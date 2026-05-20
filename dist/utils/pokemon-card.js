/* ============================================================
   POKEROLE MANAGER — pokemon-card.js (Mobile-Optimized)
   ============================================================ */

const POKEMON_NATURES = [
    "Adamant(4)", "Bashful(6)", "Bold(9)", "Brave(9)", "Calm(8)", "Hardy(9)",
    "Careful(5)", "Hasty(7)", "Docile(7)", "Impish(7)", "Gentle(10)", "Jolly(10)",
    "Lax(8)", "Naughty(6)", "Lonely(5)", "Quiet(5)", "Mild(8)", "Quirky(9)",
    "Modest(10)", "Rash(6)", "Naive(7)", "Relaxed(8)", "Sassy(7)", "Serious(4)", "Timid(4)"
];

class PokemonCardPopup extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.pokemonData = null;
        this.currentSavedData = {};
        this.internalEditMode = false;
        this.slotIndex = null;
        this.trainerRank = 1;
        this.rankRules = null;
    }

    get skillStructure() {
        return {
            "social_list": ["Tough", "Beauty", "Cool", "Cute", "Clever"],
            "skill_list_1": ["Brawl", "Channel", "Clash", "Evasion"],
            "skill_list_2": ["Alert", "Athletic", "Nature", "Stealth"],
            "skill_list_3": ["Allure", "Etiquette", "Intimidate", "Perform"]
        };
    }

    get typeMap() {
        return {
            "1": "Normal", "2": "Fire", "3": "Water", "4": "Electric", "5": "Grass", "6": "Ice",
            "7": "Fighting", "8": "Poison", "9": "Ground", "10": "Flying", "11": "Psychic",
            "12": "Bug", "13": "Rock", "14": "Ghost", "15": "Dragon", "16": "Dark",
            "17": "Steel", "18": "Fairy"
        };
    }

    getCalculatedStats() {
        const s = (label) => (this.currentSavedData.stats && this.currentSavedData.stats[label]) || (this.pokemonData ? this.pokemonData["Min" + label] : 0);
        const sk = (label) => (this.currentSavedData.skills && this.currentSavedData.skills[label]) || 0;
        return {
            hp:    (this.pokemonData ? this.pokemonData.BaseHP : 0) + s("Vitality"),
            will:  s("Insight") + 2,
            init:  s("Dexterity") + sk("Alert"),
            eva:   s("Dexterity") + sk("Evasion"),
            clash: Math.max(s("Strength"), s("Special")) + sk("Clash"),
            def:   s("Vitality"),
            spdef: s("Insight")
        };
    }

    /* ── RENDER PRINCIPALE ── */
    render() {
        if (!this.pokemonData) return;

        const naturaAttuale = this.currentSavedData.nature || "---";
        const strumentoAttuale = this.currentSavedData.item || "None";
        const descStrumento = this.currentSavedData.itemDescription || "";
        const moveDb = window.moveDatabase || [];

        // Pulisci mosse fuori-rank
        
        // se commentato: 
        // Mosse ereditate dalla forma precedente vengono mantenute
        // anche se non nel movepool attuale — il giocatore le gestisce manualmente
        /* if (this.currentSavedData.moves) {
            const learnable = this.getLearnableMoves();
            this.currentSavedData.moves = this.currentSavedData.moves.map(m =>
                learnable.includes(m) ? m : ""
            );
        } */

        const calc = this.getCalculatedStats();
        const budget = this.checkBudget() || { attr: {spent:0,max:0}, social: {spent:0,max:0}, skills: {spent:0,max:0} };
        const statusColor = (b) => (b && b.spent > b.max) ? 'color:#e74c3c;font-weight:bold;' : 'color:#27ae60;';

        const rankNames = { 0:"Starter", 1:"Beginner", 2:"Amateur", 3:"Ace", 4:"Pro", 5:"Master" };
        const currentRankName = rankNames[this.trainerRank] || "Starter";

        this.shadowRoot.innerHTML = `
        <style>
            /* ── CSS VARIABLES ── */
            :host {
                --pkm-red:    #c0392b;
                --pkm-dark:   #2c3e50;
                --text-black: #111;
                --bg-sheet:   #ffffff;
                --bg-content: #f8f9fa;
                --border-col: #333;
                --accent-gold:#f1c40f;
                /* Touch target minimo */
                --tap: 44px;
            }

            /* ── OVERLAY & SHEET ── */
            .overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.85);
                display: flex; justify-content: center; align-items: flex-end;
                z-index: 9999;
                /* Safe area per bottom sheet */
                padding-bottom: env(safe-area-inset-bottom, 0px);
            }

            /* Su schermi larghi: centrato come modal */
            @media (min-width: 700px) {
                .overlay { align-items: center; padding-bottom: 0; }
                .sheet {
                    border-radius: 16px !important;
                    width: 95% !important;
                    height: auto !important;
                    max-height: 92vh !important;
                }
                .sheet::before { display: none !important; }
            }

            .sheet {
                background: var(--bg-sheet);
                border: none;
                border-radius: 20px 20px 0 0;
                width: 100%;
                max-width: 900px;
                height: 94vh;
                max-height: 94vh;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                overscroll-behavior: contain;
                font-family: 'Nunito', 'Segoe UI', Arial, sans-serif;
                position: relative;
                color: var(--text-black);
                box-shadow: 0 -8px 40px rgba(0,0,0,0.5);
            }

            /* Handle del bottom sheet */
            /* .sheet::before {
                content: '';
                display: block;
                width: 40px; height: 4px;
                background: #ccc;
                border-radius: 2px;
                margin: 12px auto 0;
            } */

            /* ── HEADER ── */
            .header {
                background: var(--pkm-red); color: white;
                padding: 14px 18px;
                display: flex; gap: 14px; align-items: center;
                border-bottom: 3px solid var(--border-col);
                position: sticky; top: 0; z-index: 10;
            }

            .header img {
                width: 60px; height: 60px;
                object-fit: contain;
                filter: drop-shadow(1px 2px 3px rgba(0,0,0,0.4));
                flex-shrink: 0;
            }

            .header h2 {
                margin: 0 0 4px;
                font-size: clamp(1.1rem, 4vw, 1.8rem);
                text-transform: uppercase;
                text-shadow: 1px 1px #000;
                letter-spacing: 1px;
                font-weight: 900;
            }

            .header small {
                background: rgba(0,0,0,0.3);
                padding: 3px 8px;
                border-radius: 5px;
                font-weight: bold;
                font-size: 0.8em;
                display: inline-block;
            }

            .close-btn {
                position: absolute; top: 10px; right: 14px;
                cursor: pointer; font-size: 32px; color: white;
                font-weight: bold; line-height: 1; z-index: 11;
                /* Touch target */
                width: var(--tap); height: var(--tap);
                display: flex; align-items: center; justify-content: center;
                border-radius: 50%;
                -webkit-tap-highlight-color: transparent;
            }

            .close-btn:active { background: rgba(255,255,255,0.2); }

            /* ── CONTENT GRID ── */
            .content {
                padding: 16px;
                background: var(--bg-content);
                display: grid;
                grid-template-columns: 1fr;  /* Mobile: 1 colonna */
                gap: 14px;
            }

            /* Tablet: 2 colonne */
            @media (min-width: 580px) {
                .content { grid-template-columns: 1fr 1fr; }
                .full-width { grid-column: span 2; }
            }

            /* Desktop: 3 colonne */
            @media (min-width: 900px) {
                .content { grid-template-columns: 1.2fr 1fr 1fr; }
                .full-width { grid-column: span 3; }
            }

            .full-width { grid-column: span 1; } /* Default mobile */

            /* ── LANDSCAPE (telefono ruotato) ── */
            @media (orientation: landscape) and (max-height: 500px) {
                /* !important necessario: batte i !important di @media (min-width:700px) */
                .overlay {
                    align-items: center !important;
                    padding: 4px !important;
                }
                .sheet {
                    border-radius: 10px !important;
                    width: 99% !important;
                    height: 97vh !important;
                    max-height: 97vh !important;
                }
                /* Header compatto: recupera altezza per il contenuto */
                .header { padding: 5px 12px !important; }
                .header img { width: 32px !important; height: 32px !important; }
                .header h2 { font-size: 1rem !important; margin: 0 !important; }
                .header small { font-size: 0.72em !important; }
                /* 3 colonne: in landscape la larghezza è sufficiente */
                .content {
                    grid-template-columns: 1.2fr 1fr 1fr !important;
                    padding: 8px !important;
                    gap: 8px !important;
                }
                .full-width { grid-column: span 3 !important; }
                .section { padding: 10px !important; }
                .section-title { margin-bottom: 8px !important; }
                .row { min-height: 32px !important; margin-bottom: 4px !important; }
            }

            /* ── SECTION BOX ── */
            .section {
                background: var(--bg-sheet);
                border: 2px solid #ddd;
                border-radius: 12px;
                padding: 14px;
                height: fit-content;
                box-shadow: 0 2px 6px rgba(0,0,0,0.05);
            }

            .section-title {
                font-size: 0.8em; color: var(--pkm-red); font-weight: 900;
                text-transform: uppercase; margin-bottom: 12px;
                border-bottom: 3px solid var(--pkm-red);
                padding-bottom: 4px; letter-spacing: 0.5px;
            }

            /* ── CALC BOX (parametri) ── */
            .calc-box {
                background: var(--pkm-dark); color: white;
                border: 3px solid #000;
                border-radius: 12px; padding: 14px;
                display: grid; grid-template-columns: 1fr 1fr;
                gap: 8px;
                box-shadow: 0 4px 14px rgba(0,0,0,0.2);
            }

            .calc-box .full-width {
                grid-column: span 2 !important;
                font-size: 0.75em; text-transform: uppercase;
                color: #bdc3c7; font-weight: bold;
                margin-bottom: 4px;
            }

            .calc-item {
                display: flex; justify-content: space-between; align-items: center;
                border-bottom: 1px solid rgba(255,255,255,0.1);
                padding: 5px 4px;
                min-width: 0;
            }

            .calc-item span:first-child {
                font-weight: 700; color: #ecf0f1;
                font-size: 0.88em;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                margin-right: 4px;
            }

            .calc-val {
                font-weight: 900; color: var(--accent-gold);
                font-size: 1.15em; text-shadow: 1px 1px #000;
                flex-shrink: 0;
            }

            /* ── INFO BOX ── */
            .info-box {
                border: 1.5px solid #ddd; padding: 10px;
                border-radius: 8px; background: #fff; color: #333;
                cursor: pointer;
                min-height: var(--tap);
                display: flex; flex-direction: column; justify-content: center;
                -webkit-tap-highlight-color: transparent;
                transition: border-color 0.15s;
            }
            .info-box:active { border-color: var(--pkm-red); background: #fff5f5; }

            /* ── STAT / SKILL ROWS ── */
            .row {
                display: flex; justify-content: space-between; align-items: center;
                margin-bottom: 6px;
                font-size: 0.95em; font-weight: bold; color: var(--text-black);
                /* Touch target minimo */
                min-height: 38px;
            }

            /* ── INPUT / SELECT ── 
               FONDAMENTALE: font-size >= 16px evita lo zoom su iOS! */
            input, select {
                padding: 8px 6px;
                border: 2px solid #ccc;
                border-radius: 8px;
                width: 58px;
                text-align: center;
                font-size: 16px;      /* ← ANTI-ZOOM iOS */
                font-weight: 900;
                font-family: inherit;
                background: #fff; color: #000;
                -webkit-appearance: none;
                appearance: none;
                /* Touch target minimo */
                height: var(--tap);
                line-height: 1;
            }

            input:focus { border-color: var(--pkm-red); outline: none; box-shadow: 0 0 0 3px rgba(192,57,43,0.15); }

            input:disabled, select:disabled {
                border-color: transparent; background: transparent;
                -webkit-appearance: none; appearance: none;
                width: auto; min-width: 28px;
                font-weight: 800; height: auto; padding: 0;
            }

            /* Select mosse / abilità a larghezza piena */
            .move-slot select, .ability-slot select {
                width: 100%; max-width: 100%;
                text-align: left;
                box-sizing: border-box;
                text-overflow: ellipsis;
                white-space: nowrap;
                overflow: hidden;
                height: var(--tap);
                font-size: 15px; /* Non 16 perché sono select a piena larghezza */
            }

            /* ── MOVE GRID ── */
            .move-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
                gap: 12px;
                width: 100%;
            }

            /* Su mobile: 1 colonna */
            @media (max-width: 580px) {
                .move-grid { display: flex; flex-direction: column; }
            }

            .move-slot {
                background: #fff; border: 2px solid #ddd;
                border-radius: 10px; padding: 12px;
                display: flex; flex-direction: column; gap: 6px;
                box-sizing: border-box;
            }

            .swap-row {
                display: flex; align-items: center; gap: 8px;
                margin-top: 10px; flex-wrap: wrap;
            }
            .swap-row select {
                flex: 1; min-width: 0; font-size: 0.82em;
                padding: 4px 6px; border-radius: 6px;
                border: 1.5px solid #ccc; background: #fff;
            }

            .move-slot:focus-within { border-color: var(--pkm-red); }

            .move-details {
                font-size: 0.78em; border-top: 1px solid #eee;
                background: #fff; padding: 8px;
                border-radius: 6px; border: 1px solid #ddd;
                line-height: 1.4;
            }

            /* ── MOVE SECTION ACTIONS ── */
            .move-actions-row {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
                margin-top: 10px;
            }

            .btn-slot-action {
                display: flex; align-items: center; justify-content: center; gap: 5px;
                padding: 0 12px;
                min-height: 42px;
                border: 2px solid var(--pkm-red);
                border-radius: 10px;
                background: #fff;
                color: var(--pkm-red);
                font-weight: 800;
                font-size: 0.82em;
                letter-spacing: 0.2px;
                cursor: pointer;
                font-family: inherit;
                -webkit-tap-highlight-color: transparent;
                transition: background 0.12s, color 0.12s;
                white-space: nowrap;
                box-sizing: border-box;
                width: 100%;
            }
            .btn-slot-action:active {
                background: var(--pkm-red);
                color: #fff;
            }
            .btn-slot-action--primary {
                background: var(--pkm-red);
                color: #fff;
            }
            .btn-slot-action--primary:active {
                background: #a93226;
                color: #fff;
            }

            /* ── ABILITY SLOT ── */
            .ability-slot {
                width: 100%;
                display: flex; flex-direction: column;
                box-sizing: border-box;
                margin-bottom: 14px;
            }

            .ability-slot label {
                font-weight: 900; color: var(--pkm-red);
                font-size: 0.78em; text-transform: uppercase;
                letter-spacing: 0.05em; margin-bottom: 5px;
                display: block;
            }

            /* ── EDIT BUTTON (sticky bottom) ── */
            .btn-edit {
                position: sticky; bottom: calc(14px + env(safe-area-inset-bottom, 0px));
                background: #333; color: #fff;
                border: 3px solid #fff;
                padding: 0 40px;
                height: 50px;
                border-radius: 50px; cursor: pointer;
                font-weight: 900; font-size: 1em;
                font-family: inherit;
                box-shadow: 0 5px 20px rgba(0,0,0,0.45);
                transition: background 0.2s;
                z-index: 100; text-transform: uppercase; letter-spacing: 1px;
                display: block;
                width: fit-content;
                margin: 16px auto 0;
                -webkit-tap-highlight-color: transparent;
                min-width: 200px;
            }

            .btn-edit:active { opacity: 0.85; transform: scale(0.97); }
            .btn-edit.active { background: #27ae60; border-color: #fff; }

            /* Friendship toggle button */
            .btn-friendship {
                width: 100%; background: rgba(255,255,255,0.12);
                border: 1px solid rgba(255,255,255,0.3);
                color: white; padding: 0 10px;
                height: 36px; border-radius: 6px;
                cursor: pointer; font-size: 0.82em;
                font-family: inherit;
                -webkit-tap-highlight-color: transparent;
            }
            .btn-friendship:active { background: rgba(255,255,255,0.22); }

            hr { border: 0; border-top: 1.5px solid #eee; margin: 10px 0; }

            /* ── DICE FAB ── */
            .dice-fab {
                position: fixed;
                top: 70px;
                left: 16px;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                background: #5c6bc0;
                color: white;
                font-size: 1.4rem;
                border: 3px solid white;
                box-shadow: 0 4px 16px rgba(0,0,0,0.4);
                cursor: grab;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10002;
                touch-action: none;
                user-select: none;
                -webkit-tap-highlight-color: transparent;
                transition: box-shadow 0.12s, transform 0.12s;
            }
            .dice-fab.dragging {
                cursor: grabbing;
                box-shadow: 0 8px 28px rgba(0,0,0,0.5);
                transform: scale(1.1);
            }
        </style>

        <button class="dice-fab" title="Dice Roller">🎲</button>
        <div class="overlay">
            <div class="sheet">
                <span class="close-btn" onclick="this.getRootNode().host.remove()">&times;</span>

                <div class="header">
                    <img src="img/pokemon/${this.pokemonData.Name.toLowerCase()}.png" 
                         alt="${this.pokemonData.Name}" 
                         loading="lazy"
                         onerror="this.src='https://via.placeholder.com/60'">
                    <div>
                        <h2>${this.pokemonData.Name}</h2>
                        <small>RANK: ${currentRankName} | BASE HP: ${this.pokemonData.BaseHP}</small>
                    </div>
                </div>

                <div class="content">
                    <!-- COLONNA 1: Attributi + Calc Box -->
                    <div style="display:flex; flex-direction:column; gap:14px;">
                        <div class="section">
                            <div class="section-title">Attributes</div>
                            <div style="font-size:0.8em; margin-bottom:10px; border-bottom:1px dotted #ccc; padding-bottom:6px;">
                                Points: <span id="attr-counter" style="${statusColor(budget.attr)}">${budget.attr.spent} / ${budget.attr.max}</span>
                            </div>
                            ${["Strength","Dexterity","Vitality","Special","Insight"].map(st => this.renderStatRow(st)).join('')}
                        </div>

                        <div class="calc-box">
                            <div style="display:flex; gap:5px; margin-bottom:8px; margin-top:-2px; grid-column:span 2;">
                                ${this.renderTypeBadge(this.pokemonData.Type1)}
                                ${this.pokemonData.Type2 ? this.renderTypeBadge(this.pokemonData.Type2) : ''}
                            </div>
                            <div class="full-width">Parameters <small style="font-weight:400; text-transform:none; var(--pkm-red);">(items & abilities not included)</small></div>
                            <div class="calc-item"><span>HP:</span>         <span class="calc-val">${calc.hp}</span></div>
                            <div class="calc-item"><span>Will:</span>       <span class="calc-val">${calc.will}</span></div>
                            <div class="calc-item"><span>Initiative:</span> <span class="calc-val">${calc.init}</span></div>
                            <div class="calc-item"><span>Evasion:</span>    <span class="calc-val">${calc.eva}</span></div>
                            <div class="calc-item"><span>Clash:</span>      <span class="calc-val">${calc.clash}</span></div>
                            <div class="calc-item"><span>Def:</span>        <span class="calc-val">${calc.def}</span></div>
                            <div class="calc-item"><span>Def Sp:</span>     <span class="calc-val">${calc.spdef}</span></div>
                            <div class="calc-item full-width" style="margin-top:6px; border-top:1px solid rgba(255,255,255,0.2); padding-top:8px;">
                                <button class="btn-friendship" onclick="this.getRootNode().host.toggleFriendship()">
                                    🤝 Friendship
                                </button>
                            </div>
                            <div id="friendship-panel" style="display:none; grid-column:span 2; gap:6px; margin-top:4px;">
                                ${["happiness","loyalty","battles","victories"].map(f => `
                                <div class="calc-item">
                                    <span style="text-transform:capitalize;">${f}</span>
                                    <input type="number" data-friendship="${f}"
                                        min="0" ${f === 'happiness' || f === 'loyalty' ? 'max="5"' : ''}
                                        value="${this.currentSavedData.friendship?.[f] || 0}"
                                        ${this.internalEditMode ? '' : 'disabled'}
                                        inputmode="numeric"
                                        onfocus="this.select()"
                                        onblur="this.getRootNode().host.handleLiveInput(this)"
                                        style="width:44px;">
                                </div>`).join('')}
                            </div>
                        </div>
                    </div>

                    <!-- COLONNA 2: Details + Social -->
                    <div style="display:flex; flex-direction:column; gap:14px;">
                        <div class="section">
                            <div class="section-title">Details & Item</div>
                            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                                <div class="info-box"
                                     style="cursor:${this.internalEditMode ? 'pointer' : 'default'};"
                                     onclick="this.getRootNode().host.openNaturePicker()">
                                    <strong style="font-size:0.7em; color:#888; display:block; text-transform:uppercase; margin-bottom:3px;">Nature</strong>
                                    <span style="font-size:0.9em; font-weight:700;">${naturaAttuale}</span>
                                </div>
                                <div class="info-box"
                                     style="cursor:${this.internalEditMode ? 'pointer' : 'default'};"
                                     onclick="this.getRootNode().host.openItemPicker()">
                                    <strong style="font-size:0.7em; color:#888; display:block; text-transform:uppercase; margin-bottom:3px;">Item</strong>
                                    <span style="font-size:0.9em; font-weight:700;">${strumentoAttuale}</span>
                                </div>
                            </div>
                            ${descStrumento ? `
                                <div style="margin-top:10px; padding:8px 10px; background:#eef7ff; border-left:4px solid #3498db; font-size:0.78em; font-style:italic; color:#2c3e50; border-radius:0 6px 6px 0;">
                                    ${descStrumento}
                                </div>
                            ` : ''}
                            <hr>
                            ${this.renderAbilitySlot()}
                        </div>

                        <div class="section">
                            <div class="section-title">Social</div>
                            <div style="font-size:0.8em; margin-bottom:8px;">
                                Points: <span id="social-counter" style="${statusColor(budget.social)}">${budget.social.spent} / ${budget.social.max}</span>
                            </div>
                            ${this.skillStructure.social_list.map(s => this.renderSkillRow(s, 1, 5)).join('')}
                        </div>
                    </div>

                    <!-- COLONNA 3: Skills -->
                    <div class="section">
                        <div class="section-title">Skills</div>
                        <div style="font-size:0.8em; margin-bottom:8px;">
                            Points: <span id="skills-counter" style="${statusColor(budget.skills)}">${budget.skills.spent} / ${budget.skills.max}</span>
                        </div>
                        ${this.skillStructure.skill_list_1.map(s => this.renderSkillRow(s, 0, 5)).join('')}
                        <hr>
                        ${this.skillStructure.skill_list_2.map(s => this.renderSkillRow(s, 0, 5)).join('')}
                        <hr>
                        ${this.skillStructure.skill_list_3.map(s => this.renderSkillRow(s, 0, 5)).join('')}
                    </div>

                    <!-- MOSSE (full-width) -->
                    <div class="full-width">
                        ${this.renderMovesSection(moveDb)}
                    </div>
                </div>

                <button class="btn-edit ${this.internalEditMode ? 'active' : ''}">
                    ${this.internalEditMode ? '💾 SAVE' : '✎ EDIT POKÉMON'}
                </button>
            </div>
        </div>
        `;

        this.setupEvents();
    }

    /* ── RENDER HELPERS ── */

    renderStatRow(label) {
        const min = this.pokemonData["Min" + label] || 1;
        const max = this.pokemonData["Max" + label] || 5;
        const val = (this.currentSavedData.stats && this.currentSavedData.stats[label]) || min;
        return `
        <div class="row">
            <div style="display:flex; align-items:baseline; gap:4px;">
                <span style="font-size:0.92em;">${label}</span>
                <small style="font-size:0.65em; color:#7f8c8d;">(${min}–${max})</small>
            </div>
            <input type="number" data-stat="${label}"
                value="${val}" min="${min}" max="${max}"
                inputmode="numeric"
                ${this.internalEditMode ? '' : 'disabled'}
                style="width:52px;"
                onfocus="this.select()"
                onblur="this.getRootNode().host.handleLiveInput(this)">
        </div>`;
    }

    renderTypeBadge(typeId) {
        const typeName = this.typeMap[typeId];
        if (!typeName) return '';
        const typeColors = {
            "Normal":"#A8A878","Fire":"#F08030","Water":"#6890F0","Electric":"#F8D030",
            "Grass":"#78C850","Ice":"#98D8D8","Fighting":"#C03028","Poison":"#A040A0",
            "Ground":"#E0C068","Flying":"#A890F0","Psychic":"#F85888","Bug":"#A8B820",
            "Rock":"#B8A038","Ghost":"#705898","Dragon":"#7038F8","Dark":"#705848",
            "Steel":"#B8B8D0","Fairy":"#EE99AC"
        };
        const color = typeColors[typeName] || "#777";
        return `<span style="background:${color}; color:white; padding:3px 10px; border-radius:4px; font-size:0.7em; font-weight:900; text-transform:uppercase; display:inline-block; box-shadow:0 1px 3px rgba(0,0,0,0.2);">${typeName}</span>`;
    }

    renderSkillRow(label, min, max) {
        const budget = this.checkBudget();
        const socialList = this.skillStructure.social_list;
        const effectiveMax = socialList.includes(label) ? max : Math.min(max, budget.maxRank);
        const val = (this.currentSavedData.skills && this.currentSavedData.skills[label]) || min;
        return `
        <div class="row">
            <span>${label}</span>
            <input type="number"
                data-skill="${label}"
                value="${val}" min="${min}" max="${effectiveMax}"
                inputmode="numeric"
                ${this.internalEditMode ? '' : 'disabled'}
                onfocus="this.select()"
                onblur="this.getRootNode().host.handleLiveInput(this)">
        </div>`;
    }

    renderMoveSlot(idx, moveDb) {
        const selectedName = (this.currentSavedData.moves && this.currentSavedData.moves[idx]) || "";
        const moveDetails = moveDb.find(m => m.Name.trim().toLowerCase() === selectedName.trim().toLowerCase());
        const pool = this.getLearnableMoves();

        const getMiniTypeBadge = (typeId) => {
            const typeName = this.typeMap[typeId];
            if (!typeName) return '';
            const typeColors = {
                "Normal":"#A8A878","Fire":"#F08030","Water":"#6890F0","Electric":"#F8D030",
                "Grass":"#78C850","Ice":"#98D8D8","Fighting":"#C03028","Poison":"#A040A0",
                "Ground":"#E0C068","Flying":"#A890F0","Psychic":"#F85888","Bug":"#A8B820",
                "Rock":"#B8A038","Ghost":"#705898","Dragon":"#7038F8","Dark":"#705848",
                "Steel":"#B8B8D0","Fairy":"#EE99AC"
            };
            return `<span style="background:${typeColors[typeName]||'#777'}; color:white; padding:1px 5px; border-radius:3px; font-size:9px; vertical-align:middle; font-weight:900;">${typeName.toUpperCase()}</span>`;
        };

        const getVal = (name) => {
            if (!name) return 0;
            const n = name.trim();
            if (this.currentSavedData.stats?.[n] !== undefined) return this.currentSavedData.stats[n];
            if (this.currentSavedData.skills?.[n] !== undefined) return this.currentSavedData.skills[n];
            if (this.pokemonData["Min" + n]) return this.pokemonData["Min" + n];
            return 0;
        };

        let accuracyTotal = 0, damageTotal = 0;
        if (moveDetails) {
            accuracyTotal = getVal(moveDetails.Accuracy1) + getVal(moveDetails.Accuracy2);
            damageTotal = getVal(moveDetails.Damage1) + (parseInt(moveDetails.Power) || 0);
        }

        const rankNames = { 0:"Starter", 1:"Beginner", 2:"Amateur", 3:"Ace", 4:"Pro", 5:"Master" };

        return `
        <div class="move-slot">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                <select data-slot="${idx}"
                    ${this.internalEditMode ? '' : 'disabled'}
                    style="flex:1;"
                    onchange="this.getRootNode().host.handleLiveInput()">
                    <option value="">-- Empty --</option>
                    ${selectedName && !pool.includes(selectedName) 
                        ? `<option value="${selectedName}" selected>${selectedName}</option>` 
                        : ''}
                    ${pool.map(m => {
                        const moveEntry = this.pokemonData.Moves.find(mv => mv.Name === m);
                        const rankLabel = moveEntry ? `[${rankNames[moveEntry.LearnedRank] || 'R?'}] ` : '';
                        const isSelected = m === selectedName;
                        return `<option value="${m}" ${isSelected ? 'selected' : ''}>${isSelected ? m : rankLabel + m}</option>`;
                    }).join('')}
                </select>
                ${moveDetails ? getMiniTypeBadge(moveDetails.Type) : ''}
                ${idx >= 4 && this.internalEditMode ? `<button onclick="this.getRootNode().host.removeMoveSlot(${idx})" style="background:none;border:none;color:#e74c3c;font-size:1.2em;cursor:pointer;padding:0 2px;flex-shrink:0;line-height:1;" title="Rimuovi slot">×</button>` : ''}
            </div>
            ${moveDetails ? `
                <div class="move-details">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-bottom:5px;">
                        <span><strong>PWR:</strong> ${moveDetails.Power}</span>
                        <span><strong>CAT:</strong> ${moveDetails.Category}
                            <img src="img/other/${moveDetails.Category.toLowerCase()}.png"
                                 style="width:28px; height:18px; object-fit:contain; vertical-align:middle;"
                                 onerror="this.style.display='none'" loading="lazy">
                        </span>
                        <span style="grid-column:span 2; background:#f1c40f; color:#000; padding:3px 6px; border-radius:4px; font-weight:bold;">
                            🎯 ACCURACY: ${accuracyTotal} <small>(${moveDetails.Accuracy1} + ${moveDetails.Accuracy2})</small>
                        </span>
                        <span style="grid-column:span 2; background:#e74c3c; color:#fff; padding:3px 6px; border-radius:4px; font-weight:bold;">
                            ⚔️ DAMAGE: ${damageTotal} <small>(${moveDetails.Damage1} + PWR)</small>
                        </span>
                        <span style="grid-column:span 2;"><strong>TARGET:</strong> ${moveDetails.Target}</span>
                    </div>
                    <div style="border-top:1px solid #eee; padding-top:6px; line-height:1.4;">
                        <strong>Effetto:</strong> <span style="color:#444;">${moveDetails.Effect}</span>
                    </div>
                </div>
            ` : `<div style="font-size:0.78em; color:#999; text-align:center; padding:10px;">Select a move...</div>`}
        </div>`;
    }

    renderAbilitySlot() {
        const selectedAbilityName = this.currentSavedData.ability || "";
        const abilitiesList = [];
        if (this.pokemonData.Ability1?.Name)       abilitiesList.push(this.pokemonData.Ability1.Name);
        if (this.pokemonData.Ability2?.Name)       abilitiesList.push(this.pokemonData.Ability2.Name);
        if (this.pokemonData.HiddenAbility?.Name)  abilitiesList.push(this.pokemonData.HiddenAbility.Name + " (Hidden)");

        const possibleAbilities = [...new Set(abilitiesList)].filter(n => n.trim() !== "");
        const searchName = selectedAbilityName.replace(" (Hidden)", "").trim().toLowerCase();
        const abilityDetails = (this.internalAbilityDb || []).find(a =>
            a.abilityName?.trim().toLowerCase() === searchName
        );

        return `
        <div class="ability-slot">
            <label>Ability</label>
            <select data-ability
                ${this.internalEditMode ? '' : 'disabled'}
                onchange="this.getRootNode().host.handleLiveInput(); this.getRootNode().host.render()">
                <option value="">-- Select Ability --</option>
                ${possibleAbilities.map(name =>
                    `<option value="${name}" ${name === selectedAbilityName ? 'selected' : ''}>${name}</option>`
                ).join('')}
            </select>
            ${abilityDetails ? `
                <div style="margin-top:8px;">
                    <details ${this.internalEditMode ? 'open' : ''} style="border:1px solid #d1d8e0; border-radius:6px; overflow:hidden;">
                        <summary style="padding:8px 10px; font-size:0.78em; font-weight:800; cursor:pointer; background:#ebf5fb; color:#2980b9; user-select:none; min-height:40px; display:flex; align-items:center;">
                            ℹ️ ${this.internalEditMode ? 'Ability Details' : 'Info'}
                        </summary>
                        <div style="padding:10px; border-top:1px solid #d1d8e0;">
                            <div style="font-size:0.82em; line-height:1.5; color:#2c3e50; margin-bottom:8px;">
                                <strong>Effetto:</strong> ${abilityDetails.effect}
                            </div>
                            <div style="font-size:0.76em; line-height:1.4; color:#7f8c8d; font-style:italic; border-top:1px dotted #ccc; padding-top:5px; margin-top:5px;">
                                ${abilityDetails.description || "None."}
                            </div>
                        </div>
                    </details>
                </div>
            ` : ''}
        </div>`;
    }

    /* ── LOGICA INPUT & VALIDAZIONE ── */

    clampInput(input) {
        const min = parseInt(input.min) ?? 0;
        const max = parseInt(input.max) ?? 5;
        let val = parseInt(input.value);
        if (isNaN(val)) val = min;
        val = Math.min(Math.max(val, min), max);

        if (input.hasAttribute('data-skill')) {
            const socialList = this.skillStructure.social_list;
            const budget = this.checkBudget();

            if (socialList.includes(input.dataset.skill)) {
                let spesiAltreSocial = 0;
                this.shadowRoot.querySelectorAll('[data-skill]').forEach(i => {
                    if (i !== input && socialList.includes(i.dataset.skill)) {
                        spesiAltreSocial += (parseInt(i.value) || 1) - 1;
                    }
                });
                const maxConsentito = 1 + Math.max(0, budget.social.max - spesiAltreSocial);
                if (val > maxConsentito) val = maxConsentito;
                if (val < 1) val = 1;
            } else {
                let spesiAltreSkill = 0;
                this.shadowRoot.querySelectorAll('[data-skill]').forEach(i => {
                    if (i !== input && !socialList.includes(i.dataset.skill)) {
                        spesiAltreSkill += parseInt(i.value) || 0;
                    }
                });
                const maxConsentito = budget.skills.max - spesiAltreSkill;
                if (val > maxConsentito) val = Math.max(0, maxConsentito);
            }
        }

        if (input.hasAttribute('data-stat')) {
            const budget = this.checkBudget();
            let spesiAltreAttr = 0;
            this.shadowRoot.querySelectorAll('[data-stat]').forEach(i => {
                if (i !== input) {
                    const minI = parseInt(i.getAttribute('min')) || 0;
                    const valI = parseInt(i.value) || minI;
                    spesiAltreAttr += (valI - minI);
                }
            });
            const minThis = parseInt(input.getAttribute('min')) || 0;
            const maxBonus = budget.attr.max - spesiAltreAttr;
            const maxConsentito = minThis + Math.max(0, maxBonus);
            if (val > maxConsentito) val = maxConsentito;
        }

        input.value = val;
    }

    handleLiveInput(changedInput) {
        if (changedInput) this.clampInput(changedInput);
        this.saveData();

        // Aggiorna valori calcolati senza full re-render
        const calc = this.getCalculatedStats();
        const vals = this.shadowRoot.querySelectorAll('.calc-val');
        if (vals.length >= 7) {
            vals[0].innerText = calc.hp;
            vals[1].innerText = calc.will;
            vals[2].innerText = calc.init;
            vals[3].innerText = calc.eva;
            vals[4].innerText = calc.clash;
            vals[5].innerText = calc.def;
            vals[6].innerText = calc.spdef;
        }

        // Aggiorna contatori budget
        const budget = this.checkBudget();
        const attrCounter = this.shadowRoot.querySelector('#attr-counter');
        if (attrCounter) {
            attrCounter.innerText = `${budget.attr.spent} / ${budget.attr.max}`;
            attrCounter.style.color = budget.attr.spent > budget.attr.max ? '#e74c3c' : '#27ae60';
        }
        const socialCounter = this.shadowRoot.querySelector('#social-counter');
        if (socialCounter) {
            socialCounter.innerText = `${budget.social.spent} / ${budget.social.max}`;
            socialCounter.style.color = budget.social.spent > budget.social.max ? '#e74c3c' : '#27ae60';
        }
        const skillsCounter = this.shadowRoot.querySelector('#skills-counter');
        if (skillsCounter) {
            skillsCounter.innerText = `${budget.skills.spent} / ${budget.skills.max}`;
            skillsCounter.style.color = budget.skills.spent > budget.skills.max ? '#e74c3c' : '#27ae60';
        }

        this.updateCalculatedFields();
    }

    updateCalculatedFields() {
        // Hook disponibile per estensioni future
    }

    setupEvents() {
        const editBtn = this.shadowRoot.querySelector('.btn-edit');
        if (editBtn) {
            editBtn.onclick = () => {
                if (this.internalEditMode) {
                    this.saveData();
                    this.internalEditMode = false;
                } else {
                    this.internalEditMode = true;
                }
                this.render();
            };
        }

        const fab = this.shadowRoot.querySelector('.dice-fab');
        if (fab) {
            let dragging = false;
            let startPX, startPY, startLeft, startTop;
            const THRESHOLD = 6;

            fab.addEventListener('pointerdown', e => {
                e.preventDefault();
                fab.setPointerCapture(e.pointerId);
                startPX = e.clientX;
                startPY = e.clientY;
                const r = fab.getBoundingClientRect();
                startLeft = r.left;
                startTop = r.top;
                dragging = false;
            });

            fab.addEventListener('pointermove', e => {
                const dx = e.clientX - startPX;
                const dy = e.clientY - startPY;
                if (!dragging && Math.hypot(dx, dy) > THRESHOLD) {
                    dragging = true;
                    fab.classList.add('dragging');
                }
                if (!dragging) return;
                fab.style.left = Math.max(0, Math.min(window.innerWidth  - 50, startLeft + dx)) + 'px';
                fab.style.top  = Math.max(0, Math.min(window.innerHeight - 50, startTop  + dy)) + 'px';
            });

            fab.addEventListener('pointerup', () => {
                fab.classList.remove('dragging');
                if (!dragging && window.apriDiceRoller) window.apriDiceRoller();
                dragging = false;
            });
        }
    }

    renderMovesSection(moveDb) {
        const totalSlots = Math.max(4, (this.currentSavedData.moves || []).length);
        const slotOpts = (selIdx) => Array.from({length: totalSlots}, (_, i) => {
            const n = (this.currentSavedData.moves && this.currentSavedData.moves[i]) || '';
            return `<option value="${i}" ${i === selIdx ? 'selected' : ''}>Slot ${i+1}${n ? ': ' + n : ' (vuoto)'}</option>`;
        }).join('');
        return `
        <div class="section">
            <div class="section-title">Moves <small style="font-weight:400; text-transform:none; var(--pkm-red);">(parameters/items/abilities not included)</small></div>
            <div class="move-grid">
                ${Array.from({length: totalSlots}, (_, i) => this.renderMoveSlot(i, moveDb)).join('')}
            </div>
            ${this.internalEditMode ? `
            <div class="swap-row">
                <select id="swap-a">${slotOpts(0)}</select>
                <span style="font-size:1.1em;">↔</span>
                <select id="swap-b">${slotOpts(1)}</select>
                <button class="btn-slot-action" onclick="this.getRootNode().host.swapSlots()" style="white-space:nowrap;width:auto;padding:0 14px;">↕ Scambia</button>
            </div>
            <div class="move-actions-row">
                <button class="btn-slot-action" onclick="this.getRootNode().host.addMoveSlot()">+ Aggiungi Slot</button>
                <button class="btn-slot-action btn-slot-action--primary" onclick="this.getRootNode().host.openMTModal()">📖 MT</button>
            </div>
            ` : ''}
        </div>`;
    }

    swapSlots() {
        const a = parseInt(this.shadowRoot.getElementById('swap-a').value);
        const b = parseInt(this.shadowRoot.getElementById('swap-b').value);
        if (a === b) return;
        if (!this.currentSavedData.moves) this.currentSavedData.moves = ['', '', '', ''];
        const tmp = this.currentSavedData.moves[a] || '';
        this.currentSavedData.moves[a] = this.currentSavedData.moves[b] || '';
        this.currentSavedData.moves[b] = tmp;
        this.render();
        this.saveData();
    }

    addMoveSlot() {
        if (!this.currentSavedData.moves) this.currentSavedData.moves = ['', '', '', ''];
        this.currentSavedData.moves.push('');
        this.render();
        this.saveData();
    }

    removeMoveSlot(idx) {
        if (!this.currentSavedData.moves || idx < 4) return;
        this.currentSavedData.moves.splice(idx, 1);
        this.render();
        this.saveData();
    }

    async openMTModal() {
        if (!window.learnsetDatabase) {
            try {
                const resp = await fetch('utils/json/learnsets.json');
                window.learnsetDatabase = await resp.json();
            } catch (e) {
                alert('Errore nel caricamento del learnset.');
                return;
            }
        }

        const normalize = str => str.toLowerCase().replace(/[^a-z0-9]/g, '');
        let pokeName = normalize(this.pokemonData.Name);
        let learnset = window.learnsetDatabase[pokeName];
        if (!learnset) {
            const baseName = normalize(this.pokemonData.Name.split(' - ')[0]);
            learnset = window.learnsetDatabase[baseName];
        }
        if (!learnset || learnset.length === 0) {
            alert(`Nessun learnset trovato per ${this.pokemonData.Name}.`);
            return;
        }

        const moveDb = window.moveDatabase || [];
        const entries = learnset.map(id => ({
            id,
            move: moveDb.find(m => normalize(m.Name) === id) || null
        }));

        const typeMap = this.typeMap;
        const typeColors = {
            "Normal":"#A8A878","Fire":"#F08030","Water":"#6890F0","Electric":"#F8D030",
            "Grass":"#78C850","Ice":"#98D8D8","Fighting":"#C03028","Poison":"#A040A0",
            "Ground":"#E0C068","Flying":"#A890F0","Psychic":"#F85888","Bug":"#A8B820",
            "Rock":"#B8A038","Ghost":"#705898","Dragon":"#7038F8","Dark":"#705848",
            "Steel":"#B8B8D0","Fairy":"#EE99AC"
        };

        let selectedEntry = null;

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:Nunito,Segoe UI,Arial,sans-serif;';

        const modal = document.createElement('div');
        modal.style.cssText = 'background:#fff;border-radius:14px;max-width:440px;width:100%;max-height:82vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.4);';

        const header = document.createElement('div');
        header.style.cssText = 'background:#c0392b;color:white;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
        const headerTitle = document.createElement('span');
        headerTitle.style.cssText = 'font-weight:800;font-size:1.05em;';
        headerTitle.textContent = `MT — ${this.pokemonData.Name}`;
        const closeX = document.createElement('span');
        closeX.textContent = '×';
        closeX.style.cssText = 'cursor:pointer;font-size:26px;line-height:1;padding:2px 8px;border-radius:50%;';
        header.appendChild(headerTitle);
        header.appendChild(closeX);

        const searchWrap = document.createElement('div');
        searchWrap.style.cssText = 'padding:10px 14px 6px;flex-shrink:0;';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Cerca mossa...';
        searchInput.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #ddd;border-radius:8px;font-size:0.88em;outline:none;';
        searchWrap.appendChild(searchInput);

        const errorLabel = document.createElement('div');
        errorLabel.style.cssText = 'color:#c0392b;font-size:0.82em;font-weight:bold;padding:0 14px 4px;min-height:18px;flex-shrink:0;';

        const list = document.createElement('div');
        list.style.cssText = 'flex:1;overflow-y:auto;padding:0 8px 8px;';

        const renderList = (filter) => {
            list.innerHTML = '';
            const lc = filter.toLowerCase();
            const filtered = entries.filter(e => (e.move ? e.move.Name : e.id).toLowerCase().includes(lc));
            if (filtered.length === 0) {
                list.innerHTML = '<div style="text-align:center;color:#999;padding:20px;font-size:0.85em;">Nessuna mossa trovata.</div>';
                return;
            }
            filtered.forEach(entry => {
                const item = document.createElement('div');
                const isSelected = selectedEntry === entry;
                const hasData = !!entry.move;
                item.style.cssText = `display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:${hasData ? 'pointer' : 'default'};margin-bottom:3px;border:1.5px solid ${isSelected ? '#c0392b' : '#eee'};background:${isSelected ? '#fdf0ee' : (hasData ? '#fff' : '#f9f9f9')};`;

                const nameSpan = document.createElement('span');
                nameSpan.style.cssText = `flex:1;font-size:0.87em;font-weight:${hasData ? '600' : '400'};color:${hasData ? '#222' : '#aaa'};`;
                nameSpan.textContent = entry.move ? entry.move.Name : entry.id;
                item.appendChild(nameSpan);

                if (hasData) {
                    const tName = typeMap[String(entry.move.Type)];
                    const tColor = typeColors[tName] || '#777';
                    const badge = document.createElement('span');
                    badge.style.cssText = `background:${tColor};color:white;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:900;flex-shrink:0;`;
                    badge.textContent = (tName || '?').toUpperCase();
                    item.appendChild(badge);
                    const catBadge = document.createElement('span');
                    catBadge.style.cssText = 'font-size:9px;color:#555;background:#eee;border-radius:4px;padding:1px 5px;flex-shrink:0;';
                    catBadge.textContent = entry.move.Category;
                    item.appendChild(catBadge);
                } else {
                    const nd = document.createElement('span');
                    nd.style.cssText = 'font-size:9px;color:#e67e22;background:#fef9e7;border:1px solid #f0c070;border-radius:4px;padding:1px 5px;flex-shrink:0;';
                    nd.title = 'Non presente nel database';
                    nd.textContent = 'N/D';
                    item.appendChild(nd);
                }

                item.addEventListener('click', () => {
                    if (!hasData) {
                        errorLabel.textContent = `"${entry.id}" non è presente nel database delle mosse.`;
                        return;
                    }
                    selectedEntry = entry;
                    errorLabel.textContent = '';
                    renderList(searchInput.value);
                });
                list.appendChild(item);
            });
        };

        renderList('');
        searchInput.addEventListener('input', () => {
            selectedEntry = null;
            renderList(searchInput.value);
        });

        const footer = document.createElement('div');
        footer.style.cssText = 'padding:12px 14px;border-top:1px solid #eee;display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Annulla';
        cancelBtn.style.cssText = 'padding:8px 18px;border-radius:8px;border:1.5px solid #ccc;background:#f8f8f8;cursor:pointer;font-size:0.9em;';

        const teachBtn = document.createElement('button');
        teachBtn.textContent = '✓ Insegna';
        teachBtn.style.cssText = 'padding:8px 18px;border-radius:8px;border:none;background:#c0392b;color:white;font-weight:bold;cursor:pointer;font-size:0.9em;';

        const close = () => overlay.remove();
        cancelBtn.addEventListener('click', close);
        closeX.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        teachBtn.addEventListener('click', () => {
            if (!selectedEntry) {
                errorLabel.textContent = 'Seleziona prima una mossa.';
                return;
            }
            if (!selectedEntry.move) {
                errorLabel.textContent = `"${selectedEntry.id}" non è presente nel database.`;
                return;
            }
            this._teachMTMove(selectedEntry.move.Name);
            close();
        });

        footer.appendChild(cancelBtn);
        footer.appendChild(teachBtn);
        modal.appendChild(header);
        modal.appendChild(searchWrap);
        modal.appendChild(errorLabel);
        modal.appendChild(list);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        setTimeout(() => searchInput.focus(), 50);
    }

    _teachMTMove(moveName) {
        if (!this.currentSavedData.moves) this.currentSavedData.moves = ['', '', '', ''];
        const emptyIdx = this.currentSavedData.moves.indexOf('');
        if (emptyIdx !== -1) {
            this.currentSavedData.moves[emptyIdx] = moveName;
        } else {
            this.currentSavedData.moves.push(moveName);
        }
        this.render();
        this.saveData();
    }

    saveData() {
        const stats = {};
        this.shadowRoot.querySelectorAll('[data-stat]').forEach(i => {
            stats[i.dataset.stat] = parseInt(i.value) || 0;
        });

        const skills = {};
        this.shadowRoot.querySelectorAll('[data-skill]').forEach(i => {
            skills[i.dataset.skill] = parseInt(i.value) || 0;
        });

        const moves = [];
        this.shadowRoot.querySelectorAll('[data-slot]').forEach(s => moves.push(s.value));

        const abSelect = this.shadowRoot.querySelector('[data-ability]');
        const selectedAbility = abSelect ? abSelect.value : (this.currentSavedData.ability || "");

        const friendship = {};
        this.shadowRoot.querySelectorAll('[data-friendship]').forEach(i => {
            friendship[i.dataset.friendship] = parseInt(i.value) || 0;
        });

        const detail = {
            index: this.slotIndex,
            data: {
                stats, skills, moves,
                ability: selectedAbility,
                nature: this.currentSavedData.nature || "",
                item: this.currentSavedData.item || "",
                itemDescription: this.currentSavedData.itemDescription || "",
                friendship,
                baseHP: this.pokemonData?.BaseHP || 0,
            }
        };

        this.currentSavedData = detail.data;
        this.dispatchEvent(new CustomEvent('updatePokemon', { detail, bubbles: true, composed: true }));
    }

    /* ── API PUBBLICA ── */

    open(pokemonName, pkmDb, moveDb, savedData, index, rank, abilityDb, rankRules) {
        this.pokemonData = pkmDb.find(p => p.Name === pokemonName);
        this.currentSavedData = savedData || {};
        this.slotIndex = index;
        this.trainerRank = rank;
        window.moveDatabase = moveDb;
        this.internalAbilityDb = abilityDb || [];
        this.rankRules = rankRules;
        this.render();
        document.body.appendChild(this);
    }

    checkBudget() {
        const fallback = { attr:{spent:0,max:0}, social:{spent:0,max:0}, skills:{spent:0,max:0}, maxRank:5 };
        if (!this.pokemonData || !this.rankRules) return fallback;

        const rankNames = ["Starter","Beginner","Amateur","Ace","Pro","Master"];
        const rankKey = rankNames[this.trainerRank] || "Starter";
        const rules = this.rankRules[rankKey] || fallback;

        let spentAttr = 0;
        ["Strength","Dexterity","Vitality","Special","Insight"].forEach(st => {
            const val = (this.currentSavedData.stats?.[st]) || (this.pokemonData["Min" + st] || 0);
            spentAttr += val - (this.pokemonData["Min" + st] || 0);
        });

        let spentSocial = 0;
        this.skillStructure.social_list.forEach(s => {
            const val = (this.currentSavedData.skills?.[s]) || 1;
            spentSocial += val - 1;
        });

        let spentSkills = 0;
        const allSkills = [
            ...this.skillStructure.skill_list_1,
            ...this.skillStructure.skill_list_2,
            ...this.skillStructure.skill_list_3
        ];
        allSkills.forEach(s => {
            spentSkills += (this.currentSavedData.skills?.[s]) || 0;
        });

        return {
            attr:   { spent: spentAttr,   max: rules.bonus_attr    },
            social: { spent: spentSocial, max: rules.bonus_social   },
            skills: { spent: spentSkills, max: rules.skill_points   },
            maxRank: rules.max_skill_rank
        };
    }

    openNaturePicker() {
        if (!this.internalEditMode) return;
        const scelta = prompt("Scegli una Natura:\n" + POKEMON_NATURES.join(", "));
        if (!scelta) return;
        const naturaTrovata = POKEMON_NATURES.find(n =>
            n.toLowerCase().startsWith(scelta.toLowerCase().trim())
        );
        if (naturaTrovata) {
            this.currentSavedData.nature = naturaTrovata;
            this.saveData();
            this.render();
        } else {
            alert("Natura non valida! Riprova scrivendo uno dei nomi suggeriti.");
        }
    }

    openItemPicker() {
        if (!this.internalEditMode) return;
        const isMega = this.pokemonData?.Evolutions?.length === 0 &&
        window.pokedexDatabase?.some(p =>
            p.Evolutions?.some(e => e.To === this.pokemonData.DexID && e.Kind === "Mega")
        );
        if (isMega) {
            alert("Non puoi cambiare l'oggetto di una Mega Evoluzione!");
            return;
        }
        const db = window.itemDatabase || [];
        if (db.length === 0) { alert("Database strumenti non caricato!"); return; }

        const ricerca = prompt("Cerca uno strumento:");
        if (!ricerca) return;

        const risultati = db.filter(i => i.Name.toLowerCase().includes(ricerca.toLowerCase()));
        if (risultati.length > 0) {
            const item = risultati[0];
            this.currentSavedData.item = item.Name;
            this.currentSavedData.itemDescription = item.Description;
            this.render();
            this.handleLiveInput();
        } else {
            alert("Nessuno strumento trovato.");
        }
    }

    toggleFriendship() {
        const panel = this.shadowRoot.getElementById('friendship-panel');
        if (panel) panel.style.display = (panel.style.display === 'none') ? 'contents' : 'none';
    }

    getLearnableMoves() {
        if (!this.pokemonData?.Moves) return [];
        return this.pokemonData.Moves
            .filter(m => m.LearnedRank <= this.trainerRank)
            .map(m => m.Name)
            .sort();
    }
}

customElements.define('pokemon-card-popup', PokemonCardPopup);
