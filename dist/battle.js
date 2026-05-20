/* ============================================================
   POKEROLE MANAGER — battle.js  (v3 — sync commit/reveal)
   
   NOVITÀ v3:
   ─ Flusso a "commit segreto → reveal" (come Pokémon vero):
       entrambi scelgono mossa/switch PRIMA di vedere il risultato.
   ─ Sistema priorità:
       switch         = priority 100 (sempre per primo)
       mossa Priority = valore dalla banca dati (Priority N)
       mossa normale  = priority 0, risolto dall'iniziativa
   ─ Chi va per primo viene annunciato in console con motivazione.
   ─ Se il primo attaccante mette KO l'avversario:
       → switch forzato dell'avversario
       → la mossa che aveva scelto il KO'd viene annullata
       → nuovo turno con rilancio iniziativa (il pokemon è cambiato)
   ─ Ogni switch (volontario o forzato) provoca re-roll iniziativa al turno dopo.
   ─ Modificatori abilità di lobby (lobbyAbilityMods) applicati all'avvio.

   Dipende da: battle-bridge.js
   Dati da sessionStorage (battle-lobby.js)
   ============================================================ */

// ── STATO BATTAGLIA ───────────────────────────────────────────────────────────

const Battle = {
    me:       null,   // { trainerName, trainerImg, team, activeIndex, fieldMods, koCount }
    opponent: null,   // stessa struttura
    role:     null,   // 'host' | 'client'
    round:    1,
    weather:  null,
    weatherTurns: -1,
    baseWeather: null,
    baseWeatherTurns: -1,
    phase:    'connecting',

    // ── Stato sync commit/reveal ──
    // Fase del round: 'choose' | 'resolve'
    roundPhase: 'choose',

    // La mia azione dichiarata (non ancora risolta)
    myCommit:   null,   // { type:'move'|'switch', moveName?, moveData?, newIndex?, priority }
    oppCommit:  null,   // ricevuto via bridge (stesso formato)

    // In attesa dello switch forzato post-KO
    _faintedAwaitingSwitch: false,

    // Aspetta l'INIT_REROLL dell'avversario (switch forzato KO) prima che il host avanzi il round
    _waitingForcedSwitchReroll: false,

    // Tie-break reroll: entrambi i lati rilanciano finché la parità non si rompe
    _tieRerollMyDone:  false,
    _tieRerollOppSucc: null,

    // Successi iniziativa correnti
    myInitSucc:  0,
    oppInitSucc: 0,

    // Dati dado in elaborazione (precisione / danno)
    currentMove:     null,
    currentDadiMode:  null,
    currentDadiPool:  0,
    currentDadiRolls: [],

    // ── Ordine di risoluzione (accuracy sequenziale) ──
    _iGoFirst:            false,
    _onFirstAccuracyDone: null,

    // ── Evade ──
    _lastEvadeRound:    -99,  // round in cui evade è stata usata l'ultima volta
    _evadeOnDone:       null, // callback da chiamare dopo risoluzione evade (lato evader)
    _evadeAttemptOnDone:null, // callback interna dopo il dado evade
    _oppEvadeSuccessi:  null, // successi schivata ricevuti dall'avversario
    _pendingAccSuccessi:null, // successi precisione in attesa di EVADE_RESULT
    _pendingAccOnDone:  null, // callback accuracy in attesa
    _pendingAccIsCrit:  false,

    // ── Clash ──
    _lastClashRound:    -99,  // round in cui clash è stato usato l'ultima volta
    _myClashSuccessi:   null, // miei successi clash
    _oppClashSuccessi:  null, // successi clash avversario
    _clashDeclOnDone:   null, // callback lato dichiarante dopo esito clash
    _clashAtkOnDone:    null, // callback lato attaccante (attacker wins: continua con mossa)
    _clashAtkEndCb:     null, // callback lato attaccante (tie: chiama solo _fineRound)
};

// ── COSTANTI PRIORITÀ ─────────────────────────────────────────────────────────

const SWITCH_PRIORITY    = 100;
const ITEM_HEAL_PRIORITY = 100;
const EVADE_PRIORITY     = 99;
const CLASH_PRIORITY     = 50;

// ── INIZIALIZZAZIONE ──────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
    _caricaMoveDatabase();

    const meRaw  = sessionStorage.getItem('battle_me');
    const oppRaw = sessionStorage.getItem('battle_opponent');
    const role   = sessionStorage.getItem('battle_role');

    if (!meRaw || !role) {
        log('❌ Dati di sessione mancanti. Torna al trainer.', 'system');
        tornaAlTrainer();
        return;
    }

    Battle.role = role;
    Battle.me   = _inizializzaFighter(JSON.parse(meRaw));

    if (oppRaw) {
        Battle.opponent = _inizializzaFighter(JSON.parse(oppRaw));
    }

    // Meteo iniziale (l'host ha precedenza; l'abilità è già incorporata nel payload)
    const mePayload = JSON.parse(meRaw);
    if (mePayload.weather) {
        Battle.weather      = mePayload.weather;
        Battle.weatherTurns = mePayload.weatherTurns || -1;
    }

    // Leggi iniziativa da sessionStorage (calcolata in lobby con i dadi)
    Battle.myInitSucc  = parseInt(sessionStorage.getItem('battle_myInit')  || '0');
    Battle.oppInitSucc = parseInt(sessionStorage.getItem('battle_oppInit') || '0');

    if (typeof MusicManager !== 'undefined') MusicManager.playForScreen('battle');

    _registraEventiBridge();

    window.teardownBattleP2P = function () {
        if (typeof Battle._unregisterBridgeListeners === 'function') {
            Battle._unregisterBridgeListeners();
            Battle._unregisterBridgeListeners = null;
        }
    };
    window.addEventListener('pagehide', () => {
        if (typeof window.teardownBattleP2P === 'function') window.teardownBattleP2P();
    });

    aggiornaUI();
    aggiornaHeader();

    if (Battle.opponent) {
        Battle.phase = 'battle';
        log('⚔️ La battaglia ha inizio!', 'system');
        _logIniziativa(Battle.myInitSucc, Battle.oppInitSucc, 'primo turno');
        aggiornaUI();
        // Entrambi scelgono immediatamente
        _avviaFaseScelta();
    } else {
        log('⏳ In attesa dell\'avversario...', 'system');
    }

    document.getElementById('btn-stats-panel').addEventListener('click', apriStatsPanel);
    document.getElementById('btn-disconnect').addEventListener('click', () => {
        if (confirm('Vuoi davvero disconnetterti?')) disconnetti();
    });
});

function _inizializzaFighter(data) {
    return {
        trainerName:  data.trainerName  || 'Trainer',
        trainerImg:   data.trainerImg   || '',
        role:         data.role         || 'client',
        team: (data.team || []).map(pk => {
            const st = pk.data?.stats  || {};
            const sk = pk.data?.skills || {};
            return {
                name:       pk.name,
                data:       pk.data || {},
                currentHP:  _calcolaMaxHP(pk),
                maxHP:      _calcolaMaxHP(pk),
                eliminated: false,
                // Parametri calcolati una volta sola all'ingresso in battaglia.
                // Modificabili solo tramite fieldMods.def / .defSp / .clash / .evasion.
                _params: {
                    clash:   Math.max(st.Strength || 0, st.Special || 0) + (sk.Clash   || 0),
                    evasion: (st.Dexterity || 0) + (sk.Evasion || 0),
                    def:     st.Vitality || 0,
                    defSp:   st.Insight  || 0,
                },
            };
        }),
        activeIndex:  data.activeIndex  || 0,
        abilityMods:  data.abilityMods  || {},
        weather:      data.weather      || null,
        weatherTurns: data.weatherTurns || -1,
        fieldMods:    _defaultFieldMods(),
        koCount:      0,
    };
}

function _defaultFieldMods() {
    return {
        Strength: 0, Dexterity: 0, Vitality: 0,
        Special: 0, Insight: 0,
        accuracy: 0, evasion: 0,
        clash: 0, def: 0, defSp: 0,
        initiative: 0, priorityBonus: 0, critBonus: 0,
        status: null, statusTurns: 0,
        burnCureSuccessi: 0,
        iceBlockHP: 0,         // HP blocco ghiaccio (status freeze)
        disabledMoveName: null, // nome mossa disabilitata (status disabled)
        repeatMoveName: null,  // mossa a cui il pokemon è costretto (repeat)
        repeatTurns: 0,        // turni rimanenti di repeat
        confusedTurns: 0,      // turni confusione rimanenti (0 = non confuso)
        loveTurns: 0,          // turni innamoramento rimanenti (0 = non innamorato)
        flinchActive: false,   // true se flinch attiva questo turno
        confusedMalus: false,  // true questo turno se confusion non superata (−1 succ)
        inLoveHalveDmg: false, // true questo turno se amore non superato (danno/2)
        typeImmunities: [],
        statusImmunities: [],
        typePriorityBoosts: {},
    };
}

function _calcolaMaxHP(pk) {
    const baseHP = pk.data?.baseHP || 0;
    const vit    = pk.data?.stats?.Vitality || 0;
    return baseHP + vit;
}

// ── INIZIATIVA & LOG ──────────────────────────────────────────────────────────

function _getInitPool(fighter) {
    const pk      = fighter?.team?.[fighter.activeIndex];
    const dex     = pk?.data?.stats?.Dexterity || 0;
    const alert   = pk?.data?.skills?.Alert    || 0;
    const initMod = fighter?.fieldMods?.initiative || 0;
    const dexMod  = fighter?.fieldMods?.Dexterity  || 0;
    let pool = dex + dexMod + alert + initMod;
    if (fighter?.fieldMods?.status === 'paralysis') pool = Math.floor(pool / 2);
    return Math.max(1, pool);
}

function _logIniziativa(mySucc, oppSucc, contesto) {
    const chi = mySucc > oppSucc
        ? 'Tu hai iniziativa più alta.'
        : mySucc < oppSucc
        ? 'L\'avversario ha iniziativa più alta.'
        : 'Parità — si ritira l\'iniziativa.';
    log(`🎲 Iniziativa (${contesto}) — Tu: ${mySucc} | Avversario: ${oppSucc}. ${chi}`, 'system');
}

// ── FASE SCELTA (commit segreto) ─────────────────────────────────────────────

/**
 * Avvia la fase di scelta per il turno corrente.
 * Entrambi i trainer scelgono simultaneamente.
 */
function _avviaFaseScelta() {
    Battle.roundPhase = 'choose';
    Battle.myCommit   = null;
    Battle.oppCommit  = null;
    Battle._iGoFirst            = false;
    Battle._onFirstAccuracyDone = null;
    Battle._hostRoundEndReady   = false;
    Battle._clientRoundEndReady = false;
    Battle._evadeOnDone         = null;
    Battle._evadeAttemptOnDone  = null;
    Battle._oppEvadeSuccessi    = null;
    Battle._pendingAccSuccessi  = null;
    Battle._pendingAccOnDone    = null;
    Battle._myClashSuccessi     = null;
    Battle._oppClashSuccessi    = null;
    Battle._clashDeclOnDone     = null;
    Battle._clashAtkOnDone      = null;
    Battle._clashAtkEndCb       = null;
    Battle._pendingFirstAccDone = false;

    const doTurnStart = () => {
        apriModalAbilitaTurno('inizio', () => {
            apriModalOggettoTurno('inizio', () => {
                _controllaStatusInizioTurno(() => {
                    aggiornaUI();
                    aggiornaHeader();
                });
            });
        });
    };

    // Se lo switch forzato è ancora aperto (KO avvenuto prima del cambio round),
    // aspetta: dopo lo switch il normale flusso chiamerà di nuovo _avviaFaseScelta.
    const switchEl = document.getElementById('modal-switch');
    if (switchEl && !switchEl.classList.contains('hidden')) return;

    if (Battle.round === 1 && Battle.role === 'host') {
        apriModalMeteoInizio(doTurnStart);
    } else {
        doTurnStart();
    }
}

// ── EVENTI BRIDGE ─────────────────────────────────────────────────────────────

function _registraEventiBridge() {
    const subs = [];
    const sub = (ev, fn) => { BattleBridge.on(ev, fn); subs.push([ev, fn]); };

    sub('msg:OPPONENT_READY', (payload) => {
        if (!Battle.opponent) {
            Battle.opponent = _inizializzaFighter(payload);
            Battle.phase    = 'battle';

            if (Battle.role === 'host' && Battle.me.weather) {
                Battle.weather      = Battle.me.weather;
                Battle.weatherTurns = Battle.me.weatherTurns || -1;
            } else if (payload.weather) {
                Battle.weather      = payload.weather;
                Battle.weatherTurns = payload.weatherTurns || -1;
            }

            Battle.myInitSucc  = parseInt(sessionStorage.getItem('battle_myInit')  || '0');
            Battle.oppInitSucc = parseInt(sessionStorage.getItem('battle_oppInit') || '0');

            log('⚔️ La battaglia ha inizio!', 'system');
            _logIniziativa(Battle.myInitSucc, Battle.oppInitSucc, 'primo turno');
            aggiornaUI();
            aggiornaHeader();
            _avviaFaseScelta();
        }
    });

    // ── Ricezione commit avversario ──────────────────────────────────────────
    sub('msg:OPP_COMMIT', (payload) => {
        Battle.oppCommit = payload;
        // Reset evade/clash cross-state
        Battle._oppEvadeSuccessi  = null;
        Battle._pendingAccSuccessi = null;
        Battle._pendingAccOnDone  = null;
        Battle._oppClashSuccessi  = null;
        log(`🔒 ${_nomeOpp()} ha scelto la propria azione.`, 'system');
        if (Battle.myCommit) {
            _faseReveal();
        }
    });

    // ── Evade: evader invia i suoi successi schivata ─────────────────────────
    sub('msg:EVADE_RESULT', (payload) => {
        Battle._oppEvadeSuccessi = payload.successi ?? 0;
        if (Battle._pendingAccSuccessi !== null) {
            const acc = Battle._pendingAccSuccessi;
            const cb  = Battle._pendingAccOnDone;
            Battle._pendingAccSuccessi = null;
            Battle._pendingAccOnDone   = null;
            _completaEvadeCheck(acc, cb);
        }
    });

    // ── Evade: attaccante comunica l'esito ────────────────────────────────────
    sub('msg:EVADE_OUTCOME', (payload) => {
        const { dodged, evadeSuccessi, accSuccessi } = payload;
        if (dodged) {
            logBoth(`🛡️ Schivata riuscita! (Evasione: ${evadeSuccessi} ≥ Precisione: ${accSuccessi}) — nessun danno!`, 'action');
            const cb = Battle._evadeOnDone;
            Battle._evadeOnDone = null;
            cb?.();
        } else {
            logBoth(`❌ Schivata fallita! (Evasione: ${evadeSuccessi} < Precisione: ${accSuccessi}) — l'attacco continua.`, 'action');
            // _fineRound sarà chiamato in msg:APPLY_HP_MOD o msg:APPLY_DAMAGE
        }
    });

    // ── Clash: attaccante invia i suoi successi clash ─────────────────────────
    sub('msg:CLASH_ATK_RESULT', (payload) => {
        Battle._oppClashSuccessi = payload.successi ?? 0;
        _tryResolveClash();
    });

    // ── Clash: clash declarer invia i suoi successi ───────────────────────────
    sub('msg:CLASH_RESULT', (payload) => {
        Battle._oppClashSuccessi = payload.successi ?? 0;
        _tryResolveClash();
    });

    // ── Clash: esito clash comunicato ─────────────────────────────────────────
    sub('msg:CLASH_OUTCOME', (payload) => {
        const { result, clashSuccessi, atkSuccessi } = payload;
        if (result === 'tie') {
            // Il dichiarante ha già inviato HP_MOD_APPLIED (suo danno) e APPLY_HP_MOD (danno a me).
            // _clashAtkEndCb sarà chiamato da msg:HP_MOD_APPLIED → _fineRound() per l'attaccante.
            // _clashDeclOnDone sarà chiamato da HP_MOD_APPLIED (risposta a APPLY_HP_MOD) per il dichiarante.
            // Nessuna azione qui: i messaggi di sincronizzazione HP triggheranno i callback.
        } else {
            logBoth(`⚔️ Clash fallito! (${clashSuccessi} vs ${atkSuccessi}) — l'attaccante continua.`, 'action');
            const cb = Battle._clashAtkOnDone;
            Battle._clashAtkOnDone = null;
            cb?.();  // → _eseguiAzioneMia (move) → _fineRound
        }
    });

    // ── Richiesta re-roll iniziativa (dopo switch o tie-break) ──────────────
    sub('msg:INIT_REROLL', (payload) => {
        if (payload.isTieBreak) {
            if (Battle._tieRerollMyDone) {
                // Ho già lanciato: ora ho entrambi i valori, rientro nel reveal
                Battle.oppInitSucc       = payload.successi ?? 0;
                Battle._tieRerollMyDone  = false;
                Battle._tieRerollOppSucc = null;
                _faseReveal();
            } else {
                // Non ho ancora lanciato: salvo il valore avversario e aspetto
                Battle._tieRerollOppSucc = payload.successi ?? 0;
            }
            return;
        }
        Battle.oppInitSucc = payload.successi ?? 0;
        if (Battle._waitingForcedSwitchReroll && Battle.role === 'host') {
            Battle._waitingForcedSwitchReroll = false;
            _hostAvanzaNuovoRound();
        }
    });

    // ── Danno ricevuto ───────────────────────────────────────────────────────
    sub('msg:APPLY_DAMAGE', (payload) => {
        const { damage, targetRole } = payload;
        if (targetRole !== Battle.role) return;
        const t = Battle.me.team[Battle.me.activeIndex];
        if (!t || t.eliminated) return;

        // Controllo immunità lato difensore (fallback se il messaggio APPLY_TYPE_IMMUNITY
        // è arrivato in ritardo o è stato sovrascritto da un sync di stato).
        let actualDamage = damage;
        if (damage > 0) {
            const oppMoveData = _getMoveData(Battle.oppCommit?.moveName);
            const moveType    = oppMoveData?.Type;
            const moveCat     = oppMoveData?.Category;
            if (moveType && moveCat !== 'Support' &&
                    Array.isArray(Battle.me.fieldMods.typeImmunities) &&
                    Battle.me.fieldMods.typeImmunities.includes(moveType)) {
                actualDamage = 0;
                log(`🚫 ${t.name} è immune — nessun effetto!`, 'action');
            }
        }

        t.currentHP = Math.max(0, t.currentHP - actualDamage);
        log(`💥 ${t.name} subisce ${actualDamage} danni!`, 'damage');
        if (t.currentHP <= 0) {
            t.currentHP = 0;
            t.eliminated = true;
            Battle.me.koCount = (Battle.me.koCount || 0) + 1;
            Battle._faintedAwaitingSwitch = true;
            log(`💀 ${t.name} è esausto!`, 'ko');
        }
        const stateOut = _serializeOpponentFacingState();
        BattleBridge.send('DAMAGE_APPLIED', { damage, targetRole, state: stateOut });
        if (t.currentHP <= 0) {
            BattleBridge.send('POKEMON_KO', { targetRole: Battle.role, state: stateOut });
            const anyLiving = Battle.me.team.some(p => !p.eliminated && p.currentHP > 0);
            if (!anyLiving) {
                Battle.phase = 'ended';
                _cancellaAzioneCorrente();
                logBoth(`💀 ${Battle.me.trainerName} — tutto il team è esausto.`, 'ko');
                aggiornaUI();
            } else {
                // Il mio pokemon è stato eliminato: chiudo i modal dadi aperti e forzo lo switch
                setTimeout(() => {
                    _cancellaAzioneCorrente();
                    apriSwitch(true);
                }, 600);
            }
        }
        // Se l'evader ha subito danno (evade fallito) → chiama _fineRound via _evadeOnDone
        if (Battle._evadeOnDone && !Battle._faintedAwaitingSwitch) {
            const cb = Battle._evadeOnDone;
            Battle._evadeOnDone = null;
            setTimeout(cb, 400);
        }
        aggiornaUI();
    });

    sub('msg:DAMAGE_APPLIED', (payload) => {
        const { damage, targetRole, state } = payload;
        _applicaStateDiff(state);
        const target = targetRole === Battle.role ? 'Tu' : _nomeOpp();
        log(`💥 ${target} subisce ${damage} danni!`, 'damage');
        aggiornaUI();
        if (targetRole !== Battle.role && Battle.opponent && _opponentTeamAllFainted()) {
            _vittoria();
        }
    });

    sub('msg:APPLY_STATUS', (payload) => {
        const { targetRole, status, statusTurns } = payload;
        // ── Status volatili: campi separati, possono coesistere col primary ──
        if (status === 'confused' || status === 'love' || status === 'flinched') {
            const vF = targetRole === Battle.role ? Battle.me : Battle.opponent;
            if (Array.isArray(vF?.fieldMods?.statusImmunities) && vF.fieldMods.statusImmunities.includes(status)) {
                log(`🛡️ ${targetRole === Battle.role ? _nomeMePk() : _nomeOpp()} è immune a ${_nomeStatus(status)}!`, 'status');
                return;
            }
            if (status === 'flinched') {
                const tgtCommit = targetRole === Battle.role ? Battle.myCommit : Battle.oppCommit;
                if (tgtCommit?.type !== 'move') {
                    log(`😨 Flinch su ${targetRole === Battle.role ? _nomeMePk() : _nomeOpp()} — non sta usando una mossa, nessun effetto.`, 'status');
                    return;
                }
                if (vF) vF.fieldMods.flinchActive = true;
            } else if (status === 'confused') {
                if (vF) vF.fieldMods.confusedTurns = statusTurns ?? 10;
            } else {
                if (vF) vF.fieldMods.loveTurns = statusTurns ?? 10;
            }
            aggiornaUI();
            return;
        }
        const isBurn      = status === 'burn' || status === 'burn2' || status === 'burn3';
        const isPoison    = status === 'poison' || status === 'poison2';
        const isParalysis = status === 'paralysis';
        const isFreeze    = status === 'freeze';
        if (isBurn || isPoison || isParalysis || isFreeze) {
            const fighter = targetRole === Battle.role ? Battle.me : Battle.opponent;
            const pk = fighter?.team?.[fighter?.activeIndex];
            if (isBurn && _isPkFireType(pk)) {
                log(`🔥 ${pk?.name || 'Il Pokémon'} è di tipo Fuoco — immune alle bruciature!`, 'status');
                return;
            }
            if (isPoison && _isPkPoisonImmune(pk)) {
                log(`☠️ ${pk?.name || 'Il Pokémon'} è di tipo Veleno/Acciaio — immune al veleno!`, 'status');
                return;
            }
            if (isParalysis && _isPkElectricType(pk)) {
                log(`⚡ ${pk?.name || 'Il Pokémon'} è di tipo Elettro — immune alla paralisi!`, 'status');
                return;
            }
            if (isFreeze && _isPkIceType(pk)) {
                log(`❄️ ${pk?.name || 'Il Pokémon'} è di tipo Ghiaccio — immune al congelamento!`, 'status');
                return;
            }
            if (isFreeze && (Battle.weather === 'sunny' || Battle.weather === 'harsh_sun')) {
                log(`☀️ ${_nomeMeteo(Battle.weather)}: impossibile congelare con questo meteo!`, 'weather');
                return;
            }
            if (isBurn && Battle.weather === 'typhoon') {
                log(`🌀 Typhoon Weather: impossibile bruciare con questo meteo!`, 'weather');
                return;
            }
        }
        const _siF = targetRole === Battle.role ? Battle.me : Battle.opponent;
        if (Array.isArray(_siF?.fieldMods?.statusImmunities) && _siF.fieldMods.statusImmunities.includes(status)) {
            log(`🛡️ ${_siF === Battle.me ? _nomeMePk() : _nomeOpp()} è immune a ${_nomeStatus(status)}!`, 'status');
            return;
        }
        if (status === 'flinched') {
            const tgtCommit = targetRole === Battle.role ? Battle.myCommit : Battle.oppCommit;
            if (tgtCommit?.type !== 'move') {
                log(`😨 Flinch su ${targetRole === Battle.role ? _nomeMePk() : _nomeOpp()} — non sta usando una mossa, nessun effetto.`, 'status');
                return;
            }
        }
        const _PRIMARY_B = new Set(['sleep','freeze','burn','burn2','burn3','paralysis','poison','poison2']);
        if (_PRIMARY_B.has(status)) {
            const tgtF = targetRole === Battle.role ? Battle.me : Battle.opponent;
            const curr = tgtF?.fieldMods?.status;
            if (curr && _PRIMARY_B.has(curr)) {
                log(`⚠️ ${targetRole === Battle.role ? _nomeMePk() : _nomeOpp()} ha già ${_nomeStatus(curr)} — status primario ignorato.`, 'status');
                return;
            }
        }
        if (targetRole === Battle.role) {
            if (status === 'paralysis') Battle.me.fieldMods.Dexterity -= 2;
            if (status === 'freeze')    Battle.me.fieldMods.iceBlockHP = 5;
            Battle.me.fieldMods.status      = status;
            Battle.me.fieldMods.statusTurns = statusTurns ?? 0;
        } else if (Battle.opponent) {
            if (status === 'paralysis') Battle.opponent.fieldMods.Dexterity -= 2;
            if (status === 'freeze')    Battle.opponent.fieldMods.iceBlockHP = 5;
            Battle.opponent.fieldMods.status      = status;
            Battle.opponent.fieldMods.statusTurns = statusTurns ?? 0;
        }
        aggiornaUI();
    });

    sub('msg:APPLY_STAT_MOD', (payload) => {
        const { targetRole, stat, delta } = payload;
        if (targetRole === Battle.role) {
            Battle.me.fieldMods[stat] = Math.min(6, Math.max(-6, (Battle.me.fieldMods[stat] || 0) + delta));
        } else if (Battle.opponent) {
            Battle.opponent.fieldMods[stat] = Math.min(6, Math.max(-6, (Battle.opponent.fieldMods[stat] || 0) + delta));
        }
        aggiornaUI();
    });

    sub('msg:APPLY_TYPE_IMMUNITY', (payload) => {
        const { targetRole, typeId } = payload;
        const f = targetRole === Battle.role ? Battle.me : Battle.opponent;
        if (f) {
            if (!Array.isArray(f.fieldMods.typeImmunities)) f.fieldMods.typeImmunities = [];
            if (!f.fieldMods.typeImmunities.includes(typeId)) f.fieldMods.typeImmunities.push(typeId);
        }
        aggiornaUI();
    });

    sub('msg:APPLY_TYPE_PRIORITY_BOOST', (payload) => {
        const { targetRole, typeId, bonus } = payload;
        const f = targetRole === Battle.role ? Battle.me : Battle.opponent;
        if (f) {
            if (!f.fieldMods.typePriorityBoosts) f.fieldMods.typePriorityBoosts = {};
            f.fieldMods.typePriorityBoosts[typeId] = (f.fieldMods.typePriorityBoosts[typeId] || 0) + bonus;
        }
        aggiornaUI();
    });

    sub('msg:APPLY_STATUS_IMMUNITY', (payload) => {
        const { targetRole, statusId } = payload;
        const f = targetRole === Battle.role ? Battle.me : Battle.opponent;
        if (f) {
            if (!Array.isArray(f.fieldMods.statusImmunities)) f.fieldMods.statusImmunities = [];
            if (!f.fieldMods.statusImmunities.includes(statusId)) f.fieldMods.statusImmunities.push(statusId);
        }
        aggiornaUI();
    });

    sub('msg:REMOVE_STATUS', (payload) => {
        const { targetRole, statusId } = payload;
        const f = targetRole === Battle.role ? Battle.me : Battle.opponent;
        if (f) {
            if (statusId === 'confused')  { f.fieldMods.confusedTurns = 0; }
            else if (statusId === 'love')     { f.fieldMods.loveTurns = 0; }
            else if (statusId === 'flinched') { f.fieldMods.flinchActive = false; }
            else if (statusId === 'disabled') { f.fieldMods.disabledMoveName = null; }
            else if (statusId === 'repeat')   { f.fieldMods.repeatMoveName = null; f.fieldMods.repeatTurns = 0; }
            else { // primary (o payload senza statusId per compatibilità)
                if (f.fieldMods.status === 'paralysis') f.fieldMods.Dexterity += 2;
                f.fieldMods.status           = null;
                f.fieldMods.statusTurns      = 0;
                f.fieldMods.burnCureSuccessi = 0;
                f.fieldMods.iceBlockHP       = 0;
            }
        }
        aggiornaUI();
    });

    sub('msg:FORCE_SWITCH', () => {
        logBoth(`🔄 Una mossa avversaria ti costringe a cambiare Pokémon!`, 'action');
        _cancellaAzioneCorrente();
        apriSwitch(true, () => _fineRound());
    });

    sub('msg:SET_WEATHER', (payload) => {
        const { weather, turns } = payload;
        const _WEATHER_PROTECTED    = ['harsh_sun', 'typhoon', 'strong_winds'];
        const _WEATHER_BLOCKED_REPL = ['sunny', 'rain', 'sandstorm', 'hail'];
        if (_WEATHER_PROTECTED.includes(Battle.weather) && _WEATHER_BLOCKED_REPL.includes(weather)) {
            log(`🚫 ${_nomeMeteo(Battle.weather)} non può essere sostituito da ${_nomeMeteo(weather)}!`, 'weather');
            return;
        }
        Battle.weather      = weather || null;
        Battle.weatherTurns = turns !== undefined ? turns : -1;
        log(`🌦️ Il tempo cambia: ${_nomeMeteo(Battle.weather)}`, 'weather');
        aggiornaHeader();
        aggiornaUI();
    });

    sub('msg:STATUS_APPLIED', (payload) => {
        const { targetRole, status, state } = payload;
        _applicaStateDiff(state);
        const target = targetRole === Battle.role ? 'Il tuo Pokémon' : _nomeOpp();
        log(`🔶 ${target} è ora affetto da ${_nomeStatus(status)}!`, 'status');
        aggiornaUI();
    });

    sub('msg:STAT_MOD_APPLIED', (payload) => {
        const { targetRole, stat, delta, state } = payload;
        _applicaStateDiff(state);
        const target = targetRole === Battle.role ? 'Il tuo Pokémon' : _nomeOpp();
        const segno  = delta > 0 ? `+${delta}` : `${delta}`;
        log(`📊 ${target}: ${stat} ${segno}`, 'status');
        aggiornaUI();
    });

    sub('msg:APPLY_HP_MOD', (payload) => {
        const { targetRole, delta } = payload;
        if (targetRole !== Battle.role) return;
        const t = Battle.me.team[Battle.me.activeIndex];
        if (!t || t.eliminated) return;
        t.currentHP = Math.min(t.maxHP, Math.max(0, t.currentHP + delta));
        const wasKO = t.currentHP <= 0;
        if (wasKO) {
            t.eliminated = true;
            Battle.me.koCount = (Battle.me.koCount || 0) + 1;
            Battle._faintedAwaitingSwitch = true;
        }
        const stateOut = _serializeOpponentFacingState();
        BattleBridge.send('HP_MOD_APPLIED', { targetRole, delta, state: stateOut });
        if (wasKO) {
            BattleBridge.send('POKEMON_KO', { targetRole: Battle.role, state: stateOut });
            const anyLiving = Battle.me.team.some(p => !p.eliminated && p.currentHP > 0);
            if (!anyLiving) {
                Battle.phase = 'ended';
                _cancellaAzioneCorrente();
                log('💀 Tutto il tuo team è esausto...', 'ko');
                aggiornaUI();
            } else {
                setTimeout(() => { _cancellaAzioneCorrente(); apriSwitch(true); }, 600);
            }
        }
        aggiornaUI();
    });

    sub('msg:HP_MOD_APPLIED', (payload) => {
        const { targetRole, delta, state } = payload;
        _applicaStateDiff(state);
        aggiornaUI();
        if (targetRole !== Battle.role && Battle.opponent && _opponentTeamAllFainted()) {
            _vittoria();
        }
        // Clash tie: dopo i danni chiama _fineRound (lato evader o attaccante clash)
        if (Battle._evadeOnDone && !Battle._faintedAwaitingSwitch) {
            const cb = Battle._evadeOnDone;
            Battle._evadeOnDone = null;
            setTimeout(cb, 400);
        }
        if (Battle._clashDeclOnDone && !Battle._faintedAwaitingSwitch) {
            const cb = Battle._clashDeclOnDone;
            Battle._clashDeclOnDone = null;
            setTimeout(cb, 400);
        }
        if (Battle._clashAtkEndCb && !Battle._faintedAwaitingSwitch) {
            const cb = Battle._clashAtkEndCb;
            Battle._clashAtkEndCb = null;
            Battle._clashAtkOnDone = null; // annulla il callback "attacker wins" — il round finisce qui
            setTimeout(cb, 400);
        }
    });

    sub('msg:WEATHER_CHANGED', (payload) => {
        Battle.weather      = payload.weather;
        Battle.weatherTurns = payload.turns;
        log(`🌦️ Il tempo cambia: ${_nomeMeteo(Battle.weather)}`, 'weather');
        aggiornaHeader();
    });

    sub('msg:WEATHER_ENDED', () => {
        Battle.weather      = null;
        Battle.weatherTurns = -1;
        log('🌤️ Il meteo è tornato alla normalità.', 'weather');
        aggiornaHeader();
    });

    sub('msg:POKEMON_KO', (payload) => {
        const { targetRole, state } = payload;
        _applicaStateDiff(state);
        const nome = targetRole === Battle.role
            ? Battle.me.team[Battle.me.activeIndex]?.name
            : Battle.opponent?.team[Battle.opponent.activeIndex]?.name;
        log(`💀 ${nome} è esausto!`, 'ko');
        aggiornaUI();
        if (targetRole === Battle.role) {
            setTimeout(() => apriSwitch(true), 600);
        }
    });

    sub('msg:POKEMON_SWITCHED', (payload) => {
        const { role: switchRole, newIndex, state } = payload;
        if (switchRole !== Battle.role && Battle.opponent &&
            typeof newIndex === 'number' && Battle.opponent.team[newIndex]) {
            Battle.opponent.activeIndex = newIndex;
        }
        _applicaStateDiff(state);
        aggiornaUI();

        // Switch forzato avversario post-KO: aspetta il suo INIT_REROLL prima di avanzare il round
        if (Battle._waitingOppSwitch && switchRole !== Battle.role) {
            Battle._waitingOppSwitch = false;
            Battle._waitingForcedSwitchReroll = true;
            // Il host avanza quando riceve msg:INIT_REROLL; il client aspetta msg:NEW_ROUND
        }
    });

    sub('msg:STATUS_DAMAGE', (payload) => {
        const { role: dmgRole, status, damage, state } = payload;
        _applicaStateDiff(state);
        const target = dmgRole === Battle.role ? 'Il tuo Pokémon' : _nomeOpp();
        log(`🔶 ${target} subisce ${damage} danni da ${_nomeStatus(status)}!`, 'damage');
        aggiornaUI();
    });

    sub('msg:STATUS_EXPIRED', (payload) => {
        const { role: expRole, state } = payload;
        _applicaStateDiff(state);
        const target = expRole === Battle.role ? 'Il tuo Pokémon' : _nomeOpp();
        log(`✅ Lo status di ${target} è finito.`, 'status');
        aggiornaUI();
    });

    sub('msg:STATUS_HEALED', (payload) => {
        const { targetRole, state } = payload;
        _applicaStateDiff(state);
        const target = targetRole === Battle.role ? 'Il tuo Pokémon' : _nomeOpp();
        log(`💊 ${target} è guarito dallo status!`, 'heal');
        aggiornaUI();
    });

    sub('msg:HP_HEALED', (payload) => {
        const { targetRole, amount, state } = payload;
        _applicaStateDiff(state);
        const target = targetRole === Battle.role ? 'Il tuo Pokémon' : _nomeOpp();
        log(`💚 ${target} recupera ${amount} HP!`, 'heal');
        aggiornaUI();
    });

    sub('msg:LOG_MESSAGE', (payload) => {
        log(payload.text, 'action');
    });

    // ── Sblocco secondo giocatore dopo accuracy check del primo ─────────────
    sub('msg:FIRST_ACCURACY_DONE', () => {
        if (Battle._onFirstAccuracyDone) {
            log(`✅ ${_nomeOpp()} ha completato il tiro precisione — ora è il tuo turno!`, 'system');
            const cb = Battle._onFirstAccuracyDone;
            Battle._onFirstAccuracyDone = null;
            cb();
        }
    });

    // ── Sync fine turno: client avvisa host che ha finito i modal ───────────
    sub('msg:CLIENT_ROUND_END_READY', () => {
        if (Battle.role !== 'host') return;
        if (Battle._hostRoundEndReady) {
            Battle._hostRoundEndReady = false;
            _hostAvanzaNuovoRound();
        } else {
            Battle._clientRoundEndReady = true;
        }
    });

    // ── New round (dal host) ─────────────────────────────────────────────────
    sub('msg:NEW_ROUND', (payload) => {
        const { round, myInitSucc, oppInitSucc, state } = payload;
        if (state) _applicaStateDiff(state);
        Battle.round = round;
        // "myInitSucc" dal punto di vista dell'host: oppInitSucc è il mio se sono client
        if (Battle.role === 'client') {
            Battle.myInitSucc  = oppInitSucc ?? Battle.myInitSucc;
            Battle.oppInitSucc = myInitSucc  ?? Battle.oppInitSucc;
        } else {
            Battle.myInitSucc  = myInitSucc  ?? Battle.myInitSucc;
            Battle.oppInitSucc = oppInitSucc ?? Battle.oppInitSucc;
        }
        Battle._faintedAwaitingSwitch = false;
        log(`── Round ${round} ──`, 'system');
        aggiornaHeader();
        aggiornaUI();
        _avviaFaseScelta();
    });

    sub('msg:BATTLE_ENDED', (payload) => {
        const { winnerRole, winnerName, winnerImg, state } = payload;
        if (state) _applicaStateDiff(state);
        Battle.phase = 'ended';
        log(`🏆 ${winnerName} vince la battaglia!`, 'win');
        if (typeof MusicManager !== 'undefined') MusicManager.stop();
        aggiornaUI();
        setTimeout(() => mostraFine(winnerName, winnerImg), 1000);
    });

    sub('msg:APPLY_DISABLED', (payload) => {
        const { targetRole, moveName } = payload;
        const f = targetRole === Battle.role ? Battle.me : Battle.opponent;
        if (f) f.fieldMods.disabledMoveName = moveName;
        const tgtName = targetRole === Battle.role
            ? (Battle.me.team[Battle.me.activeIndex]?.name || 'Il tuo Pokémon')
            : _nomeOpp();
        log(`🚫 ${tgtName}: ${moveName} disabilitata!`, 'status');
        aggiornaUI();
    });

    sub('msg:APPLY_REPEAT', (payload) => {
        const { targetRole, moveName, turns } = payload;
        const f = targetRole === Battle.role ? Battle.me : Battle.opponent;
        if (f) { f.fieldMods.repeatMoveName = moveName; f.fieldMods.repeatTurns = turns; }
        const tgtName = targetRole === Battle.role
            ? (Battle.me.team[Battle.me.activeIndex]?.name || 'Il tuo Pokémon')
            : _nomeOpp();
        log(`🔁 ${tgtName}: costretto a usare ${moveName} per ${turns} turni!`, 'status');
        aggiornaUI();
    });

    sub('msg:APPLY_COPY', () => {
        log(`📋 L'avversario copia una tua mossa!`, 'status');
    });

    sub('msg:OPPONENT_DISCONNECTED', () => {
        log('📡 L\'avversario si è disconnesso.', 'system');
        Battle.phase = 'ended';
        aggiornaUI();
    });

    sub('disconnected', () => {
        if (Battle.phase !== 'ended') log('📡 Connessione persa.', 'system');
    });

    Battle._unregisterBridgeListeners = () => {
        subs.forEach(([ev, fn]) => { try { BattleBridge.off(ev, fn); } catch (e) {} });
        subs.length = 0;
    };
}

// ── COMMIT MOSSA / SWITCH ──────────────────────────────────────────────────────

/**
 * Calcola la priorità di un'azione.
 * Switch = 100, mossa con Priority = valore positivo, normale = 0.
 */
function _calcolaPriorita(commit) {
    if (commit.type === 'switch' || commit.type === 'item-heal') return SWITCH_PRIORITY;
    if (commit.type === 'evade') return EVADE_PRIORITY;
    if (commit.type === 'clash') return CLASH_PRIORITY;
    if (commit.type === 'pass') return 0;
    if (typeof commit.priority === 'number') return commit.priority;
    const eff = commit.moveData?.Effect || '';
    return _parsePriorityFromEffect(eff);
}

function _parsePriorityFromEffect(effectText) {
    if (!effectText) return 0;
    const low  = effectText.match(/Low\s+Priority\s+(\d+)/i);
    if (low)  return -parseInt(low[1]);
    const high = effectText.match(/Priority\s+(\d+)/i);
    if (high) return parseInt(high[1]);
    return 0;
}

/** Invia il commit al bridge e attende il commit dell'avversario. */
function _inviaCommit(commit) {
    Battle.myCommit = commit;
    BattleBridge.send('OPP_COMMIT', {
        type:       commit.type,
        moveName:   commit.moveName   || null,
        newIndex:   commit.newIndex   ?? null,
        priority:   _calcolaPriorita(commit),
        healHP:     commit.healHP     ?? null,
        healStatus: commit.healStatus ?? null,
    });
    let scelta;
    if (commit.type === 'switch')     scelta = `Switch → ${Battle.me.team[commit.newIndex]?.name}`;
    else if (commit.type === 'item-heal') scelta = `Item Heal (+${commit.healHP || 0} HP${commit.healStatus ? ` / rimuove ${_nomeStatus(commit.healStatus)}` : ''})`;
    else if (commit.type === 'evade') scelta = 'Evade (schivata)';
    else if (commit.type === 'clash') scelta = 'Clash (intercetto)';
    else if (commit.type === 'pass')  scelta = 'Passa (cura status)';
    else scelta = commit.moveName;
    log(`🔒 Hai scelto: ${scelta}`, 'system');

    // Aggiorna il pannello: mostra "In attesa avversario"
    _mostraAttesaCommit();

    if (Battle.oppCommit) {
        _faseReveal();
    }
}

function _mostraAttesaCommit() {
    const movesEl = document.getElementById('actions-moves');
    const waitEl  = document.getElementById('actions-wait');
    if (movesEl) movesEl.classList.add('hidden');
    if (waitEl)  {
        waitEl.classList.remove('hidden');
        const p = waitEl.querySelector('p') || waitEl;
        p.textContent = '⏳ Azione scelta — in attesa dell\'avversario…';
    }
}

function _mostraAttesaAccuratezzaAvversario() {
    const movesEl = document.getElementById('actions-moves');
    const waitEl  = document.getElementById('actions-wait');
    if (movesEl) movesEl.classList.add('hidden');
    if (waitEl) {
        waitEl.classList.remove('hidden');
        const p = waitEl.querySelector('p') || waitEl;
        p.textContent = `⏳ ${_nomeOpp()} sta tirando la precisione… attendi prima di procedere.`;
    }
}

/** Chiude i modal dadi/mossa aperti e annulla l'azione in corso (es. dopo un KO). */
function _cancellaAzioneCorrente() {
    document.getElementById('modal-dadi')?.classList.add('hidden');
    document.getElementById('modal-mossa')?.classList.add('hidden');
    _rimuoviPill('modal-dadi');
    _rimuoviPill('modal-mossa');
    Battle._onFirstAccuracyDone = null;
    Battle.currentMove          = null;
    Battle.currentDadiMode      = null;
    Battle.currentDadiRolls     = [];
}

// ── FASE REVEAL & RISOLUZIONE PRIORITÀ ───────────────────────────────────────

function _faseReveal() {
    Battle.roundPhase = 'resolve';

    const myCommit  = Battle.myCommit;
    const oppCommit = Battle.oppCommit;

    const myPrio  = _calcolaPriorita(myCommit);
    const oppPrio = _calcolaPriorita(oppCommit);

    // Determina chi va per primo
    let firstIsMe;
    let motivo;

    if (myPrio !== oppPrio) {
        firstIsMe = myPrio > oppPrio;
        motivo = `priorità (${myPrio > oppPrio ? 'Tu' : _nomeOpp()}: P${Math.max(myPrio, oppPrio)})`;
    } else {
        // Stessa priorità → iniziativa
        if (Battle.myInitSucc === Battle.oppInitSucc) {
            // Parità: entrambi rilanciano finché non si rompe il pareggio
            log(`🎲 Pareggio iniziativa (${Battle.myInitSucc} = ${Battle.oppInitSucc})! Entrambi rilanciano...`, 'system');
            Battle._tieRerollMyDone  = false;
            Battle._tieRerollOppSucc = null;
            _avviaRerollIniziatriva(null, true);
            return;
        }
        firstIsMe = Battle.myInitSucc > Battle.oppInitSucc;
        motivo = `iniziativa (Tu: ${Battle.myInitSucc} | ${_nomeOpp()}: ${Battle.oppInitSucc})`;
    }

    // Memorizza chi va per primo (usato per sincronizzare l'accuracy check)
    Battle._iGoFirst = firstIsMe;

    // Log reveal
    const primoNome = firstIsMe ? 'TU' : _nomeOpp().toUpperCase();
    log(`── Reveal ── ${primoNome} agisce per primo (${motivo}).`, 'system');

    if (myCommit.type === 'switch' && myPrio === oppPrio) {
        // Entrambi hanno scelto switch (prio 100) → il primo a fare switch è chi ha init maggiore
        // ma comunque entrambi switchano
    }

    // Eseguiamo nell'ordine
    if (firstIsMe) {
        _eseguiAzioneMia(() => {
            // Dopo la mia azione, se l'avversario non è stato eliminato, lui esegue
            if (!_verificaKOPostAzione()) {
                _eseguiAzioneAvversario(() => _fineRound());
            }
            // Se KO → _verificaKOPostAzione gestisce il flusso
        });
    } else {
        _eseguiAzioneAvversario(() => {
            if (!_verificaKOPostAzioneAvversaria()) {
                _eseguiAzioneMia(() => {
                    if (!_verificaKOPostAzione()) {
                        _fineRound();
                    }
                });
            }
        });
    }
}

// ── ESECUZIONE AZIONI ─────────────────────────────────────────────────────────

/**
 * Esegue la mia azione (mossa o switch).
 * @param {Function} onDone - callback quando l'azione è completata
 */
function _eseguiAzioneMia(onDone) {
    const commit = Battle.myCommit;
    if (commit.type === 'switch') {
        _eseguiSwitchLocale(commit.newIndex, false, () => {
            _avviaRerollIniziatriva(onDone);
        });
    } else if (commit.type === 'item-heal') {
        _eseguiItemHealLocale(commit, onDone);
    } else if (commit.type === 'pass') {
        log(`⏭️ ${_nomeMePk()} passa il turno (ha usato il turno per curare lo status).`, 'system');
        onDone?.();
    } else if (commit.type === 'evade') {
        _eseguiEvadeLocale(commit, onDone);
    } else if (commit.type === 'clash') {
        _eseguiClashLocale(commit, onDone);
    } else {
        if (Battle.me.fieldMods.status === 'freeze') {
            _eseguiAttaccoConGelo(commit, onDone);
            return;
        }
        if (Battle.me.fieldMods.status === 'sleep') {
            logBoth(`💤 ${_nomeMePk()} è stato addormentato questo turno — salta l'attacco!`, 'status');
            onDone?.();
            return;
        }
        Battle.currentMove = {
            index:  commit.moveIndex,
            nome:   commit.moveName,
            data:   commit.moveData,
            _accMod: 0,
            _dmgMod: 0,
            _poolPrecisione: _calcolaPoolPrecisione(commit.moveData),
        };
        const _myActivePk = Battle.me.team[Battle.me.activeIndex];
        if (_myActivePk) _myActivePk.lastMoveName = commit.moveName;
        apriModalMossaEsecuzione(commit.moveName, commit.moveData, onDone);
    }
}

/**
 * Esegue l'azione dell'avversario (switch o mossa).
 * Se è uno switch → aggiorniamo il suo pokemon in campo.
 * Se è una mossa → la annunciamo; i danni vengono gestiti via bridge quando arrivano.
 */
function _eseguiAzioneAvversario(onDone) {
    const commit = Battle.oppCommit;
    if (!commit) { onDone?.(); return; }

    if (commit.type === 'switch') {
        const nome = Battle.opponent?.team?.[commit.newIndex]?.name || '?';
        log(`🔄 ${_nomeOpp()} cambia pokemon → ${nome}`, 'action');
        onDone?.();

    } else if (commit.type === 'item-heal') {
        // Opponent usato item heal: annunciamo (i dati HP arriveranno via APPLY_HP_MOD)
        const hpPart = (commit.healHP > 0) ? `+${commit.healHP} HP` : '';
        const stPart = commit.healStatus ? `rimuove ${_nomeStatus(commit.healStatus)}` : '';
        const desc   = [hpPart, stPart].filter(Boolean).join(' / ') || '?';
        log(`💊 ${_nomeOpp()} usa un oggetto: ${desc}`, 'action');
        onDone?.();

    } else if (commit.type === 'pass') {
        log(`⏭️ ${_nomeOpp()} passa il turno (sta cercando di curare lo status).`, 'system');
        onDone?.();

    } else if (commit.type === 'evade') {
        // Opponent schiva: lo annunciamo e procediamo (il dichiarante ha priority, va prima)
        log(`🛡️ ${_nomeOpp()} tenta una schivata!`, 'action');
        onDone?.();

    } else if (commit.type === 'clash') {
        // Opponent dichiara clash: dobbiamo aprire i nostri dadi clash invece della mossa
        log(`⚔️ ${_nomeOpp()} usa Clash! Anche tu devi tirare i dadi Clash.`, 'action');
        // _clashAtkOnDone = callback se l'attaccante vince (continua con mossa normale)
        // _clashAtkEndCb  = callback se è pareggio (chiama solo _fineRound via HP_MOD_APPLIED)
        Battle._clashAtkOnDone = onDone;
        Battle._clashAtkEndCb  = () => _fineRound();
        _apriDadiClashAtk();

    } else {
        const nome = commit.moveName || 'una mossa';
        log(`⚔️ ${_nomeOpp()} usa ${nome}!`, 'action');
        const _oppActivePk = Battle.opponent?.team?.[Battle.opponent.activeIndex];
        if (_oppActivePk && commit.moveName) _oppActivePk.lastMoveName = commit.moveName;
        if (Battle.myCommit?.type === 'evade') {
            // Io sono l'evader, l'avversario attacca → aspetto EVADE_OUTCOME o APPLY_DAMAGE
            Battle._evadeOnDone = onDone;
        } else if (!Battle._iGoFirst) {
            Battle._onFirstAccuracyDone = onDone;
            _mostraAttesaAccuratezzaAvversario();
        } else {
            onDone?.();
        }
    }
}

// ── VERIFICA KO POST-AZIONE ───────────────────────────────────────────────────

/**
 * Controlla se l'avversario è esausto dopo la MIA azione.
 * Se sì: switch forzato per lui, azione avversaria annullata, nuovo round.
 * Ritorna true se c'è stato un KO.
 */
function _verificaKOPostAzione() {
    if (_opponentTeamAllFainted()) {
        _vittoria();
        return true;
    }
    // Controlla se il pokemon avversario in campo è a 0 HP.
    // Usa _waitingOppSwitch come guard invece di eliminated: quando DAMAGE_APPLIED arriva
    // prima che l'utente confermi il modal effetto, _applicaStateDiff può già settare
    // eliminated=true rendendo inutilizzabile il check !oppPk.eliminated.
    const oppPk = Battle.opponent?.team?.[Battle.opponent.activeIndex];
    if (oppPk && oppPk.currentHP <= 0 && !Battle._waitingOppSwitch) {
        if (!oppPk.eliminated) oppPk.eliminated = true;
        log(`💀 ${oppPk.name} è esausto! L'azione di ${_nomeOpp()} viene annullata.`, 'ko');
        aggiornaUI();
        Battle._waitingOppSwitch = true;
        return true;
    }
    return false;
}

/**
 * Controlla se il MIO pokemon è esausto dopo l'azione avversaria.
 */
function _verificaKOPostAzioneAvversaria() {
    const myPk = Battle.me.team[Battle.me.activeIndex];
    if (myPk && myPk.currentHP <= 0) {
        // Già gestito da APPLY_DAMAGE → apriSwitch(true)
        return true;
    }
    if (_opponentTeamAllFainted()) {
        _vittoria();
        return true;
    }
    return false;
}

// ── FINE ROUND ────────────────────────────────────────────────────────────────

function _fineRound() {
    apriModalAbilitaTurno('fine', () => {
        if (Battle._pendingFirstAccDone) {
            Battle._pendingFirstAccDone = false;
            BattleBridge.send('FIRST_ACCURACY_DONE', {});
        }
        apriModalOggettoTurno('fine', () => {
            _decrementaCondizioniVolatili();
            _applicaDannoBruciatura(() => {
                _applicaDannoMeteo(() => {
                    _verificaKOFineRound(() => {
                        if (Battle.role === 'host') {
                            if (Battle._clientRoundEndReady) {
                                Battle._clientRoundEndReady = false;
                                _hostAvanzaNuovoRound();
                            } else {
                                Battle._hostRoundEndReady = true;
                                log('⏳ Attendo che l\'avversario finisca il turno…', 'system');
                            }
                        } else {
                            BattleBridge.send('CLIENT_ROUND_END_READY', {});
                        }
                    });
                });
            });
        });
    });
}

function _applicaDannoStatus(onDone) {
    const status = Battle.me.fieldMods.status;
    const isBurn   = status === 'burn'   || status === 'burn2'   || status === 'burn3';
    const isPoison = status === 'poison' || status === 'poison2';
    if (!isBurn && !isPoison) { onDone?.(); return; }

    // Danno ogni 5 turni
    if (Battle.round % 5 !== 0) { onDone?.(); return; }

    const nomePk = _nomeMePk();
    const pk     = Battle.me.team[Battle.me.activeIndex];
    const dmg  = status === 'burn3' ? 3 : status === 'burn2' ? 2 : 1;
    if (pk) pk.currentHP = Math.max(0, pk.currentHP - dmg);
    const icon = isBurn ? '🔥' : '☠️';
    logBoth(`${icon} ${nomePk} subisce ${dmg} danni da ${_nomeStatus(status)} (turno ${Battle.round})!`, 'damage');
    aggiornaUI();
    onDone?.();
}

// Alias usato da _fineRound
function _applicaDannoBruciatura(onDone) { _applicaDannoStatus(onDone); }

function _applicaDannoMeteo(onDone) {
    const w = Battle.weather;
    if (w !== 'hail' && w !== 'sandstorm') { onDone?.(); return; }
    if (Battle.round % 5 !== 0)            { onDone?.(); return; }

    const pk = Battle.me.team[Battle.me.activeIndex];
    if (!pk || pk.currentHP <= 0) { onDone?.(); return; }

    let immune = false;
    if (w === 'hail'      && _isPkIceType(pk))                                        immune = true;
    if (w === 'sandstorm' && (_isPkRockType(pk) || _isPkGroundType(pk) || _isPkSteelType(pk))) immune = true;

    if (!immune) {
        pk.currentHP = Math.max(0, pk.currentHP - 1);
        const icon = w === 'hail' ? '🌨️' : '🌪️';
        logBoth(`${icon} ${_nomeMePk()} subisce 1 danno da ${_nomeMeteo(w)}!`, 'damage');
        aggiornaUI();
    }
    onDone?.();
}

function _verificaKOFineRound(onDone) {
    const pk = Battle.me.team[Battle.me.activeIndex];
    if (!pk || pk.currentHP > 0 || pk.eliminated) {
        onDone();
        return;
    }

    pk.eliminated = true;
    Battle.me.koCount = (Battle.me.koCount || 0) + 1;
    const stateOut = _serializeOpponentFacingState();
    BattleBridge.send('POKEMON_KO', { targetRole: Battle.role, state: stateOut });
    log(`💀 ${pk.name} è esausto per i danni di fine turno! Scegli il prossimo Pokémon.`, 'ko');
    aggiornaUI();

    const anyLiving = Battle.me.team.some(p => !p.eliminated && p.currentHP > 0);
    if (!anyLiving) {
        onDone();
        return;
    }

    // Switch forzato senza reroll (fine round — l'init ripart dal prossimo turno)
    // apriSwitch con callback = _eseguiSwitchLocale poi chiama onDone
    setTimeout(() => apriSwitch(true, onDone), 400);
}

function _hostAvanzaNuovoRound() {
    if (Battle.round >= 25) {
        _terminaBattagliaPerRound();
        return;
    }

    // Decrementa meteo temporaneo (1 round = 5 turni; -1 = permanente, non si tocca)
    if (Battle.weather && Battle.weatherTurns > 0) {
        Battle.weatherTurns -= 5;
        if (Battle.weatherTurns <= 0) {
            if (Battle.baseWeather) {
                // Ripristina sempre il meteo iniziale dell'host come permanente
                Battle.weather      = Battle.baseWeather;
                Battle.weatherTurns = -1;
                BattleBridge.send('WEATHER_CHANGED', { weather: Battle.weather, turns: -1 });
                log(`🌦️ Meteo scaduto — torna: ${_nomeMeteo(Battle.weather)} (permanente).`, 'weather');
            } else {
                // Nessun meteo iniziale impostato: fine meteo
                Battle.weather      = null;
                Battle.weatherTurns = -1;
                BattleBridge.send('WEATHER_ENDED', {});
                log('🌤️ Il meteo è tornato alla normalità.', 'weather');
            }
            aggiornaHeader();
        }
    }

    _hostInviaNewRound(Battle.round + 1);
}

function _terminaBattagliaPerRound() {
    if (Battle.phase === 'ended') return;
    Battle.phase = 'ended';

    const myLiving  = Battle.me.team.filter(t => !t.eliminated && t.currentHP > 0).length;
    const oppLiving = Battle.opponent?.team?.filter(t => !t.eliminated && t.currentHP > 0).length ?? 0;

    const oppRole = Battle.role === 'host' ? 'client' : 'host';

    if (myLiving > oppLiving) {
        BattleBridge.send('BATTLE_ENDED', {
            winnerRole: Battle.role,
            winnerName: Battle.me.trainerName,
            winnerImg:  Battle.me.trainerImg,
            state:      _serializeOpponentFacingState(),
        });
        log(`⌛ Fine round 25! Vinci tu — ${myLiving} Pokémon attivi vs ${oppLiving}.`, 'win');
        if (typeof MusicManager !== 'undefined') {
            MusicManager.stop();
            setTimeout(() => MusicManager.playForScreen('victory'), 600);
        }
        setTimeout(() => mostraFine(Battle.me.trainerName, Battle.me.trainerImg), 1000);
    } else if (oppLiving > myLiving) {
        BattleBridge.send('BATTLE_ENDED', {
            winnerRole: oppRole,
            winnerName: Battle.opponent.trainerName,
            winnerImg:  Battle.opponent.trainerImg,
            state:      _serializeOpponentFacingState(),
        });
        log(`⌛ Fine round 25! Vince ${Battle.opponent.trainerName} — ${oppLiving} Pokémon attivi vs ${myLiving}.`, 'win');
        if (typeof MusicManager !== 'undefined') MusicManager.stop();
        setTimeout(() => mostraFine(Battle.opponent.trainerName, Battle.opponent.trainerImg), 1000);
    } else {
        BattleBridge.send('BATTLE_ENDED', {
            winnerRole: null,
            winnerName: 'Pareggio',
            winnerImg:  '',
            state:      _serializeOpponentFacingState(),
        });
        log(`⌛ Fine round 25! Pareggio — ${myLiving} Pokémon attivi per parte.`, 'system');
        if (typeof MusicManager !== 'undefined') MusicManager.stop();
        setTimeout(() => mostraFine('Pareggio — Fine battaglia', ''), 1000);
    }
    aggiornaUI();
}

function _hostInviaNewRound(nextRound) {
    const state = _serializeOpponentFacingState();
    BattleBridge.send('NEW_ROUND', {
        round:        nextRound,
        myInitSucc:   Battle.myInitSucc,
        oppInitSucc:  Battle.oppInitSucc,
        state,
    });
    Battle.round = nextRound;
    Battle._faintedAwaitingSwitch = false;
    log(`── Round ${nextRound} ──`, 'system');
    aggiornaHeader();
    aggiornaUI();
    _avviaFaseScelta();
}

// ── RE-ROLL INIZIATIVA DOPO SWITCH ───────────────────────────────────────────

/**
 * Apre un modal per il rilancio dadi iniziativa (host e client in parallelo via bridge).
 */
function _avviaRerollIniziatriva(onDone, isTieBreak = false) {
    const fm           = Battle.me.fieldMods;
    const pk           = Battle.me.team[Battle.me.activeIndex];
    const pkName       = pk?.name || '—';
    const hasParalysis = fm.status === 'paralysis';

    // Pre-paralysis base: cancel the Dex -2 that was applied on switch-in restore,
    // so the player rolls against the clean pool; the /2 is applied to the result.
    const dex        = pk?.data?.stats?.Dexterity || 0;
    const alert      = pk?.data?.skills?.Alert    || 0;
    const initMod    = fm.initiative || 0;
    const dexMod     = (fm.Dexterity || 0) + (hasParalysis ? 2 : 0);
    const baseInit   = Math.max(1, dex + dexMod + alert + initMod);

    const parNote = hasParalysis
        ? `<p style="font-size:0.78rem;color:rgba(239,83,80,0.85);margin:0 0 10px;">
               ⚡ Paralisi attiva — il risultato finale sarà dimezzato (÷2).
           </p>`
        : '';

    const modal = document.createElement('div');
    modal.id = 'modal-init-reroll';
    modal.className = 'battle-modal';
    modal.innerHTML = `
        <div class="battle-modal-box">
            <div class="battle-modal-header">
                <span>${isTieBreak ? '🎲 Pareggio — Ritira Iniziativa' : '🎲 Ricalcolo Iniziativa'}</span>
            </div>
            <div class="battle-modal-body">
                <p style="font-size:0.85rem; color:rgba(232,234,240,0.6); margin:0 0 4px;">
                    ${isTieBreak ? 'Pareggio! Entrambi rilanciano finché la parità non si rompe.' : 'Un Pokémon è cambiato! Tira di nuovo l\'iniziativa.'}
                </p>
                <p style="font-size:0.82rem; font-weight:700; margin-bottom:8px;">
                    Base di ${pkName}: <b>${baseInit}</b> (DEX + Alert${hasParalysis ? ', senza penalità paralisi' : ''})
                </p>
                ${parNote}
                <div id="reroll-dice-wrap" style="
                    display:flex; flex-wrap:wrap; min-height:44px;
                    padding:10px; border-radius:10px;
                    border:1.5px solid rgba(255,255,255,0.1);
                    background:rgba(255,255,255,0.03); margin-bottom:10px;">
                </div>
                <div id="reroll-summary" style="text-align:center; font-size:0.88rem; font-weight:700; margin-bottom:10px;">
                    Iniziativa totale: —
                </div>
                <button onclick="_rerollTiraD6(${baseInit})"
                    style="width:100%; padding:10px; border-radius:10px; border:none;
                    background:#1565c0; color:#fff; font-weight:700; cursor:pointer; margin-bottom:10px;">
                    🎲 Tira 1d6
                </button>
                <button id="btn-reroll-confirm" onclick="_rerollConferma()" disabled
                    style="width:100%; padding:12px; border-radius:12px; border:none;
                    background:#27ae60; color:#fff; font-weight:800; cursor:pointer; opacity:0.4;">
                    ✅ Conferma iniziativa
                </button>
            </div>
        </div>
    `;
    modal._onDone      = onDone;
    modal._successi    = 0;
    modal._hasParalysis = hasParalysis;
    modal._tieBreak    = isTieBreak;
    document.body.appendChild(modal);
}

function _rerollTiraD6(baseInit) {
    const modal = document.getElementById('modal-init-reroll');
    if (!modal) return;
    const r            = Math.floor(Math.random() * 6) + 1;
    const hasParalysis = modal._hasParalysis;
    const preTotal     = baseInit + r;
    const total        = hasParalysis ? Math.floor(preTotal / 2) : preTotal;
    modal._successi    = total;

    const wrap = document.getElementById('reroll-dice-wrap');
    if (wrap) {
        const parPart = hasParalysis
            ? ` → <b>${preTotal}</b> ÷2 = <b style="color:#ef9a9a;">${total}</b> (paralisi)`
            : '';
        wrap.innerHTML = `
            <div style="display:flex; align-items:center; width:100%;">
                <div style="width:48px; height:48px; border-radius:10px;
                    display:flex; align-items:center; justify-content:center;
                    font-size:1.4rem; font-weight:900; margin-right:12px;
                    background:rgba(21,101,192,0.18); border:2px solid #1565c0; color:#42a5f5;">
                    ${r}
                </div>
                <div style="font-size:0.9rem; color:#e8eaf0;">
                    d6 = <b>${r}</b> + base <b>${baseInit}</b>${parPart}
                </div>
            </div>
        `;
    }
    const summary = document.getElementById('reroll-summary');
    if (summary) summary.textContent = `Iniziativa finale: ${total}`;
    const btn = document.getElementById('btn-reroll-confirm');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
}

function _rerollConferma() {
    const modal = document.getElementById('modal-init-reroll');
    if (!modal) return;
    Battle.myInitSucc = modal._successi;
    const onDone    = modal._onDone;
    const isTieBreak = modal._tieBreak || false;
    modal.remove();

    if (isTieBreak) {
        BattleBridge.send('INIT_REROLL', { successi: Battle.myInitSucc, isTieBreak: true });
        log(`🎲 Pareggio — nuovo tiro: ${Battle.me.trainerName}: ${Battle.myInitSucc}`, 'system');
        Battle._tieRerollMyDone = true;
        if (Battle._tieRerollOppSucc !== null) {
            Battle.oppInitSucc       = Battle._tieRerollOppSucc;
            Battle._tieRerollMyDone  = false;
            Battle._tieRerollOppSucc = null;
            _faseReveal();
        }
    } else {
        BattleBridge.send('INIT_REROLL', { successi: Battle.myInitSucc });
        logBoth(`🎲 Iniziativa (dopo switch) — ${Battle.me.trainerName}: ${Battle.myInitSucc} | ${_nomeOpp()}: ${Battle.oppInitSucc}`, 'system');
        onDone?.();
    }
}

// ── AGGIORNAMENTO UI ──────────────────────────────────────────────────────────

function aggiornaUI() {
    if (!Battle.me || !Battle.opponent) return;
    _aggiornaFighter('my',  Battle.me);
    _aggiornaFighter('opp', Battle.opponent);
    _aggiornaPannelloAzioni();
}

function _aggiornaFighter(prefix, fighter) {
    const pk     = fighter.team[fighter.activeIndex];
    const name   = pk?.name || '—';
    const curHP  = pk?.currentHP ?? 0;
    const maxHP  = pk?.maxHP    ?? 1;
    const pct    = Math.max(0, Math.min(100, (curHP / maxHP) * 100));

    document.getElementById(`${prefix}-trainer-name`).textContent = fighter.trainerName;

    const sprite = document.getElementById(`${prefix}-sprite`);
    const slug   = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    sprite.onerror = () => { sprite.src = 'img/pokemon/unknown.png'; };
    sprite.src   = `img/pokemon/${slug}.png`;
    sprite.alt   = name;

    document.getElementById(`${prefix}-pokemon-name`).textContent = name;

    const bar = document.getElementById(`${prefix}-hp-bar`);
    bar.style.width = `${pct}%`;
    bar.className   = 'hp-bar-fill' +
        (pct > 50 ? '' : pct > 20 ? ' hp-yellow' : ' hp-red');

    document.getElementById(`${prefix}-hp-text`).textContent = `${curHP}/${maxHP}`;

    const badge  = document.getElementById(`${prefix}-status-badge`);
    const _fm    = fighter.fieldMods || {};
    const _parts = [];
    if (_fm.status)            _parts.push(_siglaStatus(_fm.status));
    if (_fm.confusedTurns > 0) _parts.push('CNF');
    if (_fm.loveTurns > 0)     _parts.push('LVE');
    if (_fm.flinchActive)      _parts.push('FLN');
    if (_fm.disabledMoveName)  _parts.push('DIS');
    if (_fm.repeatMoveName)    _parts.push('REP');
    if (_parts.length) {
        badge.textContent = _parts.join(' ');
        badge.className   = 'status-badge';
    } else {
        badge.className = 'status-badge hidden';
    }

    const dotsEl = document.getElementById(`${prefix}-team-dots`);
    dotsEl.innerHTML = '';
    fighter.team.forEach((tp, i) => {
        if (tp.eliminated) return;
        const dot = document.createElement('span');
        dot.className = 'team-dot' +
            (tp.currentHP <= 0         ? ' ko'     : '') +
            (i === fighter.activeIndex ? ' active' : '');
        dotsEl.appendChild(dot);
    });

    if (prefix === 'my') _aggiornaMosse(pk);
}

function _aggiornaMosse(pk) {
    const mosse = pk?.data?.moves || [];
    const mods  = Battle.me.fieldMods;
    const TYPE_NAMES = {
        1:'Normal',2:'Fire',3:'Water',4:'Electric',5:'Grass',6:'Ice',
        7:'Fighting',8:'Poison',9:'Ground',10:'Flying',11:'Psychic',
        12:'Bug',13:'Rock',14:'Ghost',15:'Dragon',16:'Dark',17:'Steel',18:'Fairy',
    };
    for (let i = 0; i < 4; i++) {
        const card    = document.getElementById(`move-${i}`);
        const isCopy  = pk?.copiedMoveSlot === i && !!pk?.copiedMoveName;
        const nome    = isCopy ? pk.copiedMoveName : (mosse[i] || '');
        const md      = nome ? _getMoveData(nome) : null;
        const typeStr = md ? (TYPE_NAMES[md.Type] || '').toLowerCase() || 'normal' : '';
        card.className = 'move-card' + (nome ? '' : ' empty') + (typeStr ? ` type-${typeStr}` : '');

        if (!nome) { card.innerHTML = ''; continue; }
        if (!md) {
            card.innerHTML = `<button class="move-card-btn" onclick="selezionaMossa(${i})"><span class="move-btn-name">${isCopy ? '📋 ' : ''}${nome}</span></button>`;
            continue;
        }

        const cat    = md.Category || '—';
        const tipo   = TYPE_NAMES[md.Type] || md.Type || '—';
        const acc    = _getValPk(pk, mods, md.Accuracy1) + _getValPk(pk, mods, md.Accuracy2);
        const dmg    = _getValPk(pk, mods, md.Damage1) + (parseInt(md.Power) || 0);
        const target = md.Target || '';
        const eff    = (md.Effect && md.Effect !== '-') ? md.Effect : '';
        const dmgStr = cat !== 'Support' ? ` · ⚔️ ${dmg}` : '';

        const isDisabled  = Battle.me.fieldMods.disabledMoveName === nome;
        const isRepeating = !!(Battle.me.fieldMods.repeatMoveName) && Battle.me.fieldMods.repeatMoveName !== nome;
        const isSleeping  = Battle.me.fieldMods.status === 'sleep';
        const isBlocked   = isDisabled || isSleeping || isRepeating;
        const blockedIcon = isDisabled ? '🚫 ' : isSleeping ? '💤 ' : isRepeating ? '🔁 ' : isCopy ? '📋 ' : '';
        const blockedTag  = isDisabled ? ' · DISABILITATA' : isSleeping ? ' · IN SONNO' : isRepeating ? ' · BLOCCATA' : isCopy ? ' · COPIA' : '';
        const copyBorder  = isCopy ? 'box-shadow:inset 0 0 0 2px rgba(66,165,245,0.5);' : '';
        card.innerHTML = `
            <button class="move-card-btn" onclick="selezionaMossa(${i})"
                style="${isBlocked ? 'opacity:0.4;cursor:not-allowed;' : ''}${copyBorder}">
                <span class="move-btn-name">${blockedIcon}${nome}</span>
                <span class="move-btn-meta">${tipo} · ${cat}${blockedTag}</span>
                <span class="move-btn-pools">🎯 ${acc}${dmgStr}</span>
            </button>
            ${eff ? `
            <button class="move-card-toggle" onclick="toggleMossaInfo(${i})">▾</button>
            <div class="move-card-detail hidden" id="move-detail-${i}">
                ${target ? `<div class="move-detail-target"><strong>Target:</strong> ${target}</div>` : ''}
                <div class="move-detail-effect">${eff}</div>
            </div>` : ''}
        `;
    }
}

function toggleMossaInfo(i) {
    const detail = document.getElementById(`move-detail-${i}`);
    const toggle = document.querySelector(`#move-${i} .move-card-toggle`);
    if (!detail) return;
    const nowHidden = detail.classList.toggle('hidden');
    if (toggle) toggle.textContent = nowHidden ? '▾' : '▴';
}

function _aggiornaPannelloAzioni() {
    const movesEl  = document.getElementById('actions-moves');
    const waitEl   = document.getElementById('actions-wait');
    const endedEl  = document.getElementById('actions-ended');

    movesEl.classList.add('hidden');
    movesEl.classList.remove('readonly');
    waitEl.classList.add('hidden');
    endedEl.classList.add('hidden');

    if (Battle.phase === 'ended') {
        endedEl.classList.remove('hidden');
    } else if (Battle.phase === 'battle' && Battle.roundPhase === 'choose' && !Battle.myCommit) {
        movesEl.classList.remove('hidden');
        _aggiornaBottoniSpeciali();
    } else {
        waitEl.classList.remove('hidden');
    }
}

function _aggiornaBottoniSpeciali() {
    const evadeOk  = _evadeDisponibile();
    const clashOk  = _clashDisponibile();

    const btnEvade = document.getElementById('btn-evade');
    const btnClash = document.getElementById('btn-clash');

    if (btnEvade) {
        btnEvade.disabled = !evadeOk;
        const sub = btnEvade.querySelector('.special-btn-sub');
        if (sub) {
            sub.textContent = evadeOk
                ? ''
                : `R${Math.max(1, Battle._lastEvadeRound + 5)}`;
        } else if (!evadeOk) {
            btnEvade.innerHTML = `🛡️ Evade<span class="special-btn-sub">R${Math.max(1, Battle._lastEvadeRound + 5)}</span>`;
        } else {
            btnEvade.innerHTML = '🛡️ Evade';
        }
    }

    if (btnClash) {
        const hasLowerInit = Battle.myInitSucc < Battle.oppInitSucc;
        btnClash.disabled = !clashOk || !hasLowerInit;
        const reason = !hasLowerInit ? '(init)' : !clashOk ? `R${Math.max(1, Battle._lastClashRound + 5)}` : '';
        if (reason) {
            btnClash.innerHTML = `⚔️ Clash<span class="special-btn-sub">${reason}</span>`;
        } else {
            btnClash.innerHTML = '⚔️ Clash';
        }
    }
}

function _mostraMosseReadonly() {
    const movesEl = document.getElementById('actions-moves');
    const waitEl  = document.getElementById('actions-wait');
    if (!movesEl) return;
    waitEl?.classList.add('hidden');
    movesEl.classList.remove('hidden');
    movesEl.classList.add('readonly');
}

function aggiornaHeader() {
    document.getElementById('hdr-round').textContent   = `Round ${Battle.round}`;
    document.getElementById('hdr-weather').textContent = Battle.weather
        ? `${_iconaMeteo(Battle.weather)} ${_nomeMeteo(Battle.weather)}`
        : '🌤️ —';
}

// ── AZIONI GIOCATORE ─────────────────────────────────────────────────────────

/** Seleziona una mossa: entra nella fase commit (NON apre direttamente il tiro dado). */
function selezionaMossa(index) {
    if (document.getElementById('actions-moves')?.classList.contains('readonly')) return;
    if (Battle.phase !== 'battle' || Battle.roundPhase !== 'choose' || Battle.myCommit) return;
    const pk = Battle.me.team[Battle.me.activeIndex];
    let nome = pk?.data?.moves?.[index];
    if (pk?.copiedMoveSlot === index && pk?.copiedMoveName) nome = pk.copiedMoveName;
    if (!nome) return;
    if (Battle.me.fieldMods.status === 'sleep') {
        log(`💤 ${_nomeMePk()} dorme! Non puoi usare mosse — solo switch o oggetto.`, 'status');
        return;
    }
    if (Battle.me.fieldMods.disabledMoveName && nome === Battle.me.fieldMods.disabledMoveName) {
        log(`🚫 ${nome} è disabilitata! Non puoi usarla finché non cambi Pokémon.`, 'status');
        return;
    }
    if (Battle.me.fieldMods.repeatMoveName && nome !== Battle.me.fieldMods.repeatMoveName) {
        log(`🔁 ${_nomeMePk()} è costretto a usare ${Battle.me.fieldMods.repeatMoveName}! Non puoi scegliere ${nome}.`, 'status');
        return;
    }

    const moveData = _getMoveData(nome);
    const commit = {
        type:      'move',
        moveIndex: index,
        moveName:  nome,
        moveData,
        priority:  _parsePriorityFromEffect(moveData?.Effect) + (Battle.me.fieldMods.priorityBonus || 0)
                 + (moveData?.Type ? (Battle.me.fieldMods.typePriorityBoosts?.[moveData.Type] || 0) : 0),
    };
    _inviaCommit(commit);
}

/** Switch volontario: priority 100. */
function selezionaSwitch(newIndex) {
    if (Battle.phase !== 'battle' || Battle.roundPhase !== 'choose' || Battle.myCommit) return;
    const commit = {
        type:     'switch',
        newIndex,
        priority: SWITCH_PRIORITY,
    };
    _inviaCommit(commit);
}

// ── ITEM HEAL ────────────────────────────────────────────────────────────────

function apriItemHeal() {
    if (document.getElementById('actions-moves')?.classList.contains('readonly')) return;
    if (Battle.phase !== 'battle' || Battle.roundPhase !== 'choose' || Battle.myCommit) return;
    const pk = Battle.me.team[Battle.me.activeIndex];
    const modal = document.createElement('div');
    modal.id = 'modal-item-heal';
    modal.className = 'battle-modal';
    modal.innerHTML = `
        <div class="battle-modal-box">
            <div class="battle-modal-header">
                <span>💊 Item Heal</span>
                <button onclick="chiudiItemHeal()">✕</button>
            </div>
            <div class="battle-modal-body">
                <p style="font-size:0.82rem;color:rgba(232,234,240,0.65);margin-bottom:10px;">
                    Dichiara quanti HP vengono curati e/o quale status viene rimosso.<br>
                    La cura avviene prima dei dadi dell'avversario (priorità assoluta).
                </p>
                <div style="margin-bottom:10px;">
                    <label style="font-size:0.82rem;color:#e8eaf0;display:block;margin-bottom:4px;">HP curati (0 se nessuno)</label>
                    <input type="number" id="item-heal-hp" min="0" value="0"
                        style="width:100%;padding:8px;border-radius:8px;border:1.5px solid rgba(255,255,255,0.15);
                        background:rgba(255,255,255,0.05);color:#e8eaf0;font-family:inherit;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div style="margin-bottom:14px;">
                    <label style="font-size:0.82rem;color:#e8eaf0;display:block;margin-bottom:4px;">Status rimosso</label>
                    <select id="item-heal-status"
                        style="width:100%;padding:8px;border-radius:8px;border:1.5px solid rgba(255,255,255,0.15);
                        background:#1a1d2e;color:#e8eaf0;font-family:inherit;font-size:0.9rem;box-sizing:border-box;">
                        <option value="">— Nessuno —</option>
                        <option value="poison">Veleno</option>
                        <option value="burn">Bruciatura</option>
                        <option value="sleep">Sonno</option>
                        <option value="paralysis">Paralisi</option>
                        <option value="freeze">Congelamento</option>
                        <option value="confused">Confusione</option>
                    </select>
                </div>
                <button onclick="confermaItemHeal()"
                    style="width:100%;padding:12px;border-radius:12px;border:none;
                    background:#2e7d32;color:#fff;font-weight:800;cursor:pointer;font-size:0.9rem;font-family:inherit;">
                    ✅ Conferma cura
                </button>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

function chiudiItemHeal() { document.getElementById('modal-item-heal')?.remove(); }

function confermaItemHeal() {
    const healHP     = Math.max(0, parseInt(document.getElementById('item-heal-hp')?.value || '0') || 0);
    const healStatus = document.getElementById('item-heal-status')?.value || '';
    if (healHP === 0 && !healStatus) return;
    chiudiItemHeal();
    _inviaCommit({ type: 'item-heal', healHP, healStatus: healStatus || null, priority: ITEM_HEAL_PRIORITY });
}

function _eseguiItemHealLocale(commit, onDone) {
    const pk       = Battle.me.team[Battle.me.activeIndex];
    const healHP   = commit.healHP   || 0;
    const healSt   = commit.healStatus || null;
    let msg = `💊 ${pk?.name || '?'} usa un oggetto:`;

    if (healHP > 0) {
        const oldHP  = pk.currentHP;
        pk.currentHP = Math.min(pk.maxHP, pk.currentHP + healHP);
        const actual = pk.currentHP - oldHP;
        msg += ` +${actual} HP (${pk.currentHP}/${pk.maxHP})`;
        // Usiamo HP_MOD_APPLIED (stato già applicato localmente) per sincronizzare l'avversario
        const stateOut = _serializeOpponentFacingState();
        BattleBridge.send('HP_MOD_APPLIED', { targetRole: Battle.role, delta: actual, state: stateOut });
    }
    if (healSt) {
        msg += ` / rimuove ${_nomeStatus(healSt)}`;
        if (Battle.me.fieldMods.status === 'paralysis') Battle.me.fieldMods.Dexterity += 2;
        Battle.me.fieldMods.status           = null;
        Battle.me.fieldMods.statusTurns      = 0;
        Battle.me.fieldMods.burnCureSuccessi = 0;
        Battle.me.fieldMods.iceBlockHP       = 0;
        const stateOut = _serializeOpponentFacingState();
        BattleBridge.send('STATUS_HEALED', { targetRole: Battle.role, state: stateOut });
    }

    logBoth(msg, 'heal');
    aggiornaUI();
    setTimeout(onDone, 300);
}

// ── EVADE ────────────────────────────────────────────────────────────────────

function apriEvade() {
    if (document.getElementById('actions-moves')?.classList.contains('readonly')) return;
    if (Battle.phase !== 'battle' || Battle.roundPhase !== 'choose' || Battle.myCommit) return;
    if (Battle.me.fieldMods.status === 'sleep') {
        log(`💤 ${_nomeMePk()} dorme! Non puoi schivare — solo switch o oggetto.`, 'status');
        return;
    }
    if (!_evadeDisponibile()) return;
    _inviaCommit({ type: 'evade', priority: EVADE_PRIORITY });
}

function _evadeDisponibile() {
    return Battle.round - Battle._lastEvadeRound >= 5;
}

function _eseguiEvadeLocale(commit, onDone) {
    Battle._lastEvadeRound = Battle.round;
    const pk   = Battle.me.team[Battle.me.activeIndex];
    const mods = Battle.me.fieldMods;
    const pool = Math.max(1, (pk._params?.evasion || 0) + (mods.evasion || 0));

    log(`🛡️ ${pk?.name || '?'} tenta la schivata! Pool Evasione: ${pool} dadi.`, 'action');

    Battle._evadeAttemptOnDone = onDone;

    Battle.currentDadiMode  = 'evade';
    Battle.currentDadiPool  = pool;
    Battle.currentDadiRolls = [];

    document.getElementById('modal-dadi-title').textContent = '🛡️ Tiro Schivata';
    document.getElementById('dadi-desc').textContent =
        `Evasione — Pool: ${pool} dadi d6. ≥4 = successo.`;
    document.getElementById('dadi-results').innerHTML = '';
    document.getElementById('modal-dadi').classList.remove('hidden');
    _aggiornaDadiCount();
    _mostraMosseReadonly();
}

function _gestisciRisultatoEvade(successi, rolls) {
    logBoth(`🛡️ ${_nomeMePk()} — Schivata: ${successi} successi`, 'action');
    BattleBridge.send('EVADE_RESULT', { successi, rolls });
    const onDone = Battle._evadeAttemptOnDone;
    Battle._evadeAttemptOnDone = null;
    onDone?.();
}

function _completaEvadeCheck(accSuccessi, onDone) {
    const evadeSuccessi       = Battle._oppEvadeSuccessi ?? 0;
    Battle._oppEvadeSuccessi  = null;
    const dodged = evadeSuccessi >= accSuccessi;
    BattleBridge.send('EVADE_OUTCOME', { dodged, evadeSuccessi, accSuccessi });
    if (dodged) {
        logBoth(`🛡️ Schivata riuscita! (Evasione: ${evadeSuccessi} ≥ Precisione: ${accSuccessi}) — nessun danno!`, 'action');
        if (Battle._iGoFirst) BattleBridge.send('FIRST_ACCURACY_DONE', {});
        onDone?.();
    } else {
        logBoth(`❌ Schivata fallita! (Evasione: ${evadeSuccessi} < Precisione: ${accSuccessi}) — l'attacco continua.`, 'action');
        const isCrit = Battle._pendingAccIsCrit || false;
        Battle._pendingAccIsCrit = false;
        setTimeout(() => _avviaTiroDanno(isCrit ? 2 : 0), 400);
    }
}

// ── CLASH ────────────────────────────────────────────────────────────────────

function apriClash() {
    if (document.getElementById('actions-moves')?.classList.contains('readonly')) return;
    if (Battle.phase !== 'battle' || Battle.roundPhase !== 'choose' || Battle.myCommit) return;
    if (Battle.me.fieldMods.status === 'sleep') {
        log(`💤 ${_nomeMePk()} dorme! Non puoi intercettare — solo switch o oggetto.`, 'status');
        return;
    }
    if (!_clashDisponibile()) return;
    _inviaCommit({ type: 'clash', priority: CLASH_PRIORITY });
}

function _clashDisponibile() {
    return Battle.round - Battle._lastClashRound >= 5 &&
           Battle.myInitSucc < Battle.oppInitSucc;
}

function _calcolaPoolClash(pk, mods, oppMoveCat) {
    const st  = pk?.data?.stats  || {};
    const sk  = pk?.data?.skills || {};
    const base = oppMoveCat === 'Special'
        ? (st.Special  || 0) + (mods?.Special  || 0)
        : (st.Strength || 0) + (mods?.Strength || 0);
    return Math.max(1, base + (sk.Clash || 0));
}

function _eseguiClashLocale(commit, onDone) {
    Battle._lastClashRound = Battle.round;
    const pk      = Battle.me.team[Battle.me.activeIndex];
    const mods    = Battle.me.fieldMods;
    const oppMD   = _getMoveData(Battle.oppCommit?.moveName);
    const oppCat  = oppMD?.Category || 'Physical';
    const pool    = _calcolaPoolClash(pk, mods, oppCat);

    log(`⚔️ ${pk?.name || '?'} usa Clash! Pool: ${pool} dadi (${oppCat === 'Special' ? 'Special' : 'Strength'} + Clash). Avversario deve anche lui tirare.`, 'action');

    Battle._clashDeclOnDone = onDone;

    Battle.currentDadiMode  = 'clash';
    Battle.currentDadiPool  = pool;
    Battle.currentDadiRolls = [];

    document.getElementById('modal-dadi-title').textContent = '⚔️ Tiro Clash';
    document.getElementById('dadi-desc').textContent =
        `Clash — Pool: ${pool} dadi d6 (${oppCat === 'Special' ? 'Special' : 'Strength'} + Clash). ≥4 = successo.`;
    document.getElementById('dadi-results').innerHTML = '';
    document.getElementById('modal-dadi').classList.remove('hidden');
    _aggiornaDadiCount();
    _mostraMosseReadonly();
}

function _gestisciRisultatoClash(successi, rolls) {
    logBoth(`⚔️ ${_nomeMePk()} — Clash: ${successi} successi`, 'action');
    Battle._myClashSuccessi = successi;
    BattleBridge.send('CLASH_RESULT', { successi, rolls });
    _tryResolveClash();
}

function _apriDadiClashAtk() {
    const pk     = Battle.me.team[Battle.me.activeIndex];
    const mods   = Battle.me.fieldMods;
    const myMD   = _getMoveData(Battle.myCommit?.moveName);
    const myCat  = myMD?.Category || 'Physical';
    const pool   = _calcolaPoolClash(pk, mods, myCat);

    log(`⚔️ ${pk?.name || '?'} — tira i dadi Clash! Pool: ${pool} (${myCat === 'Special' ? 'Special' : 'Strength'} + Clash).`, 'action');

    Battle.currentDadiMode  = 'clash-atk';
    Battle.currentDadiPool  = pool;
    Battle.currentDadiRolls = [];

    document.getElementById('modal-dadi-title').textContent = '⚔️ Tiro Clash (attaccante)';
    document.getElementById('dadi-desc').textContent =
        `Clash — Pool: ${pool} dadi d6. ≥4 = successo.`;
    document.getElementById('dadi-results').innerHTML = '';
    document.getElementById('modal-dadi').classList.remove('hidden');
    _aggiornaDadiCount();
    _mostraMosseReadonly();
}

function _gestisciRisultatoClashAtk(successi, rolls) {
    logBoth(`⚔️ ${_nomeMePk()} (attaccante) — Clash: ${successi} successi`, 'action');
    Battle._myClashSuccessi = successi;
    BattleBridge.send('CLASH_ATK_RESULT', { successi, rolls });
    _tryResolveClash();
}

function _tryResolveClash() {
    if (Battle._myClashSuccessi === null || Battle._oppClashSuccessi === null) return;

    const myS  = Battle._myClashSuccessi;
    const oppS = Battle._oppClashSuccessi;
    Battle._myClashSuccessi  = null;
    Battle._oppClashSuccessi = null;

    const amDeclarer = Battle.myCommit?.type === 'clash';

    if (amDeclarer) {
        // Sono il dichiarante: decido l'esito e invio CLASH_OUTCOME + danni
        const clashS = myS;
        const atkS   = oppS;
        if (clashS === atkS) {
            // Pareggio: attaccante 1 danno, dichiarante 1 + efficacia tipo della mossa attaccante
            const oppRole = Battle.role === 'host' ? 'client' : 'host';
            const myPk    = Battle.me.team[Battle.me.activeIndex];

            // Type effectiveness: mossa attaccante vs tipi del dichiarante (me)
            const atkMoveData  = _getMoveData(Battle.oppCommit?.moveName);
            const moveType     = atkMoveData?.Type;
            const myPkBaseData = window.pokedexDatabase?.find(p => p.Name === myPk?.name);
            let typeMod  = 0;
            let isImmune = false;
            // Immunità da abilità/oggetto del dichiarante
            if (moveType && Array.isArray(Battle.me.fieldMods.typeImmunities) &&
                    Battle.me.fieldMods.typeImmunities.includes(moveType)) {
                isImmune = true;
            }
            if (!isImmune && moveType && typeof TYPE_CHART !== 'undefined' && myPkBaseData) {
                const myTypes = [myPkBaseData.Type1, myPkBaseData.Type2].filter(Boolean);
                for (const mt of myTypes) {
                    const chart = TYPE_CHART[mt];
                    if (!chart) continue;
                    if (chart.immunities.includes(moveType)) { isImmune = true; break; }
                    if (chart.weaknesses.includes(moveType))  typeMod++;
                    if (chart.resistances.includes(moveType)) typeMod--;
                }
            }
            const myDamage = isImmune ? 0 : Math.max(1, 1 + typeMod);

            if (isImmune) {
                logBoth(`⚔️ Clash pareggio! (${clashS} vs ${atkS}) — attaccante: 1 danno; ${myPk?.name}: 🚫 immune, 0 danni!`, 'action');
            } else {
                const typeTag = typeMod > 0
                    ? ` ⚡ Super efficace!${typeMod >= 2 ? ' (su entrambi i tipi)' : ''}`
                    : typeMod < 0
                        ? ` 🛡️ Non molto efficace...${typeMod <= -2 ? ' (su entrambi i tipi)' : ''}`
                        : '';
                logBoth(`⚔️ Clash pareggio! (${clashS} vs ${atkS}) — attaccante: 1 danno; ${myPk?.name}: ${myDamage} danni!${typeTag}`, 'action');
            }

            // Applico danno a me stesso (clash dichiarante)
            if (myPk && !myPk.eliminated) {
                myPk.currentHP = Math.max(0, myPk.currentHP - myDamage);
                if (myPk.currentHP <= 0) { myPk.eliminated = true; Battle.me.koCount = (Battle.me.koCount||0)+1; }
            }
            const stateOut = _serializeOpponentFacingState();
            // HP_MOD_APPLIED viene ricevuto dall'attaccante → triggera _clashAtkOnDone
            BattleBridge.send('HP_MOD_APPLIED', { targetRole: Battle.role, delta: -myDamage, state: stateOut });
            // APPLY_HP_MOD all'avversario (attaccante): prende sempre 1 danno (clash non ha tipo)
            BattleBridge.send('APPLY_HP_MOD', { targetRole: oppRole, delta: -1 });
            BattleBridge.send('CLASH_OUTCOME', { result: 'tie', clashSuccessi: clashS, atkSuccessi: atkS });
            aggiornaUI();
            // _fineRound dichiarante: chiamato in msg:HP_MOD_APPLIED (risposta dall'attaccante dopo APPLY_HP_MOD)
        } else {
            // Attaccante vince: continua con la sua mossa
            logBoth(`⚔️ Clash non pareggiato (${clashS} vs ${atkS}) — l'attaccante continua.`, 'action');
            BattleBridge.send('CLASH_OUTCOME', { result: 'attacker', clashSuccessi: clashS, atkSuccessi: atkS });
            const cb = Battle._clashDeclOnDone;
            Battle._clashDeclOnDone = null;
            cb?.();
        }
    }
    // Se sono l'attaccante la risoluzione è gestita dal dichiarante via CLASH_OUTCOME
}

// ── HELPER LOOKUP STAT/SKILL ─────────────────────────────────────────────────

/**
 * Restituisce il valore di una stat o skill del Pokémon dato il nome del campo.
 * Per le stat base (Strength, Dexterity, ecc.) aggiunge il fieldMod corrispondente.
 * Per le skill (Alert, Channel, Clash, ecc.) non ha fieldMod individuale.
 */
function _getValPk(pk, mods, name) {
    if (!name) return 0;
    const n = name.trim();
    if (pk?.data?.stats?.[n] !== undefined)  return (pk.data.stats[n]  || 0) + (mods?.[n] || 0);
    if (pk?.data?.skills?.[n] !== undefined) return  pk.data.skills[n] || 0;
    return 0;
}

// ── MODAL MOSSA ESECUZIONE ───────────────────────────────────────────────────

/**
 * Apre il modal per eseguire una mossa (tiro precisione → tiro danno).
 * Viene chiamato solo durante la fase resolve, NON durante la scelta.
 */
function apriModalMossaEsecuzione(nome, moveData, onComplete) {
    if (!moveData) moveData = _getMoveData(nome);
    if (moveData && Battle.currentMove) Battle.currentMove.data = moveData;

    const pk    = Battle.me.team[Battle.me.activeIndex];
    const mods  = Battle.me.fieldMods;

    const TYPE_NAMES = {
        1:'Normal',2:'Fire',3:'Water',4:'Electric',5:'Grass',6:'Ice',
        7:'Fighting',8:'Poison',9:'Ground',10:'Flying',11:'Psychic',
        12:'Bug',13:'Rock',14:'Ghost',15:'Dragon',16:'Dark',17:'Steel',18:'Fairy',
    };
    const tipo      = TYPE_NAMES[moveData?.Type] || moveData?.Type || '—';
    const cat       = moveData?.Category || '—';
    const isSupport = cat === 'Support';

    // Accuracy pool: Accuracy1 + Accuracy2 dalla move database
    const acc1Label  = moveData?.Accuracy1 || '';
    const acc2Label  = moveData?.Accuracy2 || '';
    const acc1Val    = _getValPk(pk, mods, acc1Label);
    const acc2Val    = _getValPk(pk, mods, acc2Label);
    const confMalus  = mods.confusedMalus ? 1 : 0;
    const poolPrec   = Math.max(1, acc1Val + acc2Val + (mods.accuracy || 0));
    const accFormula = [acc1Label, acc2Label].filter(Boolean).join(' + ') || '—';

    // Damage pool: Damage1 + Power dalla move database
    const dmg1Label  = moveData?.Damage1 || '';
    const dmg1Val    = _getValPk(pk, mods, dmg1Label);
    const power      = parseInt(moveData?.Power) || 0;
    const poolDanno  = Math.max(1, dmg1Val + power);
    const dmgFormula = dmg1Label ? `${dmg1Label} + ${power} (Power) = ${poolDanno}${confMalus ? ' 😵−1 succ.' : ''}` : '—';

    Battle.currentMove._accMod = 0;
    Battle.currentMove._dmgMod = 0;
    Battle.currentMove._poolPrecisione = poolPrec;
    Battle.currentMove._onComplete = onComplete;

    document.getElementById('modal-mossa-title').textContent = `⚔️ ${nome}`;
    const body = document.getElementById('modal-mossa-body');
    body.innerHTML = `
        <div class="mossa-info-row"><span class="mossa-info-label">Tipo</span><span class="mossa-info-value">${tipo}</span></div>
        <div class="mossa-info-row"><span class="mossa-info-label">Categoria</span><span class="mossa-info-value">${cat}</span></div>
        <div class="mossa-info-row"><span class="mossa-info-label">Bersaglio</span><span class="mossa-info-value">${moveData?.Target || '—'}</span></div>
        <div class="mossa-info-row"><span class="mossa-info-label">Precisione</span><span class="mossa-info-value">${accFormula} = ${poolPrec} dadi</span></div>
        ${!isSupport ? `<div class="mossa-info-row"><span class="mossa-info-label">Danno base</span><span class="mossa-info-value">${dmgFormula}</span></div>` : ''}
        ${moveData?.Effect && moveData.Effect !== '-' ? `
        <div style="padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
            <div class="mossa-info-label" style="margin-bottom:3px;">Effetto</div>
            <div style="font-size:0.78rem;color:#e8eaf0;line-height:1.4;">${moveData.Effect}</div>
        </div>` : ''}
        <div class="mossa-info-row"><span class="mossa-info-label">Successi richiesti</span><span class="mossa-info-value" style="color:#f9a825;font-weight:900;">${_calcolaAccNeeded()} (round ${Battle.round})</span></div>

        <p style="font-size:0.78rem; color:rgba(232,234,240,0.45); font-style:italic; margin-top:4px;">
            Ci sono effetti che modificano precisione o danni di questa mossa?
        </p>
        <div style="display:flex; flex-direction:column; gap:6px; margin-top:4px;">
            <div style="display:flex; align-items:center; justify-content:space-between;">
                <span style="font-size:0.85rem; font-weight:700;">Modificatore precisione:</span>
                <div style="display:flex; align-items:center; gap:8px;">
                    <button onclick="modificaPoolMossa('acc',-1)" style="width:30px;height:30px;border-radius:8px;border:1.5px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#e8eaf0;font-weight:900;cursor:pointer;">−</button>
                    <span id="mossa-acc-mod" style="font-weight:900; min-width:24px; text-align:center;">0</span>
                    <button onclick="modificaPoolMossa('acc',+1)" style="width:30px;height:30px;border-radius:8px;border:1.5px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#e8eaf0;font-weight:900;cursor:pointer;">+</button>
                </div>
            </div>
            ${!isSupport ? `
            <div style="display:flex; align-items:center; justify-content:space-between;">
                <span style="font-size:0.85rem; font-weight:700;">Modificatore danno:</span>
                <div style="display:flex; align-items:center; gap:8px;">
                    <button onclick="modificaPoolMossa('dmg',-1)" style="width:30px;height:30px;border-radius:8px;border:1.5px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#e8eaf0;font-weight:900;cursor:pointer;">−</button>
                    <span id="mossa-dmg-mod" style="font-weight:900; min-width:24px; text-align:center;">0</span>
                    <button onclick="modificaPoolMossa('dmg',+1)" style="width:30px;height:30px;border-radius:8px;border:1.5px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#e8eaf0;font-weight:900;cursor:pointer;">+</button>
                </div>
            </div>` : ''}
        </div>

        <button class="btn-action-primary" style="margin-top:8px;" onclick="iniziaTiroPrecisione()">
            🎲 Tira Precisione (${poolPrec} dadi)
        </button>
    `;

    document.getElementById('modal-mossa').classList.remove('hidden');
    log(`Stai usando ${nome}!`, 'action');
}

function _calcolaPoolPrecisione(moveData) {
    const pk   = Battle.me.team[Battle.me.activeIndex];
    const mods = Battle.me.fieldMods;
    const v1   = _getValPk(pk, mods, moveData?.Accuracy1);
    const v2   = _getValPk(pk, mods, moveData?.Accuracy2);
    return v1 + v2 + (mods.accuracy || 0);
}

function modificaPoolMossa(tipo, delta) {
    if (tipo === 'acc') {
        Battle.currentMove._accMod += delta;
        document.getElementById('mossa-acc-mod').textContent = Battle.currentMove._accMod;
    } else {
        Battle.currentMove._dmgMod += delta;
        document.getElementById('mossa-dmg-mod').textContent = Battle.currentMove._dmgMod;
    }
}

function chiudiModalMossa() {
    document.getElementById('modal-mossa').classList.add('hidden');
    _rimuoviPill('modal-mossa');
    const btn = document.getElementById('btn-mini-mossa');
    if (btn) btn.textContent = '—';
}

function chiudiModalDadi() {
    document.getElementById('modal-dadi').classList.add('hidden');
    _rimuoviPill('modal-dadi');
    const btn = document.getElementById('btn-mini-dadi');
    if (btn) btn.textContent = '—';
}

function miniModal(modalId, btnId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    el.classList.add('hidden');
    const btn = btnId ? document.getElementById(btnId) : el.querySelector('.btn-mini-modal');
    if (btn) btn.textContent = '▶';
    _mostraPill(modalId, btnId);
}

function _mostraPill(modalId, btnId) {
    _rimuoviPill(modalId);
    let label;
    if (modalId === 'modal-mossa') {
        label = Battle.currentMove?.nome || 'Mossa';
    } else if (modalId === 'modal-dadi') {
        label = { accuracy:'Precisione', damage:'Danno', evade:'Schivata', clash:'Clash', 'clash-atk':'Clash Atk' }[Battle.currentDadiMode] || 'Dadi';
    } else {
        const span = document.getElementById(modalId)?.querySelector('.battle-modal-header span');
        label = span?.textContent?.trim() || modalId;
    }
    const pill = document.createElement('button');
    pill.id = `pill-${modalId}`;
    pill.textContent = `▶ ${label}`;
    pill.style.cssText = [
        'position:fixed', 'bottom:72px', 'right:16px', 'z-index:9999',
        'padding:10px 18px', 'border-radius:20px',
        'border:1.5px solid rgba(255,255,255,0.2)',
        'background:rgba(18,28,48,0.97)', 'color:#e8eaf0',
        'font-weight:700', 'cursor:pointer', 'font-size:0.88rem',
        'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
    ].join(';');
    pill.onclick = () => {
        document.getElementById(modalId)?.classList.remove('hidden');
        _rimuoviPill(modalId);
        const el = document.getElementById(modalId);
        const btn = (btnId ? document.getElementById(btnId) : null) || el?.querySelector('.btn-mini-modal');
        if (btn) btn.textContent = '—';
    };
    document.body.appendChild(pill);
    _aggiornaBloccoOverlay();
}

function _rimuoviPill(modalId) {
    document.getElementById(`pill-${modalId}`)?.remove();
    _aggiornaBloccoOverlay();
}

function _aggiornaBloccoOverlay() {
    const hasPill = !!document.querySelector('[id^="pill-"]');
    let overlay = document.getElementById('modal-pill-overlay');
    if (hasPill) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'modal-pill-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:transparent;pointer-events:all;';
            document.body.appendChild(overlay);
        }
    } else {
        overlay?.remove();
    }
}

// ── TIRO DADI ─────────────────────────────────────────────────────────────────

function iniziaTiroPrecisione() {
    chiudiModalMossa();
    const pool = (Battle.currentMove._poolPrecisione || 0) + (Battle.currentMove._accMod || 0);

    Battle.currentDadiMode  = 'accuracy';
    Battle.currentDadiPool  = Math.max(1, pool);
    Battle.currentDadiRolls = [];

    document.getElementById('modal-dadi-title').textContent = '🎯 Tiro Precisione';
    document.getElementById('dadi-desc').textContent =
        `Mossa: ${Battle.currentMove.nome} — Pool: ${Battle.currentDadiPool} dadi d6. Risultato ≥ 4 = successo.`;
    document.getElementById('dadi-results').innerHTML = '';
    document.getElementById('modal-dadi').classList.remove('hidden');
    _aggiornaDadiCount();
    _mostraMosseReadonly();
}

function modificaDadi(delta) {
    Battle.currentDadiPool = Math.max(1, Battle.currentDadiPool + delta);
    _aggiornaDadiCount();
}

function tiraDado() {
    if (Battle.currentDadiRolls.length >= Battle.currentDadiPool) return;
    const risultato = Math.floor(Math.random() * 6) + 1;
    const idx = Battle.currentDadiRolls.length;   // capture index before push
    Battle.currentDadiRolls.push(risultato);
    const wrap   = document.getElementById('dadi-results');
    const bubble = document.createElement('div');
    bubble.className = 'die-bubble' + (risultato >= 4 ? ' success' : '');
    bubble.textContent = risultato;
    bubble.title = 'Clicca per ritirare (costa 1 Will)';
    bubble.addEventListener('click', () => _ritiraDado(bubble, idx));
    wrap.appendChild(bubble);
    _aggiornaDadiCount();
}

function _aggiornaDadiCount() {
    const rolled = Battle.currentDadiRolls.length;
    const pool   = Battle.currentDadiPool;
    document.getElementById('dadi-count').textContent = `${rolled}/${pool}`;
    const btn = document.querySelector('.btn-roll-d6');
    if (btn) { btn.disabled = rolled >= pool; btn.style.opacity = rolled >= pool ? '0.4' : '1'; }
}

function _ritiraDado(bubble, idx) {
    const nuovo = Math.floor(Math.random() * 6) + 1;
    Battle.currentDadiRolls[idx] = nuovo;
    bubble.textContent = nuovo;
    bubble.className   = 'die-bubble' + (nuovo >= 4 ? ' success' : '');
    logBoth(`🃏 ${Battle.me.trainerName} — dado ritirato con Will: ${nuovo}`, 'system');
}

function confermaRisultatoDadi() {
    const rolls    = Battle.currentDadiRolls;
    const successi = rolls.filter(r => r >= 4).length;
    document.getElementById('modal-dadi').classList.add('hidden');

    if (Battle.currentDadiMode === 'accuracy') {
        _gestisciRisultatoPrecisione(successi, rolls);
    } else if (Battle.currentDadiMode === 'damage') {
        _gestisciRisultatoDanno(successi, rolls);
    } else if (Battle.currentDadiMode === 'evade') {
        _gestisciRisultatoEvade(successi, rolls);
    } else if (Battle.currentDadiMode === 'clash') {
        _gestisciRisultatoClash(successi, rolls);
    } else if (Battle.currentDadiMode === 'clash-atk') {
        _gestisciRisultatoClashAtk(successi, rolls);
    }
}

function _calcolaAccNeeded() {
    return ((Battle.round - 1) % 5) + 1;
}

function _gestisciRisultatoPrecisione(successi, rolls) {
    const moveData  = Battle.currentMove?.data || _getMoveData(Battle.currentMove?.nome);
    if (moveData && Battle.currentMove) Battle.currentMove.data = moveData;
    const accNeeded = _calcolaAccNeeded();

    // Flinch: forza precisione a 0, poi si azzera
    if (Battle.me.fieldMods.flinchActive) {
        logBoth(`😨 ${_nomeMePk()} ha vacillato — precisione azzerata!`, 'status');
        Battle.me.fieldMods.flinchActive = false;
        BattleBridge.send('REMOVE_STATUS', { targetRole: Battle.role, statusId: 'flinched' });
        successi = 0;
    }
    // Confusione: −1 successo finale precisione
    if (Battle.me.fieldMods.confusedMalus && successi > 0) {
        successi = Math.max(0, successi - 1);
        logBoth(`😵 ${_nomeMePk()} è confuso — −1 successo precisione (tot: ${successi})`, 'status');
    }

    // Weather: alcune combinazioni azzerano l'accuratezza (non Support)
    const _wMoveType = moveData?.Type;
    const _wMoveCat  = moveData?.Category;
    if (_wMoveCat !== 'Support') {
        if (Battle.weather === 'harsh_sun' && _wMoveType === 3) {
            logBoth(`☀️ Harsh Sunlight: mossa Acqua non può colpire — precisione 0!`, 'weather');
            successi = 0;
        } else if (Battle.weather === 'typhoon' && _wMoveType === 2) {
            logBoth(`🌀 Typhoon: mossa Fuoco non può colpire — precisione 0!`, 'weather');
            successi = 0;
        }
    }

    BattleBridge.send('ACCURACY_RESULT', { hit: successi >= accNeeded, rolls, successi });

    // ── Caso Evade: il bersaglio ha dichiarato schivata ──
    if (Battle.oppCommit?.type === 'evade') {
        logBoth(`🎯 ${_nomeMePk()} — Precisione: ${successi} successi (attesa schivata avversario)`, 'action');
        const critThreshold = Math.max(1, 3 - (Battle.me.fieldMods.critBonus || 0));
        Battle._pendingAccIsCrit   = successi >= accNeeded + critThreshold;
        Battle._pendingAccSuccessi = successi;
        Battle._pendingAccOnDone   = Battle.currentMove._onComplete;
        // Sblocca l'evader (se sono il primo) così può tirare i dadi evasione
        if (Battle._iGoFirst) BattleBridge.send('FIRST_ACCURACY_DONE', {});
        if (Battle._oppEvadeSuccessi !== null) {
            const acc = Battle._pendingAccSuccessi;
            const cb  = Battle._pendingAccOnDone;
            Battle._pendingAccSuccessi = null;
            Battle._pendingAccOnDone   = null;
            _completaEvadeCheck(acc, cb);
        }
        return;
    }

    logBoth(`🎯 ${_nomeMePk()} — Precisione: ${successi}/${accNeeded} — ${successi >= accNeeded ? '✅ Colpisce!' : '❌ Manca!'}`, 'action');

    if (successi >= accNeeded) {
        const critThreshold = Math.max(1, 3 - (Battle.me.fieldMods.critBonus || 0));
        const isCrit = successi >= accNeeded + critThreshold;
        if (isCrit) logBoth(`💥 COLPO CRITICO di ${_nomeMePk()}! +2 dadi danno!`, 'action');
        Battle.currentMove._isCrit = isCrit;
        const cat = moveData?.Category || 'Physical';
        if (cat === 'Support') {
            if (Battle._iGoFirst) Battle._pendingFirstAccDone = true;
            _apriModalEffetto();
        } else {
            setTimeout(() => _avviaTiroDanno(isCrit ? 2 : 0), 400);
        }
    } else {
        logBoth(`❌ ${_nomeMePk()} manca il bersaglio.`, 'action');
        if (Battle._iGoFirst) BattleBridge.send('FIRST_ACCURACY_DONE', {});
        const onComplete = Battle.currentMove._onComplete;
        onComplete?.();
    }
}

function _avviaTiroDanno(bonusDadi = 0) {
    const pk       = Battle.me.team[Battle.me.activeIndex];
    const mods     = Battle.me.fieldMods;
    const moveData = Battle.currentMove?.data || _getMoveData(Battle.currentMove?.nome);
    const cat      = moveData?.Category || 'Physical';

    // Damage1 è la stat che contribuisce al danno (es. "Special", "Strength")
    // Power è il bonus fisso della mossa (campo numerico nel database)
    const statBase = _getValPk(pk, mods, moveData?.Damage1);
    const power    = parseInt(moveData?.Power) || 0;

    // STAB: +1 dado se la mossa è dello stesso tipo del Pokémon (Type1 o Type2)
    const pkBaseData = window.pokedexDatabase?.find(p => p.Name === pk.name);
    const moveType   = moveData?.Type;
    const stabBonus  = (moveType && (moveType === pkBaseData?.Type1 || moveType === pkBaseData?.Type2)) ? 1 : 0;
    if (stabBonus) logBoth(`⭐ STAB! ${pk.name} usa una mossa del suo tipo → +1 dado danno.`, 'action');

    let weatherPoolMod = 0;
    if ((Battle.weather === 'sunny' || Battle.weather === 'harsh_sun') && moveType === 2) {
        weatherPoolMod = 1;
        logBoth(`☀️ ${_nomeMeteo(Battle.weather)}: +1 dado danno (mossa Fuoco)!`, 'weather');
    } else if ((Battle.weather === 'rain' || Battle.weather === 'typhoon') && moveType === 3) {
        weatherPoolMod = 1;
        logBoth(`🌧️ ${_nomeMeteo(Battle.weather)}: +1 dado danno (mossa Acqua)!`, 'weather');
    } else if (Battle.weather === 'strong_winds' && moveType === 10) {
        weatherPoolMod = 1;
        logBoth(`💨 Strong Winds: +1 dado danno (mossa Volante)!`, 'weather');
    }

    const pool = Math.max(1, statBase + power + (Battle.currentMove._dmgMod || 0) + bonusDadi + stabBonus + weatherPoolMod);

    Battle.currentDadiMode  = 'damage';
    Battle.currentDadiPool  = pool;
    Battle.currentDadiRolls = [];

    document.getElementById('modal-dadi-title').textContent = '💥 Tiro Danno';
    document.getElementById('dadi-desc').textContent =
        `${cat} — Pool: ${pool} dadi d6${stabBonus ? ' (STAB +1)' : ''}. Ogni successo (≥4) = 1 danno.`;
    document.getElementById('dadi-results').innerHTML = '';
    document.getElementById('modal-dadi').classList.remove('hidden');
    _aggiornaDadiCount();
    _mostraMosseReadonly();
}

function _gestisciRisultatoDanno(successi, rolls) {
    const pk       = Battle.opponent.team[Battle.opponent.activeIndex];
    const mods     = Battle.opponent.fieldMods;
    const moveData = Battle.currentMove?.data;
    const cat      = moveData?.Category || 'Physical';

    // Weather defense bonuses
    const weatherDefBonus   = (Battle.weather === 'hail'      && _isPkIceType(pk))  ? 1 : 0;
    const weatherDefSpBonus = (Battle.weather === 'sandstorm' && _isPkRockType(pk)) ? 1 : 0;
    if (weatherDefBonus)   logBoth(`🌨️ Hail: +1 Def (${pk.name} — tipo Ghiaccio)!`, 'weather');
    if (weatherDefSpBonus) logBoth(`🌪️ Sandstorm: +1 Def Sp (${pk.name} — tipo Roccia)!`, 'weather');

    const difesa = cat === 'Special'
        ? Math.max(0, (pk?._params?.defSp ?? (pk?.data?.stats?.Insight  || 0)) + (mods.defSp || 0) + weatherDefSpBonus)
        : Math.max(0, (pk?._params?.def   ?? (pk?.data?.stats?.Vitality || 0)) + (mods.def   || 0) + weatherDefBonus);

    const dannoBase   = Math.max(1, successi - difesa);
    const labelDifesa = cat === 'Special' ? 'Def Sp' : 'Def';

    // Type effectiveness
    const moveType      = moveData?.Type;
    const oppPkBaseData = window.pokedexDatabase?.find(p => p.Name === pk.name);
    let typeMod  = 0;
    let isImmune = false;

    // Immunità da abilità/oggetto (priorità sul TYPE_CHART)
    if (moveType && cat !== 'Support' && Array.isArray(Battle.opponent.fieldMods.typeImmunities) &&
            Battle.opponent.fieldMods.typeImmunities.includes(moveType)) {
        isImmune = true;
    }
    if (!isImmune && moveType && cat !== 'Support' && typeof TYPE_CHART !== 'undefined' && oppPkBaseData) {
        const oppTypes = [oppPkBaseData.Type1, oppPkBaseData.Type2].filter(Boolean);
        for (const ot of oppTypes) {
            const chart = TYPE_CHART[ot];
            if (!chart) continue;
            if (chart.immunities.includes(moveType)) { isImmune = true; break; }
            if (chart.weaknesses.includes(moveType))  typeMod++;
            if (chart.resistances.includes(moveType)) typeMod--;
        }
    }

    // Strong Winds: Electric(4), Ice(6), Rock(13) → neutrale vs Volante
    if (!isImmune && Battle.weather === 'strong_winds' && [4, 6, 13].includes(moveType) && _isPkFlyingType(pk)) {
        if (typeMod !== 0) logBoth(`💨 Strong Winds: ${_TYPE_NAMES[moveType]} → neutrale vs Volante!`, 'weather');
        typeMod = 0;
    }

    let dannoFinale;
    if (isImmune) {
        dannoFinale = 0;
        logBoth(`🚫 ${pk.name} è immune al tipo di questa mossa — nessun effetto!`, 'action');
        logBoth(`💥 ${_nomeMePk()} — Danno: ${successi}−${difesa} ${labelDifesa} = 0 danni (immunità)`, 'damage');
    } else {
        dannoFinale = Math.max(0, dannoBase + typeMod);
        const modStr = typeMod !== 0 ? ` ${typeMod > 0 ? '+' : ''}${typeMod} tipo` : '';
        if (typeMod > 0)      logBoth(`⚡ Super efficace!${typeMod >= 2 ? ' (su entrambi i tipi)' : ''}`, 'action');
        else if (typeMod < 0) logBoth(`🛡️ Non molto efficace...${typeMod <= -2 ? ' (su entrambi i tipi)' : ''}`, 'action');
        logBoth(`💥 ${_nomeMePk()} — Danno: ${successi}−${difesa} ${labelDifesa}${modStr} = ${dannoFinale} danni!`, 'damage');
    }

    if (!isImmune && dannoFinale > 0 && Battle.me.fieldMods.confusedMalus) {
        dannoFinale = Math.max(0, dannoFinale - 1);
        logBoth(`😵 ${_nomeMePk()} è confuso — −1 danno (tot: ${dannoFinale})`, 'status');
    }
    if (!isImmune && dannoFinale > 0 && Battle.me.fieldMods.inLoveHalveDmg) {
        dannoFinale = Math.floor(dannoFinale / 2);
        logBoth(`💕 ${_nomeMePk()} è innamorato — danni dimezzati: ${dannoFinale}!`, 'status');
    }

    // Weather: Sunny → mosse Acqua -1 danno totale
    if (!isImmune && Battle.weather === 'sunny' && moveType === 3) {
        dannoFinale = Math.max(0, dannoFinale - 1);
        logBoth(`☀️ Sunny Weather: −1 danno totale (mossa Acqua) → ${dannoFinale} danni!`, 'weather');
    }
    // Weather: Rain → mosse Fuoco -1 danno totale
    if (!isImmune && Battle.weather === 'rain' && moveType === 2) {
        dannoFinale = Math.max(0, dannoFinale - 1);
        logBoth(`🌧️ Rain Weather: −1 danno totale (mossa Fuoco) → ${dannoFinale} danni!`, 'weather');
    }

    // Danno minimo 1 se non immunità e non Support
    if (!isImmune && moveData?.Category !== 'Support' && dannoFinale < 1) {
        dannoFinale = 1;
        logBoth(`⚔️ Danno minimo: 1 HP (resistenza/difesa non può azzerare i danni)`, 'damage');
    }

    BattleBridge.send('APPLY_DAMAGE', {
        damage:     dannoFinale,
        targetRole: Battle.opponent.role || (Battle.role === 'host' ? 'client' : 'host'),
        rolls,
        successi,
    });

    // Il secondo giocatore si sblocca DOPO che il primo ha confermato il modal effetti.
    if (Battle._iGoFirst) Battle._pendingFirstAccDone = true;

    aggiornaUI();
    setTimeout(() => {
        _apriModalEffetto();
    }, 400);
}

// ── COSTANTI BATTLE MODAL ─────────────────────────────────────────────────────

const _TYPE_NAMES = {
    1:'Normal',2:'Fire',3:'Water',4:'Electric',5:'Grass',6:'Ice',
    7:'Fighting',8:'Poison',9:'Ground',10:'Flying',11:'Psychic',
    12:'Bug',13:'Rock',14:'Ghost',15:'Dragon',16:'Dark',17:'Steel',18:'Fairy',
};
const _typeOptions = () => Object.entries(_TYPE_NAMES).map(([id,n]) => `<option value="${id}">${n}</option>`).join('');

const _BATTLE_STATS = [
    { key: 'Strength',      label: 'Strength' },
    { key: 'Dexterity',     label: 'Dexterity' },
    { key: 'Vitality',      label: 'Vitality' },
    { key: 'Special',       label: 'Special' },
    { key: 'Insight',       label: 'Insight' },
    { key: 'accuracy',      label: 'Accuracy' },
    { key: 'evasion',       label: 'Evasion' },
    { key: 'clash',         label: 'Clash' },
    { key: 'def',           label: 'Def (fisica)' },
    { key: 'defSp',         label: 'Def Sp (speciale)' },
    { key: 'initiative',    label: 'Iniziativa' },
    { key: 'priorityBonus', label: 'Priority bonus' },
    { key: 'critBonus',     label: 'Critico (−soglia)' },
];
const _BATTLE_STATUSES = [
    { id: 'poison',    label: '☠️ Veleno',          turns: 0  },
    { id: 'poison2',   label: '☠️☠️ Veleno Grave',   turns: 0  },
    { id: 'burn',      label: '🔥 Bruciatura',       turns: 0  },
    { id: 'burn2',     label: '🔥🔥 Bruciatura 2',   turns: 0  },
    { id: 'burn3',     label: '🔥🔥🔥 Bruciatura 3', turns: 0  },
    { id: 'sleep',     label: '💤 Sonno',            turns: 0  },
    { id: 'paralysis', label: '⚡ Paralisi',         turns: 0  },
    { id: 'freeze',    label: '🧊 Congelamento',     turns: 0  },
    { id: 'confused',  label: '😵 Confusione',       turns: 10 },
    { id: 'love',      label: '💕 Innamoramento',    turns: 10 },
    { id: 'flinched',  label: '😨 Flinch',           turns: 1  },
];
const _BATTLE_WEATHERS = [
    { id: 'sunny',        label: '⛅ Sunny Weather' },
    { id: 'harsh_sun',    label: '☀️ Harsh Sunlight Weather' },
    { id: 'rain',         label: '🌧️ Rain Weather' },
    { id: 'typhoon',      label: '🌀 Typhoon Weather' },
    { id: 'hail',         label: '🌨️ Hail Weather' },
    { id: 'strong_winds', label: '💨 Strong Winds Weather' },
    { id: 'sandstorm',    label: '🌪️ Sandstorm Weather' },
    { id: 'none',         label: '🌤️ Nessuno/Rimuovi' },
];

// ── EFFETTI POST-DANNO ────────────────────────────────────────────────────────

let _effQueue = [];

function _apriModalEffetto() {
    _effQueue = [];
    const body  = document.getElementById('modal-effetto-body');
    const myPk  = Battle.me.team[Battle.me.activeIndex]?.name || 'Il tuo';
    const oppPk = Battle.opponent?.team?.[Battle.opponent.activeIndex]?.name || 'Avversario';
    const tgtO  = `<option value="me">${myPk}</option><option value="opp">${oppPk}</option>`;
    const stO   = _BATTLE_STATS.map(s=>`<option value="${s.key}">${s.label}</option>`).join('');
    const dlO   = [1,2,3,4,5,6].map(n=>`<option value="${n}">+${n}</option>`).join('')
                + [1,2,3,4,5,6].map(n=>`<option value="${-n}">−${n}</option>`).join('');
    const sl  = 'padding:6px 8px;border-radius:8px;border:1.5px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#e8eaf0;font-size:0.8rem;';
    const sec = 'padding:10px 0;border-top:1px solid rgba(255,255,255,0.07);';
    const lbl = 'font-size:0.78rem;font-weight:700;color:rgba(232,234,240,0.55);text-transform:uppercase;letter-spacing:0.04em;margin:0 0 7px;';

    body.innerHTML = `
        <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:8px 10px;min-height:42px;">
            <p style="${lbl}">📋 In coda (<span id="eff-q-count">0</span>)</p>
            <div id="eff-q-list" style="display:flex;flex-direction:column;gap:5px;">
                <p style="font-size:0.78rem;color:rgba(232,234,240,0.3);margin:0;">Nessuna modifica in coda</p>
            </div>
        </div>
        <div style="${sec}">
            <p style="${lbl}">📊 Modifica statistica</p>
            <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
                <select id="eff-stat-tgt" style="${sl}flex:0 0 auto;max-width:130px;">${tgtO}</select>
                <select id="eff-stat-name" style="${sl}flex:1;">${stO}</select>
                <select id="eff-stat-delta" style="${sl}flex:0 0 75px;">${dlO}</select>
                <button onclick="_statAsk('eff')" style="padding:6px 11px;border-radius:8px;border:1.5px solid rgba(39,174,96,0.35);background:rgba(39,174,96,0.08);color:#66bb6a;font-size:0.82rem;font-weight:700;cursor:pointer;">➕</button>
            </div>
            <div id="eff-stat-roll-panel"></div>
        </div>
        <div style="${sec}">
            <p style="${lbl}">🔶 Applica status</p>
            <select id="eff-status-tgt" style="${sl}width:100%;margin-bottom:7px;">${tgtO}</select>
            <div style="display:flex;flex-wrap:wrap;gap:5px;">
                ${_BATTLE_STATUSES.map(s=>`<button onclick="_statusAsk('eff','${s.id}','${s.label}',${s.turns})" style="padding:5px 8px;border-radius:7px;border:1.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#e8eaf0;font-size:0.76rem;cursor:pointer;">${s.label}</button>`).join('')}
            </div>
            <div id="eff-status-roll-panel"></div>
        </div>
        <div style="${sec}">
            <p style="${lbl}">🌦️ Meteo</p>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;">
                <span style="font-size:0.78rem;color:rgba(232,234,240,0.55);">Durata:</span>
                <input type="number" id="eff-weather-rounds" min="0" value="4" style="${sl}width:54px;text-align:center;">
                <span style="font-size:0.72rem;color:rgba(232,234,240,0.4);">round (×5 turni · 0 = permanente)</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;">
                ${_BATTLE_WEATHERS.map(w=>`<button id="eff-wb-${w.id}" onclick="_effAccodaMeteo('${w.id}','${w.label}')" style="padding:5px 8px;border-radius:7px;border:1.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#e8eaf0;font-size:0.76rem;cursor:pointer;">${w.label}</button>`).join('')}
            </div>
        </div>
        <div style="${sec}">
            <p style="${lbl}">❤️ HP diretto</p>
            <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
                <select id="eff-hp-tgt" style="${sl}flex:0 0 auto;max-width:130px;">${tgtO}</select>
                ${[[-5,'229,57,53','#ef5350'],[-1,'229,57,53','#ef5350'],[1,'39,174,96','#66bb6a'],[5,'39,174,96','#66bb6a']].map(([n,rgb,col])=>`<button onclick="_effAccodaHP(${n})" style="padding:5px 10px;border-radius:8px;border:1.5px solid rgba(${rgb},0.35);background:rgba(${rgb},0.08);color:${col};font-weight:900;cursor:pointer;">${n>0?'+':''}${n}</button>`).join('')}
            </div>
        </div>
        <div style="${sec}">
            <p style="${lbl}">🔄 Sostituzione Pokémon (da mossa)</p>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
                <button onclick="_effSwitchMe()" class="switch-btn" style="flex:1;font-family:inherit;font-size:0.85rem;cursor:pointer;">🔄 Switch mio</button>
                <button onclick="_effSwitchOpp()" class="switch-btn" style="flex:1;font-family:inherit;font-size:0.85rem;cursor:pointer;">🔄 Switch avversario</button>
            </div>
        </div>
        <div style="${sec}">
            <p style="${lbl}">🔀 Effetti mossa</p>
            <p style="font-size:0.74rem;color:rgba(232,234,240,0.4);margin:0 0 8px;">⚠️ Usabili solo se il tuo Pokémon agisce per <b>secondo</b> in coda.</p>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
                <button onclick="_effAccodaDisabled()" style="padding:6px 10px;border-radius:8px;border:1.5px solid rgba(239,83,80,0.35);background:rgba(239,83,80,0.08);color:#ef5350;font-size:0.8rem;font-weight:700;cursor:pointer;">🚫 Disabled</button>
                <button onclick="_effApriRepeat()" style="padding:6px 10px;border-radius:8px;border:1.5px solid rgba(255,167,38,0.35);background:rgba(255,167,38,0.08);color:#ffa726;font-size:0.8rem;font-weight:700;cursor:pointer;">🔁 Repeat</button>
                <button onclick="_effAccodaCopy()" style="padding:6px 10px;border-radius:8px;border:1.5px solid rgba(66,165,245,0.35);background:rgba(66,165,245,0.08);color:#42a5f5;font-size:0.8rem;font-weight:700;cursor:pointer;">📋 Copy</button>
            </div>
            <div id="eff-repeat-panel"></div>
        </div>

        <button onclick="_inviaEffettoEChiudi()" style="width:100%;padding:13px;border-radius:14px;border:none;background:#1877f2;color:#fff;font-family:inherit;font-size:0.95rem;font-weight:800;cursor:pointer;margin-top:4px;">
            ✅ Fine azione / Invia tutto
        </button>
    `;
    document.getElementById('modal-effetto').classList.remove('hidden');
}

function _effRenderCoda() {
    const listEl  = document.getElementById('eff-q-list');
    const countEl = document.getElementById('eff-q-count');
    if (!listEl) return;
    if (countEl) countEl.textContent = _effQueue.length;
    if (!_effQueue.length) {
        listEl.innerHTML = '<p style="font-size:0.78rem;color:rgba(232,234,240,0.3);margin:0;">Nessuna modifica in coda</p>';
        return;
    }
    listEl.innerHTML = _effQueue.map((e,i) => {
        const desc = e.type==='stat'      ? `📊 ${e.tName} — ${e.stat} ${e.delta>0?'+':''}${e.delta}`
                   : e.type==='status'    ? `🔶 ${e.tName} — ${e.label}`
                   : e.type==='weather'   ? `🌦️ Meteo → ${e.label} · ${e.turns>0?`${e.turns/5} r (${e.turns} t)`:'permanente'}`
                   : e.type==='disabled'  ? `🚫 ${e.tName} — Disabled: ${e.moveName}`
                   : e.type==='repeat'    ? `🔁 ${e.tName} — Repeat: ${e.moveName} × ${e.turns} turni`
                   : e.type==='copy'      ? `📋 ${e.tName} — Copy: ${e.copiedMove} (slot di ${e.replaceMove})`
                   :                        `❤️ ${e.tName} HP ${e.delta>0?'+':''}${e.delta}`;
        return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:0.79rem;background:rgba(255,255,255,0.04);border-radius:6px;padding:4px 8px;"><span>${desc}</span><button onclick="_effRimuoviCoda(${i})" style="background:none;border:none;color:#ef5350;cursor:pointer;font-size:0.88rem;padding:0 2px;">✕</button></div>`;
    }).join('');
}

function _effRimuoviCoda(i) { _effQueue.splice(i,1); _effRenderCoda(); }

function _effTgtName(key) {
    return key === 'me'
        ? (Battle.me.team[Battle.me.activeIndex]?.name || 'Il tuo')
        : (Battle.opponent?.team?.[Battle.opponent.activeIndex]?.name || 'Avversario');
}

function _effAccodaStat() {
    const tgt   = document.getElementById('eff-stat-tgt')?.value || 'me';
    const stat  = document.getElementById('eff-stat-name')?.value;
    const delta = parseInt(document.getElementById('eff-stat-delta')?.value || '1');
    if (!stat) return;
    _effQueue.push({ type:'stat', targetKey:tgt, tName:_effTgtName(tgt), stat, delta });
    _effRenderCoda();
}

function _effAccodaStatus(statusId, label, turns) {
    const tgt = document.getElementById('eff-status-tgt')?.value || 'me';
    _effQueue.push({ type:'status', targetKey:tgt, tName:_effTgtName(tgt), statusId, label, turns });
    _effRenderCoda();
}

function _effAccodaDisabled() {
    if (Battle._iGoFirst !== false) {
        log('🚫 "Disabled" si può usare solo se il tuo Pokémon agisce per secondo.', 'status');
        return;
    }
    const oppPk = Battle.opponent?.team?.[Battle.opponent.activeIndex];
    const moveName = oppPk?.lastMoveName || null;
    if (!moveName) {
        log('🚫 L\'avversario non ha ancora usato nessuna mossa — nulla da disabilitare.', 'status');
        return;
    }
    _effQueue.push({ type: 'disabled', targetKey: 'opp', tName: _effTgtName('opp'), moveName });
    _effRenderCoda();
}

let _effRepeatMovePending = null;

function _effApriRepeat() {
    if (Battle._iGoFirst !== false) {
        log('🔁 "Repeat" si può usare solo se il tuo Pokémon agisce per secondo.', 'status');
        return;
    }
    const myPk  = Battle.me.team[Battle.me.activeIndex];
    const oppPk = Battle.opponent?.team?.[Battle.opponent.activeIndex];
    // Candidate move: pick whichever target has a last move
    const myMove  = myPk?.lastMoveName  || null;
    const oppMove = oppPk?.lastMoveName || null;
    if (!myMove && !oppMove) {
        log('🔁 Nessun Pokémon ha ancora usato una mossa — nulla da ripetere.', 'status');
        return;
    }
    const panel = document.getElementById('eff-repeat-panel');
    if (!panel) return;
    const sl = 'padding:6px 8px;border-radius:8px;border:1.5px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#e8eaf0;font-size:0.8rem;';
    const myName  = myPk?.name  || 'Il tuo';
    const oppName = oppPk?.name || 'Avversario';
    const tgtOpts = [
        myMove  ? `<option value="me">${myName} → ${myMove}</option>`  : '',
        oppMove ? `<option value="opp">${oppName} → ${oppMove}</option>` : '',
    ].join('');
    panel.innerHTML = `
        <div style="margin-top:8px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.03);">
            <p style="font-size:0.8rem;color:#e8eaf0;margin:0 0 6px;">🔁 Repeat</p>
            <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:7px;">
                <select id="eff-repeat-tgt" style="${sl}width:100%;">${tgtOpts}</select>
                <div style="display:flex;align-items:center;gap:7px;">
                    <span style="font-size:0.78rem;color:rgba(232,234,240,0.55);">Turni:</span>
                    <input type="number" id="eff-repeat-turns" min="1" max="10" value="3" style="${sl}width:54px;text-align:center;">
                </div>
            </div>
            <div style="display:flex;gap:6px;">
                <button onclick="_effAccodaRepeat()" style="flex:1;padding:7px;border-radius:8px;border:none;background:rgba(39,174,96,0.7);color:#fff;font-family:inherit;font-size:0.82rem;font-weight:700;cursor:pointer;">➕ Aggiungi</button>
                <button onclick="document.getElementById('eff-repeat-panel').innerHTML=''" style="padding:7px 11px;border-radius:8px;border:1.5px solid rgba(255,255,255,0.12);background:none;color:rgba(232,234,240,0.45);font-family:inherit;cursor:pointer;">✕</button>
            </div>
        </div>`;
}

function _effAccodaRepeat() {
    const tgtKey = document.getElementById('eff-repeat-tgt')?.value || 'me';
    const turns  = parseInt(document.getElementById('eff-repeat-turns')?.value || '3');
    if (turns < 1) return;
    const pk       = tgtKey === 'me'
        ? Battle.me.team[Battle.me.activeIndex]
        : Battle.opponent?.team?.[Battle.opponent.activeIndex];
    const moveName = pk?.lastMoveName || null;
    if (!moveName) return;
    _effQueue.push({ type: 'repeat', targetKey: tgtKey, tName: _effTgtName(tgtKey), moveName, turns });
    const panel = document.getElementById('eff-repeat-panel');
    if (panel) panel.innerHTML = '';
    _effRenderCoda();
}

function _effAccodaCopy() {
    if (Battle._iGoFirst !== false) {
        log('📋 "Copy" si può usare solo se il tuo Pokémon agisce per secondo.', 'status');
        return;
    }
    const myPk  = Battle.me.team[Battle.me.activeIndex];
    const oppPk = Battle.opponent?.team?.[Battle.opponent.activeIndex];
    const copiedMove  = oppPk?.lastMoveName || null;
    const replaceMove = myPk?.lastMoveName  || null;
    if (!copiedMove) {
        log('📋 L\'avversario non ha ancora usato nessuna mossa — nulla da copiare.', 'status');
        return;
    }
    if (!replaceMove) {
        log('📋 Il tuo Pokémon non ha ancora usato nessuna mossa — nessun slot da sostituire.', 'status');
        return;
    }
    _effQueue.push({ type: 'copy', targetKey: 'me', tName: _effTgtName('me'), copiedMove, replaceMove });
    _effRenderCoda();
}

// ── STATUS ROLL (shared tra modal-effetto e modal-turno) ──────────────────────

let _srState = { prefix: null, type: 'status', id: null, label: null, turns: null, nDice: 1, tgt: null, stat: null, delta: null };

function _statAsk(prefix) {
    const tgt    = document.getElementById(`${prefix}-stat-tgt`)?.value || 'me';
    const stat   = document.getElementById(`${prefix}-stat-name`)?.value;
    const delta  = parseInt(document.getElementById(`${prefix}-stat-delta`)?.value || '1');
    if (!stat) return;
    const tgtEl     = document.getElementById(`${prefix}-stat-tgt`);
    const tgtTxt    = tgtEl ? tgtEl.options[tgtEl.selectedIndex]?.text : '?';
    const statLabel = _BATTLE_STATS.find(s => s.key === stat)?.label || stat;
    const deltaStr  = delta > 0 ? `+${delta}` : `${delta}`;
    _srState = { prefix, type: 'stat', id: null, label: null, turns: null, nDice: 1, tgt, stat, delta };
    const bs = 'flex:1;padding:8px;border-radius:9px;font-family:inherit;font-size:0.84rem;font-weight:700;cursor:pointer;border:none;';
    _srRender(`
        <p style="font-size:0.82rem;color:#e8eaf0;margin:0 0 6px;">📊 <b>${statLabel} ${deltaStr}</b> → ${tgtTxt}</p>
        <p style="font-size:0.76rem;color:rgba(232,234,240,0.5);margin:0 0 9px;">È necessario un roll di dadi per applicare la modifica?</p>
        <div style="display:flex;gap:7px;">
            <button onclick="_srStart()" style="${bs}background:#1565c0;color:#fff;">🎲 Sì, tira i dadi</button>
            <button onclick="_srSkip()" style="${bs}background:rgba(39,174,96,0.7);color:#fff;">✅ No, applica</button>
        </div>
    `);
}

function _statusAsk(prefix, statusId, label, turns) {
    const _isBurnId = statusId === 'burn' || statusId === 'burn2' || statusId === 'burn3';
    const nDice = (_isBurnId && Battle.weather === 'harsh_sun') ? 3 : 1;
    _srState = { prefix, type: 'status', id: statusId, label, turns, nDice, tgt: null, stat: null, delta: null };
    const tgtEl  = document.getElementById(`${prefix}-status-tgt`);
    const tgtTxt = tgtEl ? tgtEl.options[tgtEl.selectedIndex]?.text : '?';
    const bs = 'flex:1;padding:8px;border-radius:9px;font-family:inherit;font-size:0.84rem;font-weight:700;cursor:pointer;border:none;';
    _srRender(`
        <p style="font-size:0.82rem;color:#e8eaf0;margin:0 0 6px;">🔶 <b>${label}</b> → ${tgtTxt}</p>
        <p style="font-size:0.76rem;color:rgba(232,234,240,0.5);margin:0 0 9px;">È necessario un roll di dadi per attivare lo status?</p>
        <div style="display:flex;gap:7px;">
            <button onclick="_srStart()" style="${bs}background:#1565c0;color:#fff;">🎲 Sì, tira i dadi</button>
            <button onclick="_srSkip()" style="${bs}background:rgba(39,174,96,0.7);color:#fff;">✅ No, applica</button>
        </div>
    `);
}

function _srStart() {
    _srState.nDice = Math.max(1, _srState.nDice);
    const _isBurnRoll = _srState.id === 'burn' || _srState.id === 'burn2' || _srState.id === 'burn3';
    if (_isBurnRoll && Battle.weather === 'harsh_sun') {
        logBoth(`☀️ Harsh Sunlight: +2 dadi chance bruciatura (tot: ${_srState.nDice}d6)!`, 'weather');
    }
    const adj = 'padding:2px 10px;border-radius:6px;border:1.5px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:#e8eaf0;cursor:pointer;font-size:1rem;font-family:inherit;';
    _srRender(`
        <p style="font-size:0.82rem;color:#e8eaf0;margin:0 0 8px;">🎲 Roll — <b>${_srState.label}</b></p>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:0.78rem;color:rgba(232,234,240,0.55);">Dadi:</span>
            <button onclick="_srAdj(-1)" style="${adj}">−</button>
            <span id="sr-ndice" style="font-size:1rem;font-weight:800;color:#e8eaf0;min-width:20px;text-align:center;">${_srState.nDice}</span>
            <button onclick="_srAdj(+1)" style="${adj}">+</button>
        </div>
        <div id="sr-results" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;min-height:20px;"></div>
        <div style="display:flex;gap:7px;">
            <button onclick="_srRoll()" style="flex:1;padding:8px;border-radius:9px;border:none;background:#1565c0;color:#fff;font-family:inherit;font-size:0.84rem;font-weight:700;cursor:pointer;">🎲 Tira ${_srState.nDice}d6</button>
            <button onclick="_srCancel()" style="padding:8px 12px;border-radius:9px;border:1.5px solid rgba(255,255,255,0.12);background:none;color:rgba(232,234,240,0.45);font-family:inherit;cursor:pointer;">✕</button>
        </div>
    `);
}

function _srAdj(delta) {
    _srState.nDice = Math.max(1, _srState.nDice + delta);
    const el = document.getElementById('sr-ndice');
    if (el) el.textContent = _srState.nDice;
    // Aggiorna testo del pulsante roll
    const btns = document.querySelectorAll(`#${_srState.prefix}-status-roll-panel button`);
    btns.forEach(b => { if (b.textContent.includes('Tira')) b.textContent = `🎲 Tira ${_srState.nDice}d6`; });
}

function _srRoll() {
    const rolls = Array.from({ length: _srState.nDice }, () => Math.floor(Math.random() * 6) + 1);
    const ok = rolls.some(r => r === 6);
    const diceHTML = rolls.map(r =>
        `<span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:7px;font-size:0.95rem;font-weight:800;border:2px solid ${r===6?'rgba(39,174,96,0.7)':'rgba(255,255,255,0.15)'};background:${r===6?'rgba(39,174,96,0.12)':'rgba(255,255,255,0.04)'};color:${r===6?'#66bb6a':'#e8eaf0'};">${r}</span>`
    ).join('');
    const msgStyle = `font-size:0.8rem;font-weight:700;margin:0 0 8px;color:${ok?'#66bb6a':'#ef5350'};`;
    const msg = ok ? '✅ Successo! Almeno un dado ha fatto 6.' : '❌ Fallito. Nessun dado ha fatto 6.';
    const _srPanelId = _srState.type === 'stat' ? `${_srState.prefix}-stat-roll-panel` : `${_srState.prefix}-status-roll-panel`;
    const panel = document.getElementById(_srPanelId);
    if (!panel) return;
    panel.querySelector('div').innerHTML = `
        <p style="font-size:0.82rem;color:#e8eaf0;margin:0 0 7px;">🎲 Roll — <b>${_srState.label}</b></p>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">${diceHTML}</div>
        <p style="${msgStyle}">${msg}</p>
        <div style="display:flex;gap:7px;">
            ${ok
                ? `<button onclick="_srConfirm()" style="flex:1;padding:8px;border-radius:9px;border:none;background:rgba(39,174,96,0.75);color:#fff;font-family:inherit;font-size:0.84rem;font-weight:700;cursor:pointer;">✅ Aggiungi alla coda</button>`
                : `<button onclick="_srStart()" style="flex:1;padding:8px;border-radius:9px;border:none;background:#1565c0;color:#fff;font-family:inherit;font-size:0.84rem;font-weight:700;cursor:pointer;">🎲 Riprova</button>`
            }
            <button onclick="_srCancel()" style="padding:8px 12px;border-radius:9px;border:1.5px solid rgba(255,255,255,0.12);background:none;color:rgba(232,234,240,0.45);font-family:inherit;cursor:pointer;">✕</button>
        </div>
    `;
}

function _srConfirm() {
    const { prefix, type, id, label, turns, tgt, stat, delta } = _srState;
    if (type === 'stat') {
        const queue = prefix === 'eff' ? _effQueue : _tmQueue;
        const name  = prefix === 'eff' ? _effTgtName(tgt) : _tmName(tgt);
        queue.push({ type: 'stat', targetKey: tgt, tName: name, stat, delta });
        if (prefix === 'eff') _effRenderCoda(); else _tmRenderCoda();
    } else {
        if (prefix === 'eff') _effAccodaStatus(id, label, turns);
        else                  _tmAccodaStatus(id, label, turns);
    }
    _srCancel();
}

function _srSkip() {
    const { prefix, type, id, label, turns, tgt, stat, delta } = _srState;
    if (type === 'stat') {
        const queue = prefix === 'eff' ? _effQueue : _tmQueue;
        const name  = prefix === 'eff' ? _effTgtName(tgt) : _tmName(tgt);
        queue.push({ type: 'stat', targetKey: tgt, tName: name, stat, delta });
        if (prefix === 'eff') _effRenderCoda(); else _tmRenderCoda();
    } else {
        if (prefix === 'eff') _effAccodaStatus(id, label, turns);
        else                  _tmAccodaStatus(id, label, turns);
    }
    _srCancel();
}

function _srCancel() {
    _srState = { prefix: null, type: 'status', id: null, label: null, turns: null, nDice: 1, tgt: null, stat: null, delta: null };
    ['eff', 'tm'].forEach(p => {
        ['status-roll-panel', 'stat-roll-panel'].forEach(s => {
            const el = document.getElementById(`${p}-${s}`);
            if (el) el.innerHTML = '';
        });
    });
}

function _srRender(html) {
    const panelId = _srState.type === 'stat'
        ? `${_srState.prefix}-stat-roll-panel`
        : `${_srState.prefix}-status-roll-panel`;
    const el = document.getElementById(panelId);
    if (el) el.innerHTML = `<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:10px;margin-top:7px;">${html}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────

function _effAccodaMeteo(weatherId, label) {
    _effQueue = _effQueue.filter(e => e.type !== 'weather');
    const roundsEl = document.getElementById('eff-weather-rounds');
    const rounds = roundsEl ? parseInt(roundsEl.value) || 0 : 0;
    const turns = rounds > 0 ? rounds * 5 : -1;
    _effQueue.push({ type:'weather', weatherId, label, turns });
    _effRenderCoda();
    _BATTLE_WEATHERS.forEach(w => {
        const b = document.getElementById(`eff-wb-${w.id}`);
        if (b) b.style.background = w.id===weatherId ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)';
    });
}

function _effAccodaHP(delta) {
    const tgt = document.getElementById('eff-hp-tgt')?.value || 'me';
    _effQueue.push({ type:'hp', targetKey:tgt, tName:_effTgtName(tgt), delta });
    _effRenderCoda();
}

function _inviaEffettoEChiudi() {
    const wasKO = _inviaQueue(_effQueue, 5);
    _effQueue = [];
    if (!wasKO) {
        chiudiModalEffetto();
        aggiornaUI();
        _effettoComplete();
    }
}

function _effettoComplete() {
    const onComplete = Battle.currentMove?._onComplete;
    onComplete?.();
}

function chiudiModalEffetto() {
    document.getElementById('modal-effetto').classList.add('hidden');
}

function _effSwitchMe() {
    _inviaQueue(_effQueue, 5);
    _effQueue = [];
    chiudiModalEffetto();
    logBoth(`🔄 ${Battle.me.team[Battle.me.activeIndex]?.name || 'Il tuo Pokémon'} esce per effetto di una mossa!`, 'action');
    apriSwitch(true, () => _effettoComplete());
}

function _effSwitchOpp() {
    _inviaQueue(_effQueue, 5);
    _effQueue = [];
    chiudiModalEffetto();
    logBoth(`🔄 ${Battle.opponent?.team?.[Battle.opponent.activeIndex]?.name || "L'avversario"} deve cambiare Pokémon per effetto di una mossa!`, 'action');
    BattleBridge.send('FORCE_SWITCH', {});
    Battle.oppCommit = null; // la mossa dell'avversario è annullata dallo switch forzato
    _effettoComplete();
}

// ── INVIO CODA (shared: turn modals + effect modal) ───────────────────────────

function _inviaQueue(queue, weatherTurns) {
    for (const e of queue) {
        const targetRole = e.targetKey === 'me'
            ? Battle.role : (Battle.role === 'host' ? 'client' : 'host');

        if (e.type === 'stat') {
            BattleBridge.send('APPLY_STAT_MOD', { targetRole, stat: e.stat, delta: e.delta });
            const f = e.targetKey === 'me' ? Battle.me : Battle.opponent;
            if (f) f.fieldMods[e.stat] = Math.min(6, Math.max(-6, (f.fieldMods[e.stat]||0) + e.delta));
            logBoth(`📊 ${e.tName} — ${e.stat} ${e.delta>0?'+':''}${e.delta}`, 'status');

        } else if (e.type === 'status') {
            const f0 = e.targetKey === 'me' ? Battle.me : Battle.opponent;
            // ── Volatili: separati dal primary, possono coesistere ──
            if (e.statusId === 'confused' || e.statusId === 'love' || e.statusId === 'flinched') {
                if (Array.isArray(f0?.fieldMods?.statusImmunities) && f0.fieldMods.statusImmunities.includes(e.statusId)) {
                    logBoth(`🛡️ ${e.tName} è immune a ${e.label}!`, 'status');
                    continue;
                }
                if (e.statusId === 'flinched') {
                    const tgtCommit = e.targetKey === 'me' ? Battle.myCommit : Battle.oppCommit;
                    if (tgtCommit?.type !== 'move') {
                        logBoth(`😨 Flinch su ${e.tName} — non sta usando una mossa, nessun effetto.`, 'status');
                        continue;
                    }
                    if (f0) f0.fieldMods.flinchActive = true;
                } else if (e.statusId === 'confused') {
                    if (f0) f0.fieldMods.confusedTurns = e.turns ?? 10;
                } else {
                    if (f0) f0.fieldMods.loveTurns = e.turns ?? 10;
                }
                BattleBridge.send('APPLY_STATUS', { targetRole, status: e.statusId, statusTurns: e.turns });
                logBoth(`🔶 ${e.label} → ${e.tName}`, 'status');
                continue;
            }
            const isBurn      = e.statusId === 'burn' || e.statusId === 'burn2' || e.statusId === 'burn3';
            const isPoison    = e.statusId === 'poison' || e.statusId === 'poison2';
            const isParalysis = e.statusId === 'paralysis';
            const isFreeze    = e.statusId === 'freeze';
            const f = e.targetKey === 'me' ? Battle.me : Battle.opponent;
            if (isBurn || isPoison || isParalysis || isFreeze) {
                const pk = f?.team?.[f?.activeIndex];
                if (isBurn && _isPkFireType(pk)) {
                    logBoth(`🔥 ${e.tName} è di tipo Fuoco — immune alle bruciature!`, 'status');
                    continue;
                }
                if (isPoison && _isPkPoisonImmune(pk)) {
                    logBoth(`☠️ ${e.tName} è di tipo Veleno/Acciaio — immune al veleno!`, 'status');
                    continue;
                }
                if (isParalysis && _isPkElectricType(pk)) {
                    logBoth(`⚡ ${e.tName} è di tipo Elettro — immune alla paralisi!`, 'status');
                    continue;
                }
                if (isFreeze && _isPkIceType(pk)) {
                    logBoth(`❄️ ${e.tName} è di tipo Ghiaccio — immune al congelamento!`, 'status');
                    continue;
                }
            }
            if (Array.isArray(f?.fieldMods?.statusImmunities) && f.fieldMods.statusImmunities.includes(e.statusId)) {
                logBoth(`🛡️ ${e.tName} è immune a ${e.label}!`, 'status');
                continue;
            }
            if (e.statusId === 'flinched') {
                const tgtCommit = e.targetKey === 'me' ? Battle.myCommit : Battle.oppCommit;
                if (tgtCommit?.type !== 'move') {
                    logBoth(`😨 Flinch su ${e.tName} — non sta usando una mossa, nessun effetto.`, 'status');
                    continue;
                }
            }
            const _PRIMARY = new Set(['sleep','freeze','burn','burn2','burn3','paralysis','poison','poison2']);
            if (_PRIMARY.has(e.statusId)) {
                const curr = f?.fieldMods?.status;
                if (curr && _PRIMARY.has(curr)) {
                    logBoth(`⚠️ ${e.tName} ha già ${_nomeStatus(curr)} — non può avere due status primari contemporaneamente.`, 'status');
                    continue;
                }
            }
            BattleBridge.send('APPLY_STATUS', { targetRole, status: e.statusId, statusTurns: e.turns });
            if (f) {
                if (e.statusId === 'paralysis') f.fieldMods.Dexterity -= 2;
                if (e.statusId === 'freeze')    f.fieldMods.iceBlockHP = 5;
                f.fieldMods.status = e.statusId; f.fieldMods.statusTurns = e.turns;
            }
            logBoth(`🔶 ${e.label} → ${e.tName}`, 'status');

        } else if (e.type === 'weather') {
            const weather = e.weatherId === 'none' ? null : e.weatherId;
            const wTurns = e.turns !== undefined ? e.turns : weatherTurns;
            const _WP = ['harsh_sun', 'typhoon', 'strong_winds'];
            const _WB = ['sunny', 'rain', 'sandstorm', 'hail'];
            if (_WP.includes(Battle.weather) && _WB.includes(weather)) {
                logBoth(`🚫 ${_nomeMeteo(Battle.weather)} non può essere sostituito da ${_nomeMeteo(weather)}!`, 'weather');
            } else {
                BattleBridge.send('SET_WEATHER', { weather, turns: wTurns });
                Battle.weather      = weather;
                Battle.weatherTurns = wTurns;
                log(`🌦️ ${weather ? `Meteo: ${_nomeMeteo(weather)}` : 'Meteo rimosso'}`, 'weather');
                aggiornaHeader();
            }

        } else if (e.type === 'immunity') {
            const f = e.targetKey === 'me' ? Battle.me : Battle.opponent;
            if (f) {
                if (!Array.isArray(f.fieldMods.typeImmunities)) f.fieldMods.typeImmunities = [];
                if (!f.fieldMods.typeImmunities.includes(e.typeId)) f.fieldMods.typeImmunities.push(e.typeId);
            }
            BattleBridge.send('APPLY_TYPE_IMMUNITY', { targetRole, typeId: e.typeId });
            logBoth(`🛡️ ${e.tName} diventa immune al tipo ${e.typeName}`, 'status');

        } else if (e.type === 'typePriority') {
            const f = e.targetKey === 'me' ? Battle.me : Battle.opponent;
            if (f) {
                if (!f.fieldMods.typePriorityBoosts) f.fieldMods.typePriorityBoosts = {};
                f.fieldMods.typePriorityBoosts[e.typeId] = (f.fieldMods.typePriorityBoosts[e.typeId] || 0) + e.bonus;
            }
            BattleBridge.send('APPLY_TYPE_PRIORITY_BOOST', { targetRole, typeId: e.typeId, bonus: e.bonus });
            logBoth(`⚡ Mosse di tipo ${e.typeName}: Priority ${e.bonus > 0 ? '+' : ''}${e.bonus} per ${e.tName}`, 'status');

        } else if (e.type === 'statusImmunity') {
            const f = e.targetKey === 'me' ? Battle.me : Battle.opponent;
            if (f) {
                if (!Array.isArray(f.fieldMods.statusImmunities)) f.fieldMods.statusImmunities = [];
                if (!f.fieldMods.statusImmunities.includes(e.statusId)) f.fieldMods.statusImmunities.push(e.statusId);
            }
            BattleBridge.send('APPLY_STATUS_IMMUNITY', { targetRole, statusId: e.statusId });
            logBoth(`🛡️ ${e.tName} diventa immune a ${e.statusLabel}`, 'status');

        } else if (e.type === 'removeStatus') {
            const f   = e.targetKey === 'me' ? Battle.me : Battle.opponent;
            const sid = e.statusId;
            if (f) {
                if (sid === 'confused')  { f.fieldMods.confusedTurns = 0; }
                else if (sid === 'love')     { f.fieldMods.loveTurns = 0; }
                else if (sid === 'flinched') { f.fieldMods.flinchActive = false; }
                else if (sid === 'disabled') { f.fieldMods.disabledMoveName = null; }
                else if (sid === 'repeat')   { f.fieldMods.repeatMoveName = null; f.fieldMods.repeatTurns = 0; }
                else { // primary
                    if (f.fieldMods.status === 'paralysis') f.fieldMods.Dexterity += 2;
                    f.fieldMods.status           = null;
                    f.fieldMods.statusTurns      = 0;
                    f.fieldMods.burnCureSuccessi = 0;
                    f.fieldMods.iceBlockHP       = 0;
                }
            }
            BattleBridge.send('REMOVE_STATUS', { targetRole, statusId: sid });
            logBoth(`✅ ${e.tName} — ${_nomeStatus(sid)} rimosso`, 'heal');
            aggiornaUI();

        } else if (e.type === 'disabled') {
            const f = Battle.opponent;
            if (f) f.fieldMods.disabledMoveName = e.moveName;
            BattleBridge.send('APPLY_DISABLED', { targetRole, moveName: e.moveName });
            logBoth(`🚫 ${e.tName}: ${e.moveName} disabilitata!`, 'status');
            aggiornaUI();

        } else if (e.type === 'repeat') {
            const f = e.targetKey === 'me' ? Battle.me : Battle.opponent;
            if (f) { f.fieldMods.repeatMoveName = e.moveName; f.fieldMods.repeatTurns = e.turns; }
            BattleBridge.send('APPLY_REPEAT', { targetRole, moveName: e.moveName, turns: e.turns });
            logBoth(`🔁 ${e.tName}: costretto a usare ${e.moveName} per ${e.turns} turni!`, 'status');
            aggiornaUI();

        } else if (e.type === 'copy') {
            const myPk   = Battle.me.team[Battle.me.activeIndex];
            const moves  = myPk?.data?.moves || [];
            const slot   = moves.indexOf(e.replaceMove);
            if (myPk && slot >= 0) {
                myPk.copiedMoveName = e.copiedMove;
                myPk.copiedMoveSlot = slot;
            }
            BattleBridge.send('APPLY_COPY', {});
            logBoth(`📋 ${myPk?.name || 'Il tuo'} copia ${e.copiedMove} (sostituisce ${e.replaceMove} fino allo switch)`, 'status');

        } else if (e.type === 'hp') {
            if (e.targetKey === 'me') {
                const t = Battle.me.team[Battle.me.activeIndex];
                if (!t) continue;
                t.currentHP = Math.min(t.maxHP, Math.max(0, t.currentHP + e.delta));
                const wasKO = t.currentHP <= 0;
                if (wasKO) {
                    t.eliminated = true;
                    Battle.me.koCount = (Battle.me.koCount||0) + 1;
                    Battle._faintedAwaitingSwitch = true;
                }
                const stateOut = _serializeOpponentFacingState();
                BattleBridge.send('HP_MOD_APPLIED', { targetRole, delta: e.delta, state: stateOut });
                if (wasKO) BattleBridge.send('POKEMON_KO', { targetRole: Battle.role, state: stateOut });
                logBoth(`❤️ ${t.name}: HP ${e.delta>0?'+':''}${e.delta}${wasKO?' — KO!':''}`, 'status');
                aggiornaUI();
                if (wasKO) {
                    chiudiModalEffetto();
                    document.getElementById('modal-turno-existente')?.remove();
                    const anyLiving = Battle.me.team.some(p => !p.eliminated && p.currentHP > 0);
                    if (!anyLiving) {
                        Battle.phase = 'ended';
                        _cancellaAzioneCorrente();
                        log('💀 Tutto il tuo team è esausto...', 'ko');
                    } else {
                        // Se siamo in un modal di fine turno (_tmOnDone = continuazione della catena),
                        // usa switch senza reroll + riprendi la catena.
                        // Altrimenti (modal effetto durante battaglia) → reroll come prima.
                        const continueCb = _tmOnDone || undefined;
                        _tmOnDone = null;
                        setTimeout(() => { _cancellaAzioneCorrente(); apriSwitch(true, continueCb); }, 600);
                    }
                    return true;
                }
            } else {
                const t = Battle.opponent?.team?.[Battle.opponent.activeIndex];
                if (t) t.currentHP = Math.min(t.maxHP, Math.max(0, t.currentHP + e.delta));
                BattleBridge.send('APPLY_HP_MOD', { targetRole, delta: e.delta });
                logBoth(`❤️ ${_nomeOpp()}: HP ${e.delta>0?'+':''}${e.delta}`, 'status');
                aggiornaUI();
            }
        }
    }
    return false;
}

// ── SWITCH POKEMON ────────────────────────────────────────────────────────────

/**
 * Apre il pannello switch.
 * @param {boolean} forced - true se switch forzato dopo KO
 */
// moveDoneCallback: se definito, usa switch semplice (da mossa) invece di eseguiSwitchForzato (da KO)
function apriSwitch(forced = false, moveDoneCallback = undefined) {
    const body = document.getElementById('modal-switch-body');
    body.innerHTML = '';

    if (forced) {
        const txt = moveDoneCallback !== undefined
            ? 'Sei costretto a cambiare Pokémon!'
            : 'Il tuo Pokémon è esausto! Scegline un altro.';
        body.innerHTML = `<p style="font-size:0.85rem; color:rgba(232,234,240,0.6); margin-bottom:8px;">${txt}</p>`;
    } else {
        // Switch volontario: solo disponibile nella fase choose
        if (Battle.roundPhase !== 'choose' || Battle.myCommit) return;
    }

    Battle.me.team.forEach((pk, i) => {
        if (pk.eliminated) return;
        const card = document.createElement('div');
        const isActive = i === Battle.me.activeIndex;
        const isKO     = pk.currentHP <= 0;

        card.className = 'switch-pokemon-card' + (isActive ? ' active' : '') + (isKO ? ' ko' : '');
        card.innerHTML = `
            <img src="img/pokemon/${pk.name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')}.png"
                 onerror="this.src='img/pokemon/unknown.png'" alt="${pk.name}">
            <div class="switch-pokemon-card-info">
                <div class="switch-pokemon-card-name">${pk.name}${isActive ? ' (in campo)' : ''}</div>
                <div class="switch-pokemon-card-hp">HP: ${pk.currentHP}/${pk.maxHP}${isKO ? ' — KO' : ''}</div>
            </div>
        `;
        if (!isActive && !isKO && !pk.eliminated) {
            card.onclick = () => {
                if (forced) {
                    if (moveDoneCallback !== undefined) {
                        // Switch da mossa: nessun reroll, nessun avanzamento round diretto
                        chiudiSwitch();
                        _eseguiSwitchLocale(i, false, moveDoneCallback);
                    } else {
                        eseguiSwitchForzato(i); // switch da KO: reroll + nuovo round
                    }
                } else {
                    chiudiSwitch();
                    selezionaSwitch(i); // commit switch volontario
                }
            };
        }
        body.appendChild(card);
    });

    document.getElementById('modal-switch').classList.remove('hidden');
}

function chiudiSwitch() {
    document.getElementById('modal-switch').classList.add('hidden');
}

/** Switch forzato dopo KO: non consuma il commit, avvia reroll iniziativa. */
function eseguiSwitchForzato(newIndex) {
    chiudiSwitch();
    _eseguiSwitchLocale(newIndex, true, () => {
        Battle._faintedAwaitingSwitch = false;
        _avviaRerollIniziatriva(() => {
            if (Battle.role === 'host') {
                _hostAvanzaNuovoRound();
            }
            // Client: ha inviato INIT_REROLL, il host avanza quando lo riceve
        });
    });
}

/** Esegue il cambio di pokemon in locale e invia POKEMON_SWITCHED via bridge. */
function _eseguiSwitchLocale(newIndex, forcedKoReplace, onDone) {
    const oldIdx  = Battle.me.activeIndex;
    const vecchio = Battle.me.team[oldIdx]?.name;
    const nuovo   = Battle.me.team[newIndex]?.name;

    // Salva lo status PRIMARIO del Pokémon uscente (persiste in panchina).
    // I modificatori di stat e gli status volatili (confusedTurns, loveTurns, flinchActive)
    // vengono azzerati automaticamente da _defaultFieldMods() al rientro.
    if (oldIdx !== newIndex) {
        const outPk = Battle.me.team[oldIdx];
        if (outPk) {
            outPk._savedStatus           = Battle.me.fieldMods.status           ?? null;
            outPk._savedStatusTurns      = Battle.me.fieldMods.statusTurns      ?? 0;
            outPk._savedBurnCureSuccessi = Battle.me.fieldMods.burnCureSuccessi ?? 0;
            outPk._savedIceBlockHP       = Battle.me.fieldMods.iceBlockHP       ?? 0;
            outPk._savedStatusImmunities = [...(Battle.me.fieldMods.statusImmunities || [])];
            // Copied move (from Copy effect) expires on switch-out
            outPk.copiedMoveName = null;
            outPk.copiedMoveSlot = null;
        }
    }

    Battle.me.activeIndex = newIndex;
    const newPk = Battle.me.team[newIndex];

    // Sempre reset completo dei modificatori di stat.
    Battle.me.fieldMods = _defaultFieldMods();

    // Ripristina lo status salvato (burn, paralysis, freeze ecc. persistono in panchina).
    // disabledMoveName NON viene ripristinato: si azzera sempre allo switch.
    Battle.me.fieldMods.iceBlockHP       = newPk._savedIceBlockHP ?? 0;
    Battle.me.fieldMods.statusImmunities = [...(newPk._savedStatusImmunities || [])];
    if (newPk._savedStatus) {
        Battle.me.fieldMods.status           = newPk._savedStatus;
        Battle.me.fieldMods.statusTurns      = newPk._savedStatusTurns      ?? 0;
        Battle.me.fieldMods.burnCureSuccessi = newPk._savedBurnCureSuccessi ?? 0;
        if (newPk._savedStatus === 'paralysis') {
            Battle.me.fieldMods.Dexterity -= 2;
        }
    }

    // Applica i modificatori permanenti dell'abilità.
    if (Battle.me.abilityMods) {
        Object.entries(Battle.me.abilityMods).forEach(([stat, delta]) => {
            Battle.me.fieldMods[stat] = (Battle.me.fieldMods[stat] || 0) + delta;
        });
    }

    BattleBridge.send('POKEMON_SWITCHED', {
        newIndex,
        role:  Battle.role,
        state: _serializeOpponentFacingState(),
    });
    logBoth(`🔄 ${Battle.me.trainerName}: ${vecchio} rientra, ${nuovo} in campo!`, 'action');
    aggiornaUI();
    onDone?.();
}

// ── STATUS INIZIO TURNO ───────────────────────────────────────────────────────

function _controllaStatusInizioTurno(onDone) {
    const fm     = Battle.me.fieldMods;
    const status = fm.status; // solo status primario
    const nomePk = _nomeMePk();

    // Flinch (volatile): nota a inizio turno, effetto al tiro precisione
    if (fm.flinchActive) {
        logBoth(`😨 ${nomePk} ha vacillato! Se usa una mossa, la precisione sarà 0.`, 'status');
    }

    // Status primari che aprono modal (chainano i volatili in callback)
    if (status === 'sleep') {
        apriModalCuraSonno(() => _checkVolatiliInizioTurno(onDone));
        return;
    }
    if (status === 'burn' || status === 'burn2' || status === 'burn3') {
        apriModalCuraStatus(() => _checkVolatiliInizioTurno(onDone));
        return;
    }

    // Status primari che loggano soltanto
    if (status === 'paralysis') logBoth(`⚡ ${nomePk} è paralizzato! (DEX −2, Iniziativa dimezzata)`, 'status');
    if (status === 'freeze')    logBoth(`❄️ ${nomePk} è congelato! L'attacco colpirà il blocco di ghiaccio.`, 'status');

    _checkVolatiliInizioTurno(onDone);
}

function _checkVolatiliInizioTurno(onDone) {
    const fm = Battle.me.fieldMods;
    if (fm.confusedTurns > 0) {
        _checkConfused(() => {
            if (fm.loveTurns > 0) _checkLove(onDone);
            else onDone?.();
        });
        return;
    }
    if (fm.loveTurns > 0) {
        _checkLove(onDone);
        return;
    }
    onDone?.();
}

// ── MODAL CURA STATUS (Bruciatura / Veleno) ───────────────────────────────────

function _statusCureThreshold(status) {
    const rainBonus = Battle.weather === 'rain' ? 3 : 0;
    if (status === 'burn3') return Math.max(1, 8 - rainBonus);
    if (status === 'burn2') return Math.max(1, 6 - rainBonus);
    if (status === 'sleep') return 5;
    return Math.max(1, 4 - rainBonus); // burn
}

function _statusCureIcon(status) {
    return '🔥'; // solo le bruciature usano il modal cura
}

function apriModalCuraStatus(onDone) {
    const status    = Battle.me.fieldMods.status;
    const nomePk    = _nomeMePk();
    const pk        = Battle.me.team[Battle.me.activeIndex];
    const dex       = (pk?.data?.stats?.Dexterity || 0) + (Battle.me.fieldMods?.Dexterity || 0);
    const athletic  = pk?.data?.skills?.Athletic || 0;
    const pool      = Math.max(1, dex + athletic);
    const threshold = _statusCureThreshold(status);
    const già       = Battle.me.fieldMods.burnCureSuccessi || 0;
    const icon      = _statusCureIcon(status);

    const modal = document.createElement('div');
    modal.id    = 'modal-cura-status';
    modal.className = 'battle-modal';
    modal.innerHTML = `
        <div class="battle-modal-box">
            <div class="battle-modal-header">
                <span>${icon} ${_nomeStatus(status)} — ${nomePk}</span>
            </div>
            <div class="battle-modal-body">
                <p style="font-size:0.85rem;color:rgba(232,234,240,0.7);margin:0 0 4px;">
                    Successi necessari (cumulativi): <b>${threshold}</b>
                </p>
                <p style="font-size:0.88rem;color:#42a5f5;margin:0 0 10px;">
                    Già ottenuti: <b id="sc-già">${già}</b> / ${threshold}
                </p>
                <p style="font-size:0.78rem;color:rgba(232,234,240,0.45);margin:0 0 14px;">
                    Pool: DEX <b>${dex}</b> + Athletic <b>${athletic}</b> = <b>${pool}</b> dadi · successo ≥ 4
                </p>
                <p style="font-size:0.75rem;color:rgba(239,83,80,0.8);margin:0 0 12px;">
                    ⚠️ Tirare i dadi usa il tuo turno (passi l'azione).
                </p>
                <div id="sc-dadi-wrap" style="
                    display:flex;flex-wrap:wrap;gap:6px;min-height:44px;
                    padding:8px;border-radius:10px;
                    border:1.5px solid rgba(255,255,255,0.1);
                    background:rgba(255,255,255,0.03);margin-bottom:8px;"></div>
                <div id="sc-summary" style="
                    text-align:center;font-size:0.85rem;font-weight:700;
                    color:rgba(232,234,240,0.55);margin-bottom:12px;">—</div>
                <button id="btn-sc-roll"
                    onclick="_statusCuraTiraDado(${pool},${threshold})"
                    style="width:100%;padding:10px;border-radius:10px;border:none;
                    background:#1565c0;color:#fff;font-weight:700;cursor:pointer;margin-bottom:8px;">
                    🎲 Tira ${pool}d6 — DEX + Athletic (usa il turno)
                </button>
                <button onclick="_statusCuraOggetto()"
                    style="width:100%;padding:9px;border-radius:10px;border:none;
                    background:rgba(255,255,255,0.07);color:#e8eaf0;font-weight:600;
                    cursor:pointer;margin-bottom:8px;">
                    💊 Usa oggetto per guarire (mantieni il turno)
                </button>
                <button onclick="_statusCuraSalta()"
                    style="width:100%;padding:9px;border-radius:10px;border:none;
                    background:rgba(255,255,255,0.03);color:rgba(232,234,240,0.45);cursor:pointer;">
                    ⏭️ Salta — subirai il danno ogni 5 turni
                </button>
            </div>
        </div>`;
    modal._onDone = onDone;
    document.body.appendChild(modal);
}

// ── HELPER: dadi cliccabili per re-roll con Will ─────────────────────────────

function _creaStatusDiceBubbles(rolls, wrapEl) {
    wrapEl.innerHTML = '';
    rolls.forEach((r, idx) => {
        const bubble = document.createElement('div');
        const applyStyle = (val) => {
            bubble.style.cssText =
                `width:40px;height:40px;border-radius:8px;display:flex;align-items:center;` +
                `justify-content:center;font-size:1.2rem;font-weight:900;cursor:pointer;` +
                `background:${val >= 4 ? 'rgba(39,174,96,0.2)' : 'rgba(255,255,255,0.05)'};` +
                `border:2px solid ${val >= 4 ? '#27ae60' : 'rgba(255,255,255,0.15)'};` +
                `color:${val >= 4 ? '#4caf50' : '#e8eaf0'};`;
        };
        applyStyle(r);
        bubble.title     = 'Clicca per ritirare (costa 1 Will)';
        bubble.textContent = r;
        bubble.addEventListener('click', () => {
            const nuovo = Math.floor(Math.random() * 6) + 1;
            rolls[idx]  = nuovo;
            bubble.textContent = nuovo;
            applyStyle(nuovo);
            logBoth(`🃏 ${Battle.me.trainerName} — dado ritirato con Will: ${nuovo}`, 'system');
        });
        wrapEl.appendChild(bubble);
    });
}

function _statusCuraTiraDado(pool, threshold) {
    const modal = document.getElementById('modal-cura-status');
    if (!modal || modal._rolled) return;
    modal._rolled = true;

    const btn = document.getElementById('btn-sc-roll');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }

    const rolls = Array.from({ length: pool }, () => Math.floor(Math.random() * 6) + 1);

    const wrap = document.getElementById('sc-dadi-wrap');
    if (wrap) _creaStatusDiceBubbles(rolls, wrap);

    const body = modal.querySelector('.battle-modal-body');
    if (body) {
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = '✅ Conferma risultato';
        confirmBtn.style.cssText =
            'width:100%;padding:10px;border-radius:10px;border:none;' +
            'background:#2e7d32;color:#fff;font-weight:700;cursor:pointer;margin-top:8px;';
        confirmBtn.onclick = () => {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.4';
            _processaCuraStatus(rolls, threshold);
        };
        body.appendChild(confirmBtn);
    }
}

function _processaCuraStatus(rolls, threshold) {
    const modal      = document.getElementById('modal-cura-status');
    if (!modal) return;
    const successi   = rolls.filter(r => r >= 4).length;
    const già        = Battle.me.fieldMods.burnCureSuccessi || 0;
    const nuovo      = già + successi;
    Battle.me.fieldMods.burnCureSuccessi = nuovo;

    const giàEl = document.getElementById('sc-già');
    if (giàEl) giàEl.textContent = nuovo;

    const summary    = document.getElementById('sc-summary');
    const nomeStatus = _nomeStatus(Battle.me.fieldMods.status || '');
    const wasSleep   = Battle.me.fieldMods.status === 'sleep';

    if (nuovo >= threshold) {
        if (summary) summary.innerHTML =
            `✅ <b style="color:#4caf50;">${successi} successi</b> — Totale: ${nuovo}/${threshold} — ${nomeStatus} curata!`;
        logBoth(`🎲 ${_nomeMePk()} — Cura ${nomeStatus}: ${successi} succ. turno, ${nuovo}/${threshold} — ✅ Guarito!`, 'heal');

        Battle.me.fieldMods.status           = null;
        Battle.me.fieldMods.statusTurns      = 0;
        Battle.me.fieldMods.burnCureSuccessi = 0;
        const pk = Battle.me.team[Battle.me.activeIndex];
        if (pk) { pk._savedStatus = null; pk._savedStatusTurns = 0; pk._savedBurnCureSuccessi = 0; }
        BattleBridge.send('STATUS_HEALED', { targetRole: Battle.role, state: _serializeOpponentFacingState() });
        if (!wasSleep) _inviaCommit({ type: 'pass' });
        aggiornaUI();

        setTimeout(() => {
            const m  = document.getElementById('modal-cura-status');
            const cb = m?._onDone;
            m?.remove();
            cb?.();
        }, 1500);
    } else {
        _inviaCommit({ type: 'pass' });
        if (summary) summary.innerHTML =
            `${successi} successi questo turno — Totale: <b>${nuovo}/${threshold}</b>`;
        logBoth(`🎲 ${_nomeMePk()} — Cura ${nomeStatus}: ${successi} succ. turno, ${nuovo}/${threshold} totale`, 'status');

        const body = modal.querySelector('.battle-modal-body');
        if (body) {
            const continueBtn = document.createElement('button');
            continueBtn.textContent = '▶️ Continua (turno passato)';
            continueBtn.style.cssText =
                'width:100%;padding:12px;border-radius:12px;border:none;' +
                'background:#546e7a;color:#fff;font-weight:800;cursor:pointer;margin-top:8px;';
            continueBtn.onclick = () => {
                const m  = document.getElementById('modal-cura-status');
                const cb = m?._onDone;
                m?.remove();
                cb?.();
            };
            body.appendChild(continueBtn);
        }
    }
}

function _statusCuraOggetto() {
    const modal = document.getElementById('modal-cura-status');
    if (!modal) return;
    const nomePk    = _nomeMePk();
    const nomeStato = _nomeStatus(Battle.me.fieldMods.status || '');
    Battle.me.fieldMods.status           = null;
    Battle.me.fieldMods.statusTurns      = 0;
    Battle.me.fieldMods.burnCureSuccessi = 0;
    const pk = Battle.me.team[Battle.me.activeIndex];
    if (pk) { pk._savedStatus = null; pk._savedStatusTurns = 0; pk._savedBurnCureSuccessi = 0; }
    logBoth(`💊 ${nomePk} usa un oggetto — ${nomeStato} curata! (il turno non è perso)`, 'heal');
    BattleBridge.send('STATUS_HEALED', { targetRole: Battle.role, state: _serializeOpponentFacingState() });
    aggiornaUI();
    const onDone = modal._onDone;
    modal.remove();
    onDone?.();
}

function _statusCuraSalta() {
    const modal = document.getElementById('modal-cura-status');
    if (!modal) return;
    const onDone = modal._onDone;
    modal.remove();
    onDone?.();
}

// Alias per retrocompatibilità con eventuali chiamate precedenti
function apriModalCuraBruciatura(onDone) { apriModalCuraStatus(onDone); }

// ── MODAL CURA SONNO ──────────────────────────────────────────────────────────

function apriModalCuraSonno(onDone) {
    const nomePk  = _nomeMePk();
    const pk      = Battle.me.team[Battle.me.activeIndex];
    const insight = Math.max(1, (pk?.data?.stats?.Insight || 0) + (Battle.me.fieldMods?.Insight || 0));
    const pool    = insight;
    const threshold = 5;
    const già     = Battle.me.fieldMods.burnCureSuccessi || 0;

    const modal = document.createElement('div');
    modal.id    = 'modal-cura-status';
    modal.className = 'battle-modal';
    modal.innerHTML = `
        <div class="battle-modal-box">
            <div class="battle-modal-header">
                <span>💤 Sonno — ${nomePk}</span>
            </div>
            <div class="battle-modal-body">
                <p style="font-size:0.85rem;color:rgba(232,234,240,0.7);margin:0 0 4px;">
                    Successi Insight necessari (cumulativi): <b>${threshold}</b>
                </p>
                <p style="font-size:0.88rem;color:#42a5f5;margin:0 0 10px;">
                    Già ottenuti: <b id="sc-già">${già}</b> / ${threshold}
                </p>
                <p style="font-size:0.78rem;color:rgba(232,234,240,0.45);margin:0 0 14px;">
                    Pool: Insight <b>${insight}</b> = <b>${pool}</b> dadi · successo ≥ 4
                </p>
                <p style="font-size:0.75rem;color:rgba(239,83,80,0.8);margin:0 0 12px;">
                    ⚠️ Se non guarisei, il roll usa il tuo turno. Se guarisei, puoi agire normalmente!
                </p>
                <div id="sc-dadi-wrap" style="
                    display:flex;flex-wrap:wrap;gap:6px;min-height:44px;
                    padding:8px;border-radius:10px;
                    border:1.5px solid rgba(255,255,255,0.1);
                    background:rgba(255,255,255,0.03);margin-bottom:8px;"></div>
                <div id="sc-summary" style="
                    text-align:center;font-size:0.85rem;font-weight:700;
                    color:rgba(232,234,240,0.55);margin-bottom:12px;">—</div>
                <button id="btn-sc-roll"
                    onclick="_statusCuraTiraDado(${pool},${threshold})"
                    style="width:100%;padding:10px;border-radius:10px;border:none;
                    background:#1565c0;color:#fff;font-weight:700;cursor:pointer;margin-bottom:8px;">
                    🎲 Tira ${pool}d6 — Insight
                </button>
                <button onclick="_sonnoNonTirare()"
                    style="width:100%;padding:9px;border-radius:10px;border:none;
                    background:rgba(255,255,255,0.04);color:rgba(232,234,240,0.55);
                    font-weight:600;cursor:pointer;">
                    ⏭️ Non tirare — puoi fare switch o oggetto (mosse bloccate)
                </button>
            </div>
        </div>`;
    modal._onDone = onDone;
    document.body.appendChild(modal);
}

function _sonnoNonTirare() {
    const modal = document.getElementById('modal-cura-status');
    if (!modal) return;
    const onDone = modal._onDone;
    modal.remove();
    onDone?.();
}

// ── CHECK CONFUSIONE (inizio turno) ───────────────────────────────────────────

function _checkConfused(onDone) {
    const fm     = Battle.me.fieldMods;
    const pk     = Battle.me.team[Battle.me.activeIndex];
    const nomePk = _nomeMePk();
    const insight = Math.max(1, (pk?.data?.stats?.Insight || 0) + (fm.Insight || 0));

    const modal = document.createElement('div');
    modal.id    = 'modal-check-confused';
    modal.className = 'battle-modal';
    modal.innerHTML = `
        <div class="battle-modal-box">
            <div class="battle-modal-header">
                <span>😵 Confusione — ${nomePk}</span>
            </div>
            <div class="battle-modal-body">
                <p style="font-size:0.85rem;color:rgba(232,234,240,0.7);margin:0 0 4px;">
                    Servono <b>3 successi</b> Insight per guarire dalla confusione.
                </p>
                <p style="font-size:0.78rem;color:rgba(232,234,240,0.45);margin:0 0 14px;">
                    Pool: Insight <b>${insight}</b> dadi · successo ≥ 4 · non cumulativo.
                    Se non guarisei: −1 accuracy e −1 danno questo turno.
                </p>
                <div id="cnf-dadi-wrap" style="
                    display:flex;flex-wrap:wrap;gap:6px;min-height:44px;
                    padding:8px;border-radius:10px;
                    border:1.5px solid rgba(255,255,255,0.1);
                    background:rgba(255,255,255,0.03);margin-bottom:8px;"></div>
                <div id="cnf-summary" style="
                    text-align:center;font-size:0.85rem;font-weight:700;
                    color:rgba(232,234,240,0.55);margin-bottom:12px;">—</div>
                <button id="btn-cnf-roll"
                    onclick="_confusedTiraDado(${insight})"
                    style="width:100%;padding:10px;border-radius:10px;border:none;
                    background:#6a1b9a;color:#fff;font-weight:700;cursor:pointer;">
                    🎲 Tira ${insight}d6 — Insight
                </button>
            </div>
        </div>`;
    modal._onDone = onDone;
    document.body.appendChild(modal);
}

function _confusedTiraDado(pool) {
    const modal = document.getElementById('modal-check-confused');
    if (!modal || modal._rolled) return;
    modal._rolled = true;

    const btn = document.getElementById('btn-cnf-roll');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }

    const rolls = Array.from({ length: pool }, () => Math.floor(Math.random() * 6) + 1);

    const wrap = document.getElementById('cnf-dadi-wrap');
    if (wrap) _creaStatusDiceBubbles(rolls, wrap);

    const body = modal.querySelector('.battle-modal-body');
    if (body) {
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = '✅ Conferma risultato';
        confirmBtn.style.cssText =
            'width:100%;padding:10px;border-radius:10px;border:none;' +
            'background:#2e7d32;color:#fff;font-weight:700;cursor:pointer;margin-top:8px;';
        confirmBtn.onclick = () => {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.4';
            const successi = rolls.filter(r => r >= 4).length;
            const fm       = Battle.me.fieldMods;
            const nomePk   = _nomeMePk();
            const summary  = document.getElementById('cnf-summary');
            if (successi >= 3) {
                if (summary) summary.innerHTML =
                    `✅ <b style="color:#4caf50;">${successi}/${pool} successi</b> — Confusione curata!`;
                fm.confusedTurns = 0;
                fm.confusedMalus = false;
                logBoth(`😵→✅ ${nomePk} — Confusione curata! (${successi}/${pool} succ.)`, 'heal');
                BattleBridge.send('REMOVE_STATUS', { targetRole: Battle.role, statusId: 'confused' });
                aggiornaUI();
                setTimeout(() => {
                    const m  = document.getElementById('modal-check-confused');
                    const cb = m?._onDone;
                    m?.remove();
                    cb?.();
                }, 1500);
            } else {
                fm.confusedMalus = true;
                if (summary) summary.innerHTML =
                    `<b style="color:#ef9a9a;">${successi}/${pool} successi</b> — Non guarito · −1 accuracy e danno.`;
                logBoth(`😵 ${nomePk} è confuso! (${successi}/${pool} succ., servivano 3) — −1 accuracy e −1 danno.`, 'status');
                const btn2 = document.createElement('button');
                btn2.textContent = '▶️ Continua';
                btn2.style.cssText =
                    'width:100%;padding:12px;border-radius:12px;border:none;' +
                    'background:#546e7a;color:#fff;font-weight:800;cursor:pointer;margin-top:8px;';
                btn2.onclick = () => {
                    const m  = document.getElementById('modal-check-confused');
                    const cb = m?._onDone;
                    m?.remove();
                    cb?.();
                };
                body.appendChild(btn2);
            }
        };
        body.appendChild(confirmBtn);
    }
}

// ── CHECK INNAMORAMENTO (inizio turno) ────────────────────────────────────────

function _checkLove(onDone) {
    const fm     = Battle.me.fieldMods;
    const pk     = Battle.me.team[Battle.me.activeIndex];
    const nomePk = _nomeMePk();
    const insight = Math.max(1, (pk?.data?.stats?.Insight || 0) + (fm.Insight || 0));

    const modal = document.createElement('div');
    modal.id    = 'modal-check-love';
    modal.className = 'battle-modal';
    modal.innerHTML = `
        <div class="battle-modal-box">
            <div class="battle-modal-header">
                <span>💕 Innamoramento — ${nomePk}</span>
            </div>
            <div class="battle-modal-body">
                <p style="font-size:0.85rem;color:rgba(232,234,240,0.7);margin:0 0 4px;">
                    Servono <b>2 successi</b> Insight per guarire dall'innamoramento.
                </p>
                <p style="font-size:0.78rem;color:rgba(232,234,240,0.45);margin:0 0 14px;">
                    Pool: Insight <b>${insight}</b> dadi · successo ≥ 4 · non cumulativo.
                    Se non guarisei: danno dimezzato questo turno.
                </p>
                <div id="lve-dadi-wrap" style="
                    display:flex;flex-wrap:wrap;gap:6px;min-height:44px;
                    padding:8px;border-radius:10px;
                    border:1.5px solid rgba(255,255,255,0.1);
                    background:rgba(255,255,255,0.03);margin-bottom:8px;"></div>
                <div id="lve-summary" style="
                    text-align:center;font-size:0.85rem;font-weight:700;
                    color:rgba(232,234,240,0.55);margin-bottom:12px;">—</div>
                <button id="btn-lve-roll"
                    onclick="_loveTiraDado(${insight})"
                    style="width:100%;padding:10px;border-radius:10px;border:none;
                    background:#c62828;color:#fff;font-weight:700;cursor:pointer;">
                    🎲 Tira ${insight}d6 — Insight
                </button>
            </div>
        </div>`;
    modal._onDone = onDone;
    document.body.appendChild(modal);
}

function _loveTiraDado(pool) {
    const modal = document.getElementById('modal-check-love');
    if (!modal || modal._rolled) return;
    modal._rolled = true;

    const btn = document.getElementById('btn-lve-roll');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }

    const rolls = Array.from({ length: pool }, () => Math.floor(Math.random() * 6) + 1);

    const wrap = document.getElementById('lve-dadi-wrap');
    if (wrap) _creaStatusDiceBubbles(rolls, wrap);

    const body = modal.querySelector('.battle-modal-body');
    if (body) {
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = '✅ Conferma risultato';
        confirmBtn.style.cssText =
            'width:100%;padding:10px;border-radius:10px;border:none;' +
            'background:#2e7d32;color:#fff;font-weight:700;cursor:pointer;margin-top:8px;';
        confirmBtn.onclick = () => {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.4';
            const successi = rolls.filter(r => r >= 4).length;
            const fm       = Battle.me.fieldMods;
            const nomePk   = _nomeMePk();
            const summary  = document.getElementById('lve-summary');
            if (successi >= 2) {
                if (summary) summary.innerHTML =
                    `✅ <b style="color:#4caf50;">${successi}/${pool} successi</b> — Innamoramento curato!`;
                fm.loveTurns      = 0;
                fm.inLoveHalveDmg = false;
                logBoth(`💕→✅ ${nomePk} — Innamoramento curato! (${successi}/${pool} succ.)`, 'heal');
                BattleBridge.send('REMOVE_STATUS', { targetRole: Battle.role, statusId: 'love' });
                aggiornaUI();
                setTimeout(() => {
                    const m  = document.getElementById('modal-check-love');
                    const cb = m?._onDone;
                    m?.remove();
                    cb?.();
                }, 1500);
            } else {
                fm.inLoveHalveDmg = true;
                if (summary) summary.innerHTML =
                    `<b style="color:#ef9a9a;">${successi}/${pool} successi</b> — Non guarito · danno dimezzato.`;
                logBoth(`💕 ${nomePk} è innamorato e distratto! (${successi}/${pool} succ., servivano 2) — danni dimezzati.`, 'status');
                const btn2 = document.createElement('button');
                btn2.textContent = '▶️ Continua';
                btn2.style.cssText =
                    'width:100%;padding:12px;border-radius:12px;border:none;' +
                    'background:#546e7a;color:#fff;font-weight:800;cursor:pointer;margin-top:8px;';
                btn2.onclick = () => {
                    const m  = document.getElementById('modal-check-love');
                    const cb = m?._onDone;
                    m?.remove();
                    cb?.();
                };
                body.appendChild(btn2);
            }
        };
        body.appendChild(confirmBtn);
    }
}

// ── CONGELAMENTO: attacco al blocco di ghiaccio ───────────────────────────────
// Tipo 2=Fire, 7=Fighting, 13=Rock, 17=Steel → super efficaci vs Ice (tipo 6)

const _FORTI_VS_GHIACCIO = new Set([2, 7, 13, 17]);

function _eseguiAttaccoConGelo(commit, onDone) {
    const moveData   = commit.moveData || {};
    const moveTypeId = moveData.Type || 0;
    const cat        = moveData.Category || 'Physical';
    const nomePk     = _nomeMePk();
    const moveName   = commit.moveName || '?';

    if (_FORTI_VS_GHIACCIO.has(moveTypeId)) {
        logBoth(`❄️💥 ${nomePk} usa ${moveName} — il ghiaccio si frantuma! Congelamento rimosso! (nessun danno all'avversario)`, 'heal');
        Battle.me.fieldMods.status      = null;
        Battle.me.fieldMods.statusTurns = 0;
        Battle.me.fieldMods.iceBlockHP  = 0;
        const pk = Battle.me.team[Battle.me.activeIndex];
        if (pk) { pk._savedStatus = null; pk._savedStatusTurns = 0; pk._savedIceBlockHP = 0; }
        BattleBridge.send('STATUS_HEALED', { targetRole: Battle.role, state: _serializeOpponentFacingState() });
        aggiornaUI();
        if (Battle._iGoFirst) BattleBridge.send('FIRST_ACCURACY_DONE', {});
        onDone?.();
    } else if (cat === 'Support') {
        logBoth(`❄️ ${nomePk} è congelato — la mossa di supporto fallisce!`, 'status');
        if (Battle._iGoFirst) BattleBridge.send('FIRST_ACCURACY_DONE', {});
        onDone?.();
    } else {
        logBoth(`❄️ ${nomePk} usa ${moveName} — l'attacco colpisce il blocco di ghiaccio!`, 'status');
        apriModalAttaccoGelo(commit, onDone);
    }
}

function apriModalAttaccoGelo(commit, onDone) {
    const pk        = Battle.me.team[Battle.me.activeIndex];
    const mods      = Battle.me.fieldMods;
    const moveData  = commit.moveData || {};
    const cat       = moveData.Category || 'Physical';
    const dmg1Val   = _getValPk(pk, mods, moveData.Damage1 || '');
    const power     = parseInt(moveData.Power) || 0;
    const poolDanno = Math.max(1, dmg1Val + power);
    const iceHP     = mods.iceBlockHP || 5;

    const modal = document.createElement('div');
    modal.id    = 'modal-attacco-gelo';
    modal.className = 'battle-modal';
    modal.innerHTML = `
        <div class="battle-modal-box">
            <div class="battle-modal-header"><span>❄️ Blocco di Ghiaccio — ${_nomeMePk()}</span></div>
            <div class="battle-modal-body">
                <p style="font-size:0.84rem;color:rgba(232,234,240,0.7);margin:0 0 6px;">
                    Blocco HP: <b id="ghiaccio-hp">${iceHP}</b>/5 &nbsp;·&nbsp; DEF: <b>2</b>
                </p>
                <p style="font-size:0.78rem;color:rgba(232,234,240,0.45);margin:0 0 12px;">
                    Pool danno: <b>${poolDanno}</b> dadi · successo ≥4 = 1 danno · −2 difesa blocco
                </p>
                <div id="ghiaccio-dadi-wrap" style="
                    display:flex;flex-wrap:wrap;gap:6px;min-height:44px;
                    padding:8px;border-radius:10px;
                    border:1.5px solid rgba(255,255,255,0.1);
                    background:rgba(255,255,255,0.03);margin-bottom:8px;"></div>
                <div id="ghiaccio-summary" style="
                    text-align:center;font-size:0.85rem;font-weight:700;
                    color:rgba(232,234,240,0.55);margin-bottom:12px;">—</div>
                <button id="btn-ghiaccio-roll"
                    onclick="_eseguiDannoGelo(${poolDanno})"
                    style="width:100%;padding:10px;border-radius:10px;border:none;
                    background:#0d47a1;color:#fff;font-weight:700;cursor:pointer;">
                    🎲 Tira ${poolDanno}d6 — Danno al blocco di ghiaccio
                </button>
            </div>
        </div>`;
    modal._onDone = onDone;
    document.body.appendChild(modal);
}

function _eseguiDannoGelo(poolDanno) {
    const modal = document.getElementById('modal-attacco-gelo');
    if (!modal || modal._rolled) return;
    modal._rolled = true;

    const btn = document.getElementById('btn-ghiaccio-roll');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }

    const rolls = Array.from({ length: poolDanno }, () => Math.floor(Math.random() * 6) + 1);

    const wrap = document.getElementById('ghiaccio-dadi-wrap');
    if (wrap) _creaStatusDiceBubbles(rolls, wrap);

    const body = modal.querySelector('.battle-modal-body');
    if (body) {
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = '✅ Conferma risultato';
        confirmBtn.style.cssText =
            'width:100%;padding:10px;border-radius:10px;border:none;' +
            'background:#2e7d32;color:#fff;font-weight:700;cursor:pointer;margin-top:8px;';
        confirmBtn.onclick = () => {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.4';
            const successi = rolls.filter(r => r >= 4).length;
            const difesa   = 2;
            const danno    = Math.max(0, successi - difesa);
            const fm       = Battle.me.fieldMods;
            fm.iceBlockHP  = Math.max(0, (fm.iceBlockHP || 5) - danno);

            const hpEl = document.getElementById('ghiaccio-hp');
            if (hpEl) hpEl.textContent = fm.iceBlockHP;

            const summary = document.getElementById('ghiaccio-summary');
            if (Battle._iGoFirst) BattleBridge.send('FIRST_ACCURACY_DONE', {});

            if (fm.iceBlockHP <= 0) {
                if (summary) summary.innerHTML =
                    `✅ <b style="color:#4caf50;">${successi} succ. − 2 difesa = ${danno} danni</b> — Blocco distrutto! Congelamento rimosso!`;
                logBoth(`❄️→✅ ${_nomeMePk()} — Blocco di ghiaccio distrutto (${danno} danni)! Congelamento rimosso!`, 'heal');
                fm.status      = null;
                fm.statusTurns = 0;
                fm.iceBlockHP  = 0;
                const pk = Battle.me.team[Battle.me.activeIndex];
                if (pk) { pk._savedStatus = null; pk._savedStatusTurns = 0; pk._savedIceBlockHP = 0; }
                BattleBridge.send('STATUS_HEALED', { targetRole: Battle.role, state: _serializeOpponentFacingState() });
                aggiornaUI();
                setTimeout(() => {
                    const m  = document.getElementById('modal-attacco-gelo');
                    const cb = m?._onDone;
                    m?.remove();
                    cb?.();
                }, 1500);
            } else {
                if (summary) summary.innerHTML =
                    `${successi} succ. − 2 difesa = ${danno} danni — Blocco HP: <b>${fm.iceBlockHP}/5</b>`;
                logBoth(`❄️ ${_nomeMePk()} — Blocco di ghiaccio: ${danno} danni, HP rimanenti: ${fm.iceBlockHP}/5`, 'status');

                const btn2 = document.createElement('button');
                btn2.textContent = '▶️ Continua';
                btn2.style.cssText =
                    'width:100%;padding:12px;border-radius:12px;border:none;' +
                    'background:#546e7a;color:#fff;font-weight:800;cursor:pointer;margin-top:8px;';
                btn2.onclick = () => {
                    const m  = document.getElementById('modal-attacco-gelo');
                    const cb = m?._onDone;
                    m?.remove();
                    cb?.();
                };
                body.appendChild(btn2);
            }
        };
        body.appendChild(confirmBtn);
    }
}

// ── DECREMENTO CONDIZIONI VOLATILI (fine turno) ───────────────────────────────

function _decrementaCondizioniVolatili() {
    const fm  = Battle.me.fieldMods;
    const nom = _nomeMePk();

    // Reset flag per-turno
    fm.confusedMalus  = false;
    fm.inLoveHalveDmg = false;
    const wasFlinch   = fm.flinchActive;
    fm.flinchActive   = false;
    if (wasFlinch) {
        BattleBridge.send('REMOVE_STATUS', { targetRole: Battle.role, statusId: 'flinched' });
    }

    // Confusione
    if (fm.confusedTurns > 0) {
        fm.confusedTurns--;
        if (fm.confusedTurns <= 0) {
            fm.confusedTurns = 0;
            logBoth(`✅ ${nom} non è più confuso!`, 'heal');
            BattleBridge.send('REMOVE_STATUS', { targetRole: Battle.role, statusId: 'confused' });
        }
    }
    // Innamoramento
    if (fm.loveTurns > 0) {
        fm.loveTurns--;
        if (fm.loveTurns <= 0) {
            fm.loveTurns = 0;
            logBoth(`✅ ${nom} non è più innamorato!`, 'heal');
            BattleBridge.send('REMOVE_STATUS', { targetRole: Battle.role, statusId: 'love' });
        }
    }
    // Repeat
    if (fm.repeatTurns > 0) {
        fm.repeatTurns--;
        if (fm.repeatTurns <= 0) {
            fm.repeatTurns = 0;
            fm.repeatMoveName = null;
            logBoth(`✅ ${nom} non è più costretto a ripetere la mossa!`, 'heal');
            BattleBridge.send('REMOVE_STATUS', { targetRole: Battle.role, statusId: 'repeat' });
        }
    }
}

// ── MODAL METEO INIZIALE (round 1) ────────────────────────────────────────────

function apriModalMeteoInizio(onDone) {
    const modal = document.createElement('div');
    modal.id    = 'modal-meteo-inizio';
    modal.className = 'battle-modal';
    const sl = 'padding:6px 8px;border-radius:8px;border:1.5px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#e8eaf0;font-size:0.8rem;';
    modal.innerHTML = `
        <div class="battle-modal-box">
            <div class="battle-modal-header"><span>🌦️ Meteo Iniziale — Round 1</span></div>
            <div class="battle-modal-body">
                <p style="font-size:0.84rem;color:rgba(232,234,240,0.65);margin-bottom:4px;">
                    Scegli il meteo imposto da un'abilità o condizione del campo all'avvio.<br>
                    Se nessuna abilità lo modifica, scegli Nessuno.
                </p>
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
                    <span style="font-size:0.78rem;color:rgba(232,234,240,0.55);">Durata:</span>
                    <input type="number" id="meteo-inizio-rounds" min="0" value="0" style="${sl}width:54px;text-align:center;">
                    <span style="font-size:0.72rem;color:rgba(232,234,240,0.4);">round (×5 turni · 0 = permanente)</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:7px;">
                    ${_BATTLE_WEATHERS.map(w=>`<button class="effetto-type-btn" onclick="_confermaMeteoInizio('${w.id}')">${w.label}</button>`).join('')}
                </div>
            </div>
        </div>`;
    modal._onDone = onDone;
    document.body.appendChild(modal);
}

function _confermaMeteoInizio(weatherId) {
    const weather = weatherId === 'none' ? null : weatherId;
    if (weather) {
        const roundsEl = document.getElementById('meteo-inizio-rounds');
        const rounds = roundsEl ? parseInt(roundsEl.value) || 0 : 0;
        const turns = rounds > 0 ? rounds * 5 : -1;
        BattleBridge.send('SET_WEATHER', { weather, turns });
        Battle.weather           = weather;
        Battle.weatherTurns      = turns;
        Battle.baseWeather       = weather;
        Battle.baseWeatherTurns  = turns;
        const durLabel = turns > 0 ? `${rounds} round (${turns} turni)` : 'permanente';
        log(`🌦️ Meteo iniziale: ${_nomeMeteo(weather)} · ${durLabel}`, 'weather');
        aggiornaHeader();
    }
    const modal = document.getElementById('modal-meteo-inizio');
    if (modal) { const cb = modal._onDone; modal.remove(); if (cb) cb(); }
}

// ── MODAL TURNO (abilità / oggetto) ───────────────────────────────────────────

let _tmQueue  = [];
let _tmOnDone = null;

function _tmName(key) {
    return key === 'me'
        ? (Battle.me.team[Battle.me.activeIndex]?.name || 'Il tuo')
        : (Battle.opponent?.team?.[Battle.opponent.activeIndex]?.name || 'Avversario');
}

function _buildTurnModalHTML(titolo, pkLine, opts = {}) {
    const myPk  = Battle.me.team[Battle.me.activeIndex]?.name || 'Il tuo';
    const oppPk = Battle.opponent?.team?.[Battle.opponent.activeIndex]?.name || 'Avversario';
    const tgtO  = `<option value="me">${myPk}</option><option value="opp">${oppPk}</option>`;
    const stO   = _BATTLE_STATS.map(s=>`<option value="${s.key}">${s.label}</option>`).join('');
    const dlO   = [1,2,3,4,5,6].map(n=>`<option value="${n}">+${n}</option>`).join('')
                + [1,2,3,4,5,6].map(n=>`<option value="${-n}">−${n}</option>`).join('');
    const sl  = 'padding:6px 8px;border-radius:8px;border:1.5px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#e8eaf0;font-size:0.8rem;';
    const sec = 'padding:10px 0;border-top:1px solid rgba(255,255,255,0.07);';
    const lbl = 'font-size:0.78rem;font-weight:700;color:rgba(232,234,240,0.55);text-transform:uppercase;letter-spacing:0.04em;margin:0 0 7px;';

    return `
        <div class="battle-modal-box">
            <div class="battle-modal-header"><span>${titolo}</span><button class="btn-mini-modal" onclick="miniModal('modal-turno-existente')" title="Minimizza">—</button></div>
            <div class="battle-modal-body">
                <p style="font-size:0.8rem;color:rgba(232,234,240,0.5);margin:0;">${pkLine}</p>

                <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:8px 10px;min-height:42px;">
                    <p style="${lbl}">📋 In coda (<span id="tm-q-count">0</span>)</p>
                    <div id="tm-q-list" style="display:flex;flex-direction:column;gap:5px;">
                        <p style="font-size:0.78rem;color:rgba(232,234,240,0.3);margin:0;">Nessuna modifica in coda</p>
                    </div>
                </div>

                <div style="${sec}">
                    <p style="${lbl}">📊 Modifica statistica</p>
                    <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
                        <select id="tm-stat-tgt" style="${sl}flex:0 0 auto;max-width:130px;">${tgtO}</select>
                        <select id="tm-stat-name" style="${sl}flex:1;">${stO}</select>
                        <select id="tm-stat-delta" style="${sl}flex:0 0 75px;">${dlO}</select>
                        <button onclick="_statAsk('tm')" style="padding:6px 11px;border-radius:8px;border:1.5px solid rgba(39,174,96,0.35);background:rgba(39,174,96,0.08);color:#66bb6a;font-size:0.82rem;font-weight:700;cursor:pointer;">➕</button>
                    </div>
                    <div id="tm-stat-roll-panel"></div>
                </div>

                <div style="${sec}">
                    <p style="${lbl}">🔶 Applica status</p>
                    <select id="tm-status-tgt" style="${sl}width:100%;margin-bottom:7px;">${tgtO}</select>
                    <div style="display:flex;flex-wrap:wrap;gap:5px;">
                        ${_BATTLE_STATUSES.map(s=>`<button onclick="_statusAsk('tm','${s.id}','${s.label}',${s.turns})" style="padding:5px 8px;border-radius:7px;border:1.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#e8eaf0;font-size:0.76rem;cursor:pointer;">${s.label}</button>`).join('')}
                    </div>
                    <div id="tm-status-roll-panel"></div>
                </div>

                <div style="${sec}">
                    <p style="${lbl}">❌ Rimuovi status</p>
                    <select id="tm-rmst-tgt" style="${sl}width:100%;margin-bottom:7px;"
                            onchange="_tmAggiornaBtnRimuovi()">${tgtO}</select>
                    <div id="tm-rmst-list" style="display:flex;flex-wrap:wrap;gap:5px;min-height:26px;">
                        <span style="font-size:0.75rem;color:rgba(232,234,240,0.3);">Nessuno status attivo</span>
                    </div>
                </div>

                <div style="${sec}">
                    <p style="${lbl}">🛡️ Immunità status</p>
                    <select id="tm-stimmune-tgt" style="${sl}width:100%;margin-bottom:7px;">${tgtO}</select>
                    <div style="display:flex;flex-wrap:wrap;gap:5px;">
                        ${_BATTLE_STATUSES.map(s=>`<button onclick="_tmAccodaStatusImmunity('${s.id}','${s.label}')" style="padding:5px 8px;border-radius:7px;border:1.5px solid rgba(100,181,246,0.2);background:rgba(100,181,246,0.06);color:#90caf9;font-size:0.76rem;cursor:pointer;">${s.label}</button>`).join('')}
                    </div>
                </div>

                <div style="${sec}">
                    <p style="${lbl}">🛡️ Immunità tipo</p>
                    <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
                        <select id="tm-imm-tgt" style="${sl}flex:0 0 auto;max-width:130px;">${tgtO}</select>
                        <select id="tm-imm-type" style="${sl}flex:1;"><option value="">— Tipo —</option>${_typeOptions()}</select>
                        <button onclick="_tmAccodaImmunity()" style="padding:6px 11px;border-radius:8px;border:1.5px solid rgba(39,174,96,0.35);background:rgba(39,174,96,0.08);color:#66bb6a;font-size:0.82rem;font-weight:700;cursor:pointer;">➕</button>
                    </div>
                </div>

                <div style="${sec}">
                    <p style="${lbl}">🌦️ Meteo</p>
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;">
                        <span style="font-size:0.78rem;color:rgba(232,234,240,0.55);">Durata:</span>
                        <input type="number" id="tm-weather-rounds" min="0" value="4" style="${sl}width:54px;text-align:center;">
                        <span style="font-size:0.72rem;color:rgba(232,234,240,0.4);">round (×5 turni · 0 = permanente)</span>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:5px;">
                        ${_BATTLE_WEATHERS.map(w=>`<button id="tm-wb-${w.id}" onclick="_tmAccodaMeteo('${w.id}','${w.label}')" style="padding:5px 8px;border-radius:7px;border:1.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#e8eaf0;font-size:0.76rem;cursor:pointer;">${w.label}</button>`).join('')}
                    </div>
                </div>

                <div style="${sec}">
                    <p style="${lbl}">❤️ HP diretto</p>
                    <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
                        <select id="tm-hp-tgt" style="${sl}flex:0 0 auto;max-width:130px;">${tgtO}</select>
                        ${[[-5,'229,57,53','#ef5350'],[-1,'229,57,53','#ef5350'],[1,'39,174,96','#66bb6a'],[5,'39,174,96','#66bb6a']].map(([n,rgb,col])=>`<button onclick="_tmAccodaHP(${n})" style="padding:5px 10px;border-radius:8px;border:1.5px solid rgba(${rgb},0.35);background:rgba(${rgb},0.08);color:${col};font-weight:900;cursor:pointer;">${n>0?'+':''}${n}</button>`).join('')}
                    </div>
                </div>

                ${opts.showPriorityBoost ? `
                <div style="${sec}">
                    <p style="${lbl}">⚡ Priority per tipo mossa</p>
                    <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
                        <select id="tm-prio-tgt" style="${sl}flex:0 0 auto;max-width:130px;">${tgtO}</select>
                        <select id="tm-prio-type" style="${sl}flex:1;"><option value="">— Tipo —</option>${_typeOptions()}</select>
                        <select id="tm-prio-val" style="${sl}flex:0 0 75px;">
                            ${[1,2,3,4].map(n=>`<option value="${n}">+${n}</option>`).join('')}
                            ${[1,2,3,4].map(n=>`<option value="${-n}">−${n}</option>`).join('')}
                        </select>
                        <button onclick="_tmAccodaTypePriority()" style="padding:6px 11px;border-radius:8px;border:1.5px solid rgba(39,174,96,0.35);background:rgba(39,174,96,0.08);color:#66bb6a;font-size:0.82rem;font-weight:700;cursor:pointer;">➕</button>
                    </div>
                </div>` : ''}

                <button onclick="_confermaTurnModal()" style="width:100%;padding:13px;border-radius:14px;border:none;background:#1877f2;color:#fff;font-family:inherit;font-size:0.95rem;font-weight:800;cursor:pointer;margin-top:4px;">
                    ✅ Fatto / Nessun effetto
                </button>
            </div>
        </div>`;
}

function apriModalAbilitaTurno(momento, onDone) {
    document.getElementById('modal-turno-existente')?.remove();
    _tmQueue  = [];
    _tmOnDone = onDone;
    const pk      = Battle.me.team[Battle.me.activeIndex];
    const ability = pk?.data?.ability || '—';
    const titolo  = momento === 'inizio' ? '⚡ Abilità — Inizio Turno' : '⚡ Abilità — Fine Turno';
    const modal   = document.createElement('div');
    modal.id      = 'modal-turno-existente';
    modal.className = 'battle-modal';
    modal.innerHTML = _buildTurnModalHTML(titolo, `${pk?.name||'—'} — Abilità: ${ability}`, { showPriorityBoost: true });
    document.body.appendChild(modal);
    _tmAggiornaBtnRimuovi();
}

function apriModalOggettoTurno(momento, onDone) {
    document.getElementById('modal-turno-existente')?.remove();
    _tmQueue  = [];
    _tmOnDone = onDone;
    const pk   = Battle.me.team[Battle.me.activeIndex];
    const item = pk?.data?.item || '—';
    const titolo = momento === 'inizio' ? '🎒 Oggetto — Inizio Turno' : '🎒 Oggetto — Fine Turno';
    const modal  = document.createElement('div');
    modal.id     = 'modal-turno-existente';
    modal.className = 'battle-modal';
    modal.innerHTML = _buildTurnModalHTML(titolo, `${pk?.name||'—'} — Oggetto: ${item}`);
    document.body.appendChild(modal);
    _tmAggiornaBtnRimuovi();
}

function _tmRenderCoda() {
    const listEl  = document.getElementById('tm-q-list');
    const countEl = document.getElementById('tm-q-count');
    if (!listEl) return;
    if (countEl) countEl.textContent = _tmQueue.length;
    if (!_tmQueue.length) {
        listEl.innerHTML = '<p style="font-size:0.78rem;color:rgba(232,234,240,0.3);margin:0;">Nessuna modifica in coda</p>';
        return;
    }
    listEl.innerHTML = _tmQueue.map((e,i) => {
        const desc = e.type==='stat'            ? `📊 ${e.tName} — ${e.stat} ${e.delta>0?'+':''}${e.delta}`
                   : e.type==='status'           ? `🔶 ${e.tName} — ${e.label}`
                   : e.type==='weather'          ? `🌦️ Meteo → ${e.label} · ${e.turns>0?`${e.turns/5} r (${e.turns} t)`:'permanente'}`
                   : e.type==='immunity'         ? `🛡️ ${e.tName} immune a ${e.typeName}`
                   : e.type==='typePriority'     ? `⚡ Tipo ${e.typeName} Priority ${e.bonus>0?'+':''}${e.bonus}`
                   : e.type==='statusImmunity'   ? `🛡️ ${e.tName} immune a ${e.statusLabel}`
                   : e.type==='removeStatus'     ? `❌ ${e.tName} — rimuove ${e.statusLabel || 'status'}`
                   :                              `❤️ ${e.tName} HP ${e.delta>0?'+':''}${e.delta}`;
        return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:0.79rem;background:rgba(255,255,255,0.04);border-radius:6px;padding:4px 8px;"><span>${desc}</span><button onclick="_tmRimuoviCoda(${i})" style="background:none;border:none;color:#ef5350;cursor:pointer;font-size:0.88rem;padding:0 2px;">✕</button></div>`;
    }).join('');
}

function _tmRimuoviCoda(i) { _tmQueue.splice(i,1); _tmRenderCoda(); }

function _tmAccodaStat() {
    const tgt   = document.getElementById('tm-stat-tgt')?.value || 'me';
    const stat  = document.getElementById('tm-stat-name')?.value;
    const delta = parseInt(document.getElementById('tm-stat-delta')?.value || '1');
    if (!stat) return;
    _tmQueue.push({ type:'stat', targetKey:tgt, tName:_tmName(tgt), stat, delta });
    _tmRenderCoda();
}

function _tmAccodaStatus(statusId, label, turns) {
    const tgt = document.getElementById('tm-status-tgt')?.value || 'me';
    _tmQueue.push({ type:'status', targetKey:tgt, tName:_tmName(tgt), statusId, label, turns });
    _tmRenderCoda();
}

function _tmAccodaMeteo(weatherId, label) {
    _tmQueue = _tmQueue.filter(e => e.type !== 'weather');
    const roundsEl = document.getElementById('tm-weather-rounds');
    const rounds = roundsEl ? parseInt(roundsEl.value) || 0 : 0;
    const turns = rounds > 0 ? rounds * 5 : -1;
    _tmQueue.push({ type:'weather', weatherId, label, turns });
    _tmRenderCoda();
    _BATTLE_WEATHERS.forEach(w => {
        const b = document.getElementById(`tm-wb-${w.id}`);
        if (b) b.style.background = w.id===weatherId ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)';
    });
}

function _tmAccodaImmunity() {
    const tgt    = document.getElementById('tm-imm-tgt')?.value || 'me';
    const typeId = parseInt(document.getElementById('tm-imm-type')?.value);
    if (!typeId) return;
    const typeName = _TYPE_NAMES[typeId] || String(typeId);
    _tmQueue.push({ type: 'immunity', targetKey: tgt, tName: _tmName(tgt), typeId, typeName });
    _tmRenderCoda();
}

function _tmAccodaTypePriority() {
    const tgt    = document.getElementById('tm-prio-tgt')?.value || 'me';
    const typeId = parseInt(document.getElementById('tm-prio-type')?.value);
    if (!typeId) return;
    const bonus    = parseInt(document.getElementById('tm-prio-val')?.value || '1');
    const typeName = _TYPE_NAMES[typeId] || String(typeId);
    _tmQueue.push({ type: 'typePriority', targetKey: tgt, tName: _tmName(tgt), typeId, typeName, bonus });
    _tmRenderCoda();
}

function _tmAccodaHP(delta) {
    const tgt = document.getElementById('tm-hp-tgt')?.value || 'me';
    _tmQueue.push({ type:'hp', targetKey:tgt, tName:_tmName(tgt), delta });
    _tmRenderCoda();
}

function _tmAccodaStatusImmunity(statusId, label) {
    const tgt = document.getElementById('tm-stimmune-tgt')?.value || 'me';
    _tmQueue.push({ type:'statusImmunity', targetKey:tgt, tName:_tmName(tgt), statusId, statusLabel:label });
    _tmRenderCoda();
}

function _tmAccodaRimuoviStatus(statusId) {
    const tgt = document.getElementById('tm-rmst-tgt')?.value || 'me';
    _tmQueue.push({ type:'removeStatus', targetKey:tgt, tName:_tmName(tgt), statusId, statusLabel:_nomeStatus(statusId) });
    _tmRenderCoda();
    _tmAggiornaBtnRimuovi();
}

function _tmAggiornaBtnRimuovi() {
    const tgt = document.getElementById('tm-rmst-tgt')?.value || 'me';
    const f   = tgt === 'me' ? Battle.me : Battle.opponent;
    const fm  = f?.fieldMods;
    const el  = document.getElementById('tm-rmst-list');
    if (!el || !fm) return;
    const attivi = [];
    if (fm.status)              attivi.push({ id: fm.status,              label: _nomeStatus(fm.status) });
    if (fm.confusedTurns > 0)   attivi.push({ id: 'confused',             label: `Confusione (${fm.confusedTurns} t.)` });
    if (fm.loveTurns > 0)       attivi.push({ id: 'love',                 label: `Innamoramento (${fm.loveTurns} t.)` });
    if (fm.flinchActive)        attivi.push({ id: 'flinched',             label: 'Flinch' });
    if (!attivi.length) {
        el.innerHTML = '<span style="font-size:0.75rem;color:rgba(232,234,240,0.3);">Nessuno status attivo</span>';
        return;
    }
    el.innerHTML = attivi.map(s =>
        `<button onclick="_tmAccodaRimuoviStatus('${s.id}')"
            style="padding:5px 9px;border-radius:7px;border:1.5px solid rgba(239,83,80,0.3);
            background:rgba(239,83,80,0.07);color:#ef9a9a;font-size:0.76rem;cursor:pointer;">
            ❌ ${s.label}</button>`
    ).join('');
}

function _confermaTurnModal() {
    const wasKO = _inviaQueue(_tmQueue, -1);
    document.getElementById('modal-turno-existente')?.remove();
    if (!wasKO && _tmOnDone) { const cb = _tmOnDone; _tmOnDone = null; cb(); }
}

// ── VITTORIA ──────────────────────────────────────────────────────────────────

function _vittoria() {
    if (Battle.phase === 'ended') return;
    Battle.phase = 'ended';
    BattleBridge.send('BATTLE_ENDED', {
        winnerRole: Battle.role,
        winnerName: Battle.me.trainerName,
        winnerImg:  Battle.me.trainerImg,
        state:      _serializeOpponentFacingState(),
    });
    log(`🏆 ${Battle.me.trainerName} vince la battaglia!`, 'win');
    if (typeof MusicManager !== 'undefined') {
        MusicManager.stop();
        setTimeout(() => MusicManager.playForScreen('victory'), 600);
    }
    aggiornaUI();
    setTimeout(() => mostraFine(Battle.me.trainerName, Battle.me.trainerImg), 1000);
}

function mostraFine(nome, img) {
    document.getElementById('end-trainer-name').textContent = nome;
    const imgEl = document.getElementById('end-trainer-img');
    if (imgEl) {
        if (img) { imgEl.src = img; imgEl.style.display = ''; }
        else { imgEl.style.display = 'none'; }
    }
    document.getElementById('battle-end-screen').classList.remove('hidden');
}

// ── PANNELLO STATISTICHE ──────────────────────────────────────────────────────

function apriStatsPanel() {
    const body = document.getElementById('stats-panel-body');
    body.innerHTML = '';
    [['my', Battle.me, 'Tu'], ['opp', Battle.opponent, 'Avversario']].forEach(([prefix, fighter, label]) => {
        if (!fighter) return;
        const pk   = fighter.team[fighter.activeIndex];
        const mods = fighter.fieldMods;
        const stats = pk?.data?.stats || {};
        const section = document.createElement('div');
        section.className = 'stats-fighter-section';
        const params = pk?._params || {};
        const paramRows = [
            { key: 'clash',  label: 'Clash',    base: params.clash  ?? 0 },
            { key: 'evasion', label: 'Evasion', base: params.evasion ?? 0 },
            { key: 'def',    label: 'Def',       base: params.def    ?? 0 },
            { key: 'defSp',  label: 'Def Sp',   base: params.defSp  ?? 0 },
        ].map(({ key, label, base }) => {
            const mod = mods[key] || 0;
            const val = base + mod;
            const cls = mod > 0 ? 'buff' : mod < 0 ? 'debuff' : '';
            const extra = mod !== 0 ? ` (base ${base} ${mod > 0 ? '+' : ''}${mod})` : '';
            return `<div class="stat-row">
                <span class="stat-name">${label}</span>
                <span class="stat-value ${cls}">${val}${extra}</span>
            </div>`;
        }).join('');

        const modRows = [
            { key: 'accuracy',      label: 'Accuracy bonus' },
            { key: 'initiative',    label: 'Iniziativa bonus' },
            { key: 'priorityBonus', label: 'Priority bonus' },
        ].map(({ key, label }) => {
            const mod = mods[key] || 0;
            if (mod === 0) return '';
            const cls = mod > 0 ? 'buff' : 'debuff';
            return `<div class="stat-row">
                <span class="stat-name">${label}</span>
                <span class="stat-value ${cls}">${mod > 0 ? '+' : ''}${mod}</span>
            </div>`;
        }).join('');
        const critMod = mods.critBonus || 0;
        const critThreshold = Math.max(1, 3 - critMod);
        const critCls = critMod > 0 ? 'buff' : critMod < 0 ? 'debuff' : '';
        const critRow = critMod !== 0 ? `<div class="stat-row">
            <span class="stat-name">Crit (−soglia)</span>
            <span class="stat-value ${critCls}">${critMod > 0 ? '+' : ''}${critMod} (soglia: ${critThreshold})</span>
        </div>` : '';
        const hasBattleMods = modRows || critRow;

        section.innerHTML = `
            <div class="stats-fighter-title">${label}: ${pk?.name || '—'}</div>
            ${['Strength','Dexterity','Vitality','Special','Insight'].map(s => {
                const base = stats[s] || 0;
                const mod  = mods[s]  || 0;
                const val  = base + mod;
                const cls  = mod > 0 ? 'buff' : mod < 0 ? 'debuff' : '';
                const extra = mod !== 0 ? ` (base ${base} ${mod > 0 ? '+' : ''}${mod})` : '';
                return `<div class="stat-row">
                    <span class="stat-name">${s}</span>
                    <span class="stat-value ${cls}">${val}${extra}</span>
                </div>`;
            }).join('')}
            <div class="stat-row" style="border-top:1px solid rgba(255,255,255,0.08);margin-top:4px;padding-top:4px;">
                <span class="stat-name" style="opacity:0.5;font-size:0.75rem;">Parametri</span>
            </div>
            ${paramRows}
            ${hasBattleMods ? `
            <div class="stat-row" style="border-top:1px solid rgba(255,255,255,0.08);margin-top:4px;padding-top:4px;">
                <span class="stat-name" style="opacity:0.5;font-size:0.75rem;">Modificatori battaglia</span>
            </div>
            ${modRows}${critRow}` : ''}
            <div class="stat-row" style="border-top:1px solid rgba(255,255,255,0.08);margin-top:4px;padding-top:4px;">
                <span class="stat-name">Status</span>
                <span class="stat-value ${mods.status ? 'debuff' : ''}">${mods.status ? _nomeStatus(mods.status) : '—'}</span>
            </div>
            <div class="stat-row">
                <span class="stat-name">HP</span>
                <span class="stat-value">${pk?.currentHP ?? '—'}/${pk?.maxHP ?? '—'}</span>
            </div>
            <div class="stat-row">
                <span class="stat-name">Iniziativa</span>
                <span class="stat-value">${prefix === 'my' ? Battle.myInitSucc : Battle.oppInitSucc}</span>
            </div>
        `;
        body.appendChild(section);
    });
    document.getElementById('stats-panel').classList.add('open');
    document.getElementById('stats-panel-overlay').classList.add('open');
}

function chiudiStatsPanel() {
    document.getElementById('stats-panel').classList.remove('open');
    document.getElementById('stats-panel-overlay').classList.remove('open');
}

// ── STATO SERIALIZZATO ────────────────────────────────────────────────────────

function _applicaStateDiff(state) {
    if (!state) return;
    if (state.myTeam) {
        state.myTeam.forEach((pk, i) => {
            if (Battle.me.team[i]) {
                Battle.me.team[i].currentHP = pk.currentHP;
                Battle.me.team[i].maxHP     = pk.maxHP;
                if (pk.eliminated !== undefined) Battle.me.team[i].eliminated = pk.eliminated;
            }
        });
    }
    if (state.myFieldMods)  Battle.me.fieldMods  = state.myFieldMods;
    if (state.myKoCount !== undefined) Battle.me.koCount = state.myKoCount;
    if (state.oppTeam) {
        state.oppTeam.forEach((pk, i) => {
            if (Battle.opponent?.team[i]) {
                Battle.opponent.team[i].currentHP = pk.currentHP;
                Battle.opponent.team[i].maxHP     = pk.maxHP;
                if (pk.eliminated !== undefined) Battle.opponent.team[i].eliminated = pk.eliminated;
            }
        });
    }
    if (state.oppFieldMods) Battle.opponent.fieldMods = state.oppFieldMods;
    if (state.oppKoCount !== undefined && Battle.opponent) Battle.opponent.koCount = state.oppKoCount;
}

function _opponentTeamAllFainted() {
    if (!Battle.opponent?.team?.length) return false;
    return !Battle.opponent.team.some(t => !t.eliminated && t.currentHP > 0);
}

function _serializeOpponentFacingState() {
    const fm = Battle.me.fieldMods;
    let oppFieldMods;
    try { oppFieldMods = JSON.parse(JSON.stringify(fm)); }
    catch (e) { oppFieldMods = { ...fm }; }
    return {
        oppTeam: Battle.me.team.map(t => ({
            currentHP:  t.currentHP,
            maxHP:      t.maxHP,
            eliminated: !!t.eliminated,
        })),
        oppFieldMods,
        oppKoCount: Battle.me.koCount,
    };
}

// ── DISCONNESSIONE ────────────────────────────────────────────────────────────

function disconnetti() {
    BattleBridge.disconnect();
    tornaAlTrainer();
}

function tornaAlTrainer() {
    if (typeof MusicManager !== 'undefined') MusicManager.stop();
    if (typeof window.teardownBattleP2P === 'function') window.teardownBattleP2P();
    sessionStorage.removeItem('battle_me');
    sessionStorage.removeItem('battle_opponent');
    sessionStorage.removeItem('battle_role');
    sessionStorage.removeItem('battle_offer');
    sessionStorage.removeItem('battle_answer');
    sessionStorage.removeItem('battle_firstTurn');
    sessionStorage.removeItem('battle_myInit');
    sessionStorage.removeItem('battle_oppInit');
    try {
        if (window.parent !== window && typeof window.parent._exitBattleInline === 'function') {
            window.parent._exitBattleInline();
            return;
        }
    } catch (e) {}
    window.location.href = 'trainer.html';
}

// ── CONSOLE LOG ───────────────────────────────────────────────────────────────

function log(testo, tipo = 'action') {
    const logEl = document.getElementById('battle-log');
    const p = document.createElement('p');
    p.className = `log-entry log-${tipo}`;
    p.textContent = testo;
    logEl.prepend(p);
    while (logEl.children.length > 80) logEl.removeChild(logEl.lastChild);
}

/** Logga localmente E invia LOG_MESSAGE all'avversario (stesso testo su entrambe le console). */
function logBoth(testo, tipo = 'action') {
    log(testo, tipo);
    BattleBridge.send('LOG_MESSAGE', { text: testo });
}

/** Nome del pokemon attivo in campo (usato nei messaggi condivisi). */
function _nomeMePk() {
    return Battle.me.team[Battle.me.activeIndex]?.name || Battle.me.trainerName;
}

// ── DATABASE MOSSE ────────────────────────────────────────────────────────────

let _moveDb = [];

function _caricaMoveDatabase() {
    try {
        const raw = window.moveDatabase || {};
        _moveDb = raw.moveCollection ?? (Array.isArray(raw) ? raw : Object.values(raw));
    } catch (_) {}
}

function _getMoveData(nome) {
    if (!_moveDb.length) _caricaMoveDatabase();
    return _moveDb.find(m =>
        m.Name?.toLowerCase() === nome?.toLowerCase() ||
        m.name?.toLowerCase() === nome?.toLowerCase()
    ) || null;
}

// ── UTILITY ───────────────────────────────────────────────────────────────────

function _nomeOpp() { return Battle.opponent?.trainerName || 'Avversario'; }

function _getPkTypes(pk) {
    const db = window.pokedexDatabase?.find(p => p.Name === pk?.name);
    const t1 = db?.Type1 ?? pk?.data?.Type1;
    const t2 = db?.Type2 ?? pk?.data?.Type2;
    return [t1, t2];
}
// Type ID 2 = Fire
function _isPkFireType(pk) {
    const [t1, t2] = _getPkTypes(pk);
    return t1 === 2 || t2 === 2;
}
// Type ID 8 = Poison, 17 = Steel
function _isPkPoisonImmune(pk) {
    const [t1, t2] = _getPkTypes(pk);
    return t1 === 8 || t2 === 8 || t1 === 17 || t2 === 17;
}
// Type ID 4 = Electric
function _isPkElectricType(pk) {
    const [t1, t2] = _getPkTypes(pk);
    return t1 === 4 || t2 === 4;
}
// Type ID 6 = Ice
function _isPkIceType(pk) {
    const [t1, t2] = _getPkTypes(pk);
    return t1 === 6 || t2 === 6;
}
// Type ID 10 = Flying
function _isPkFlyingType(pk) {
    const [t1, t2] = _getPkTypes(pk);
    return t1 === 10 || t2 === 10;
}
// Type ID 13 = Rock
function _isPkRockType(pk) {
    const [t1, t2] = _getPkTypes(pk);
    return t1 === 13 || t2 === 13;
}
// Type ID 9 = Ground
function _isPkGroundType(pk) {
    const [t1, t2] = _getPkTypes(pk);
    return t1 === 9 || t2 === 9;
}
// Type ID 17 = Steel
function _isPkSteelType(pk) {
    const [t1, t2] = _getPkTypes(pk);
    return t1 === 17 || t2 === 17;
}

function _nomeStatus(s) {
    const MAP = {
        poison: 'Veleno', poison2: 'Veleno Grave',
        burn: 'Bruciatura', burn2: 'Bruciatura 2', burn3: 'Bruciatura 3',
        sleep: 'Sonno', paralysis: 'Paralisi',
        freeze: 'Congelamento', confused: 'Confusione',
        love: 'Innamoramento', flinched: 'Flinch', disabled: 'Mossa Disabilitata',
    };
    return MAP[s] || s || '—';
}

function _siglaStatus(s) {
    const MAP = {
        poison: 'PSN', poison2: 'PSN',
        burn: 'BRN', burn2: 'BRN', burn3: 'BRN',
        sleep: 'SLP', paralysis: 'PAR',
        freeze: 'FRZ', confused: 'CNF',
        love: 'LVE', flinched: 'FLN', disabled: 'DIS',
    };
    return MAP[s] || s?.slice(0,3).toUpperCase() || '?';
}

function _nomeMeteo(w) {
    const MAP = {
        sunny:        'Sunny Weather',
        harsh_sun:    'Harsh Sunlight Weather',
        rain:         'Rain Weather',
        typhoon:      'Typhoon Weather',
        hail:         'Hail Weather',
        strong_winds: 'Strong Winds Weather',
        sandstorm:    'Sandstorm Weather',
    };
    return MAP[w] || w || '—';
}

function _iconaMeteo(w) {
    const MAP = {
        sunny:        '⛅',
        harsh_sun:    '☀️',
        rain:         '🌧️',
        typhoon:      '🌀',
        hail:         '🌨️',
        strong_winds: '💨',
        sandstorm:    '🌪️',
    };
    return MAP[w] || '🌤️';
}
