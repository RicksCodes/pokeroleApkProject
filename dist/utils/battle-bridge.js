/**
 * POKEROLE MANAGER — battle-bridge.js
 * Connessione P2P via WebRTC DataChannel.
 * Nessun server esterno richiesto — funziona su WiFi locale o hotspot.
 *
 * FLUSSO:
 *   HOST:   createOffer()  → ottieni stringa offer → la manda al client (copia/condividi)
 *   CLIENT: createAnswer(offer) → ottieni stringa answer → la manda all'host
 *   HOST:   setAnswer(answer) → connessione stabilita
 *
 * USO:
 *   BattleBridge.on('connected', () => { ... });
 *   BattleBridge.on('message', (msg) => { ... });
 *   BattleBridge.send('APPLY_DAMAGE', { damage: 3, targetRole: 'client' });
 *
 * NOTA: se battle.html è caricato in iframe da trainer.html, battle.html può
 * impostare window.__POKEROLE_REUSE_P2P_BRIDGE__ e window.BattleBridge dal parent
 * prima di questo script — in quel caso non creiamo una seconda connessione.
 */

(function () {
    if (window.__POKEROLE_REUSE_P2P_BRIDGE__ && window.BattleBridge) {
        return;
    }

const BattleBridge = (() => {

    // ── STATO ─────────────────────────────────────────────────────────────────
    let _pc        = null;
    let _channel   = null;
    let _role      = null;   // 'host' | 'client'
    let _handlers  = {};
    let _connected = false;
    let _keepalive = null;

    const RTC_CONFIG = {
        iceServers: []   // Solo ICE locale (LAN/hotspot), nessun server STUN/TURN esterno
    };

    // ── UTILITY ───────────────────────────────────────────────────────────────

    function _emit(event, data) {
        (_handlers[event] || []).forEach(fn => fn(data));
    }

    function _setupChannelEvents(ch) {
        ch.onopen = () => {
            _connected = true;
            console.log('[BRIDGE] DataChannel aperto');
            _emit('connected', { role: _role });

            // Keepalive ogni 15s per evitare che la connessione cada in background
            _keepalive = setInterval(() => {
                if (_channel?.readyState === 'open') {
                    _channel.send(JSON.stringify({ type: 'PING', payload: {} }));
                }
            }, 15000);
        };

        ch.onclose = () => {
            _connected = false;
            clearInterval(_keepalive);
            console.warn('[BRIDGE] DataChannel chiuso');
            _emit('disconnected', {});
        };

        ch.onerror = (e) => {
            console.error('[BRIDGE] DataChannel errore', e);
            _emit('error', { message: 'Errore DataChannel' });
        };

        ch.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); }
            catch { return; }
            if (msg.type === 'PING') return; // ignora keepalive
            _emit('message', msg);
            if (msg.type) _emit('msg:' + msg.type, msg.payload);
        };
    }

    /**
     * Attende che la raccolta ICE sia completa (o timeout 10s).
     */
    function _waitForICE(pc) {
        return new Promise((resolve) => {
            if (pc.iceGatheringState === 'complete') {
                resolve(); return;
            }
            const timeout = setTimeout(() => resolve(), 10000);
            pc.onicegatheringstatechange = () => {
                if (pc.iceGatheringState === 'complete') {
                    clearTimeout(timeout);
                    resolve();
                }
            };
        });
    }

    function _createPC() {
        const pc = new RTCPeerConnection(RTC_CONFIG);
        pc.onconnectionstatechange = () => {
            console.log('[BRIDGE] connectionState:', pc.connectionState);
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                _connected = false;
                _emit('disconnected', {});
            }
        };
        return pc;
    }

    // ── HOST ──────────────────────────────────────────────────────────────────

    async function createOffer() {
        _role = 'host';
        _pc = _createPC();

        _channel = _pc.createDataChannel('battle', {
            ordered: true,
            maxRetransmits: 10,
        });
        _setupChannelEvents(_channel);

        const offer = await _pc.createOffer();
        await _pc.setLocalDescription(offer);
        await _waitForICE(_pc);

        const encoded = _encodeSDP(_pc.localDescription.sdp, 'offer');
        console.log('[BRIDGE] Offer creata, lunghezza:', encoded.length);
        return encoded;
    }

    async function setAnswer(encodedAnswer) {
        if (!_pc) throw new Error('Chiama createOffer() prima');
        const sdp = _decodeSDP(encodedAnswer);
        await _pc.setRemoteDescription({ type: 'answer', sdp });
        console.log('[BRIDGE] Answer impostata, in attesa di connessione...');
    }

    // ── CLIENT ────────────────────────────────────────────────────────────────

    async function createAnswer(encodedOffer) {
        _role = 'client';
        _pc = _createPC();

        _pc.ondatachannel = (event) => {
            _channel = event.channel;
            _setupChannelEvents(_channel);
        };

        const sdp = _decodeSDP(encodedOffer);
        await _pc.setRemoteDescription({ type: 'offer', sdp });

        const answer = await _pc.createAnswer();
        await _pc.setLocalDescription(answer);
        await _waitForICE(_pc);

        const encoded = _encodeSDP(_pc.localDescription.sdp, 'answer');
        console.log('[BRIDGE] Answer creata, lunghezza:', encoded.length);
        return encoded;
    }

    // ── CODEC SDP ─────────────────────────────────────────────────────────────
    // SDP raw in base64 — nessun parsing, nessuna ricostruzione, zero perdite.

    function _encodeSDP(sdp, type) {
        const obj = { t: type === 'offer' ? 'o' : 'a', s: sdp };
        return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    }

    function _decodeSDP(encoded) {
        try {
            const obj = JSON.parse(decodeURIComponent(escape(atob(encoded))));
            return obj.s;
        } catch (e) {
            throw new Error('Codice non valido. Riprova.');
        }
    }

    // ── INVIO MESSAGGI ────────────────────────────────────────────────────────

    function send(type, payload = {}) {
        if (!_channel || _channel.readyState !== 'open') {
            console.warn('[BRIDGE] Canale non aperto, impossibile inviare:', type);
            return false;
        }
        _channel.send(JSON.stringify({ type, payload }));
        return true;
    }

    // ── EVENTI ────────────────────────────────────────────────────────────────

    function on(event, fn) {
        if (!_handlers[event]) _handlers[event] = [];
        _handlers[event].push(fn);
    }

    function off(event, fn) {
        if (!_handlers[event]) return;
        _handlers[event] = _handlers[event].filter(f => f !== fn);
    }

    // ── DISCONNESSIONE ────────────────────────────────────────────────────────

    function disconnect() {
        send('OPPONENT_DISCONNECTED', { role: _role });
        clearInterval(_keepalive);
        if (_channel) { _channel.close(); _channel = null; }
        if (_pc)      { _pc.close();      _pc = null;      }
        _connected = false;
        _role = null;
        _emit('disconnected', {});
    }

    // ── GETTER ────────────────────────────────────────────────────────────────

    const getRole     = () => _role;
    const isConnected = () => _connected;

    // ── API PUBBLICA ──────────────────────────────────────────────────────────
    return {
        createOffer, setAnswer, createAnswer,
        send, on, off,
        disconnect,
        getRole, isConnected,
    };

})();

window.BattleBridge = BattleBridge;
})();
