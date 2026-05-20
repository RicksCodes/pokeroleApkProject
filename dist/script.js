/* document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const modal = document.getElementById('modal-creazione');
        modal.style.display = 'flex';
        const content = modal.querySelector('.modal-content');
        alert(
            'modal alignItems: ' + getComputedStyle(modal).alignItems + '\n' +
            'content maxHeight: ' + getComputedStyle(content).maxHeight + '\n' +
            'content borderRadius: ' + getComputedStyle(content).borderRadius
        );
    }, 2000);
});
 */

/* ============================================================
   POKEROLE MANAGER — script.js (Mobile-Optimized)
   ============================================================ */

let allenatori = JSON.parse(localStorage.getItem('pokeRole_Trainers')) || [];
let indiceSelezionato = null;
let ranksConfig = null;
let currentTrainerImageData = "";

// --- CARICAMENTO CONFIGURAZIONE RANGHI ---
async function caricaConfigurazione() {
    try {
        const response = await fetch('utils/json/ranks.json');
        if (!response.ok) throw new Error("Errore nel caricamento del JSON");
        ranksConfig = await response.json();
        popolaSelectRango();
    } catch (error) {
        console.error("Errore caricamento ranks.json", error);
    }
}

function popolaSelectRango() {
    const select = document.getElementById('input-rango');
    if (!select || !ranksConfig) return;
    select.innerHTML = "";
    Object.keys(ranksConfig.ranks).forEach(rankName => {
        const option = document.createElement('option');
        option.value = rankName;
        option.textContent = rankName;
        select.appendChild(option);
    });
}

// --- HELPER: blocca/sblocca scroll body ---
function lockBody()   { document.body.classList.add('modal-open'); }
function unlockBody() { document.body.classList.remove('modal-open'); }

// --- PREVIEW IMMAGINE UPLOAD ---
function previewImage(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function() {
        const img = new Image();
        img.onload = function() {
            const MAX = 400;
            const scale = Math.min(MAX / img.width, MAX / img.height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');

            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const compressed = canvas.toDataURL('image/jpeg', 0.85);

            const preview = document.getElementById('image-preview');
            const placeholder = document.getElementById('placeholder-text');
            const wrapper = document.querySelector('.image-upload-wrapper');

            preview.src = compressed;
            preview.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
            if (wrapper) { wrapper.style.border = "none"; wrapper.style.background = "none"; }
            currentTrainerImageData = compressed;
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

// --- CARICA GRIGLIA ALLENATORI ---
function caricaAllenatori() {
    const grid = document.getElementById('trainer-grid');
    if (!grid) return;

    const fragment = document.createDocumentFragment();

    const addCard = document.createElement('div');
    addCard.className = 'add-card';
    addCard.setAttribute('role', 'button');
    addCard.setAttribute('aria-label', 'Aggiungi nuovo trainer');
    addCard.onclick = () => apriModalCreazione();
    addCard.innerHTML = `<div class="plus-icon">+</div><p class="add-text">New Trainer</p>`;
    fragment.appendChild(addCard);

    allenatori.forEach((p, index) => {
        const card = document.createElement('div');
        card.className = 'trainer-card';
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `Apri profilo di ${p.nome}`);
        card.onclick = () => menuAzione(index);

        const placeholderImg = `https://via.placeholder.com/150?text=${p.nome ? p.nome.charAt(0).toUpperCase() : "?"}`;
        card.innerHTML = `
            <div class="card-image-container">
                <img src="${p.immagine || placeholderImg}" alt="Avatar di ${p.nome}" loading="lazy">
            </div>
            <div class="card-info">
                <strong>${p.nome}</strong>
                <small style="color: var(--accent-color); font-weight: 800; display: block; margin: 3px 0;">${p.rango || 'Beginner'}</small>
                <small>Age: ${p.eta}</small>
                <p class="desc-preview">${p.descrizione || ''}</p>
            </div>`;
        fragment.appendChild(card);
    });

    grid.innerHTML = "";
    grid.appendChild(fragment);
}

function apriModalCreazione() {
    lockBody();
    document.getElementById('modal-creazione').style.display = "flex";
    setTimeout(() => {
        const nomInput = document.getElementById('input-nome');
        if (nomInput) nomInput.focus();
    }, 300);
}

// --- SALVA NUOVO ALLENATORE ---
function salvaNuovoAllenatore() {
    const nome = document.getElementById('input-nome').value.trim();
    const eta = parseInt(document.getElementById('input-eta').value);
    const rango = document.getElementById('input-rango').value;
    const desc = document.getElementById('input-desc').value.trim();

    if (!nome || isNaN(eta)) {
        alert("Inserisci almeno Nome ed Età.");
        return;
    }/*
    if (eta < 10) {
        alert("L'età minima è 10 anni!");
        return;
    } */
    if (eta > 99) {
        alert("L'età massima è 99 anni!");
        eta = 99;
        return;}
    if (eta < 10 || isNaN(eta)){ 
        alert("L'età minima è 10 anni!");
        eta = 10;
        return;}

    const nuovoAllenatore = {
        id: Date.now(),
        nome,
        eta,
        rango,
        descrizione: desc,
        immagine: currentTrainerImageData,
        natura: "",
        concetto: "",
        stats: {
            "Strength": 1, "Vitality": 1, "Dexterity": 1, "Insight": 1,
            "Tough": 1, "Beauty": 1, "Cool": 1, "Cute": 1, "Clever": 1,
            "Brawl": 0, "Throw": 0, "Evasion": 0, "Weapons": 0,
            "Empathy": 0, "Etiquette": 0, "Intimidate": 0, "Perform": 0,
            "Alert": 0, "Athletic": 0, "Nature": 0, "Stealth": 0,
            "Crafts": 0, "Lore": 0, "Medicine": 0, "Science": 0
        },
        zaino: [],
        soldi: 1500,
        team: []
    };

    allenatori.push(nuovoAllenatore);
    localStorage.setItem('pokeRole_Trainers', JSON.stringify(allenatori));
    chiudiModal();
    caricaAllenatori();
}

// --- MODALS ---
function menuAzione(index) {
    indiceSelezionato = index;
    document.getElementById('azione-titolo').innerText = allenatori[index].nome;
    lockBody();
    document.getElementById('modal-azione').style.display = "flex";
}

function procediVisualizza() {
    if (indiceSelezionato === null) return;
    const trainerSelezionato = allenatori[indiceSelezionato];
    sessionStorage.setItem('currentTrainerId', trainerSelezionato.id);
    window.location.href = 'trainer.html';
}

function eliminaAllenatoreDefinitivo() {
    allenatori.splice(indiceSelezionato, 1);
    localStorage.setItem('pokeRole_Trainers', JSON.stringify(allenatori));
    caricaAllenatori();
    chiudiModalConferma();
}

function chiudiModal() {
    unlockBody();
    document.getElementById('modal-creazione').style.display = "none";
    document.getElementById('input-nome').value = "";
    document.getElementById('input-eta').value = "10";
    document.getElementById('input-desc').value = "";

    currentTrainerImageData = "";
    const preview = document.getElementById('image-preview');
    const placeholder = document.getElementById('placeholder-text');
    const wrapper = document.querySelector('.image-upload-wrapper');

    if (preview) { preview.src = "#"; preview.style.display = "none"; }
    if (placeholder) placeholder.style.display = "block";
    if (wrapper) {
        wrapper.style.border = "2px dashed var(--border-color)";
        wrapper.style.background = "rgba(0,0,0,0.02)";
    }
    document.getElementById('trainer-image').value = "";
}

function chiudiModalAzione() {
    unlockBody();
    document.getElementById('modal-azione').style.display = "none";
}

function chiudiModalConferma() {
    unlockBody();
    document.getElementById('modal-conferma').style.display = "none";
}

function chiediConfermaCancellazione() {
    chiudiModalAzione();
    lockBody();
    document.getElementById('modal-conferma').style.display = "flex";
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    caricaConfigurazione();
    caricaAllenatori();
    MusicManager.playForScreen('index');
});

// Chiudi modal cliccando fuori
window.addEventListener('click', (e) => {
    if (e.target.classList.contains("modal")) {
        const id = e.target.id;
        if (id === 'modal-creazione') chiudiModal();
        else if (id === 'modal-azione') chiudiModalAzione();
        else if (id === 'modal-conferma') chiudiModalConferma();
        else {
            unlockBody();
            e.target.style.display = "none";
        }
    }
});

// Aggiornamento live quando arriva un import dal menu
window.addEventListener('trainersUpdated', () => {
    allenatori = JSON.parse(localStorage.getItem('pokeRole_Trainers')) || [];
    caricaAllenatori();
});

// Gestione tasto back Android

function mostraToastEsci() {
    const vecchio = document.getElementById('toast-esci');
    if (vecchio) vecchio.remove();

    const toast = document.createElement('div');
    toast.id = 'toast-esci';
    toast.textContent = 'Premi ancora per uscire';
    toast.style.cssText = `
        position: fixed;
        bottom: calc(32px + env(safe-area-inset-bottom, 0px));
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.82);
        color: white;
        padding: 12px 24px;
        border-radius: 24px;
        font-size: 0.9rem;
        font-weight: 700;
        font-family: 'Nunito', 'Segoe UI', sans-serif;
        z-index: 99999;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
        white-space: nowrap;
    `;

    document.body.appendChild(toast);

    requestAnimationFrame(() => { toast.style.opacity = '1'; });

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

/* if (window.Capacitor) {
    window.addEventListener('backButton', () => {
        if (window.location.href.includes('trainer.html')) {
            window.location.href = 'index.html';
        } else {
            mostraToastEsci();
        }
    });
} */
if (window.Capacitor) {
    // Segna la pagina corrente
    localStorage.setItem('currentPage', 
        window.location.href.includes('trainer.html') ? 'trainer' : 'home'
    );

    window.addEventListener('backButton', () => {
        if (window.location.href.includes('trainer.html')) {
            localStorage.setItem('currentPage', 'home');
            window.location.href = 'index.html';
        } else {
            mostraToastEsci();
        }
    });
}