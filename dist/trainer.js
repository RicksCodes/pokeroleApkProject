/* ============================================================
   POKEROLE MANAGER — trainer.js (Mobile-Optimized)
   ============================================================ */
function getPokemonImgSrc(nome) {
    const slug = nome.toLowerCase().replace(/-mega(?= [a-z])/g, ' - mega');
    return `img/pokemon/${slug}.png`;
}

let currentTrainer = null;
let editMode = false;
let ranksData = null;
let activeSlotIndex = null;

// --- 1. CARICAMENTO DATI ---
async function loadTrainerData() {
    try {
        const response = await fetch('utils/json/ranks.json');
        ranksData = await response.json();
    } catch (error) {
        console.error("Errore nel caricamento ranks.json:", error);
    }

    const trainerId = sessionStorage.getItem('currentTrainerId');
    if (!trainerId) {
        alert("Nessun allenatore selezionato!");
        window.location.href = 'index.html';
        return;
    }

    const allTrainers = JSON.parse(localStorage.getItem('pokeRole_Trainers')) || [];
    currentTrainer = allTrainers.find(t => t.id == trainerId);

    if (!currentTrainer) {
        alert("Allenatore non trovato!");
        window.location.href = 'index.html';
        return;
    }

    window.currentTrainer = currentTrainer;
    renderTrainer();
    aggiornaVitali();
    if (typeof MusicManager !== 'undefined') MusicManager.playForScreen('trainer');
    if (!currentTrainer.box)     currentTrainer.box     = [];
    if (!currentTrainer.boxData) currentTrainer.boxData = {};
    const badge = document.getElementById('box-count');
    if (badge) badge.textContent = currentTrainer.box.length;
}

// --- VALIDAZIONE ATTRIBUTI ---
function validaAttributo(inputCambiato, tipo) {
    if (!ranksData || !currentTrainer) return;

    let val = parseInt(inputCambiato.value);
    if (isNaN(val)) val = 1;
    val = Math.min(Math.max(val, 1), 5);
    inputCambiato.value = val;

    const rango = currentTrainer.rango || "Beginner";
    const eta = parseInt(document.getElementById('in-age').value) || 10;
    const infoRango = ranksData.ranks[rango];
    const bonusEta = ranksData.age_bonuses.find(b => eta >= b.min && eta <= b.max) || { attr: 0, social: 0 };

    const listaStats = (tipo === 'attr') ? ranksData.setup.attribute_list : ranksData.setup.social_list;
    const bonusRango = (tipo === 'attr') ? infoRango.bonus_attr : infoRango.bonus_social;
    const bonusSpecificoEta = (tipo === 'attr') ? bonusEta.attr : bonusEta.social;
    const budgetTotale = (listaStats.length * ranksData.base_stats.attributes_default) + bonusRango + bonusSpecificoEta;

    let spesiAltri = 0;
    listaStats.forEach(stat => {
        const input = document.querySelector(`input[data-stat="${stat}"]`);
        if (input !== inputCambiato) spesiAltri += parseInt(input.value) || 1;
    });

    const maxConsentito = Math.max(1, budgetTotale - spesiAltri);
    if (val > maxConsentito) inputCambiato.value = maxConsentito;

    aggiornaVitali();
}

// --- VALIDAZIONE SKILL ---
function validaSkill(inputCambiato) {
    if (!ranksData || !currentTrainer) return;

    const rangoAttuale = currentTrainer.rango || "Beginner";
    const infoRango = ranksData.ranks[rangoAttuale];
    const maxLivelloSkill = infoRango.max_skill_rank;
    const maxPuntiTotali = infoRango.skill_points;

    let val = parseInt(inputCambiato.value);
    if (isNaN(val)) val = 0;
    val = Math.min(Math.max(val, 0), maxLivelloSkill);
    inputCambiato.value = val;

    let spesiAltri = 0;
    document.querySelectorAll('.skill-in').forEach(input => {
        if (input !== inputCambiato) spesiAltri += parseInt(input.value) || 0;
    });

    const maxConsentito = Math.max(0, maxPuntiTotali - spesiAltri);
    if (val > maxConsentito) inputCambiato.value = maxConsentito;
}

// --- 2. RENDER TRAINER ---
function renderTrainer() {
    const imgEl = document.getElementById('trainer-img');
    imgEl.src = currentTrainer.immagine || "https://via.placeholder.com/150";

    document.getElementById('display-nome').innerText = currentTrainer.nome;

    // Rank: select in edit mode, testo altrimenti
    const rankDisplay = document.getElementById('display-rank');
    if (editMode && ranksData) {
        let options = "";
        Object.keys(ranksData.ranks).forEach(r => {
            const selected = (currentTrainer.rango === r) ? "selected" : "";
            options += `<option value="${r}" ${selected}>${r}</option>`;
        });
        rankDisplay.innerHTML = `<select id="in-rank" onchange="aggiornaRangoTemporaneo(this.value)" style="font-size:15px; padding:4px 8px; border-radius:6px; border:1.5px solid var(--accent-blue); background:var(--input-bg); color:var(--text-color); font-family:inherit;">${options}</select>`;
    } else {
        rankDisplay.innerText = currentTrainer.rango || "Beginner";
    }

    document.getElementById('in-age').value = currentTrainer.eta;

    // Skill inputs
    document.querySelectorAll('.skill-in').forEach(input => {
        const statName = input.getAttribute('data-stat');
        if (currentTrainer.stats && currentTrainer.stats[statName] !== undefined) {
            input.value = currentTrainer.stats[statName];
        }
        input.onfocus = function() { this.select(); };
        input.onblur = function() { validaSkill(this); };
    });

    // Age input
    const inputAge = document.getElementById('in-age');
    inputAge.onfocus = function() { this.select(); };
    inputAge.onblur = () => {
        let valoreEta = parseInt(inputAge.value);
        if (valoreEta > 99) valoreEta = 99;
        if (valoreEta < 10 || isNaN(valoreEta)) valoreEta = 10;
        inputAge.value = valoreEta;
        currentTrainer.eta = valoreEta;
        document.querySelectorAll('input[data-stat]').forEach(i => {
            const stat = i.getAttribute('data-stat');
            if (ranksData.setup.attribute_list.includes(stat)) validaAttributo(i, 'attr');
            if (ranksData.setup.social_list.includes(stat)) validaAttributo(i, 'social');
        });
    };

    // Natura display
    const natureDisplay = document.getElementById('trainer-nature-display');
    if (natureDisplay) {
        natureDisplay.textContent = currentTrainer.nature || "Nessuna";
    }

    // Stat inputs (attributi + social)
    document.querySelectorAll('input[data-stat]').forEach(input => {
        const statName = input.getAttribute('data-stat');
        if (currentTrainer.stats && currentTrainer.stats[statName] !== undefined) {
            input.value = currentTrainer.stats[statName];
        }
        input.onfocus = function() { this.select(); };
        input.onblur = function() {
            if (ranksData.setup.attribute_list.includes(statName)) {
                validaAttributo(this, 'attr');
            } else if (ranksData.setup.social_list.includes(statName)) {
                validaAttributo(this, 'social');
            } else {
                validaSkill(this);
            }
            aggiornaVitali();
        };
    });

    renderBadges();
    renderTeam();
}

function aggiornaRangoTemporaneo(nuovoRango) {
    currentTrainer.rango = nuovoRango;
}

// --- 3. CALCOLO HP E WILL ---
function aggiornaVitali() {
    const vit = parseInt(document.querySelector('[data-stat="Vitality"]').value) || 1;
    const ins = parseInt(document.querySelector('[data-stat="Insight"]').value) || 1;
    document.getElementById('val-hp').innerText = 4 + vit;
    document.getElementById('val-will').innerText = ins + 2;
}

// --- 4. EDIT MODE ---
function toggleEditMode() {
    editMode = !editMode;
    const btn = document.getElementById('btn-edit-mode');
    const inputs = document.querySelectorAll('.sheet-container input');

    if (editMode) {
        btn.innerText = "💾 Save Changes";
        btn.style.background = "#28a745";
        btn.style.color = "white";
        btn.style.borderColor = "#28a745";
        document.body.classList.add('edit-mode-active');
        inputs.forEach(i => i.disabled = false);
    } else {
        salvaModifiche();
        btn.innerText = "✎ Edit Mode: OFF";
        btn.style.background = "";
        btn.style.color = "";
        btn.style.borderColor = "";
        document.body.classList.remove('edit-mode-active');
        inputs.forEach(i => i.disabled = true);
    }

    renderTrainer();
}

// --- 5. SALVATAGGIO ---
function salvaModifiche() {
    currentTrainer.eta = document.getElementById('in-age').value;
    currentTrainer.concetto = currentTrainer.desc || "";

    const natureInput = document.getElementById('in-nature');
    if (natureInput) currentTrainer.nature = natureInput.value;

    if (!currentTrainer.stats) currentTrainer.stats = {};
    document.querySelectorAll('input[data-stat]').forEach(input => {
        currentTrainer.stats[input.getAttribute('data-stat')] = parseInt(input.value);
    });

    let allTrainers = JSON.parse(localStorage.getItem('pokeRole_Trainers')) || [];
    const index = allTrainers.findIndex(t => t.id == currentTrainer.id);
    if (index !== -1) {
        allTrainers[index] = currentTrainer;
        localStorage.setItem('pokeRole_Trainers', JSON.stringify(allTrainers));
    }

    aggiornaVitali();
    console.log("Dati salvati!");
}

// Ascolta import da menu
window.addEventListener('trainersUpdated', () => { loadTrainerData(); });

// Init
document.addEventListener('DOMContentLoaded', loadTrainerData);

// --- ZAINO ---

function apriZaino() {
    document.getElementById('modal-zaino').style.display = "flex";
    renderZaino();
}

function chiudiZaino() {
    document.getElementById('modal-zaino').style.display = "none";
}

function renderZaino() {
    const walletInput = document.getElementById('wallet-amount');
    if (walletInput) {
        walletInput.value = currentTrainer.soldi !== undefined ? currentTrainer.soldi : 1500;
    }

    const container = document.getElementById('lista-oggetti');
    container.innerHTML = "";

    if (!currentTrainer.zaino) currentTrainer.zaino = [];

    if (currentTrainer.zaino.length === 0) {
        container.innerHTML = "<p style='text-align:center; opacity:0.5; padding:12px 0;'>Bag is empty.</p>";
        return;
    }

    const fragment = document.createDocumentFragment();
    currentTrainer.zaino.forEach((item, index) => {
        const div = document.createElement('div');
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border-color); gap:10px;";
        div.innerHTML = `
            <span style="flex:1; font-weight:600;"><strong>${item.quantita}x</strong> ${item.nome}</span>
            <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
                <button onclick="modificaQuantita(${index}, -1)" style="width:36px;height:36px;border-radius:8px;border:1.5px solid var(--border-color);background:var(--bg-color);color:var(--text-color);font-size:1.1rem;cursor:pointer;font-weight:bold;-webkit-tap-highlight-color:transparent;">−</button>
                <button onclick="modificaQuantita(${index}, 1)" style="width:36px;height:36px;border-radius:8px;border:1.5px solid var(--border-color);background:var(--bg-color);color:var(--text-color);font-size:1.1rem;cursor:pointer;font-weight:bold;-webkit-tap-highlight-color:transparent;">+</button>
                <button onclick="rimuoviOggetto(${index})" style="width:36px;height:36px;border-radius:8px;border:none;background:#fdecea;color:#dc3545;font-size:1.1rem;cursor:pointer;font-weight:bold;-webkit-tap-highlight-color:transparent;">&times;</button>
            </div>
        `;
        fragment.appendChild(div);
    });
    container.appendChild(fragment);
}

function aggiungiOggetto() {
    const nome = document.getElementById('item-nome').value.trim();
    const qty = parseInt(document.getElementById('item-qty').value) || 1;
    if (!nome) return;
    if (qty <= 0) {
        alert('La quantità deve essere almeno 1!');
        document.getElementById('item-qty').value = "1";
        return;
    }
    const esistente = currentTrainer.zaino.find(i => i.nome.toLowerCase() === nome.toLowerCase());
    if (esistente) {
        esistente.quantita += qty;
    } else {
        currentTrainer.zaino.push({ nome, quantita: qty });
    }

    document.getElementById('item-nome').value = "";
    document.getElementById('item-qty').value = "1";
    salvaDatiZaino();
    renderZaino();
}

function modificaQuantita(index, delta) {
    currentTrainer.zaino[index].quantita += delta;
    if (currentTrainer.zaino[index].quantita <= 0) {
        rimuoviOggetto(index);
    } else {
        salvaDatiZaino();
        renderZaino();
    }
}

function rimuoviOggetto(index) {
    currentTrainer.zaino.splice(index, 1);
    salvaDatiZaino();
    renderZaino();
}

function salvaDatiZaino() {
    let allTrainers = JSON.parse(localStorage.getItem('pokeRole_Trainers')) || [];
    const idx = allTrainers.findIndex(t => t.id == currentTrainer.id);
    if (idx !== -1) {
        allTrainers[idx].zaino = currentTrainer.zaino;
        localStorage.setItem('pokeRole_Trainers', JSON.stringify(allTrainers));
    }
}

function salvaSoldi() {
    let amount = parseInt(document.getElementById('wallet-amount').value) || 0;
    if (amount < 0) amount = 0;
    document.getElementById('wallet-amount').value = amount;
    currentTrainer.soldi = amount;
    let allTrainers = JSON.parse(localStorage.getItem('pokeRole_Trainers')) || [];
    const idx = allTrainers.findIndex(t => t.id == currentTrainer.id);
    if (idx !== -1) {
        allTrainers[idx].soldi = amount;
        localStorage.setItem('pokeRole_Trainers', JSON.stringify(allTrainers));
    }
}

// --- POKÉDEX ---

let pokedexDatabase = [];
let nomiDisponibili = [];

async function inizializzaPokedex() {
    try {
        const risposta = await fetch('utils/json/pokemonDataCollection.json');
        const archivio = await risposta.json();
        pokedexDatabase = archivio.pokemonCollection;
        nomiDisponibili = pokedexDatabase.map(pokemon => pokemon.Name);
        window.nomiDisponibili = nomiDisponibili;
        console.log("Pokedex pronto! Caricati:", nomiDisponibili.length, "Pokémon");
    } catch (errore) {
        console.error("Impossibile leggere il database Pokémon:", errore);
    }
}

inizializzaPokedex();

// --- TEAM ---

let slotSelezionatoPerScelta = null;

function renderTeam() {
    const slots = document.querySelectorAll('.ball-slot');
    slots.forEach((slot, i) => {
        const pkmn = currentTrainer.team[i];
        slot.innerHTML = "";

        if (pkmn && pkmn !== "") {
            slot.classList.add('occupied');
            const img = document.createElement('img');
            img.src = getPokemonImgSrc(pkmn);
            img.className = "pokemon-icon";
            img.alt = pkmn;
            slot.appendChild(img);

            slot.onclick = (e) => {
                e.stopPropagation();
                if (editMode) {
                    apriModalScelta(i, pkmn);
                } else {
                    apriSchedaPokemon(i);
                }
            };
        } else {
            slot.classList.remove('occupied');
            slot.onclick = () => apriPokedex(i);
            slot.innerHTML = '<span style="opacity:0.25; font-size:1.2rem; font-weight:900; pointer-events:none;">+</span>';
        }
    });
}

// --- POPUP SCELTA POKEMON ---

function apriModalScelta(index, nome) {
    slotSelezionatoPerScelta = index;
    const teamData = currentTrainer.teamData?.[index] || {};

    const pokemonCorrente = window.pokedexDatabase?.find(p => p.Name === nome);
    const isMegaByDB = pokemonCorrente && window.pokedexDatabase?.some(p =>
        p.Evolutions?.some(e => e.To === pokemonCorrente.DexID && e.Kind === "Mega")
    );

    // Se è una mega ma non ha preMegaName, ricavalo dal database
    if (isMegaByDB && !teamData.preMegaName) {
        const pokemonBase = window.pokedexDatabase.find(p =>
            p.Evolutions?.some(e => e.To === pokemonCorrente.DexID && e.Kind === "Mega")
        );
        if (pokemonBase) teamData.preMegaName = pokemonBase.Name;
    }

    /* const isMega = !!teamData.preMegaName; */
    const isMega = isMegaByDB;

    document.getElementById('titolo-scelta').innerText = "What do you want to do with " + nome + "?";

    const btnRevert = document.getElementById('btn-mega-revert');
    if (btnRevert) {
        btnRevert.style.display = isMega ? 'inline-block' : 'none';
        btnRevert.onclick = () => azioneMegaRevert(index);
    }

    document.getElementById('modal-scelta-pokemon').style.display = "flex";
}

function chiudiModalScelta() {
    document.getElementById('modal-scelta-pokemon').style.display = "none";
    slotSelezionatoPerScelta = null;
}

function azioneSostituisci() {
    const index = slotSelezionatoPerScelta;
    chiudiModalScelta();
    apriPokedex(index);
}





/* 
function evolveSlotPokemon() {
    const index = slotSelezionatoPerScelta;
    const nomeAttuale = currentTrainer.team[index];
    const pkmnAttuale = window.pokedexDatabase.find(p => p.Name === nomeAttuale);

    if (!pkmnAttuale || !pkmnAttuale.Evolutions?.length) {
        alert("Questo Pokémon non può evolversi ulteriormente!");
        chiudiModalScelta();
        return;
    }

    const listaEvo = pkmnAttuale.Evolutions
        .map(e => window.pokedexDatabase.find(p => p.DexID === e.To))
        .filter(Boolean);

    if (listaEvo.length === 0) {
        alert("Evoluzioni non trovate nel database!");
        chiudiModalScelta();
        return;
    }

    chiudiModalScelta();

    if (listaEvo.length === 1) {
        applicaEvoluzione(index, pkmnAttuale, listaEvo[0]);
    } else {
        mostraSceltaEvoluzione(index, pkmnAttuale, listaEvo);
    }
}

function mostraSceltaEvoluzione(index, pkmnAttuale, listaEvo) {
    const vecchio = document.getElementById('evo-picker-overlay');
    if (vecchio) vecchio.remove();

    const overlay = document.createElement('div');
    overlay.id = 'evo-picker-overlay';
    overlay.style.cssText = `
        position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.75);
        display:flex; align-items:center; justify-content:center;
        z-index:9999; padding:20px; box-sizing:border-box;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background:#1a1a2e; border:2px solid #e2b96f; border-radius:14px;
        padding:24px; text-align:center; color:#fff;
        min-width:260px; max-width:90vw;
        font-family:'Nunito','Segoe UI',sans-serif;
    `;

    const titolo = document.createElement('h3');
    titolo.style.cssText = 'margin:0 0 6px; color:#e2b96f;';
    titolo.textContent = 'Scegli l\'evoluzione';

    const sottotitolo = document.createElement('p');
    sottotitolo.style.cssText = 'margin:0 0 18px; opacity:0.7; font-size:0.9em;';
    sottotitolo.textContent = `In cosa vuoi evolvere ${pkmnAttuale.Name}?`;

    const griglia = document.createElement('div');
    griglia.style.cssText = 'display:flex; gap:14px; justify-content:center; flex-wrap:wrap;';

    listaEvo.forEach(evo => {
        const btn = document.createElement('button');
        btn.style.cssText = `
            background:#16213e; border:2px solid #e2b96f; border-radius:10px;
            padding:12px 16px; color:#fff; cursor:pointer; min-width:90px;
            display:flex; flex-direction:column; align-items:center; gap:8px;
            font-family:inherit; min-height:44px;
            -webkit-tap-highlight-color:transparent;
        `;

        const img = document.createElement('img');
        img.src = `img/pokemon/${evo.Name.toLowerCase()}.png`;
        img.style.cssText = 'width:60px; height:60px; object-fit:contain;';
        img.onerror = () => { img.style.display = 'none'; };

        const nome = document.createElement('span');
        nome.style.cssText = 'font-size:0.82em;';
        nome.textContent = evo.Name;

        btn.appendChild(img);
        btn.appendChild(nome);
        btn.addEventListener('click', () => {
            overlay.remove();
            applicaEvoluzione(index, pkmnAttuale, evo);
        });

        griglia.appendChild(btn);
    });

    const btnAnnulla = document.createElement('button');
    btnAnnulla.style.cssText = `
        margin-top:18px; padding:0 20px; height:44px;
        background:transparent; border:1px solid #888;
        color:#aaa; border-radius:8px; cursor:pointer;
        font-family:inherit; -webkit-tap-highlight-color:transparent;
    `;
    btnAnnulla.textContent = 'Annulla';
    btnAnnulla.addEventListener('click', () => overlay.remove());

    box.appendChild(titolo);
    box.appendChild(sottotitolo);
    box.appendChild(griglia);
    box.appendChild(btnAnnulla);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

function applicaEvoluzione(index, pkmnAttuale, evoluzione) {
    if (!confirm(`Evolvere ${pkmnAttuale.Name} in ${evoluzione.Name}?`)) return;

    if (!currentTrainer.teamData) currentTrainer.teamData = {};
    if (!currentTrainer.teamData[index]) currentTrainer.teamData[index] = { stats: {} };
    const savedStats = currentTrainer.teamData[index].stats || {};

    const statsList = ["Strength", "Dexterity", "Vitality", "Special", "Insight"];
    statsList.forEach(s => {
        const minAttuale = pkmnAttuale["Min" + s] || 1;
        const valoreAttuale = savedStats[s] || minAttuale;
        const puntiBonus = valoreAttuale - minAttuale;
        const nuovoMin = evoluzione["Min" + s] || 1;
        const nuovoMax = evoluzione["Max" + s] || 5;
        let nuovoValore = nuovoMin + puntiBonus;
        if (nuovoValore > nuovoMax) nuovoValore = nuovoMax;
        savedStats[s] = nuovoValore;
    });

    currentTrainer.team[index] = evoluzione.Name;
    salvaModifiche();
    renderTeam();
    apriSchedaPokemon(index);
}
 */

function azioneEvolve() {
    const index = slotSelezionatoPerScelta;
    const nomeAttuale = currentTrainer.team[index];
    const pokemonAttuale = window.pokedexDatabase.find(p => p.Name === nomeAttuale);

    if (!pokemonAttuale || !pokemonAttuale.Evolutions?.length) {
        alert("Questo Pokémon non può evolversi ulteriormente!");
        chiudiModalScelta();
        return;
    }

    // Risolvi tutti i candidati
    const candidati = pokemonAttuale.Evolutions
        .map(evo => ({
            data: window.pokedexDatabase.find(p => p.DexID === evo.To),
            kind: evo.Kind,
            item: evo.Item
        }))
        .filter(e => e.data);

    if (candidati.length === 0) {
        alert("Evoluzioni non trovate nel database!");
        chiudiModalScelta();
        return;
    }

    const megaCandidati   = candidati.filter(e => e.kind === "Mega");
    const normaliCandidati = candidati.filter(e => e.kind !== "Mega");

    if (megaCandidati.length > 0) {
        chiudiModalScelta();
        _gestisciMega(index, pokemonAttuale, megaCandidati);
        return;
    }

    if (normaliCandidati.length === 1) {
        _applicaEvoluzione(index, pokemonAttuale, normaliCandidati[0].data);
    } else {
        chiudiModalScelta();
        _mostraPickerEvoluzione(index, pokemonAttuale, normaliCandidati.map(c => c.data));
    }
}

function _gestisciMega(index, pokemonBase, megaCandidati) {
    const itemTenuto = (currentTrainer.teamData[index] || {}).item || "";

    const megaValida = megaCandidati.find(e =>
        e.item && itemTenuto.toLowerCase().includes(e.item.toLowerCase())
    );

    if (!megaValida) {
        const oggettiRichiesti = megaCandidati.map(e => e.item).filter(Boolean).join(" / ");
        alert(`Per mega evolvere serve: ${oggettiRichiesti}\n\nOggetto attuale: ${itemTenuto || "nessuno"}`);
        return;
    }

    if (!confirm(`Mega evolvere ${pokemonBase.Name} in ${megaValida.data.Name}?`)) return;

    // Salva solo il nome base — le stats/mosse restano in teamData invariate
    if (!currentTrainer.teamData[index]) currentTrainer.teamData[index] = {};
    currentTrainer.teamData[index].preMegaName = pokemonBase.Name;

    _applicaEvoluzione(index, pokemonBase, megaValida.data, true);
}

function azioneMegaRevert(index) {
    const teamData = currentTrainer.teamData[index];
    if (!teamData?.preMegaName) return;

    const nomeBase = teamData.preMegaName;
    const pokemonBase = window.pokedexDatabase.find(p => p.Name === nomeBase);
    if (!pokemonBase) return;

    // Serve anche il pokémon mega per leggere i suoi minimi
    const nomeMega = currentTrainer.team[index];
    const pokemonMega = window.pokedexDatabase.find(p => p.Name === nomeMega);
    if (!pokemonMega) return;

    if (!confirm(`Far tornare alla forma base (${nomeBase})?`)) return;

    chiudiModalScelta();

    if (!currentTrainer.teamData[index].stats) currentTrainer.teamData[index].stats = {};

    const statsList = ["Strength","Dexterity","Vitality","Special","Insight"];

    statsList.forEach(s => {
        const minMega = pokemonMega["Min" + s] || 1;
        const valoreAttualeMega = currentTrainer.teamData[index].stats[s] ?? minMega;
        // Quanti punti ha distribuito l'utente sopra il minimo del mega?
        const bonusUtente = Math.max(0, valoreAttualeMega - minMega);

        const minBase = pokemonBase["Min" + s] || 1;
        const maxBase = pokemonBase["Max" + s] || 5;
        // Riapplica quei bonus sopra il minimo del base
        currentTrainer.teamData[index].stats[s] = Math.min(minBase + bonusUtente, maxBase);
    });

    currentTrainer.team[index] = nomeBase;
    delete currentTrainer.teamData[index].preMegaName;

    salvaModifiche();
    renderTeam();
}


function _mostraPickerEvoluzione(index, pokemonAttuale, candidati) {
    // Rimuovi un picker precedente se esiste
    document.getElementById('modal-evo-picker')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'modal-evo-picker';
    overlay.style.cssText = `
        position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7);
        display:flex; align-items:center; justify-content:center; z-index:9999;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background:#1a1a2e; border:2px solid #e2b96f; border-radius:12px;
        padding:24px; text-align:center; color:#fff; min-width:280px;
    `;

    box.innerHTML = `
        <h3 style="margin:0 0 8px; color:#e2b96f;">Scegli l'evoluzione</h3>
        <p style="margin:0 0 20px; opacity:0.7; font-size:0.9em;">
            In cosa vuoi evolvere ${pokemonAttuale.Name}?
        </p>
        <div id="evo-picker-opzioni" style="display:flex; gap:16px; justify-content:center; flex-wrap:wrap;"></div>
        <button onclick="document.getElementById('modal-evo-picker').remove()"
            style="margin-top:20px; padding:6px 20px; background:transparent;
                   border:1px solid #888; color:#aaa; border-radius:6px; cursor:pointer;">
            Annulla
        </button>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const contenitore = document.getElementById('evo-picker-opzioni');
    candidati.forEach(evo => {
        const btn = document.createElement('button');
        btn.style.cssText = `
            background:#16213e; border:2px solid #e2b96f; border-radius:10px;
            padding:12px 16px; color:#fff; cursor:pointer; min-width:100px;
            display:flex; flex-direction:column; align-items:center; gap:8px;
            transition: background 0.15s;
        `;
        btn.onmouseenter = () => btn.style.background = '#e2b96f22';
        btn.onmouseleave = () => btn.style.background = '#16213e';

        btn.innerHTML = `
            <img src="img/pokemon/${evo.Name.toLowerCase()}.png"
                 style="width:64px; height:64px; object-fit:contain; image-rendering:pixelated;"
                 onerror="this.style.display='none'">
            <span style="font-size:0.85em;">${evo.Name}</span>
        `;

        btn.onclick = () => {
            overlay.remove();
            _applicaEvoluzione(index, pokemonAttuale, evo);
        };

        contenitore.appendChild(btn);
    });
}

function _applicaEvoluzione(index, pokemonAttuale, evoluzione, skipConfirm = false) {
    /* if (!confirm(`Evolvere ${pokemonAttuale.Name} in ${evoluzione.Name}?`)) return; */
    if (!skipConfirm && !confirm(`Evolvere ${pokemonAttuale.Name} in ${evoluzione.Name}?`)) return;

    if (!currentTrainer.teamData[index]) currentTrainer.teamData[index] = { stats: {} };
    const savedStats = currentTrainer.teamData[index].stats || {};

    const statsList = ["Strength", "Dexterity", "Vitality", "Special", "Insight"];
    statsList.forEach(s => {
        const minAttuale = pokemonAttuale["Min" + s] ?? 1;
        const valoreAttuale = savedStats[s] ?? minAttuale;
        const puntiBonus = valoreAttuale - minAttuale;
        const nuovoMin = evoluzione["Min" + s] ?? 1;
        const nuovoMax = evoluzione["Max" + s] ?? 5;
        let nuovoValore = nuovoMin + puntiBonus;
        if (nuovoValore > nuovoMax) nuovoValore = nuovoMax;
        savedStats[s] = nuovoValore;
    });

    currentTrainer.team[index] = evoluzione.Name;
    salvaModifiche();
    renderTeam();
    apriSchedaPokemon(index);
}






function azioneRimuovi() {
    const index = slotSelezionatoPerScelta;
    currentTrainer.team[index] = "";
    if (currentTrainer.teamData && currentTrainer.teamData[index]) {
        delete currentTrainer.teamData[index];
    }
    chiudiModalScelta();
    salvaModifiche();
    renderTeam();
}

// --- DATI GLOBALI ---

window.pokedexDatabase = [];
window.moveDatabase = [];
window.abilityDatabase = [];

async function caricaDati() {
    try {
        const [respPkm, respMoves, respAbilities] = await Promise.all([
            fetch('utils/json/pokemonDataCollection.json'),
            fetch('utils/json/moveDataCollection.json'),
            fetch('utils/json/abilityDataCollection.json')
        ]);

        const [dataPkm, dataMoves, dataAbilities] = await Promise.all([
            respPkm.json(),
            respMoves.json(),
            respAbilities.json()
        ]);

        window.pokedexDatabase = dataPkm.pokemonCollection;
        window.moveDatabase = dataMoves.moveCollection;
        window.abilityDatabase = dataAbilities.abilityCollection;

        loadItems();
        console.log("✅ Dati caricati con successo!");
    } catch (error) {
        console.error("❌ Errore nel caricamento dei JSON:", error);
    }
}

caricaDati();

// --- SCHEDA POKEMON ---

function apriSchedaPokemon(index) {
    if (!window.pokedexDatabase || !window.moveDatabase) return;

    const nome = currentTrainer.team[index];
    if (!nome) return;

    const rankMap = { "Starter": 0, "Beginner": 1, "Amateur": 2, "Ace": 3, "Pro": 4, "Master": 5 };
    const trainerRankValue = rankMap[currentTrainer.rango] || 0;

    const popup = document.createElement('pokemon-card-popup');

    if (!currentTrainer.teamData) currentTrainer.teamData = {};
    const savedData = currentTrainer.teamData[index] || {};

    popup.open(
        nome,
        window.pokedexDatabase,
        window.moveDatabase,
        savedData,
        index,
        trainerRankValue,
        window.abilityDatabase,
        (ranksData ? ranksData.ranks : null)
    );

    popup.addEventListener('updatePokemon', (e) => {
        const { index, data } = e.detail;
        currentTrainer.teamData[index] = data;
        if (typeof salvaModifiche === "function") salvaModifiche();
    });
}

// --- POKEDEX SEARCH ---

function filtraPokedex() {
    const term = document.getElementById('pokedex-search').value.toLowerCase();
    console.log('Test path:', getPokemonImgSrc('Pikachu'));
console.log('Capacitor disponibile:', !!window.Capacitor);
    const grid = document.getElementById('pokedex-grid');
    if (!grid) return;

    grid.innerHTML = "";
    const fragment = document.createDocumentFragment();

    nomiDisponibili.forEach(nome => {
        
        if (!nome.toLowerCase().includes(term)) return;
        

        const div = document.createElement('div');
        div.className = "pokedex-item";

        const img = document.createElement('img');
        img.src = getPokemonImgSrc(nome);
        img.alt = nome;
        img.width = 56;
        img.height = 56;
        img.onerror = function() { this.style.display = 'none'; };

        const span = document.createElement('span');
        span.textContent = nome;

        div.appendChild(img);
        div.appendChild(span);
        div.addEventListener('click', () => selezionaPokemon(nome));
        fragment.appendChild(div);
    });

    grid.appendChild(fragment);
}
function apriPokedex(index) {
    if (!editMode) {
        alert("Attiva la modalità EDIT per modificare il Team!");
        return;
    }
    activeSlotIndex = index;
    const modal = document.getElementById('modal-pokedex');
    if (modal) {
        modal.style.display = "flex";
        filtraPokedex();
        // Focus sulla ricerca su mobile
        setTimeout(() => {
            const searchInput = document.getElementById('pokedex-search');
            if (searchInput) searchInput.focus();
        }, 300);
    }
}

function chiudiPokedex() {
    document.getElementById('modal-pokedex').style.display = "none";
}

function selezionaPokemon(nome) {
    if (!currentTrainer.team) currentTrainer.team = ["", "", "", "", "", ""];
    if (currentTrainer.teamData && currentTrainer.teamData[activeSlotIndex]) {
        currentTrainer.teamData[activeSlotIndex] = {};
    }
    currentTrainer.team[activeSlotIndex] = nome;

    // Se è una mega, imposta automaticamente la megapietra
    const pokemonSelezionato = window.pokedexDatabase?.find(p => p.Name === nome);
    if (pokemonSelezionato) {
        const pokemonBase = window.pokedexDatabase?.find(p =>
            p.Evolutions?.some(e => e.To === pokemonSelezionato.DexID && e.Kind === "Mega")
        );
        if (pokemonBase) {
            const megaEvo = pokemonBase.Evolutions.find(e => e.To === pokemonSelezionato.DexID && e.Kind === "Mega");
            if (!currentTrainer.teamData) currentTrainer.teamData = {};
            currentTrainer.teamData[activeSlotIndex] = {
                item: megaEvo.Item || "",
                preMegaName: pokemonBase.Name
            };
        }
    }
    chiudiPokedex();
    salvaModifiche();
    renderTeam();
}

// --- ITEMS ---

let itemDatabase = [];

async function loadItems() {
    try {
        const response = await fetch('utils/json/itemCollection.json');
        const data = await response.json();
        itemDatabase = data.itemCollection;
        window.itemDatabase = itemDatabase;
    } catch (e) {
        console.error("Errore caricamento strumenti:", e);
    }
}

// --- EXTRA ---

function openExtraSection() {
    if (editMode) {
        alert("Coming Soon: disponibile nei prossimi aggiornamenti!");
    }
}

// --- NATURA ALLENATORE ---

function openTrainerNaturePicker() {
    if (!editMode) return;

    const listaNomi = POKEMON_NATURES.join(", ");
    const scelta = prompt("Scegli la Natura dell'Allenatore:\n" + listaNomi);
    if (!scelta) return;

    const naturaTrovata = POKEMON_NATURES.find(n =>
        n.toLowerCase().startsWith(scelta.toLowerCase().trim())
    );

    if (naturaTrovata) {
        currentTrainer.nature = naturaTrovata;
        const display = document.getElementById('trainer-nature-display');
        if (display) display.textContent = naturaTrovata;
        salvaModifiche();
    } else {
        alert("Natura non valida!");
    }
}

// --- CONCEPT ---

function apriConcept() {
    const textarea = document.getElementById('concept-text');
    textarea.value = currentTrainer.descrizione || currentTrainer.concetto || "";
    textarea.disabled = !editMode;
    document.getElementById('modal-concept').style.display = "flex";
    if (editMode) {
        setTimeout(() => textarea.focus(), 300);
    }
}

function chiudiConcept() {
    if (editMode) {
        currentTrainer.descrizione = document.getElementById('concept-text').value;
        currentTrainer.concetto = currentTrainer.descrizione;
        salvaModifiche();
    }
    document.getElementById('modal-concept').style.display = "none";
}

// --- BADGES ---

const BADGE_LIST = [
    "1_Coal_Badge", "2_Forest_Badge", "3_Cobble_Badge", "4_Fen_Badge",
    "5_Relic_Badge", "6_Mine_Badge", "7_Icicle_Badge", "8_Beacon_Badge"
];

function renderBadges() {
    if (!currentTrainer.badges) currentTrainer.badges = [];
    document.querySelectorAll('.badge-slot').forEach((slot, i) => {
        const badgeName = BADGE_LIST[i];
        slot.innerHTML = `<img src="img/badges/${badgeName}.png" alt="${badgeName}" loading="lazy">`;
        if (currentTrainer.badges.includes(i)) {
            slot.classList.add('earned');
        } else {
            slot.classList.remove('earned');
        }
    });
}

function toggleBadge(index) {
    if (!editMode) return;
    if (!currentTrainer.badges) currentTrainer.badges = [];

    if (currentTrainer.badges.includes(index)) {
        currentTrainer.badges = currentTrainer.badges.filter(b => b !== index);
    } else {
        currentTrainer.badges.push(index);
    }
    salvaBadges();
    renderBadges();
    if (typeof MusicManager !== 'undefined') MusicManager.playForScreen('trainer');
}

function salvaBadges() {
    let allTrainers = JSON.parse(localStorage.getItem('pokeRole_Trainers')) || [];
    const idx = allTrainers.findIndex(t => t.id == currentTrainer.id);
    if (idx !== -1) {
        allTrainers[idx].badges = currentTrainer.badges;
        localStorage.setItem('pokeRole_Trainers', JSON.stringify(allTrainers));
    }
}

function openBadgePicker() {
    // Gestito da toggleBadge
}
