/**
 * POKEROLE MANAGER — battle-lobby.js  (v3 — sync initiative + split ability questions)
 *
 * FLUSSO:
 *   STEP 0 — Scelta Host / Join
 *   STEP 1H — Host: copia/condividi stringa offer → attende answer dal client
 *   STEP 1C — Client: incolla stringa offer → riceve answer → la condivide
 *   STEP 2H — Host: incolla stringa answer del client
 *   [connessione stabilita → indicatore verde su entrambi]
 *   STEP 3  — Selezione team
 *   STEP 4  — Scelta primo Pokémon
 *   STEP 4b — Lancio dadi iniziativa (simultaneo via bridge)
 *   STEP 5a — Domanda abilità meteo (entrambi i trainer)
 *   STEP 5b — Domanda abilità statistiche (entrambi i trainer)
 *   STEP 6  — Pronti → vai a battle.html
 *
 * NOVITÀ v3:
 *   - Iniziativa calcolata tramite lancio dadi (DEX+Alert dadi d6, successi ≥4),
 *     entrambi i trainer tirano in contemporanea, chi fa più successi va per primo.
 *   - Step abilità diviso in due domande separate:
 *       5a: "Il tuo Pokémon ha un'abilità che altera il METEO?"
 *       5b: "Il tuo Pokémon ha un'abilità che altera le STATISTICHE?"
 *   - Entrambi host e client passano per entrambe le domande abilità.
 *   - Il numero di successi iniziativa viene salvato in sessionStorage per battle.js.
 */

// ── MAPPE DATI ────────────────────────────────────────────────────────────────

const TYPE_MAP = {
    0:'???', 1:'Normal', 2:'Fire', 3:'Water', 4:'Electric', 5:'Grass',
    6:'Ice', 7:'Fighting', 8:'Poison', 9:'Ground', 10:'Flying',
    11:'Psychic', 12:'Bug', 13:'Rock', 14:'Ghost', 15:'Dragon',
    16:'Dark', 17:'Steel', 18:'Fairy'
};

const WEATHER_TYPE_EFFECTS = {
    sun:       { 2: { Special: 1 }, 3: { Special: -1 } },
    rain:      { 3: { Special: 1 }, 2: { Special: -1 } },
    sandstorm: { 13: { Vitality: 1 }, 17: { Vitality: 1 }, 9: { Vitality: 1 } },
    hail:      { 6: { Vitality: 1 } },
    fog:       {},
};

function _parsePriority(effectText) {
    if (!effectText) return 0;
    const low  = effectText.match(/Low\s+Priority\s+(\d+)/i);
    if (low)  return -parseInt(low[1]);
    const high = effectText.match(/Priority\s+(\d+)/i);
    if (high) return parseInt(high[1]);
    return 0;
}

// ── STATO LOBBY ───────────────────────────────────────────────────────────────

const LobbyState = {
    step:          0,
    role:          null,
    selectedTeam:  [],
    firstPokemon:  null,
    weather:       null,
    weatherTurns:  -1,
    opponentReady: false,
    myReady:       false,

    // Iniziativa dadi
    myInitDice:    0,    // pool dadi da tirare
    myInitRolls:   [],   // risultati
    myInitSucc:    0,    // successi
    oppInitSucc:   null, // successi avversario (ricevuti via bridge)
    _initResolved: false, // guard contro doppia chiamata _risolviInizLatidative

};

const WEATHER_OPTIONS = [
    { id: 'sun',       label: '☀️ Sole Intenso',       desc: 'Potenzia mosse Fuoco, indebolisce mosse Acqua' },
    { id: 'rain',      label: '🌧️ Pioggia',            desc: 'Potenzia mosse Acqua, indebolisce mosse Fuoco' },
    { id: 'sandstorm', label: '🌪️ Tempesta di Sabbia',  desc: 'Danno ai tipi non Roccia/Acciaio/Terra ogni turno' },
    { id: 'hail',      label: '🌨️ Grandine',           desc: 'Danno ai tipi non Ghiaccio ogni turno' },
    { id: 'fog',       label: '🌫️ Nebbia',             desc: 'Riduce precisione di tutti' },
    { id: 'none',      label: '🌤️ Nessun Meteo',       desc: 'Condizioni normali' },
];

// ── APERTURA / CHIUSURA ───────────────────────────────────────────────────────

function apriBattleLobby() {
    Object.assign(LobbyState, {
        step: 0, role: null, selectedTeam: [], firstPokemon: null,
        weather: null, weatherTurns: -1,
        opponentReady: false, myReady: false,
        myInitDice: 0, myInitRolls: [], myInitSucc: 0, oppInitSucc: null,
        _initResolved: false,
    });
    document.getElementById('modal-battle-lobby').style.display = 'flex';
    renderLobbyStep(0);
    if (typeof MusicManager !== 'undefined') MusicManager.playForScreen('lobby');
}

function chiudiBattleLobby() {
    BattleBridge.disconnect();
    document.getElementById('modal-battle-lobby').style.display = 'none';
    if (typeof MusicManager !== 'undefined') MusicManager.playForScreen('trainer');
}

function lobbyGoBack() {
    if (LobbyState.step <= 1) {
        chiudiBattleLobby();
    } else {
        renderLobbyStep(LobbyState.step - 1);
    }
}

// ── INDICATORE CONNESSIONE ────────────────────────────────────────────────────

function aggiornaIndicatoreConnessione(stato) {
    const el = document.getElementById('conn-indicator');
    if (!el) return;
    const cfg = {
        waiting:    { color: '#9e9e9e', label: 'In attesa…',      pulse: false },
        connecting: { color: '#ff9800', label: 'Connessione…',    pulse: true  },
        connected:  { color: '#4caf50', label: 'Connesso ✓',      pulse: false },
        error:      { color: '#f44336', label: 'Errore',          pulse: false },
    };
    const c = cfg[stato] || cfg.waiting;
    el.innerHTML = `
        <span style="
            display:inline-block;
            width:13px; height:13px;
            border-radius:50%;
            background:${c.color};
            box-shadow: 0 0 0 3px ${c.color}33;
            ${c.pulse ? 'animation:conn-pulse 1.1s ease-in-out infinite;' : ''}
            vertical-align:middle;
            margin-right:7px;
            flex-shrink:0;
        "></span>
        <span style="font-size:0.82rem; color:var(--text-color); opacity:0.85; vertical-align:middle;">${c.label}</span>
    `;
}

(function _injectPulseKeyframe() {
    if (document.getElementById('conn-pulse-style')) return;
    const s = document.createElement('style');
    s.id = 'conn-pulse-style';
    s.textContent = `
        @keyframes conn-pulse {
            0%   { box-shadow: 0 0 0 0   rgba(255,152,0,0.6); }
            70%  { box-shadow: 0 0 0 8px rgba(255,152,0,0);   }
            100% { box-shadow: 0 0 0 0   rgba(255,152,0,0);   }
        }
    `;
    document.head.appendChild(s);
})();

function _connBanner() {
    return `
        <div id="conn-indicator" style="
            display:flex; align-items:center;
            padding:9px 14px; border-radius:10px;
            border:1.5px solid var(--border-color);
            background:var(--bg-color);
            margin-bottom:4px;
            box-shadow:0 1px 4px rgba(0,0,0,0.10);
        "></div>
    `;
}

// ── ROUTER STEP ───────────────────────────────────────────────────────────────

function renderLobbyStep(step) {
    LobbyState.step = step;
    document.getElementById('lobby-btn-back').style.visibility =
        step === 0 ? 'hidden' : 'visible';

    const content = document.getElementById('lobby-content');
    content.innerHTML = '';

    switch (step) {
        case 0:  return renderStep0(content);
        case 1:  return renderStep1(content);
        case 2:  return renderStep2(content);
        case 3:  return renderStep3(content);
        case 4:  return renderStep4(content);
        case '4b': return renderStep4b(content);
        case 6:  return renderStep6(content);
    }
}

// ── STEP 0: SCELTA HOST / JOIN ────────────────────────────────────────────────

function renderStep0(content) {
    document.getElementById('lobby-title').textContent = '⚔️ Battaglia Multiplayer';
    content.innerHTML = `
        <p style="text-align:center; color:var(--accent-blue); opacity:0.7; margin:8px 0 24px;">
            Assicurati di essere sulla stessa rete WiFi o hotspot dell'avversario.
        </p>
        <button onclick="scegliRuolo('host')" style="${btnStyle('#e53935')}">
            📡 Crea Partita (Host)
        </button>
        <p style="text-align:center; font-size:0.78rem; color:var(--accent-blue); opacity:0.55; margin:-4px 0 16px;">
            Genera il codice da condividere all'avversario
        </p>
        <button onclick="scegliRuolo('client')" style="${btnStyle('var(--accent-blue)')}">
            🔗 Unisciti (Join)
        </button>
        <p style="text-align:center; font-size:0.78rem; color:var(--accent-blue); opacity:0.55; margin:-4px 0 0;">
            Incolla il codice ricevuto dall'host
        </p>
    `;
}

async function scegliRuolo(role) {
    LobbyState.role = role;

    BattleBridge.on('connected',            _onConnected);
    BattleBridge.on('disconnected',         _onDisconnected);
    BattleBridge.on('msg:OPPONENT_READY',   _onOpponentReady);
    BattleBridge.on('msg:BATTLE_START_ACK', _onBattleStartAck);
    // Listener per scambio risultati iniziativa
    BattleBridge.on('msg:INIT_RESULT',      _onOpponentInitResult);

    if (role === 'host') {
        showLobbyLoading('Generazione codice di connessione…');
        try {
            const offer = await BattleBridge.createOffer();
            sessionStorage.setItem('battle_offer', offer);
            renderLobbyStep(1);
        } catch (e) {
            showLobbyError('Errore nella creazione codice: ' + e.message);
        }
    } else {
        renderLobbyStep(1);
    }
}

// ── STEP 1 ────────────────────────────────────────────────────────────────────

function renderStep1(content) {
    if (LobbyState.role === 'host') renderStep1Host(content);
    else                             renderStep1Client(content);
}

function renderStep1Host(content) {
    document.getElementById('lobby-title').textContent = '📡 Invia il Codice';
    const offer = sessionStorage.getItem('battle_offer') || '';
    content.innerHTML = `
        ${_connBanner()}
        <p style="${labelStyle()} color:var(--accent-blue);">Condividi questo codice con il tuo avversario:</p>
        <textarea readonly style="${textareaStyle()} min-height:90px;">${offer}</textarea>
        <div style="display:flex; margin-top:6px;">
            <button onclick="copiaStringa('${_escAttr(offer)}', this)" style="${btnSmall()} flex:1; margin-right:8px;">📋 Copia</button>
            <button onclick="condividiStringa('${_escAttr(offer)}')" id="btn-share-offer" style="${btnSmall()} flex:1;">📤 Condividi</button>
        </div>
        <div style="margin:20px 0 8px; padding:13px; background:rgba(255,193,7,0.18);
             border-radius:12px; border:1px solid rgba(255,193,7,0.55); font-size:0.84rem;
             color:var(--accent-blue); text-align:center;">
            ⏳ Aspetta che il client generi la sua risposta, poi incollala qui sotto.
        </div>
        <p style="${labelStyle()} margin-top:8px; color:var(--accent-blue);">Incolla la risposta del client:</p>
        <textarea id="answer-text-input" placeholder="Incolla qui il codice del client…"
            style="${textareaStyle()} min-height:90px;"></textarea>
        <button onclick="hostRiceveAnswerDaTesto()" style="${btnStyle('#27ae60')} margin-top:8px;">
            ✅ Connetti
        </button>
    `;
    if (!navigator.share) {
        const btn = document.getElementById('btn-share-offer');
        if (btn) btn.style.display = 'none';
    }
    aggiornaIndicatoreConnessione('waiting');
}

async function hostRiceveAnswerDaTesto() {
    const testo = document.getElementById('answer-text-input')?.value?.trim();
    if (!testo) { showToast('Incolla prima il codice del client.'); return; }
    showLobbyLoading('Finalizzazione connessione…');
    aggiornaIndicatoreConnessione('connecting');
    try {
        await BattleBridge.setAnswer(testo);
    } catch (e) {
        showLobbyError('Codice non valido: ' + e.message);
    }
}

function renderStep1Client(content) {
    document.getElementById('lobby-title').textContent = '🔗 Connettiti all\'Host';
    content.innerHTML = `
        ${_connBanner()}
        <p style="${labelStyle()} color:var(--accent-blue);">Incolla il codice ricevuto dall'host:</p>
        <textarea id="offer-text-client" placeholder="Incolla qui il codice dell'host…"
            style="${textareaStyle()} min-height:90px;"></textarea>
        <button onclick="clientUsaTesto()" style="${btnStyle('#e53935')} margin-top:8px;">
            ▶️ Genera risposta
        </button>
    `;
    aggiornaIndicatoreConnessione('waiting');
}

async function clientUsaTesto() {
    const testo = document.getElementById('offer-text-client')?.value?.trim();
    if (!testo) { showToast('Incolla prima il codice dell\'host.'); return; }
    showLobbyLoading('Generazione risposta…');
    aggiornaIndicatoreConnessione('connecting');
    try {
        const answer = await BattleBridge.createAnswer(testo);
        sessionStorage.setItem('battle_answer', answer);
        renderClientMostraAnswer(answer);
    } catch (e) {
        showLobbyError('Codice non valido: ' + e.message);
    }
}

function renderClientMostraAnswer(answer) {
    document.getElementById('lobby-title').textContent = '📤 Invia la Risposta';
    const content = document.getElementById('lobby-content');
    content.innerHTML = `
        ${_connBanner()}
        <p style="${labelStyle()}">Condividi questa risposta con l'host:</p>
        <textarea readonly style="${textareaStyle()} min-height:90px;">${answer}</textarea>
        <div style="display:flex; margin-top:6px;">
            <button onclick="copiaStringa('${_escAttr(answer)}', this)" style="${btnSmall()} flex:1; margin-right:8px;">📋 Copia</button>
            <button onclick="condividiStringa('${_escAttr(answer)}')" id="btn-share-answer" style="${btnSmall()} flex:1;">📤 Condividi</button>
        </div>
        <div style="margin-top:20px; padding:13px; background:rgba(255,193,7,0.18);
             border-radius:12px; border:1px solid rgba(255,193,7,0.55); font-size:0.84rem;
             color:var(--text-color); text-align:center;">
            ⏳ Aspetta che l'host incolli la tua risposta e completi la connessione…
        </div>
    `;
    if (!navigator.share) {
        const btn = document.getElementById('btn-share-answer');
        if (btn) btn.style.display = 'none';
    }
    aggiornaIndicatoreConnessione('connecting');
}

function renderStep2(content) { renderLobbyStep(3); }

// ── STEP 3: SELEZIONE TEAM ───────────────────────────────────────────────────

function renderStep3(content) {
    document.getElementById('lobby-title').textContent = '👥 Seleziona il Team';
    const team = currentTrainer?.team || [];
    content.innerHTML = `
        <p style="${labelStyle()}">
            Scegli fino a 6 Pokémon dal tuo team
            <span style="opacity:0.6; font-size:0.8rem;">(Box escluso)</span>:
        </p>
        <p id="team-sel-count" style="text-align:center; font-size:0.85rem;
            color:var(--accent-blue); font-weight:600; margin:0 0 8px;">
            Selezionati: 0 / 6
        </p>
        <div id="team-sel-grid" style="display:flex; flex-direction:column;"></div>
        <button id="btn-team-confirm" onclick="confermaTeam()" disabled
            style="${btnStyle('#27ae60')} margin-top:16px; opacity:0.4;">
            ✅ Conferma Team
        </button>
    `;
    const grid = document.getElementById('team-sel-grid');
    team.forEach((nomePokemon, slotIndex) => {
        if (!nomePokemon) return;
        const pkData = currentTrainer?.teamData?.[slotIndex] || {};

        const pkBaseData = window.pokedexDatabase?.find(p => p.Name === nomePokemon);
        const baseHP = pkData.baseHP ?? pkBaseData?.BaseHP ?? 0;
        const finalHP = baseHP + (pkData.stats?.Vitality || 0);

        const div = document.createElement('div');
        div.id = `team-slot-${slotIndex}`;
        div.style.cssText = `
            display:flex; align-items:center; padding:10px 14px;
            border-radius:12px; border:2px solid var(--border-color);
            background:var(--bg-color); cursor:pointer;
            transition: border-color 0.2s, background 0.2s; margin-bottom:10px;
            box-shadow:0 1px 4px rgba(0,0,0,0.09);
        `;
        div.innerHTML = `
            <img src="img/pokemon/${_slugPokemon(nomePokemon)}.png"
                 onerror="this.src='img/pokemon/unknown.png'"
                 style="width:52px; height:52px; object-fit:contain; image-rendering:pixelated; margin-right:12px;">
            <div style="flex:1;">
                <div style="font-weight:700; color:var(--text-color);">${nomePokemon}</div>
                <div style="font-size:0.75rem; color:var(--text-color); opacity:0.6;">
                    HP: ${finalHP} | Slot ${slotIndex + 1}
                </div>
            </div>
            <span id="check-${slotIndex}" style="font-size:1.4rem;">⬜</span>
        `;
        div.onclick = () => toggleTeamSlot(slotIndex, nomePokemon, pkData);
        grid.appendChild(div);
    });
}

function toggleTeamSlot(slotIndex, nome, pkData) {
    const existing = LobbyState.selectedTeam.findIndex(p => p.slotIndex === slotIndex);
    const check = document.getElementById(`check-${slotIndex}`);
    const slot  = document.getElementById(`team-slot-${slotIndex}`);
    if (existing >= 0) {
        LobbyState.selectedTeam.splice(existing, 1);
        check.textContent = '⬜';
        slot.style.borderColor = 'var(--border-color)';
        slot.style.background  = 'var(--bg-color)';
    } else {
        if (LobbyState.selectedTeam.length >= 6) {
            showToast('Massimo 6 Pokémon!'); return;
        }
        LobbyState.selectedTeam.push({ slotIndex, name: nome, data: pkData });
        check.textContent = '✅';
        slot.style.borderColor = '#27ae60';
        slot.style.background  = 'rgba(39,174,96,0.08)';
    }
    const count = LobbyState.selectedTeam.length;
    document.getElementById('team-sel-count').textContent = `Selezionati: ${count} / 6`;
    const btn = document.getElementById('btn-team-confirm');
    btn.disabled = count === 0;
    btn.style.opacity = count === 0 ? '0.4' : '1';
}

function confermaTeam() {
    if (LobbyState.selectedTeam.length === 0) return;
    renderLobbyStep(4);
}

// ── STEP 4: PRIMO POKEMON ────────────────────────────────────────────────────

function renderStep4(content) {
    document.getElementById('lobby-title').textContent = '🥊 Primo Pokémon';
    content.innerHTML = `
        <p style="${labelStyle()}">Chi mandi in campo per primo?</p>
        <p style="font-size:0.78rem; color:var(--text-color); opacity:0.55; margin:-4px 0 10px;">
            Dopo la scelta tirerai l'iniziativa (DEX + Alert + 1d6) in contemporanea con l'avversario.
            Le mosse con Priorità agiscono prima indipendentemente dall'iniziativa.
        </p>
        <div id="first-pkmn-grid" style="display:flex; flex-direction:column;"></div>
    `;
    const grid = document.getElementById('first-pkmn-grid');
    LobbyState.selectedTeam.forEach((pk, idx) => {
        const div = document.createElement('div');
        div.style.cssText = `
            display:flex; align-items:center; padding:12px 14px;
            border-radius:12px; border:2px solid var(--border-color);
            background:var(--bg-color); cursor:pointer; margin-bottom:10px;
            box-shadow:0 1px 4px rgba(0,0,0,0.09);
        `;
        const pkStats  = pk.data?.stats  || {};
        const pkSkills = pk.data?.skills || {};
        const initPool = (pkStats.Dexterity || 0) + (pkSkills.Alert || 0);
        const moves = pk.data?.moves || [];
        const movesDb = window.moveDatabase || [];
        const priorityMoves = moves
            .filter(Boolean)
            .map(nome => movesDb.find(m => m.Name?.toLowerCase() === nome.toLowerCase()))
            .filter(m => m && _parsePriority(m.Effect) > 0)
            .map(m => `${m.Name} (P${_parsePriority(m.Effect)})`);
        div.innerHTML = `
            <img src="img/pokemon/${_slugPokemon(pk.name)}.png"
                 onerror="this.src='img/pokemon/unknown.png'"
                 style="width:52px; height:52px; object-fit:contain; image-rendering:pixelated; margin-right:12px;">
            <div style="flex:1;">
                <div style="font-weight:700; color:var(--text-color);">${pk.name}</div>
                <div style="font-size:0.75rem; color:var(--text-color); opacity:0.6;">
                    Iniziativa base: ${initPool} (DEX ${pkStats.Dexterity || 0} + Alert ${pkSkills.Alert || 0}) + 1d6
                </div>
                ${priorityMoves.length ? `
                <div style="font-size:0.72rem; color:#ffb300; margin-top:2px;">
                    ⚡ Mosse priorità: ${priorityMoves.join(', ')}
                </div>` : ''}
            </div>
            <span style="font-size:1.1rem;">▶️</span>
        `;
        div.onclick = () => {
            LobbyState.firstPokemon  = idx;
            LobbyState.myInitDice    = initPool;
            LobbyState.myInitRolls   = [];
            LobbyState.myInitSucc    = 0;
            LobbyState._initResolved = false;
            // NON azzerare oppInitSucc: se l'host ha già tirato e il messaggio
            // INIT_RESULT è arrivato in anticipo, il valore va preservato.
            renderLobbyStep('4b');
        };
        grid.appendChild(div);
    });
}

// ── STEP 4b: LANCIO DADI INIZIATIVA ─────────────────────────────────────────

function renderStep4b(content) {
    document.getElementById('lobby-title').textContent = '🎲 Iniziativa';
    const pk       = LobbyState.selectedTeam[LobbyState.firstPokemon];
    const baseInit = LobbyState.myInitDice;

    const diceArea = `
        <div id="init-dice-results" style="
            display:flex; flex-wrap:wrap; min-height:54px;
            padding:10px; border-radius:10px;
            border:1.5px solid var(--border-color);
            background:var(--bg-color); margin-bottom:12px; align-items:center;">
        </div>
        <div id="init-dice-summary" style="
            text-align:center; font-size:0.9rem; font-weight:700;
            color:var(--text-color); margin-bottom:12px;">
            Iniziativa totale: —
        </div>
    `;

    if (LobbyState.role === 'host') {
        content.innerHTML = `
            <p style="${labelStyle()}">Tira l'iniziativa per <b>${pk?.name || '—'}</b></p>
            <p style="font-size:0.82rem; color:var(--text-color); opacity:0.6; margin:-4px 0 12px;">
                Iniziativa base: <b>${baseInit}</b> (DEX + Alert). Il client tirerà dopo di te.
            </p>
            ${diceArea}
            <button id="btn-init-roll" onclick="_lobbyTiraD6(${baseInit})" style="${btnStyle('#1565c0')}">
                🎲 Tira 1d6
            </button>
            <div id="init-wait-msg" style="display:none; text-align:center; margin-top:12px;
                font-size:0.82rem; color:var(--text-color); opacity:0.65;">
                ⏳ In attesa che il client tiri…
            </div>
        `;
    } else {
        // Client: se l'host ha già tirato (messaggio arrivato prima di questo step)
        // mostra subito il pulsante, altrimenti il messaggio d'attesa
        const hostGiaHaTirato = LobbyState.oppInitSucc !== null;
        content.innerHTML = `
            <p style="${labelStyle()}">Tira l'iniziativa per <b>${pk?.name || '—'}</b></p>
            <p style="font-size:0.82rem; color:var(--text-color); opacity:0.6; margin:-4px 0 12px;">
                Iniziativa base: <b>${baseInit}</b> (DEX + Alert). Tira dopo l'host.
            </p>
            ${diceArea}
            ${hostGiaHaTirato
                ? `<button id="btn-init-roll" onclick="_lobbyTiraD6(${baseInit})"
                       style="${btnStyle('#1565c0')}">🎲 Tira 1d6</button>`
                : `<div id="init-wait-host" style="text-align:center; padding:14px 0;
                       font-size:0.82rem; color:var(--text-color); opacity:0.65;">
                       ⏳ Attendi che l'host tiri l'iniziativa…
                   </div>`
            }
        `;
    }
}

function _lobbyTiraD6(baseInit) {
    const rollBtn = document.getElementById('btn-init-roll');
    if (rollBtn) { rollBtn.disabled = true; rollBtn.style.opacity = '0.5'; }

    const r     = Math.floor(Math.random() * 6) + 1;
    const total = baseInit + r;
    LobbyState.myInitSucc = total;

    const wrap = document.getElementById('init-dice-results');
    if (wrap) {
        wrap.innerHTML = `
            <div style="display:flex; align-items:center; width:100%;">
                <div style="width:48px; height:48px; border-radius:10px;
                    display:flex; align-items:center; justify-content:center;
                    font-size:1.4rem; font-weight:900; margin-right:12px;
                    background:rgba(21,101,192,0.18); border:2px solid #1565c0; color:#42a5f5;">
                    ${r}
                </div>
                <div style="font-size:0.9rem; color:var(--text-color);">
                    d6 = <b>${r}</b> + base <b>${baseInit}</b> = <b style="color:#42a5f5;">${total}</b>
                </div>
            </div>
        `;
    }
    const summary = document.getElementById('init-dice-summary');
    if (summary) summary.textContent = `Iniziativa totale: ${total}`;

    // Invia subito il risultato all'avversario
    BattleBridge.send('INIT_RESULT', { successi: total });

    if (LobbyState.oppInitSucc !== null) {
        // Il risultato dell'avversario è già arrivato (client ha appena tirato) → risolvi subito
        _risolviInizLatidative();
    } else {
        // Host: aspetta che il client tiri
        const waitMsg = document.getElementById('init-wait-msg');
        if (waitMsg) waitMsg.style.display = 'block';
    }
}

function _lobbyConfermaInit() {
    const successi = LobbyState.myInitSucc;
    BattleBridge.send('INIT_RESULT', { successi });

    const btn = document.getElementById('btn-init-confirm');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
    const rollBtn = document.getElementById('btn-init-roll');
    if (rollBtn) { rollBtn.disabled = true; rollBtn.style.opacity = '0.5'; }
    const waitMsg = document.getElementById('init-wait-msg');
    if (waitMsg) waitMsg.style.display = 'block';

    // Se abbiamo già ricevuto il risultato dell'avversario, procedi subito
    if (LobbyState.oppInitSucc !== null) {
        _risolviInizLatidative();
    }
}

function _onOpponentInitResult(payload) {
    LobbyState.oppInitSucc = payload.successi ?? 0;

    if (LobbyState.role === 'client') {
        // L'host ha tirato: sblocca il pulsante per il client
        const waitEl = document.getElementById('init-wait-host');
        if (waitEl) {
            waitEl.outerHTML = `
                <button id="btn-init-roll" onclick="_lobbyTiraD6(${LobbyState.myInitDice})"
                    style="${btnStyle('#1565c0')}">
                    🎲 Tira 1d6
                </button>
            `;
        }
    } else {
        // Host: il client ha appena tirato, entrambi i risultati ci sono → risolvi
        if (LobbyState.myInitSucc > 0) {
            _risolviInizLatidative();
        }
    }
}

function _risolviInizLatidative() {
    if (LobbyState._initResolved) return;
    LobbyState._initResolved = true;

    const mine = LobbyState.myInitSucc;
    const opp  = LobbyState.oppInitSucc;

    // Parità → host va per primo
    let firstTurnAbsoluto;
    if (mine > opp) {
        firstTurnAbsoluto = LobbyState.role;
    } else if (opp > mine) {
        firstTurnAbsoluto = LobbyState.role === 'host' ? 'client' : 'host';
    } else {
        firstTurnAbsoluto = 'host';
    }

    sessionStorage.setItem('battle_firstTurn',  firstTurnAbsoluto);
    sessionStorage.setItem('battle_myInit',      String(mine));
    sessionStorage.setItem('battle_oppInit',     String(opp));

    const content = document.getElementById('lobby-content');
    const chi    = firstTurnAbsoluto === LobbyState.role ? 'Vai per primo TU!' : 'Va per primo l\'AVVERSARIO.';
    const colore = firstTurnAbsoluto === LobbyState.role ? '#27ae60' : '#ff9800';

    if (content) {
        content.innerHTML = `
            <div style="text-align:center; padding:24px 0;">
                <div style="font-size:2.2rem; margin-bottom:8px;">🎲</div>
                <p style="font-size:1rem; font-weight:800; color:${colore}; margin:0 0 4px;">${chi}</p>
                <p style="font-size:0.85rem; color:var(--text-color); opacity:0.65;">
                    La tua iniziativa: <b>${mine}</b> &nbsp;|&nbsp; Iniziativa avversario: <b>${opp}</b>
                </p>
                <p style="font-size:0.8rem; color:var(--text-color); opacity:0.5; margin-top:10px;">
                    ⏳ Preparazione in corso…
                </p>
            </div>
        `;
    }

    // Avanza automaticamente allo step 6 — nessun bottone "Continua" necessario
    setTimeout(() => renderLobbyStep(6), 1500);
}

// ── STEP 6: PRONTI ────────────────────────────────────────────────────────────

function renderStep6(content) {
    return renderStep6_interno(content);
}

function renderStep6_interno(content) {
    document.getElementById('lobby-title').textContent = '🏁 Pronti!';
    const pk = LobbyState.selectedTeam[LobbyState.firstPokemon];
    const firstTurn = sessionStorage.getItem('battle_firstTurn');
    const mySucc    = sessionStorage.getItem('battle_myInit')  || '?';
    const oppSucc   = sessionStorage.getItem('battle_oppInit') || '?';
    const chiPrimo  = firstTurn === LobbyState.role ? '🟢 Vai per primo TU' : '🟡 Va per primo l\'avversario';

            
    content.innerHTML = `
        ${_connBanner()}
        <div style="text-align:center; padding:20px 0;">
            <img src="img/pokemon/${_slugPokemon(pk?.name)}.png"
                 onerror="this.src='img/pokemon/unknown.png'"
                 style="width:80px; height:80px; object-fit:contain; image-rendering:pixelated; margin-bottom:8px;">
            <p style="margin:0; font-weight:700; color:var(--text-color); font-size:1.1rem;">${pk?.name}</p>
            <p style="margin:4px 0 0; font-size:0.8rem; color:var(--text-color); opacity:0.6;">Il tuo primo Pokémon in campo</p>
        </div>
        <div style="padding:12px 14px; border-radius:12px; border:1.5px solid var(--border-color);
            background:var(--bg-color); margin-bottom:4px; font-size:0.85rem; color:var(--text-color);
            box-shadow:0 1px 4px rgba(0,0,0,0.09);">
            <b>Team:</b> ${LobbyState.selectedTeam.map(p => p.name).join(', ')}<br>
            <b>Iniziativa:</b> Tuoi successi: ${mySucc} | Avversario: ${oppSucc} — ${chiPrimo}<br>
            
            <b>Ruolo:</b> ${LobbyState.role === 'host' ? '📡 Host' : '🔗 Client'}
        </div>
        <button onclick="inviaReadyEProcedi()" id="btn-inizia-battaglia"
            style="${btnStyle('#e53935')} margin-top:16px;">
            ⚔️ Inizia la Battaglia!
        </button>
        <p id="ready-status" style="text-align:center; font-size:0.82rem;
            color:var(--text-color); opacity:0.6; margin-top:8px;"></p>
    `;
    aggiornaIndicatoreConnessione(BattleBridge.isConnected() ? 'connected' : 'connecting');
}

function inviaReadyEProcedi() {
    const payload = _buildTeamPayload();
    BattleBridge.send('OPPONENT_READY', payload);
    LobbyState.myReady = true;

    const status = document.getElementById('ready-status');
    if (status) status.textContent = '⏳ In attesa dell\'avversario…';

    const btn = document.querySelector('#lobby-content button[onclick="inviaReadyEProcedi()"]');
    if (btn) btn.disabled = true;

    if (LobbyState.opponentReady) _avviaBattaglia();
}

function _buildTeamPayload() {

    return {
        trainerId:    currentTrainer.id,
        trainerName:  currentTrainer.nome,
        trainerImg:   '',
        /* team:         LobbyState.selectedTeam.map(pk => ({ name: pk.name, data: pk.data })), */
        team: LobbyState.selectedTeam.map(pk => {
            const pkBaseData = window.pokedexDatabase?.find(p => p.Name === pk.name);
            const baseHP = pk.data?.baseHP ?? pkBaseData?.BaseHP ?? 0;
            return { name: pk.name, data: { ...pk.data, baseHP: baseHP } };
        }),
        activeIndex:  LobbyState.firstPokemon,
        weather:      LobbyState.weather,
        weatherTurns: LobbyState.weatherTurns,
        role:         LobbyState.role,
        
    };
}

// ── EVENTI BRIDGE ─────────────────────────────────────────────────────────────

function _onConnected() {
    console.log('[LOBBY] Connessi!');
    aggiornaIndicatoreConnessione('connected');
    if (LobbyState.step <= 2) {
        renderLobbyStep(3);
    }
}

function _onDisconnected() {
    aggiornaIndicatoreConnessione('error');
    if (document.getElementById('modal-battle-lobby')?.style.display !== 'none') {
        showLobbyError('Connessione persa. Riprova.');
    }
}

function _onOpponentReady(payload) {
    sessionStorage.setItem('battle_opponent', JSON.stringify(payload));
    LobbyState.opponentReady = true;
    if (LobbyState.myReady) _avviaBattaglia();
}

function _onBattleStartAck() {
    _avviaBattaglia();
}

function _avviaBattaglia() {
    BattleBridge.off('disconnected', _onDisconnected);
    BattleBridge.off('msg:INIT_RESULT', _onOpponentInitResult);

    const modal = document.getElementById('modal-battle-lobby');
    if (modal) modal.style.display = 'none';

    // Il calcolo del primo turno è già in sessionStorage dal lancio dadi (step 4b).
    // Se per qualche motivo mancasse (es. partita locale senza P2P), calcoliamo fallback.
    if (!sessionStorage.getItem('battle_firstTurn')) {
        const mePayload  = _buildTeamPayload();
        const oppPayload = JSON.parse(sessionStorage.getItem('battle_opponent') || 'null');
        if (oppPayload) {
            const myPk  = LobbyState.selectedTeam[LobbyState.firstPokemon];
            const oppPk = oppPayload.team?.[oppPayload.activeIndex];
            const myInit  = (myPk?.data?.stats?.Dexterity  || 0) + (myPk?.data?.skills?.Alert  || 0);
            const oppInit = (oppPk?.data?.stats?.Dexterity || 0) + (oppPk?.data?.skills?.Alert || 0);
            const hostIsMe = LobbyState.role === 'host';
            const hostInit = hostIsMe ? myInit : oppInit;
            const clientInit = hostIsMe ? oppInit : myInit;
            const firstTurnAbsoluto = hostInit >= clientInit ? 'host' : 'client';
            sessionStorage.setItem('battle_firstTurn', firstTurnAbsoluto);
            sessionStorage.setItem('battle_myInit',  String(myInit));
            sessionStorage.setItem('battle_oppInit', String(oppInit));
        }
    }

    sessionStorage.setItem('battle_me',   JSON.stringify(_buildTeamPayload()));
    sessionStorage.setItem('battle_role', LobbyState.role);

    if (typeof window._enterBattleInline === 'function') {
        window._enterBattleInline();
    } else {
        window.location.href = 'battle.html';
    }
}

// ── UTILITY CONDIVISIONE ──────────────────────────────────────────────────────

function copiaStringa(testo, btn) {
    const _onCopiato = () => {
        showToast('Copiato!');
        if (btn) { const orig = btn.textContent; btn.textContent = '✅ Copiato'; setTimeout(() => { btn.textContent = orig; }, 1500); }
    };
    const _fallback = () => {
        try {
            const ta = document.createElement('textarea');
            ta.value = testo;
            ta.style.cssText = 'position:fixed; top:-9999px; left:-9999px; opacity:0;';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            _onCopiato();
        } catch(e) {
            showToast('Copia manualmente dal campo testo.');
        }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(testo).then(_onCopiato).catch(_fallback);
    } else {
        _fallback();
    }
}

async function condividiStringa(testo) {
    if (!navigator.share) { showToast('Condivisione non supportata su questo dispositivo.'); return; }
    try {
        await navigator.share({ title: 'PokéRole — Codice Battaglia', text: testo });
    } catch (e) {
        if (e.name !== 'AbortError') showToast('Condivisione annullata.');
    }
}

// ── UTILITY UI ────────────────────────────────────────────────────────────────

function showLobbyLoading(msg) {
    const content = document.getElementById('lobby-content');
    content.innerHTML = `
        <div style="text-align:center; padding:40px 0;">
            <div style="font-size:2rem; margin-bottom:12px;
                animation: spin 1s linear infinite; display:inline-block;">⚙️</div>
            <p style="color:var(--text-color); opacity:0.7;">${msg}</p>
        </div>
    `;
}

function showLobbyError(msg) {
    const content = document.getElementById('lobby-content');
    content.innerHTML = `
        <div style="text-align:center; padding:30px 0;">
            <p style="font-size:2rem; margin-bottom:8px;">❌</p>
            <p style="color:#e53935; font-weight:600;">${msg}</p>
            <button onclick="renderLobbyStep(0)"
                style="${btnStyle('var(--accent-blue)')} margin-top:16px;">
                ↩ Ricomincia
            </button>
        </div>
    `;
    aggiornaIndicatoreConnessione('error');
}

function showToast(msg) {
    let t = document.getElementById('lobby-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'lobby-toast';
        t.style.cssText = `
            position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
            background:rgba(0,0,0,0.8); color:#fff; padding:10px 20px;
            border-radius:20px; font-size:0.9rem; z-index:99999;
            transition:opacity 0.3s; pointer-events:none;
        `;
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timeout);
    t._timeout = setTimeout(() => { t.style.opacity = '0'; }, 2000);
}

// ── STILI CONDIVISI ───────────────────────────────────────────────────────────

function btnStyle(color) {
    return `width:100%; padding:14px; border-radius:14px; border:none;
        background:${color}; color:#fff; font-size:1rem; font-weight:700;
        cursor:pointer; -webkit-tap-highlight-color:transparent; margin-bottom:0;`;
}

function btnSmall() {
    return `padding:8px 16px; border-radius:8px; border:1.5px solid var(--border-color);
        background:var(--input-bg); color:var(--text-color); font-size:0.85rem;
        cursor:pointer; -webkit-tap-highlight-color:transparent; margin-top:6px;`;
}

function labelStyle() {
    return `display:block; font-size:0.9rem; color:var(--text-color); font-weight:600; margin:0 0 6px;`;
}

function textareaStyle() {
    return `width:100%; box-sizing:border-box; margin-top:4px; padding:10px;
        border-radius:8px; border:1.5px solid var(--border-color);
        background:var(--input-bg); color:var(--text-color);
        font-size:0.72rem; font-family:monospace; resize:vertical;`;
}

function _slugPokemon(name) {
    return (name || 'unknown').toLowerCase().replace(/\s/g, '-').replace(/[^a-z0-9-]/g, '');
}

function _escAttr(str) {
    return (str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
