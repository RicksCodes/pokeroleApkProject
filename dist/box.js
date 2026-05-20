// ============================================================
//  PC BOX — box.js
//  Slot stile pokeball identici al team attivo
// ============================================================

let boxSlotSelezionato = null;

// ── Apertura / Chiusura ───────────────────────────────────────
function apriBox() {
    if (!currentTrainer.box)     currentTrainer.box     = [];
    if (!currentTrainer.boxData) currentTrainer.boxData = {};
    document.getElementById('modal-box').style.display = 'flex';
    renderBox();
}

function chiudiBox() {
    document.getElementById('modal-box').style.display = 'none';
    boxSlotSelezionato = null;
}

// ── Render griglia ────────────────────────────────────────────
function renderBox() {
    if (!currentTrainer.box)     currentTrainer.box     = [];
    if (!currentTrainer.boxData) currentTrainer.boxData = {};

    const grid = document.getElementById('box-grid');
    grid.innerHTML = '';

    // Slot esistenti — stessa classe ball-slot del team
    currentTrainer.box.forEach((nome, i) => {
        grid.appendChild(creaBoxSlot(i, nome));
    });

    // Slot "aggiungi" vuoto sempre alla fine
    const addSlot = document.createElement('div');
    addSlot.className = 'ball-slot';
    addSlot.title = 'Aggiungi Pokémon al Box';
    addSlot.innerHTML = '<span style="opacity:0.3; font-size:1.2rem; pointer-events:none;">+</span>';
    addSlot.onclick = () => apriBoxPokedex();
    grid.appendChild(addSlot);

    // Aggiorna badge header
    const badge = document.getElementById('box-count');
    if (badge) badge.textContent = currentTrainer.box.length;
}



function creaBoxSlot(index, nome) {
    const slot = document.createElement('div');
    slot.className = 'ball-slot occupied';

    const img = document.createElement('img');
    img.src = `img/pokemon/${nome.toLowerCase()}.png`;
    img.alt = nome;
    img.className = 'pokemon-icon';
    img.onerror = () => { img.style.display = 'none'; };
    slot.appendChild(img);

    slot.onclick = (e) => {
        e.stopPropagation();
        if (editMode) {
            apriModalSceltaBox(index, nome);
        } else {
            boxVediPokemon(index);
        }
    };

    return slot;
}

// ── Modal scelta (stile identico a modal-scelta-pokemon del team) ──
function apriModalSceltaBox(index, nome) {
    boxSlotSelezionato = index;
    document.getElementById('modal-scelta-box')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'modal-scelta-box';
    overlay.style.cssText = `
        position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.6);
        display:flex; align-items:center; justify-content:center; z-index:9000;
    `;
    overlay.innerHTML = `
        <div style="background:var(--sheet-bg); padding:20px; border-radius:10px;
                    text-align:center; border:2px solid var(--border-color);">
            <h4 style="margin-bottom:15px;">What do you want to do with ${nome}?</h4>
            <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:center;">
                <button onclick="chiudiModalSceltaBox(); boxVediPokemon(${index})"
                    style="background:#1877f2; color:white; padding:10px; border:none; border-radius:6px; cursor:pointer;">
                    👁 View
                </button>
                <button onclick="chiudiModalSceltaBox(); apriBoxPokedexSostituisci(${index})"
                    style="background:#f0a500; color:white; padding:10px; border:none; border-radius:6px; cursor:pointer;">
                    🔄 Change
                </button>
                <button onclick="chiudiModalSceltaBox(); boxSpostaInTeam(${index})"
                    style="background:#28a745; color:white; padding:10px; border:none; border-radius:6px; cursor:pointer;">
                    ⇄ Move to Team
                </button>
                <button onclick="chiudiModalSceltaBox(); boxEliminaPokemon(${index})"
                    style="background:#dc3545; color:white; padding:10px; border:none; border-radius:6px; cursor:pointer;">
                    🗑 Remove
                </button>
                <button onclick="chiudiModalSceltaBox()"
                    style="background:#6c757d; color:white; padding:10px; border:none; border-radius:6px; cursor:pointer;">
                    Annulla
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}

function chiudiModalSceltaBox() {
    document.getElementById('modal-scelta-box')?.remove();
}

// ── Azioni ────────────────────────────────────────────────────

// Vedi scheda — riusa pokemon-card-popup identicamente al team
function boxVediPokemon(index) {
    const nome = currentTrainer.box[index];
    if (!nome || !window.pokedexDatabase || !window.moveDatabase) return;

    const rankMap = { "Starter": 0, "Beginner": 1, "Amateur": 2, "Ace": 3, "Pro": 4, "Master": 5 };
    const trainerRankValue = rankMap[currentTrainer.rango] || 0;

    const popup = document.createElement('pokemon-card-popup');
    const savedData = (currentTrainer.boxData && currentTrainer.boxData[index]) || {};

    popup.open(
        nome,
        window.pokedexDatabase,
        window.moveDatabase,
        savedData,
        'box_' + index,
        trainerRankValue,
        window.abilityDatabase,
        (typeof ranksData !== 'undefined' && ranksData ? ranksData.ranks : null)
    );

    popup.addEventListener('updatePokemon', (e) => {
        const { index: slotKey, data } = e.detail;
        const boxIdx = parseInt(String(slotKey).replace('box_', ''));
        if (!currentTrainer.boxData) currentTrainer.boxData = {};
        currentTrainer.boxData[boxIdx] = data;
        salvaBox();
    });

    document.body.appendChild(popup);
}

// Elimina dal box
function boxEliminaPokemon(index) {
    const nome = currentTrainer.box[index];
    if (!confirm(`Vuoi davvero rimuovere ${nome} dal Box?\nTutti i suoi dati andranno persi.`)) return;

    currentTrainer.box.splice(index, 1);

    const newBoxData = {};
    Object.keys(currentTrainer.boxData || {}).forEach(k => {
        const ki = parseInt(k);
        if (ki < index)      newBoxData[ki]     = currentTrainer.boxData[ki];
        else if (ki > index) newBoxData[ki - 1] = currentTrainer.boxData[ki];
    });
    currentTrainer.boxData = newBoxData;

    salvaBox();
    renderBox();
}

// ── Sposta nel Team — picker visivo con le vere pokeball ─────
function boxSpostaInTeam(index) {
    boxSlotSelezionato = index;
    apriTeamPickerPerBox(currentTrainer.box[index]);
}

function apriTeamPickerPerBox(nomePokemonBox) {
    document.getElementById('box-team-picker')?.remove();

    if (!currentTrainer.team) currentTrainer.team = ["","","","","",""];

    // Costruiamo le ball del team come div identici a .ball-slot
    const slotsHTML = currentTrainer.team.map((pkmn, i) => {
        const isOccupied = pkmn && pkmn !== "";
        const imgTag = isOccupied
            ? `<img src="img/pokemon/${pkmn.toLowerCase()}.png" class="pokemon-icon" style="width:80%;height:80%;object-fit:contain;pointer-events:none;">`
            : `<div style="position:absolute;top:50%;left:50%;width:10px;height:10px;
                           background:white;border:2px solid #222;border-radius:50%;
                           transform:translate(-50%,-50%);pointer-events:none;"></div>`;

        const ballBg = isOccupied
            ? `background:rgba(255,255,255,0.1);border:2px solid #1877f2;`
            : `background:linear-gradient(to bottom,#ff1c1c 45%,#222 45%,#222 55%,#fff 55%);border:3px solid #444;`;

        return `
            <div onclick="boxConfermaSposta(${boxSlotSelezionato}, ${i})"
                 title="${isOccupied ? pkmn : 'Slot libero'}"
                 style="
                    width:100%; aspect-ratio:1/1; border-radius:50%;
                    ${ballBg}
                    cursor:pointer; display:flex; align-items:center; justify-content:center;
                    overflow:hidden; position:relative;
                    transition:transform 0.2s, border-color 0.2s;
                 "
                 onmouseenter="this.style.transform='scale(1.1)'; this.style.borderColor='#1877f2';"
                 onmouseleave="this.style.transform='scale(1)'; this.style.borderColor='${isOccupied ? '#1877f2' : '#444'}';"
            >${imgTag}</div>
        `;
    }).join('');

    const overlay = document.createElement('div');
    overlay.id = 'box-team-picker';
    overlay.style.cssText = `
        position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.75);
        display:flex; align-items:center; justify-content:center; z-index:10000;
        padding:16px; box-sizing:border-box;
    `;
    overlay.innerHTML = `
        <div style="background:var(--sheet-bg,#1a1a2e); border:2px solid var(--accent-blue,#1877f2);
                    border-radius:16px; padding:20px; text-align:center;
                    color:var(--text-color,#fff); width:100%; max-width:360px; box-sizing:border-box;">
            <h3 style="margin:0 0 6px; color:var(--accent-blue,#1877f2);">Scegli uno slot del Team</h3>
            <p style="margin:0 0 16px; opacity:0.65; font-size:0.85em;">
                Stai spostando <strong>${nomePokemonBox}</strong><br>
                <span style="font-size:0.8em;">Slot libero → entra nel team &nbsp;|&nbsp; Slot occupato → scambio</span>
            </p>
            <div style="display:grid; grid-template-columns:repeat(6,1fr); gap:8px; margin-bottom:18px;">
                ${slotsHTML}
            </div>
            <button onclick="document.getElementById('box-team-picker').remove()"
                style="padding:6px 22px; background:transparent; border:1px solid #888;
                       color:#aaa; border-radius:8px; cursor:pointer;">
                Annulla
            </button>
        </div>
    `;
    document.body.appendChild(overlay);
}

function boxConfermaSposta(boxIndex, teamIndex) {
    document.getElementById('box-team-picker')?.remove();

    if (!currentTrainer.team)     currentTrainer.team     = ["","","","","",""];
    if (!currentTrainer.teamData) currentTrainer.teamData = {};
    if (!currentTrainer.boxData)  currentTrainer.boxData  = {};

    const nomePokemonBox   = currentTrainer.box[boxIndex];
    const dataPokemonBox   = currentTrainer.boxData[boxIndex]   || {};
    const nomePokemonTeam  = currentTrainer.team[teamIndex]     || "";
    const dataPokemonTeam  = currentTrainer.teamData[teamIndex] || {};
    const teamOccupato     = nomePokemonTeam && nomePokemonTeam !== "";

    if (teamOccupato) {
        // Scambio pieno: nessun dato va perso
        currentTrainer.box[boxIndex]       = nomePokemonTeam;
        currentTrainer.boxData[boxIndex]   = dataPokemonTeam;
        currentTrainer.team[teamIndex]     = nomePokemonBox;
        currentTrainer.teamData[teamIndex] = dataPokemonBox;
    } else {
        // Slot libero: rimuovi dal box, inserisci nel team
        currentTrainer.team[teamIndex]     = nomePokemonBox;
        currentTrainer.teamData[teamIndex] = dataPokemonBox;

        currentTrainer.box.splice(boxIndex, 1);
        const newBoxData = {};
        Object.keys(currentTrainer.boxData).forEach(k => {
            const ki = parseInt(k);
            if (ki < boxIndex)      newBoxData[ki]     = currentTrainer.boxData[ki];
            else if (ki > boxIndex) newBoxData[ki - 1] = currentTrainer.boxData[ki];
        });
        currentTrainer.boxData = newBoxData;
    }

    salvaBox();
    if (typeof salvaModifiche === 'function') salvaModifiche();
    if (typeof renderTeam     === 'function') renderTeam();
    renderBox();
}

// ── Pokedex per aggiungere / sostituire nel box ──────────────
let boxPokedexMode         = 'add';
let boxPokedexReplaceIndex = null;

function apriBoxPokedex() {
    boxPokedexMode = 'add';
    boxPokedexReplaceIndex = null;
    _apriBoxPokedexModal();
}

function apriBoxPokedexSostituisci(index) {
    boxPokedexMode = 'replace';
    boxPokedexReplaceIndex = index;
    _apriBoxPokedexModal();
}

function _apriBoxPokedexModal() {
    document.getElementById('modal-box-pokedex').style.display = 'flex';
    document.getElementById('box-pokedex-search').value = '';
    filtraBoxPokedex();
}

function chiudiBoxPokedex() {
    document.getElementById('modal-box-pokedex').style.display = 'none';
}

function filtraBoxPokedex() {
    const term = (document.getElementById('box-pokedex-search')?.value || '').toLowerCase();
    const grid = document.getElementById('box-pokedex-grid');
    if (!grid) return;
    grid.innerHTML = '';

    (window.nomiDisponibili || []).forEach(nome => {
        if (!nome.toLowerCase().includes(term)) return;
        const div = document.createElement('div');
        div.className = 'pokedex-item';
        div.innerHTML = `
            <img src="img/pokemon/${nome.toLowerCase()}.png" style="width:50px;height:50px;object-fit:contain;">
            <span style="display:block;font-size:10px;">${nome}</span>
        `;
        div.onclick = () => selezionaBoxPokemon(nome);
        grid.appendChild(div);
    });
}

function selezionaBoxPokemon(nome) {
    chiudiBoxPokedex();

    /* if (boxPokedexMode === 'replace' && boxPokedexReplaceIndex !== null) {
        currentTrainer.box[boxPokedexReplaceIndex] = nome;
        if (currentTrainer.boxData) delete currentTrainer.boxData[boxPokedexReplaceIndex];
    } else {
        if (!currentTrainer.box) currentTrainer.box = [];
        currentTrainer.box.push(nome);
    }
 */
    const pokemonSelezionato = window.pokedexDatabase?.find(p => p.Name === nome);
    let datiIniziali = {};

    if (pokemonSelezionato) {
        const pokemonBase = window.pokedexDatabase?.find(p =>
            p.Evolutions?.some(e => e.To === pokemonSelezionato.DexID && e.Kind === "Mega")
        );
        if (pokemonBase) {
            const megaEvo = pokemonBase.Evolutions.find(e => e.To === pokemonSelezionato.DexID && e.Kind === "Mega");
            datiIniziali = {
                item: megaEvo.Item || "",
                preMegaName: pokemonBase.Name
            };
        }
    }

    if (boxPokedexMode === 'replace' && boxPokedexReplaceIndex !== null) {
        currentTrainer.box[boxPokedexReplaceIndex] = nome;
        currentTrainer.boxData[boxPokedexReplaceIndex] = datiIniziali;
    } else {
        if (!currentTrainer.box) currentTrainer.box = [];
        currentTrainer.box.push(nome);
        if (Object.keys(datiIniziali).length > 0) {
            const newIndex = currentTrainer.box.length - 1;
            if (!currentTrainer.boxData) currentTrainer.boxData = {};
            currentTrainer.boxData[newIndex] = datiIniziali;
        }
    }
    salvaBox();
    renderBox();
}

// ── Salvataggio ───────────────────────────────────────────────
function salvaBox() {
    let allTrainers = JSON.parse(localStorage.getItem('pokeRole_Trainers')) || [];
    const idx = allTrainers.findIndex(t => t.id == currentTrainer.id);
    if (idx !== -1) {
        allTrainers[idx].box     = currentTrainer.box;
        allTrainers[idx].boxData = currentTrainer.boxData;
        allTrainers[idx].boxSfondo = currentTrainer.boxSfondo;
        localStorage.setItem('pokeRole_Trainers', JSON.stringify(allTrainers));
    }
}
