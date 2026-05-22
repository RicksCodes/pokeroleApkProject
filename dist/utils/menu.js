/* ============================================================
   POKEROLE MANAGER — menu.js (Mobile-Optimized)
   ============================================================ */
async function _shareJSON(filename, data) {
    const json = JSON.stringify(data, null, 2);
    try {
        if (navigator.share && navigator.canShare) {
            const file = new File([json], filename, { type: 'application/json' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: filename });
                return;
            }
        }
    } catch(err) {
        if (err.name === 'AbortError') return; // utente ha annullato
    }
    _downloadJSON(filename, json);
}

async function _downloadJSON(filename, json) {
    // Prova 1: Capacitor Filesystem → Documents (funziona su Android 10+ senza permessi speciali)
    if (window.Capacitor?.Plugins?.Filesystem) {
        try {
            await Capacitor.Plugins.Filesystem.writeFile({
                path: filename,
                data: json,
                directory: 'DOCUMENTS',
                encoding: 'utf8',
                recursive: true,
            });
            alert(`✅ File salvato in Documenti/${filename}`);
            return;
        } catch(err) {
            console.warn('Filesystem DOCUMENTS fallito:', err);
        }
    }

    // Prova 2: Capacitor Share (mostra il dialog di condivisione di sistema)
    if (window.Capacitor?.Plugins?.Share) {
        try {
            await Capacitor.Plugins.Share.share({
                title: filename,
                text: json,
                dialogTitle: 'Salva o condividi ' + filename,
            });
            return;
        } catch(e) {
            if (e.name === 'AbortError') return;
            console.warn('Share plugin fallito:', e);
        }
    }

    // Prova 3: download browser standard (funziona su emulatore e browser)
    try {
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch(e) {
        alert('Export fallito: ' + e.message);
    }
}


class CustomMenu extends HTMLElement {
    constructor() {
        super();
        try { this.attachShadow({ mode: 'open' }); }
        catch(e) { console.error('Shadow DOM non supportato', e); }
    }

    connectedCallback() {
        this._root = this.shadowRoot || this;
        if (!this.shadowRoot) this.innerHTML = '';
        this.render();
    }

    getTrainers() {
        return JSON.parse(localStorage.getItem('pokeRole_Trainers')) || [];
    }

    attivaSelezioneExport() {
        const cards = document.querySelectorAll('.trainer-card');
        if (cards.length === 0) return;
        if (document.getElementById('floating-export-btn')) return;

        cards.forEach((card, index) => {
            card.style.position = 'relative';

            const check = document.createElement('div');
            check.className = 'export-checkbox-ui';
            check.dataset.index = index;
            check.dataset.checked = 'false';
            check.style.cssText = `
                position:absolute; top:-10px; right:-10px;
                width:28px; height:28px; z-index:999;
                border-radius:50%;
                border:3px solid var(--accent-color,#1877f2);
                background:white;
                display:flex; align-items:center; justify-content:center;
                font-size:16px; cursor:pointer;
                box-shadow:0 2px 6px rgba(0,0,0,0.2);
                -webkit-tap-highlight-color:transparent;
            `;
            check.innerHTML = '';

            const _toggleCheck = () => {
                const isChecked = check.dataset.checked === 'true';
                check.dataset.checked = isChecked ? 'false' : 'true';
                check.innerHTML = isChecked ? '' : '✓';
                check.style.background = isChecked ? 'white' : '#28a745';
                check.style.borderColor = isChecked ? 'var(--accent-color,#1877f2)' : '#28a745';
                check.style.color = 'white';
            };
            // touchend con preventDefault sopprime il click sintetico su mobile
            check.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                _toggleCheck();
            }, { passive: false });
            // click gestisce emulatore e desktop (su mobile non scatta grazie al preventDefault sopra)
            check.addEventListener('click', (e) => {
                e.stopPropagation();
                _toggleCheck();
            });
            card.appendChild(check);
        });

        this.creaTastoFlottante();
    }
    creaTastoFlottante() {
        const btn = document.createElement('button');
        btn.id = 'floating-export-btn';
        btn.innerHTML = "📥 Esporta Selezionati";
        btn.style.cssText = `
            position:fixed;
            bottom:calc(24px + env(safe-area-inset-bottom,0px));
            right:calc(20px + env(safe-area-inset-right,0px));
            padding:0 24px; height:52px;
            background:var(--accent-color,#1877f2);
            color:white; border:none; border-radius:26px;
            font-weight:800; font-size:15px;
            box-shadow:0 4px 20px rgba(0,0,0,0.35);
            cursor:pointer; z-index:10000;
            font-family:'Nunito','Segoe UI',sans-serif;
            -webkit-tap-highlight-color:transparent;
        `;

        btn.addEventListener('click', async () => {
            const checks = document.querySelectorAll('.export-checkbox-ui');
            const selezionati = [];
            const dati = this.getTrainers();

            checks.forEach(check => {
                if (check.dataset.checked === 'true') {
                    selezionati.push(dati[parseInt(check.dataset.index)]);
                }
            });

            if (selezionati.length === 0) {
                alert('Seleziona almeno un trainer!');
                return;
            }

            await _shareJSON('pokeRole_selection.json', selezionati);
            this.rimuoviSelezioneUI();
        });

        document.body.appendChild(btn);
    }

    rimuoviSelezioneUI() {
        const btn = document.getElementById('floating-export-btn');
        if (btn) btn.remove();

        document.querySelectorAll('.trainer-card').forEach(card => {
            card.style.outline = "";
            const check = card.querySelector('.export-checkbox-ui');
            if (check) check.remove();
        });
    }

    render() {
        this._root.innerHTML = `
        <style>
            .dropdown { position:relative; display:inline-block; font-family:'Nunito','Segoe UI',sans-serif; }

            .dropbtn {
                background:var(--card-bg,#ffffff); color:var(--text-color,#1c1e21);
                border:1.5px solid var(--border-color,#dddfe2); padding:0 16px;
                height:44px; min-width:44px; border-radius:10px; cursor:pointer;
                font-weight:800; font-size:15px; display:flex; align-items:center; gap:6px;
                -webkit-tap-highlight-color:transparent; transition:background 0.15s;
                font-family:'Nunito','Segoe UI',sans-serif;
            }

            .dropdown-content {
                display:none; position:absolute;
                background-color:var(--card-bg,#ffffff); min-width:200px;
                box-shadow:0 8px 24px rgba(0,0,0,0.2); z-index:9999;
                border-radius:14px; border:1.5px solid var(--border-color,#dddfe2);
                top:calc(100% + 8px); left:0; overflow:hidden;
                max-height:70vh; overflow-y:auto; -webkit-overflow-scrolling:touch;
                touch-action:manipulation;
            }

            .dropdown-content.show { display:block; }

            /* ---- stile unificato per <a> e <button> negli item ---- */
            .menu-item a, .menu-item .menu-btn {
                color:var(--text-color,#1c1e21); padding:14px 18px;
                text-decoration:none; display:flex; align-items:center; gap:10px;
                font-size:0.95rem; font-weight:600; cursor:pointer; min-height:48px;
                -webkit-tap-highlight-color:transparent; transition:background 0.1s;
                /* reset button */
                background:none; border:none; width:100%; text-align:left;
                font-family:'Nunito','Segoe UI',sans-serif; box-sizing:border-box;
            }

            .menu-item a:active, .menu-item .menu-btn:active {
                background-color:var(--hover-bg,#f2f2f2);
            }

            @media (hover:hover) and (pointer:fine) {
                .menu-item a:hover, .menu-item .menu-btn:hover {
                    background-color:var(--hover-bg,#f2f2f2);
                }
                .dropbtn:hover { background:var(--hover-bg,#f2f2f2); }
            }

            .menu-item label {
                color:var(--text-color,#1c1e21); padding:14px 18px;
                display:flex; align-items:center; gap:10px;
                font-size:0.95rem; font-weight:600; cursor:pointer; min-height:48px;
                -webkit-tap-highlight-color:transparent; transition:background 0.1s;
                box-sizing:border-box; width:100%;
            }

            .menu-item label:active { background-color:var(--hover-bg,#f2f2f2); }

            .menu-sep { height:1px; background:var(--border-color,#dddfe2); margin:4px 0; }

            .dark-mode-container {
                padding:14px 18px; display:flex; align-items:center;
                justify-content:space-between; min-height:48px;
            }

            .mode-label { font-size:0.9rem; font-weight:700; color:var(--text-color); }

            .theme-switch { position:relative; display:inline-block; width:50px; height:26px; flex-shrink:0; }
            .theme-switch input { opacity:0; width:0; height:0; }
            .slider {
                position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0;
                background-color:#ccc; transition:.3s; border-radius:34px;
            }
            .slider:before {
                position:absolute; content:""; height:20px; width:20px;
                left:3px; bottom:3px; background-color:white; transition:.3s; border-radius:50%;
            }
            input:checked + .slider { background-color:#1877f2; }
            input:checked + .slider:before { transform:translateX(24px); }
        </style>

        <div class="dropdown">
            <button class="dropbtn" aria-label="Menu">☰ Tools</button>
            <div id="dropdown-menu" class="dropdown-content" role="menu">
                <div class="menu-item">
                    <button class="menu-btn" id="home-btn" role="menuitem">🏠 Home</button>
                </div>
                <div class="menu-item">
                    <button class="menu-btn" id="dice-btn" role="menuitem">🎲 Dice Roller</button>
                </div>
                <div class="menu-item">
                    <button class="menu-btn" id="type-chart-btn" role="menuitem">📊 Type Chart</button>
                </div>
                <div class="menu-item">
                    <button class="menu-btn" id="battle-steps-btn" role="menuitem">⚔️ Battle Steps</button>
                </div>
                <div class="menu-item">
                    <button class="menu-btn" id="multiplayer-btn" role="menuitem">🆚 Multiplayer Battle</button>
                </div>
                <div class="menu-item">
                    <button class="menu-btn" id="coming-soon-1-btn" role="menuitem">📋 Combat Notes</button>
                </div>
                <div class="menu-item">
                    <button class="menu-btn" id="coming-soon-2-btn" role="menuitem">🤒 Status Conditions</button>
                </div>
                <div class="menu-item">
                    <button class="menu-btn" id="legal-btn" role="menuitem">⚖️ Legal Notice</button>
                </div>
                <div class="menu-sep"></div>
                <div class="menu-item">
                    <button class="menu-btn" id="export-btn" role="menuitem">📤 Export JSON</button>
                </div>
                <div class="menu-item">
                    <label for="import-input" role="menuitem">📥 Import JSON</label>
                    <input type="file" id="import-input" accept=".json" style="display:none">
                </div>
                <div class="menu-sep"></div>
                <div class="dark-mode-container">
                    <span class="mode-label">Dark Mode</span>
                    <label class="theme-switch">
                        <input type="checkbox" id="theme-toggle" aria-label="Attiva dark mode">
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
        </div>
        `;
        this.setupEventListeners();
    }

    setupEventListeners() {
        const menu      = this._root.querySelector('#dropdown-menu');
        const btn       = this._root.querySelector('.dropbtn');
        const toggle    = this._root.querySelector('#theme-toggle');
        const homeBtn   = this._root.querySelector('#home-btn');
        const diceBtn   = this._root.querySelector('#dice-btn');
        const typeChartBtn    = this._root.querySelector('#type-chart-btn');
        const battleStepsBtn  = this._root.querySelector('#battle-steps-btn');
        const multiplayerBtn  = this._root.querySelector('#multiplayer-btn');
        const exportBtn       = this._root.querySelector('#export-btn');
        const importInput     = this._root.querySelector('#import-input');
        const comingSoon1Btn  = this._root.querySelector('#coming-soon-1-btn');
        const comingSoon2Btn  = this._root.querySelector('#coming-soon-2-btn');
        const legalBtn        = this._root.querySelector('#legal-btn');

        // Toggle menu apri/chiudi
        btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('show'); });

        // Chiudi cliccando/toccando fuori — usa this (il custom element host) per Shadow DOM
        document.addEventListener('click', (e) => {
            if (!this.contains(e.target)) menu.classList.remove('show');
        });
        document.addEventListener('touchstart', (e) => {
            if (!this.contains(e.target)) menu.classList.remove('show');
        }, { passive: true });

        // Impedisce che click interni al menu lo chiudano subito
        menu.addEventListener('click', (e) => e.stopPropagation());

        // Dark Mode
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            toggle.checked = true;
            document.documentElement.setAttribute('data-theme', 'dark');
        }
        toggle.addEventListener('change', () => {
            const isDark = toggle.checked;
            document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });

        // Home — usa window.location.href per compatibilità Capacitor
        homeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            menu.classList.remove('show');
            window.location.href = 'index.html';
        });

        // Dice Roller
        diceBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.apriDiceRoller) window.apriDiceRoller();
            menu.classList.remove('show');
        });

        // Type Chart
        typeChartBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.apriTypeChart) window.apriTypeChart();
            menu.classList.remove('show');
        });

        // Battle Steps
        battleStepsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.apriBattleSteps) window.apriBattleSteps();
            menu.classList.remove('show');
        });

        // Multiplayer Battle
        multiplayerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            menu.classList.remove('show');
            if (window.apriBattleLobby) {
                window.apriBattleLobby();
            } else {
                alert('⚔️ Apri prima un allenatore per accedere al Multiplayer!');
            }
        });

        // Combat Notes
        comingSoon1Btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.apriCombatNotes) window.apriCombatNotes();
            menu.classList.remove('show');
        });

        // Status Conditions
        comingSoon2Btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.apriStatusConditions) window.apriStatusConditions();
            menu.classList.remove('show');
        });

        // Legal Notice
        legalBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.apriLegalNotice) window.apriLegalNotice();
            menu.classList.remove('show');
        });

        // Export — rilevamento pagina compatibile con Capacitor (file://)
        exportBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    menu.classList.remove('show');

    const isTrainerPage = (typeof window._isTrainerPage !== 'undefined' && window._isTrainerPage)
        || document.title.toLowerCase().includes('trainer')
        || window.location.href.includes('trainer');

    if (isTrainerPage) {
        if (typeof currentTrainer !== 'undefined' && currentTrainer !== null) {
            await _shareJSON(`Trainer_${currentTrainer.nome}.json`, [currentTrainer]);
        } else {
            alert("Nessun dato allenatore da esportare.");
        }
    } else {
        this.attivaSelezioneExport();
    }
});

        // Import
        importInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (re) => {
                try {
                    const importati = JSON.parse(re.target.result);
                    const lista = Array.isArray(importati) ? importati : [importati];
                    let attuali = this.getTrainers();
                    lista.forEach(nuovo => {
                        const idx = attuali.findIndex(a => a.id === nuovo.id);
                        if (idx !== -1) attuali[idx] = nuovo;
                        else attuali.push(nuovo);
                    });
                    localStorage.setItem('pokeRole_Trainers', JSON.stringify(attuali));
                    window.dispatchEvent(new Event('trainersUpdated'));
                    window.location.reload();
                } catch(err) {
                    console.error("Errore import:", err);
                    alert("Errore nel formato del file JSON");
                }
                e.target.value = "";
            };
            reader.readAsText(file);
            menu.classList.remove('show');
        });
    }
}

customElements.define('custom-menu', CustomMenu);

/* ============================================================
   DICE ROLLER
   ============================================================ */

function rollDice(faces) {
    const container = document.getElementById('dice-results-container');
    if (!container) return;
    const die = document.createElement('div');
    die.className = 'die-bubble rolling';
    die.innerText = "...";
    container.prepend(die);
    setTimeout(() => {
        die.innerText = Math.floor(Math.random() * faces) + 1;
        die.classList.remove('rolling');
        die.setAttribute('data-faces', 'd' + faces);
    }, 300);
    die.addEventListener('click', () => {
        die.style.transition = "transform 0.18s, opacity 0.18s";
        die.style.transform = "scale(0)";
        die.style.opacity = "0";
        setTimeout(() => die.remove(), 200);
    });
}

function pulisciDadi() {
    const c = document.getElementById('dice-results-container');
    if (c) c.innerHTML = "";
}

window.apriDiceRoller  = () => { const m = document.getElementById('modal-dice'); if (m) m.style.display = "flex"; };
window.chiudiDiceRoller = () => { const m = document.getElementById('modal-dice'); if (m) m.style.display = "none"; };

/* ============================================================
   MODAL HELPER — usa CSS vars per dark mode + accordion manuale
   ============================================================ */

function _creaModalInfo(id, titolo, contenuto) {
    let modal = document.getElementById(id);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = id;
        modal.style.cssText = `
            display:none; position:fixed; top:0; left:0; width:100%; height:100%;
            background:rgba(0,0,0,0.7); z-index:9999; justify-content:center;
            align-items:flex-end; padding-bottom:env(safe-area-inset-bottom,0px);
        `;
        modal.innerHTML = `
            <div style="
                background:var(--card-bg,#fff); border-radius:20px 20px 0 0;
                width:100%; max-width:680px; max-height:88vh;
                overflow-y:auto; -webkit-overflow-scrolling:touch;
                padding:20px 20px calc(20px + env(safe-area-inset-bottom,0px));
                position:relative; font-family:'Nunito','Segoe UI',sans-serif;
                color:var(--text-color,#1c1e21); overscroll-behavior:contain;
                box-sizing:border-box;
            ">
                <div style="width:36px;height:4px;background:var(--border-color,#ccc);border-radius:2px;margin:0 auto 16px;"></div>
                <button id="${id}-close"
                    style="position:absolute;top:20px;right:16px;background:none;border:none;
                    font-size:26px;cursor:pointer;color:var(--text-color);width:44px;height:44px;
                    display:flex;align-items:center;justify-content:center;border-radius:22px;
                    -webkit-tap-highlight-color:transparent;">
                    &times;
                </button>
                <h2 style="margin-bottom:16px;font-size:1.3em;font-weight:900;padding-right:40px;color:var(--text-color,#1c1e21);">${titolo}</h2>
                <div id="${id}-body" style="display:flex;flex-direction:column;gap:12px;">
                    ${contenuto}
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector(`#${id}-close`).addEventListener('click', () => { modal.style.display = 'none'; });
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

        // Accordion manuale: gestisce tutti i .accordion-header dentro questo modal
        modal.addEventListener('click', (e) => {
            const hdr = e.target.closest('.accordion-header');
            if (!hdr) return;
            const body = hdr.nextElementSibling;
            const arrow = hdr.querySelector('.acc-arrow');
            const isOpen = body.style.display === 'block';
            body.style.display = isOpen ? 'none' : 'block';
            if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
        });
    }
    modal.style.display = 'flex';
}

/* Helper per creare card info con sfondo/bordo che rispettano dark mode */
function _card(borderColor, icon, title, text) {
    return `
    <div style="background:var(--hover-bg,#f2f2f2);border-left:4px solid ${borderColor};padding:12px;border-radius:8px;">
        <strong style="color:${borderColor};">${icon} ${title}</strong>
        <p style="margin:8px 0 0;font-size:0.9em;line-height:1.6;color:var(--text-color,#1c1e21);">${text}</p>
    </div>`;
}

/* Helper accordion (sostituisce <details> non affidabili su Android WebView) */
function _accordion(icon, title, innerHtml) {
    return `
    <div style="border:1px solid var(--border-color,#dddfe2);border-radius:8px;overflow:hidden;">
        <div class="accordion-header" style="
            cursor:pointer;font-weight:800;padding:12px 14px;
            background:var(--hover-bg,#f2f2f2);min-height:48px;
            display:flex;align-items:center;justify-content:space-between;
            color:var(--text-color,#1c1e21);user-select:none;-webkit-user-select:none;
            -webkit-tap-highlight-color:transparent;">
            <span>${icon} ${title}</span>
            <span class="acc-arrow" style="transition:transform 0.2s;font-size:0.85em;">▶</span>
        </div>
        <div style="display:none;padding:12px;display:none;flex-direction:column;gap:8px;
            background:var(--card-bg,#fff);">
            ${innerHtml}
        </div>
    </div>`;
}

/* ============================================================
   TYPE CHART
   ============================================================ */

window.apriTypeChart = function() {
    _creaModalInfo('modal-type-chart', '📊 Type Chart', `
        <img src="img/other/table.png" style="width:100%;border-radius:10px;margin-bottom:8px;" alt="Type Chart">
        ${_card('#27ae60','🛡️','Resistances','All Pokémon Types (except Normal) can resist certain Move Types, reducing 1 point from the total damage received.')}
        ${_card('#e74c3c','⚡','Weaknesses','All Pokémon are weak to certain Move Types. Super Effective hits deal 1 additional damage, but the roll MUST score at least 1 Success.')}
        ${_card('#8e44ad','✨','Immunities','Some Pokémon Types are Immune to specific Types of damage. They receive no damage from those attacks.')}
        ${_card('#f39c12','⚖️','Double Resistance / Weakness','Two types may share a resistance or weakness, doubling the bonus/penalty for dual-type Pokémon.')}
    `);
};

/* ============================================================
   BATTLE STEPS
   ============================================================ */

window.apriBattleSteps = function() {
    _creaModalInfo('modal-battle-steps', '⚔️ Battling Step by Step', `
        ${_card('#1877f2','','Step 1: Initiative','<em>"Pikachu, I choose you!"</em><br>Roll 1 Die + Initiative score (<strong>Dexterity + Alert</strong>). Highest result goes first.')}
        ${_card('#27ae60','','Step 2: Use a Move','<em>"Pikachu, use Thunderbolt!"</em><br>Order your Pokémon to use a Move. Roll the dice for <strong>Accuracy</strong>.')}
        ${_card('#f39c12','','Step 2.5: Evasion / Clash (Optional)','Evasion: Roll <strong>Dexterity + Evasion</strong>. Match opponent\'s successes to dodge.<br>Clash: Roll <strong>Strength/Special + Clash</strong>. Match to both take 1 damage instead.')}
        ${_card('#e74c3c','','Step 3: Damage','Roll damage pool: <strong>Strength/Special + Move Power - Foe DEF/SDEF</strong>.')}
        ${_card('#8e44ad','','Step 4: Next Pokémon','Next in initiative order acts. Repeat Steps 2–3 until everyone has gone.')}
        ${_card('#1877f2','','End of Round','Apply end-of-round effects, then start a new round. Trainers can act at the end of each round.')}
    `);
};

/* ============================================================
   COMBAT NOTES
   ============================================================ */

window.apriCombatNotes = function() {
    const weatherRows = [
        ['#f39c12','☀️ Sunny','Fire +1 die; Water -1 dmg; No Frozen.'],
        ['#1877f2','🌧️ Rain','Water +1 die; Fire -1 dmg; Easier to heal Burns.'],
        ['#795548','🌪️ Sandstorm','1 dmg/round to non-Rock/Ground/Steel; Rock SpDef +1.'],
        ['#e74c3c','🔥 Harsh Sun','Fire +1 die; Water moves FAIL; Cancels other weather.'],
        ['#1565c0','🌊 Typhoon','Water +1 die; Fire moves FAIL; No Burns; Cancels other weather.'],
        ['#455a64','💨 Strong Winds','Flying +1 die; Electric/Ice/Rock deal neutral to Flying; Cancels other weather.'],
        ['#0288d1','🌨️ Hail','1 dmg/round to non-Ice; Ice Def +1.'],
    ].map(([c,n,t]) => `
        <div style="background:var(--hover-bg,#f2f2f2);border-left:3px solid ${c};padding:10px;border-radius:6px;color:var(--text-color,#1c1e21);">
            <strong style="color:${c};">${n}</strong> — ${t}
        </div>`).join('');

    const trainerActions = `
        <div style="display:flex;flex-direction:column;gap:8px;font-size:0.9em;line-height:1.6;color:var(--text-color,#1c1e21);">
            <p><strong>Switch Pokémon</strong>: Recall/send up to 2. Mid-round switch = dazed for 1 round.</p>
            <p><strong>Use Item</strong>: Roll <strong>Clever + Medicine</strong>. Pokémon must stay still for the round.</p>
            <p><strong>Search Cover</strong>: Roll <strong>Insight + Alert</strong>. 1/4 cover +1, 1/2 cover +2, full = destroy cover.</p>
            <p><strong>Enter Fray</strong>: Join battle next round. Cannot give orders while fighting.</p>
            <p><strong>Run Away</strong>: Recall Pokémon + roll <strong>Dexterity + Athletic</strong> vs foe. Win = escape.</p>
        </div>`;

    _creaModalInfo('modal-combat-notes', '📋 Combat Notes', `
        <div style="background:var(--hover-bg,#f2f2f2);border-left:4px solid var(--border-color,#555);padding:12px;border-radius:8px;">
            <strong style="color:var(--text-color,#1c1e21);">📌 Key Rules</strong>
            <p style="margin:8px 0 0;font-size:0.9em;line-height:1.7;color:var(--text-color,#1c1e21);">
                A <strong>Round</strong> ≈ 10 seconds. A <strong>Turn</strong> is when a Pokémon uses its action.<br><br>
                Each success on Damage = <strong>1 point of damage</strong>. A hit always deals minimum 1 damage.<br><br>
                <strong style="color:#930909;">Heal: 1 HP every 8 hours</strong>. Fainting = unconscious for ~8 hours.<br><br>
                <strong>STAB</strong>: Same Type Attack Bonus adds +1 Bonus Die to damage.<br><br>
                <strong>Critical Hit</strong>: 3+ extra successes on Accuracy → +2 dice damage.<br>
                <strong>High-Critical</strong>: Only 2 extra successes needed.<br><br>
                <strong>Healing cap in battle</strong>: Max 3 HP/round (Complete Heal: 5 HP/round).<br><br>
                HP penalty: Full HP = 0 removed successes; Half HP = -1; 1 HP = -2.
            </p>
        </div>
        ${_accordion('🌦️','Weather Conditions', weatherRows)}
        ${_accordion('🔄','Trainer Actions (End of Round)', trainerActions)}
    `);
};

/* ============================================================
   STATUS CONDITIONS
   ============================================================ */

window.apriStatusConditions = function() {
    const statuses = [
        ['#e74c3c','🔥','Burn 1','Immune: Fire-type. Deals 1 damage/round. Cure: Dexterity+Athletic (4 successes).'],
        ['#c0392b','🔥🔥','Burn 2','Immune: Fire-type. Deals 2 Lethal damage/round. Cure: Dexterity+Athletic (6 successes).'],
        ['#922b21','🔥🔥🔥','Burn 3','Immune: Fire-type. Deals 3 Lethal damage/round. Cure: Dexterity+Athletic (8 successes).'],
        ['#d4ac0d','⚡','Paralysis','Immune: Electric-type. -2 Dexterity, half speed. Duration: 24 hours.'],
        ['#1877f2','🧊','Frozen Solid','Immune: Ice-type. Cannot act. Ice block has 5 HP (Def/SpDef 2). Super-effective hits break it instantly.'],
        ['#8e44ad','☠️','Poison','Immune: Poison/Steel-type. 1 damage/round (1/hour if resting). Continues outside battle! Cure: Medical attention.'],
        ['#6a1b9a','☠️☠️','Badly Poisoned','Immune: Poison/Steel-type. 1 Lethal damage/round. Continues outside battle — risk of death! Cure: Medical attention.'],
        ['#455a64','💤','Sleep','Cannot act. Resist: Insight (5 successes to wake, costs action). Duration: 5 minutes.'],
        ['#555','😨','Flinched','Cannot be resisted. Lose next action. Duration: 1 Action.'],
        ['#e67e22','😵','Confused','Resist: Insight (2+ successes = act normally). -1 success to all rolls; fail = 1 self-damage. Duration: 5 rounds.'],
        ['#555','🚫','Disabled','Cannot be resisted. One move disabled. Duration: 5 rounds to 1 scene.'],
        ['#e91e63','💕','In Love','Immune: same gender/genderless. Resist: Insight (2+). Deals half damage to beloved. Duration: 1 scene.'],
    ].map(([c,ico,name,text]) => `
        <div style="background:var(--hover-bg,#f2f2f2);border-left:4px solid ${c};padding:12px;border-radius:8px;">
            <strong style="color:${c};">${ico} ${name}</strong>
            <p style="margin:6px 0 0;font-size:0.88em;line-height:1.6;color:var(--text-color,#1c1e21);">${text}</p>
        </div>`).join('');

    _creaModalInfo('modal-status-conditions', '🤒 Status Conditions', statuses);
};

/* ============================================================
   LEGAL NOTICE
   ============================================================ */

window.apriLegalNotice = function() {
    const readmeUrl = 'https://github.com/RicksCodes/pokeroleApkProject/blob/main/README.md';

    function _openLink(url) {
        if (window.Capacitor?.Plugins?.Browser) {
            Capacitor.Plugins.Browser.open({ url });
        } else {
            window.open(url, '_blank');
        }
    }

    _creaModalInfo('modal-legal-notice', '⚖️ Legal Notice', `
        <div style="background:var(--hover-bg,#f2f2f2);border-left:4px solid #e74c3c;padding:14px;border-radius:8px;">
            <p style="margin:0 0 10px;font-size:0.95em;line-height:1.7;color:var(--text-color,#1c1e21);">
                This is a <strong>non-profit, fan-made application</strong> created purely for entertainment purposes,
                born after receiving the Pokérole book PDF without knowing anything about it,
                with the hope that it can help those who, like me, didn't understand much and always forget something.
            </p>
            <p style="margin:0 0 10px;font-size:0.9em;line-height:1.7;color:var(--text-color,#1c1e21);">
                All media assets used (including sprites, images, and music) are property of their respective owners
                and were sourced from online databases or directly from the games.
                <strong>No copyright infringement is intended.</strong>
            </p>
            <p style="margin:0;font-size:0.9em;line-height:1.7;color:var(--text-color,#1c1e21);">
                My original contributions are strictly limited to the HTML, CSS, and JS source code.
            </p>
        </div>
        <div style="text-align:center;margin-top:4px;">
            <button onclick="(${_openLink.toString()})('${readmeUrl}')"
                style="
                    display:inline-flex;align-items:center;gap:8px;
                    background:#24292e;color:#fff;border:none;border-radius:10px;
                    padding:12px 20px;font-size:0.95em;font-weight:700;cursor:pointer;
                    font-family:'Nunito','Segoe UI',sans-serif;
                    -webkit-tap-highlight-color:transparent;
                ">
                📖 Read full README on GitHub
            </button>
        </div>
    `);
};