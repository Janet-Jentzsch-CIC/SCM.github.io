// =====================================================================
// src/js/app.js – Haupt-Logik der PWA
// =====================================================================

// == 1. Modul-Importe ==================================================
import './header.js';

import {
    addShot,
    bulkAddShots,
    deleteShot,
    getAreas,
    getAss,
    getCurrentGoalkeeper,
    getGameTimerState,
    getSevenG6,
    getShots,
    getShowShotLines,
    getTF,
    getTor,
    initDB,
    setAreas,
    setAss,
    setCurrentGoalkeeper,
    setGameTimerState,
    setMatchInfo,
    setSevenG6,
    setShowShotLines,
    setTF,
    setTor
} from './db.js';

import {
    drawMarker,
    drawShotAreaLegacy,
    drawText,
    isPointInPolygon,
    isPointInShotAreaLegacy,
    relToCanvas
} from './canvasUtils.js';

/* --- 1.1 Farb-Konstanten für die verschiedenen Arten von Markern --- */
const COLOR_TEMP_MARKER = '#888'; // temporärer Marker bei Auswahl GRAU
const COLOR_GOAL_TOR = '#ff0000'; // Rot für „Tor“
const COLOR_GOAL_SAVE = '#00b050'; // Grün für Torwart-Parade
const COLOR_LINES = '#ffd700cc';   // Gelb-Gold, 80 % Deckkraft

let ass = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};
let sevenG6 = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};
let torCount = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};
let tfCount = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};

/* ===== Konstanten & globale Helfer ================================ */
const FIRST_HALF = 1;
const SECOND_HALF = 2;
const HALF_LENGTH = 30 * 60; // 30 min (Halbzeit)
const FULL_LENGTH = 60 * 60; // 60 min (Spielende)

function currentHalf() {
    return gameSeconds < HALF_LENGTH ? FIRST_HALF : SECOND_HALF;
}

/* =====================================================================
 *  Alle Halbzeit-abhängigen Badges & Button-States neu zeichnen
 * ===================================================================*/
function refreshHalfDependentUI() {
    updateAssBadge();
    updateSevenG6Badge();
    updateTorBadge();
    updateTFBadge();
}

/* =====================================================================
 *  1.1 Badge Updates
 * ===================================================================*/
function updateAssBadge() {
    const gk = currentGoalkeeper;
    const half = currentHalf();

    /* --- Badge-Rendering wie gehabt -------------------------------- */
    document.querySelector('#ass-value').innerHTML =
        `<div style="font-size:.85em">TW ${gk}<br>${half}. HZ</div>
         <div style="font-weight:700">${ass[gk][half]}</div>`;

    /* --- Button sperren, wenn Wert 0 --------------------------- */
    const decBtn = document.getElementById('ass-decrement');
    if (decBtn) decBtn.disabled = ass[gk][half] === 0;
}

function updateSevenG6Badge() {
    const gk = currentGoalkeeper;
    const half = currentHalf();

    document.querySelector('#seven-g6-value').innerHTML =
        `<div style="font-size:.85em">TW ${gk}<br>${half}. HZ</div>
         <div style="font-weight:700">${sevenG6[gk][half]}</div>`;

    const dec = document.getElementById('seven-g6-decrement');
    if (dec) dec.disabled = sevenG6[gk][half] === 0;
}

function updateTorBadge() {
    const gk = currentGoalkeeper;
    const half = currentHalf();

    document.querySelector('#tor-value').innerHTML =
        `<div style="font-size:.85em">TW ${gk}<br>${half}. HZ</div>
         <div style="font-weight:700">${torCount[gk][half]}</div>`;

    const dec = document.getElementById('tor-decrement');
    if (dec) dec.disabled = torCount[gk][half] === 0;
}

function updateTFBadge() {
    const gk = currentGoalkeeper;
    const half = currentHalf();

    document.querySelector('#tf-value').innerHTML =
        `<div style="font-size:.85em">TW ${gk}<br>${half}. HZ</div>
         <div style="font-weight:700">${tfCount[gk][half]}</div>`;

    const dec = document.getElementById('tf-decrement');
    if (dec) dec.disabled = tfCount[gk][half] === 0;
}

/* --- 1.2 Spezial-Konstante: virtuelle Goal-Area für 7 m -------- */
export const DUMMY_GOAL_ID = 999;

/* ----------------------------------------------
   Zuordnung shotArea → Statistik-Spalte
------------------------------------------------ */
/* Mapping Shot-Area → Statistik-Spalte */
const AREA_TO_COL = {
    rl: 'rl', rm: 'rm', rr: 'rr',
    la: 'la', ra: 'ra',
    dl: 'dl', dm: 'dm', dr: 'dr',
    km: 'km',
    gegenstoss: 'gs', '7m': '7m'
};

/* ---- Paraden (links) ------------------- */
const LEFT_COL_MAP = {
    rl: 3, rm: 4, rr: 5,
    km: 6,
    la: 7, ra: 8,
    dl: 9, dm: 10, dr: 11,
    gs: 12, '7m': 13
};

/* ---- Gegentore (rechts) ---------------- */
const RIGHT_COL_MAP = {
    rl: 18, rm: 19, rr: 20,
    km: 21,
    la: 22, ra: 23,
    dl: 24, dm: 25, dr: 26,
    gs: 27, '7m': 28
};

// == 2. Globale Runtime-States =========================================
// shots = **einzige** Quelle – egal ob online oder offline.
// Persistente Shots besitzen eine id (PK aus IndexedDB)
// Offline-Shots haben noch **keine** id (undefined)
let shots = []; // alle Würfe – synchron & unsynchron
let shotAreas = []; // Liste der Shot-Areas (Wurfzonen)
let goalAreas = []; // Liste der Goal-Areas (Torzonen)

/* =======  RIVAL GK Tracking  ========================================= */
let rivalShots = [];                       // Alle Würfe gegnerischer Keeper
let currentRivalGoalkeeper = 1;            // Start = „Torwart 1“
let currentRivalPos = null;                // zuletzt geklickte Wurfposition

/* Buttons erst aktivieren, sobald eine Pos. gewählt ist */
const enableRivalActionBtns = onOff => {
    ['goal-btn-rival', 'goalkeeper-save-btn-rival',
        'cancel-btn-rival', 'undo-btn-rival'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = !onOff;
        el.classList.toggle('active', onOff);
    });
};

// --- Caches --------------------
let shotAreaMap = new Map(); // id → das entsprechende Zonenobjekt
let goalAreaMap = new Map(); // id → das entsprechende Zonenobjekt

/* Registrierung-Workflow */
let currentStep = 1;
let currentShotPosition = null; // aktuell ausgewählte Shot-Area
let currentExactShotPos = null; // genaues rel. Koordinatenobjekt {x,y}
let currentExactGoalPos = null; // genaues rel. Koordinatenobjekt {x,y}

/* UI-Modi */
let showShotLines = false; // toggelt Verbindungslinien ein/aus

/* Canvas & Timer */
let canvas, ctx; // Canvas-Element + 2D-Context
let canvasWidth = 0; // aktuelle Breite des Darstellungsbereichs
let canvasHeight = 0; // aktuelle Höhe des Darstellungsbereichs
let gameSeconds = 0; // Gesamtzeit in Sekunden (Game Time)
let gameInterval = null; // Rückgabewert von setInterval
let gameRunning = false; // true = Timer läuft

/* Table cols */
const COLS = 33;
/**
 * Globale Variable für den aktuell gewählten Torwart.
 * Initial ist Torwart 1 aktiv.
 */
let currentGoalkeeper = 1;

// == 3. Boot-Strap =====================================================
document.addEventListener('DOMContentLoaded', () =>
    initApp().catch(err => console.error('[BOOT] Fehler:', err))
);

async function initApp() {
    // _____ Ass __________________________________________________________________
    ass = await getAss();
    // 2) Sicherstellen, dass die erwartete Struktur vorhanden ist
    if (!ass || typeof ass !== 'object') ass = {};
    for (const gk of [1, 2]) {
        ass[gk] ??= {};
        ass[gk][1] = Number(ass[gk][1] ?? 0);
        ass[gk][2] = Number(ass[gk][2] ?? 0);
    }

    // 3) Default persistieren
    await setAss(ass);
    updateAssBadge();

    /* „−“-Button initial deaktivieren, falls Wert == 0 */
    const decBtn = document.getElementById('ass-decrement');
    if (decBtn) {
        decBtn.disabled = ass[currentGoalkeeper][currentHalf()] === 0;
    }

    /* 3.1 IndexedDB initialisieren */
    await initDB();

    // _____ 7g6-Zähler __________________________________________________________________
    sevenG6 = await getSevenG6();
    if (!sevenG6 || typeof sevenG6 !== 'object') sevenG6 = {};
    for (const gk of [1, 2]) {
        sevenG6[gk] ??= {};
        sevenG6[gk][1] = Number(sevenG6[gk][1] ?? 0);
        sevenG6[gk][2] = Number(sevenG6[gk][2] ?? 0);
    }

    await setSevenG6(sevenG6);
    updateSevenG6Badge();

    /* _____ Tor-Zähler ______________________________________________ */
    torCount = await getTor();
    if (!torCount || typeof torCount !== 'object') torCount = {};
    for (const gk of [1, 2]) {
        torCount[gk] ??= {};
        torCount[gk][1] = Number(torCount[gk][1] ?? 0);
        torCount[gk][2] = Number(torCount[gk][2] ?? 0);
    }

    await setTor(torCount);
    updateTorBadge();

    // „–“-Button gleich beim Laden deaktivieren, wenn Wert 0 ist
    const torDec = document.getElementById('tor-decrement');
    if (torDec) torDec.disabled = torCount[currentGoalkeeper][currentHalf()] === 0;

    /* _____ TF-Zähler _____________________________________________________________ */
    tfCount = await getTF();
    for (const gk of [1, 2]) {
        tfCount[gk] ??= {};
        tfCount[gk][1] = Number(tfCount[gk][1] ?? 0);
        tfCount[gk][2] = Number(tfCount[gk][2] ?? 0);
    }
    await setTF(tfCount);
    updateTFBadge();

    // „–“-Button gleich beim Laden deaktivieren, wenn Wert 0 ist
    const tfDec = document.getElementById('tf-decrement');
    if (tfDec) tfDec.disabled = tfCount[currentGoalkeeper][currentHalf()] === 0;

    // „–“-Button gleich beim Laden deaktivieren, wenn Wert 0 ist
    const g6Dec = document.getElementById('seven-g6-decrement');
    if (g6Dec) g6Dec.disabled = sevenG6[currentGoalkeeper][currentHalf()] === 0;

    /* 3.2 Stammdaten (Areas + bereits existierende Shots) laden */
    const areas = await getAreas();
    shotAreas = areas.shotAreas;
    goalAreas = areas.goalAreas;

    // lookup maps
    shotAreaMap = new Map(shotAreas.map(a => [a.id, a]));
    goalAreaMap = new Map(goalAreas.map(a => [a.id, a]));

    shots = await getShots();

    /* 3.3 Canvas + Timer + UI */
    initCanvas();
    await initTimers();
    updateStatsHeading(); // korrigiert Überschrift gleich beim Start

    // Show-Lines-Status aus IndexedDB wiederherstellen
    showShotLines = await getShowShotLines();
    const checkbox = document.getElementById('show-lines-toggle');
    if (checkbox) checkbox.checked = showShotLines;

    setupEventListeners();
    initAreaEditors();
    updateStatistics(); // Zeichnet erstes Stats-Bild, noch ohne Shots
    drawAreas(); // Rendert alle Areas (Shot + Goal)

    /* 3.4 Online/Offline-Sync */
    window.addEventListener('online', handleConnectionChange);
    window.addEventListener('offline', handleConnectionChange);
    await handleConnectionChange();

    /* 3.5 Service-Worker-Lifecycle */
    initServiceWorkerLifecycle();

    /* Buttons direkt nach dem Laden korrekt initialisieren */
    updateButtonStates();

    /* init Shot-Tabelle */
    renderShotTable();
    /** init GK-overview table */
    //renderGkOverviewTable();
    renderRivalShotTable();
    enableRivalActionBtns(false);
}

// == 4. Canvas-Initialisierung =========================================
function initCanvas() {
    canvas = document.getElementById('court-canvas');
    ctx = canvas.getContext('2d');

    // TODO
    // Klick-Handler **hier** anbinden, weil wir das Canvas sicher haben
    // canvas.addEventListener('click', handleCanvasClick);
    // Click-Listener wird zentral in setupEventListeners() gebunden

    const bg = document.getElementById('background-image');
    // Falls bg (Bild) bereits geladen: sofort Größe setzen
    bg.complete ? setCanvasSize() : (bg.onload = setCanvasSize);

    window.addEventListener('resize', setCanvasSize);
}

function setCanvasSize() {
    const box = document.querySelector('.background-container');
    canvasWidth = box.clientWidth;
    canvasHeight = box.clientHeight;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    /* Wichtig: globale Kopie auf window hängen, damit Hit-Test darauf zugreifen kann */
    window.canvasWidth = canvasWidth;
    window.canvasHeight = canvasHeight;

    drawAreas();
}

// == 5. Event-Binding & UI-Helper =======================================
const on = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
};

function setupEventListeners() {
    /* Timer */
    on('start-pause-btn', 'click', toggleGameTimer);
    on('reset-btn', 'click', resetGameTimer);

    /* Manuelle ±-Buttons */
    on('rewind-fast-btn', 'click', () => adjustGameSeconds(-10)); // «<<
    on('rewind-btn', 'click', () => adjustGameSeconds(-1)); //  «
    on('forward-btn', 'click', () => adjustGameSeconds(+1)); //  »
    on('forward-fast-btn', 'click', () => adjustGameSeconds(+10)); // »»

    if (canvas) canvas.addEventListener('click', handleCanvasClick);

    /* Ergebnis-Buttons */
    on('goal-btn', 'click', () => finishShot(false));
    on('goalkeeper-save-btn', 'click', () => finishShot(true));
    on('cancel-btn', 'click', resetRegistrationProcess);

    /* Optionen: Show-Lines-Toggle */
    on('show-lines-toggle', 'change', async e => {
        showShotLines = e.target.checked;
        await setShowShotLines(showShotLines);
        drawAreas();
    });

    /* Globale Aktionen: Export, Undo, Clear All */
    on('export-btn', 'click', exportData);
    on('undo-btn', 'click', undoLastShot);

    /* CLEAR ALL mit Sicherheitsfrage */
    on('clear-btn', 'click', async () => {
        const msg = 'Wirklich ALLES zurücksetzen?\n' +
            '(Shots, Timer, Show-Lines, Torwart …)';
        if (!confirm(msg)) return;
        await hardResetGame();
    });

    /* === Ass Buttons ================================== */
    on('ass-increment', 'click', () => changeAss(+1));
    on('ass-decrement', 'click', () => changeAss(-1));

    /* === 7g6 Buttons =================================== */
    on('seven-g6-increment', 'click', () => changeSevenG6(+1));
    on('seven-g6-decrement', 'click', () => changeSevenG6(-1));

    /* === Tor Buttons ==================================== */
    on('tor-increment', 'click', () => changeTor(+1));
    on('tor-decrement', 'click', () => changeTor(-1));

    /* === TF Buttons ==================================== */
    on('tf-increment', 'click', () => changeTF(+1));
    on('tf-decrement', 'click', () => changeTF(-1));

    /* Torwart-Toggle initialisieren */
    changeGoalkeeper().catch(err => console.error('[GK] Fehler:', err));


    /* --------------------------------------------------
     *  RIVAL – Positions- & Action-Buttons
     * -------------------------------------------------- */
    const rivalPosBtns = document
        .querySelectorAll('.gk-overview-positions-btns-container .gk-overview-action-btn');

    rivalPosBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            /* 1 Position merken */
            currentRivalPos = btn.textContent.trim().toLowerCase();   // 'ra', 'km' …

            /* 2 UI: Aktiv-Highlight */
            rivalPosBtns.forEach(b => b.classList.toggle('active-pos', b === btn));

            /* 3 Aktion-Buttons freischalten */
            enableRivalActionBtns(true);
        });
    });

    /* Action-Buttons */
    on('goal-btn-rival', 'click', () => finishRivalShot(false));
    on('goalkeeper-save-btn-rival', 'click', () => finishRivalShot(true));
    on('cancel-btn-rival', 'click', resetRivalProcess);
    on('undo-btn-rival', 'click', undoLastRivalShot);

    /* GK-Toggle (Rival) */
    const rivalToggle = document.querySelector('.gk-overview-toggle-btn');
    if (rivalToggle) {
        rivalToggle.addEventListener('click', () => {
            currentRivalGoalkeeper = currentRivalGoalkeeper === 1 ? 2 : 1;
            rivalToggle.textContent = `Torwart ${currentRivalGoalkeeper}`;
            renderRivalShotTable();              // Tabelle neu
        });
    }

}

/* ===================================================================
 *  RIVAL : Shot fertigstellen
 * ===================================================================*/
async function finishRivalShot(isSave) {
    if (!currentRivalPos) {                   // keine Pos. gewählt
        showToast('Erst eine Wurfposition wählen!', 'offline');
        return;
    }

    const shot = {
        timestamp: new Date().toISOString(),
        gameTime: formatTime(gameSeconds),
        gameMinutesFloor: Math.floor(gameSeconds / 60),
        gameSeconds,
        shotCategory: currentRivalPos,        // z.B. 'ra'
        isGoalkeeperSave: isSave,
        goalkeeperId: currentRivalGoalkeeper,
        team: 'rival'                         // <<< einziges Unterscheidungsmerkmal
    };

    /* sofort persistieren, falls online */
    if (navigator.onLine) {
        shot.id = await addShot(shot);        // bestehende DB-API weiter nutzen
    }
    shots.push(shot);                       // in globales Array
    rivalShots.push(shot);                  // separat für schnelle Filterung

    renderRivalShotTable();                 // Mini-Tabelle rechts
    resetRivalProcess();
}


/* Reset nur für den Workflow des Rivals */
function resetRivalProcess() {
    currentRivalPos = null;
    enableRivalActionBtns(false);
    document
        .querySelectorAll('.gk-overview-action-btn')
        .forEach(b => b.classList.remove('active-pos'));
}

function undoLastRivalShot() {
    const last = rivalShots.pop();
    if (!last) {
        showToast('Kein Eintrag zum Rückgängigmachen', 'offline');
        return;
    }
    /* auch aus globaler shots-Liste entfernen */
    const idx = shots.findIndex(s => s.timestamp === last.timestamp);
    if (idx > -1) shots.splice(idx, 1);

    if (last.id) {               // schon in DB?
        deleteShot(last.id).catch(() => console.warn('[RIVAL] DB-Undo fehlgeschlagen'));
    }
    renderRivalShotTable();
    showToast('Letzter Rival-Shot zurückgenommen', 'update');
}


function renderRivalShotTable() {
    /* --------------------------------------------------------------
       Ziel-Container ► Tabelle für den RIVAL-Keeper
       (s. index.html → <aside id="gk-overview-rival-table">)
    -------------------------------------------------------------- */
    const cont = document.getElementById('gk-overview-rival-table');

    if (!cont) return;

    /* nur Shots des aktuellen RIVAL-Keepers */
    const rows = shots
        .filter(s => s.team === 'rival' && (s.goalkeeperId ?? 1) === currentRivalGoalkeeper)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    cont.innerHTML = '';
    const tbl = document.createElement('table');
    tbl.className = 'shot-table';
    tbl.innerHTML = `
    <thead>
      <tr><th>#</th><th>Min</th><th>Shot A</th><th>Goal A</th></tr>
    </thead><tbody></tbody>`;
    cont.appendChild(tbl);

    const tb = tbl.querySelector('tbody');
    rows.forEach((s, i) => {
        const tr = document.createElement('tr');
        tr.className = s.isGoalkeeperSave ? 'shot-row--save' : 'shot-row--goal';
        tr.innerHTML = `
      <td>${rows.length - i}</td>
      <td>${Math.ceil(s.gameSeconds / 60)}'</td>
      <td>${s.shotCategory.toUpperCase()}</td>
      <td>${s.isGoalkeeperSave ? '–' : 'Tor'}</td>`;
        tb.appendChild(tr);
    });
    if (!rows.length) {
        tb.innerHTML = `<tr><td colspan="4" style="padding:8px;">No shots yet …</td></tr>`;
    }
}


// == 6. Area-Editor-Setup ==============================================
function initAreaEditors() {
    const root = document.getElementById('areas-editor-content');
    if (!root) return;

    if (!document.getElementById('shot-areas-editor')) {
        root.innerHTML = `
            <div class="editor-lists">
                <div id="shot-areas-editor" class="area-list"></div>
                <div id="goal-areas-editor" class="area-list"></div>
            </div>
            <div class="editor-actions">
                <button id="save-areas-btn" class="btn-primary">Save Areas</button>
            </div>
            <form id="area-edit-form" class="editor-form" style="display:none;">
                <input id="area-name-input" placeholder="Name">
                <input id="area-color-input" placeholder="Farbe (Hex)">
                <textarea id="area-coords-input" rows="5" placeholder="Koordinaten JSON"></textarea>
                <div class="form-buttons">
                    <button type="button" id="area-save-btn">Save</button>
                    <button type="button" id="area-cancel-btn">Cancel</button>
                </div>
            </form>
        `;
    }

    // Funktion zum Rendern der Listen (Shot- und Goal-Areas)
    function renderLists() {
        ['shot', 'goal'].forEach(type => {
            const container = document.getElementById(`${type}-areas-editor`);
            const arr = type === 'shot' ? shotAreas : goalAreas;
            container.innerHTML = '';
            const ul = document.createElement('ul');
            arr.forEach(area => {
                const li = document.createElement('li');
                li.textContent = area.name;

                const editBtn = document.createElement('button');
                editBtn.textContent = 'Edit';
                editBtn.onclick = () => openEditForm(area, type);

                const delBtn = document.createElement('button');
                delBtn.textContent = '✕';
                delBtn.onclick = () => deleteArea(area.id, type);

                li.append(' ', editBtn, ' ', delBtn);
                ul.appendChild(li);
            });
            container.appendChild(ul);
        });
    }

    // Speichern der Areas-Daten in IndexedDB
    on('save-areas-btn', 'click', async () => {
        await setAreas(shotAreas, goalAreas);
        shotAreaMap = new Map(shotAreas.map(a => [a.id, a]));
        goalAreaMap = new Map(goalAreas.map(g => [g.id, g]));
        showToast('Areas gespeichert', 'update');
    });

    let editArea = null, editType = null;

    function openEditForm(area, type) {
        editArea = {...area};
        editType = type;
        const form = document.getElementById('area-edit-form');
        form.style.display = 'block';
        form.querySelector('#area-name-input').value = area.name;
        form.querySelector('#area-color-input').value = area.color;
        form.querySelector('#area-coords-input').value = JSON.stringify(area.coords, null, 2);
    }

    on('area-cancel-btn', 'click', () => {
        document.getElementById('area-edit-form').style.display = 'none';
    });

    on('area-save-btn', () => {
        const form = document.getElementById('area-edit-form');
        let coords;
        try {
            coords = JSON.parse(form.querySelector('#area-coords-input').value);
        } catch {
            alert('Koordinaten kein gültiges JSON');
            return;
        }
        editArea.name = form.querySelector('#area-name-input').value || editArea.name;
        editArea.color = form.querySelector('#area-color-input').value || editArea.color;
        editArea.coords = coords;

        const arr = editType === 'shot' ? shotAreas : goalAreas;
        const idx = arr.findIndex(a => a.id === editArea.id);
        if (idx > -1) arr[idx] = editArea;

        if (editType === 'shot') {
            shotAreaMap.set(editArea.id, editArea); // Den bestehenden Verweis überschreiben
        } else {
            goalAreaMap.set(editArea.id, editArea);
        }

        form.style.display = 'none';
        renderLists();
        drawAreas();
        showToast('Area aktualisiert – DB-Speicher nicht vergessen', 'update');
    });

    function deleteArea(id, type) {
        if (!confirm('Diese Area wirklich löschen?')) return;
        const arr = type === 'shot' ? shotAreas : goalAreas;
        const idx = arr.findIndex(a => a.id === id);
        if (idx > -1) arr.splice(idx, 1);
        if (type === 'shot') {
            shotAreaMap.delete(id);
        } else {
            goalAreaMap.delete(id);
        }
        renderLists();
        drawAreas();
        showToast('Area gelöscht – DB-Speicher nicht vergessen', 'update');
    }

    renderLists();
}

/* --------------------------------------------------------------
   Shot-Tabelle (rechte Spalte) – erzeugt/aktualisiert die Tabelle
----------------------------------------------------------------*/
function makeEmptyStatRow(goalkeeperName, halfLabel = '') {
    const row = document.createElement('tr');
    for (let col = 0; col < COLS; col++) {
        const td = document.createElement('td');
        if (col >= 2 && col !== DIVIDER_IDX) td.textContent = '';
        if (col === ASS_IDX && !document.getElementById('ass-cell')) {
            td.id = 'ass-cell';
        }

        row.appendChild(td);
    }

    /* Meta-Infos in die ersten beiden Spalten schreiben */
    row.children[0].textContent = goalkeeperName;
    row.children[1].textContent = halfLabel;

    // Datensatz-Key für Direktzugriff
    const isTw1 = goalkeeperName.startsWith('TW1');
    const half = halfLabel === '01-30' ? 1 : 2;

    row.dataset.key = `${isTw1 ? 1 : 2}-${half}`;
    return row;
}

function renderShotTable() {
    const cont = document.getElementById('shot-table-container');
    if (!cont) return;

    /* 1) Alle Shots des aktiven Keepers in umgekehrter Chronologie */
    const rows = shots
        .filter(s => s.team !== 'rival' &&
            (s.goalkeeperId ?? 1) === currentGoalkeeper)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    /* 2) Leeren + Grundgerüst aufbauen */
    cont.innerHTML = '';
    const tbl = document.createElement('table');
    tbl.className = 'shot-table';
    tbl.innerHTML = `
        <thead>
            <tr>
                <th>#</th>
                <th>m</th>
                <th>W</th>
                <th>T</th>
            </tr>
        </thead>
        <tbody></tbody>`;
    cont.appendChild(tbl);

    const tbody = tbl.querySelector('tbody');

    /* 3) Jede Zeile füllen */
    rows.forEach((s, idx) => {
        /* 1. Den Namen speziell für **diese** Zeile ermitteln */
        const goalLabel =
            (s.goalAreaId === DUMMY_GOAL_ID)
                ? '7m'
                : (goalAreaMap.get(s.goalAreaId)?.name ?? '–');

        // Schnellzugriff auf den Namen der Wurfzone
        const shotName = shotAreaMap.get(s.shotAreaId)?.name ?? '–';

        /* 2. Eine Zeile für die Tabelle erstellen */
        const tr = document.createElement('tr');
        tr.className = s.isGoalkeeperSave ? 'shot-row--save' : 'shot-row--goal';

        const min = Math.ceil(s.gameSeconds / 60) || 0;

        tr.innerHTML = `
        <td>${rows.length - idx}</td>
        <td>${min}'</td>
        <td>${shotName}</td>
        <td>${goalLabel}</td>
    `;

        tbody.appendChild(tr);
    });

    /* 4) Fallback, falls noch keine Shots existieren */
    if (!rows.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="4" style="padding:8px;">No shots yet …</td>`;
        tbody.appendChild(tr);
    }
}

function renderGkOverviewTable() {
    /* --------------------------------------------------------------
       Neuer Ziel-Container ► Tabelle für den EIGENEN Keeper
       (s. index.html → <aside id="gk-overview-own-table">)
    -------------------------------------------------------------- */
    const cont = document.getElementById('gk-overview-own-table');

    if (!cont) return;

    /* 1) Alle Shots des aktiven Keepers in umgekehrter Chronologie */
    const rows = shots
        .filter(s => s.team !== 'rival' &&
            (s.goalkeeperId ?? 1) === currentGoalkeeper)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    /* 2) Leeren + Grundgerüst aufbauen */
    cont.innerHTML = '';
    const tbl = document.createElement('table');
    tbl.className = 'shot-table';
    tbl.innerHTML = `
        <thead>
            <tr>
                <th>#</th>
                <th>m</th>
                <th>W</th>
                <th>%</th>
            </tr>
        </thead>
        <tbody></tbody>`;
    cont.appendChild(tbl);

    const tbody = tbl.querySelector('tbody');

    /* 3) Jede Zeile füllen */
    rows.forEach((s, idx) => {
        /* 1. Den Namen speziell für **diese** Zeile ermitteln */
        const goalLabel =
            (s.goalAreaId === DUMMY_GOAL_ID)
                ? '7m'
                : (goalAreaMap.get(s.goalAreaId)?.name ?? '–');

        // Schnellzugriff auf den Namen der Wurfzone
        const shotName = shotAreaMap.get(s.shotAreaId)?.name ?? '–';

        /* 2. Eine Zeile für die Tabelle erstellen */
        const tr = document.createElement('tr');
        tr.className = s.isGoalkeeperSave ? 'shot-row--save' : 'shot-row--goal';

        const min = Math.ceil(s.gameSeconds / 60) || 0;

        tr.innerHTML = `
        <td>${rows.length - idx}</td>
        <td>${min}'</td>
        <td>${shotName}</td>
        <td>Percentage</td>
    `;

        tbody.appendChild(tr);
    });

    /* 4) Fallback, falls noch keine Shots existieren */
    if (!rows.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="4" style="padding:8px;">No shots yet …</td>`;
        tbody.appendChild(tr);
    }
}

// == 7. Canvas-Interaktion ==============================================
/**
 * Behandelt einen Klick auf das Spielfeld-Canvas.
 *
 * Logik ohne Step-Indicator:
 * ‒ Wenn noch keine Wurfposition gewählt wurde ⇒ erster Klick
 * ‒ Sonst – sofern noch keine Torposition gewählt wurde ⇒ zweiter Klick
 * ‒ Alle Prüfungen laufen über das Vorhandensein der beiden
 *   State-Variablen `currentShotPosition` und `currentExactGoalPos`.
 *
 * @param {MouseEvent} e – Maus-/Touch-Event
 */
function handleCanvasClick(e) {
    const {relX, relY} = getRelCoords(e);

    /* ---------- 1) Erster Klick ⇒ Shot-Area festlegen -------------- */
    if (!currentShotPosition) {
        const area = findShotAreaAtPoint(relX, relY, shotAreas);
        if (!area) return; // ausserhalb → abbrechen

        paintTempMarker(relX, relY); // gelben Marker malen
        currentShotPosition = area; // Wurfzone merken
        currentExactShotPos = {x: relX, y: relY};

        /* === Sonderfall: 7-Meter → zweiter Klick entfällt ========= */
        if (area.name === '7m') {
            /* Dummy-Goal-Pos anlegen (gleiche Koordinate) */
            currentExactGoalPos = {x: relX, y: relY};
            currentStep = 2; // Schritt überspringen
            updateButtonStates();// Tor / Gehalten sofort aktiv
            drawAreas(); // Marker neu zeichnen
            return; // fertig – auf Button-Click warten
        }

        currentStep = 2; // Cursor wechselt zu Schritt 2
        updateButtonStates(); // Cancel sofort aktiv

        return; // fertig – auf zweiten Klick warten
    }

    /* --------------------------------------------------------------
       2) Zweiter Klick ⇒ Torzone (Goal Area) festlegen
    ----------------------------------------------------------------*/
    if (!currentExactGoalPos) {
        const area = findAreaAtPoint(relX, relY, goalAreas);
        if (!area) return; // ausserhalb → abbrechen

        paintTempMarker(relX, relY); // roten Marker malen

        currentExactGoalPos = {x: relX, y: relY};

        updateButtonStates(); // Tor / Gehalten Buttons aktiv
        drawAreas(); // Canvas komplett neu zeichnen
    }
}

// == 8. Workflow-Steuerung =============================================
/**
 * Aktualisiert die drei Overlay-Buttons (Tor · Gehalten · Cancel).
 *  • Tor / Gehalten werden erst aktiv, wenn sowohl Shot- als auch Goal-Pos gesetzt sind.
 *  • Cancel wird **nur** aktiv, sobald der Nutzer mit Schritt 1 begonnen hat
 *    (es also etwas gibt, das man überhaupt abbrechen kann).
 */
function updateButtonStates() {
    const stepReady = currentStep === 2 && !!currentExactGoalPos; // beide Klicks erledigt

    /* === 1) Tor / Gehalten ====================================== */
    document
        .getElementById('goal-btn')
        .classList.toggle('active', stepReady);

    document
        .getElementById('goalkeeper-save-btn')
        .classList.toggle('active', stepReady);

    /* === 2) Cancel – erlaubt, sobald *mindestens* erster Klick erfolgt ist */
    const cancelPossible = !!currentShotPosition; // schon ein Shot-Bereich gewählt?
    document
        .getElementById('cancel-btn')
        .classList.toggle('active', cancelPossible);

    /* === 3) Undo – nur aktiv, wenn
        • mindestens 1 fertig erfasster Shot existiert UND
        • aktuell *kein* Shot-Vorgang läuft (= kein erster Klick)   */
    const undoReady = shots.length > 0 // es gibt überhaupt noch Shots
        && !currentShotPosition // kein Vorgang läuft
        && currentStep === 1; // Registrier-Workflow ruht
    // damit bleibt Undo aktiv, solange mindestens noch ein Shot existiert.
    const undoBtn = document.getElementById('undo-btn');
    undoBtn.classList.toggle('active', undoReady);
    undoBtn.disabled = !undoReady;
}

function resetRegistrationProcess() {
    currentStep = 1; // interner State
    currentShotPosition = null;
    currentExactShotPos = null;
    currentExactGoalPos = null;
    updateButtonStates();
    drawAreas();
}

/**
 * Schließt einen Wurf ab und persistiert ihn (inkl. GK-Zuweisung und
 * Spielzeit in Sekunden). Ergänzt das shot-Objekt um gameSeconds, damit
 * wir später die aufgerundete Minute zeichnen können.
 *
 * @param {boolean} gkSave – true = Torwart-Parade, false = Tor
 */
async function finishShot(gkSave = false) {
    /* --- Plausibilitätsprüfungen ------------------------------------- */
    if (!currentShotPosition || !currentExactShotPos || !currentExactGoalPos) {
        showToast('Ungültiger Wurf – bitte alle Schritte abschließen', 'offline');
        return;
    }

    /* --- Torzone (Goal-Area) ermitteln ----------------------------- */
    let goalArea = findAreaAtPoint(
        currentExactGoalPos?.x ?? 0,
        currentExactGoalPos?.y ?? 0,
        goalAreas
    );

    /* 7-Meter = kein Klick aufs Großtor → Dummy-Area anlegen */
    if (!goalArea && currentShotPosition.name === '7m') {
        goalArea = {id: DUMMY_GOAL_ID, name: '7m', color: '#8E070C'}; // rein für das vollständige Objekt
    }

    if (!goalArea) return; // für alle anderen Fälle weiter abbrechen

    /* --------------------------------------------------------------
   Shot-Objekt OHNE id  →  Schlüssel vergibt IndexedDB
    ----------------------------------------------------------------*/
    const shot = {
        timestamp: new Date().toISOString(),
        gameTime: formatTime(gameSeconds),
        gameMinutesFloor: Math.floor(gameSeconds / 60),
        gameSeconds,
        shotAreaId: currentShotPosition.id,
        goalAreaId: goalArea.id,
        shotCategory: currentShotPosition.name,
        exactShotPos: currentExactShotPos,
        exactGoalPos: currentExactGoalPos,
        isGoalkeeperSave: gkSave,
        goalkeeperId: currentGoalkeeper
    };

    /* --- In-Memory Array + UI-Updates ------------------------------ */
    /* --- Persistenz + ID ------------------------------------------------ */
    if (navigator.onLine) {
        // Online ⇒ sofort persistieren ⇒ id zurückschreiben
        shot.id = await addShot(shot);
    }
    shots.push(shot);
    updateStatistics();
    renderShotTable();
    // renderGkOverviewTable()
    renderGKStatTable();
    resetRegistrationProcess();
}

// == 9. Zeichnen & Statistik ===========================================
/**
 * Zeichnet ein halbtransparentes Rechteck.
 */
function drawRectArea(ctx, area, w, h) {
    const {x1, y1, x2, y2} = area.coords;
    ctx.save();
    ctx.fillStyle = area.color + '22';
    ctx.strokeStyle = area.color;
    ctx.lineWidth = 2;
    ctx.fillRect(x1 * w, y1 * h, (x2 - x1) * w, (y2 - y1) * h);
    ctx.strokeRect(x1 * w, y1 * h, (x2 - x1) * w, (y2 - y1) * h);
    /* Label mittig */
    ctx.fillStyle = '#000';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(area.name,
        (x1 + x2) / 2 * w,
        (y1 + y2) / 2 * h);
    ctx.restore();
}

/* ==============================================================
 * Kleine Hilfsfunktion: zeichnet einen temp. Marker,
 * wenn eine Position übergeben wurde.
 * ============================================================== */
function drawTempMarkerIfAvailable(pos) {
    if (!pos) return;
    const p = relToCanvas(pos.x, pos.y, canvas);
    drawMarker(ctx, p.x, p.y, 6, COLOR_TEMP_MARKER);
}

function drawAreas() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    /* 1) Shot-Areas – Legacy vs. Rechteck */
    shotAreas.forEach(area => {
        if (area.id <= 9) {
            drawShotAreaLegacy(ctx, area, canvasWidth, canvasHeight, 0.35);
        } else {
            drawRectArea(ctx, area, canvasWidth, canvasHeight);
        }
    });

    /* 2) Goal-Areas – Rechtecke + Label */
    goalAreas.forEach(area => {
        const x1 = area.coords.x1 * canvasWidth;
        const y1 = area.coords.y1 * canvasHeight;
        const x2 = area.coords.x2 * canvasWidth;
        const y2 = area.coords.y2 * canvasHeight;

        ctx.save();
        ctx.fillStyle = area.color + '22';
        ctx.strokeStyle = area.color;

        ctx.lineWidth = 3;
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.restore();
    });

    /* ---------- Früh-Exit, wenn es noch GAR KEINE Shots gibt ------ */
    if (!shots.length) {
        drawTempMarkerIfAvailable(currentExactShotPos);
        drawTempMarkerIfAvailable(currentExactGoalPos);
        return; // keine weiteren Berechnungen nötig
    }

    /* 3) Verbindungslinien (falls aktiviert) – nur für akt. GK */
    // const visibleShots = shots.filter(s => (s.goalkeeperId ?? 1) === currentGoalkeeper);

    const visibleShots = shots

        // .filter(s => s.team!=='rival' && (s.goalkeeperId ?? 1) === currentGoalkeeper);

        .filter(s => s.team !== 'rival' &&
            (s.goalkeeperId ?? 1) === currentGoalkeeper)

    if (showShotLines) {
        ctx.save();
        ctx.strokeStyle = COLOR_LINES;
        ctx.lineWidth = 1;
        visibleShots.forEach(s => {
            const start = relToCanvas(s.exactShotPos.x, s.exactShotPos.y, canvas);
            const end = relToCanvas(s.exactGoalPos.x, s.exactGoalPos.y, canvas);
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
        });
        ctx.restore();
    }

    /* 4) Permanente Marker + Minuten-Label */
    visibleShots.forEach(s => {
        const shotPt = relToCanvas(s.exactShotPos.x, s.exactShotPos.y, canvas);
        const goalPt = relToCanvas(s.exactGoalPos.x, s.exactGoalPos.y, canvas);
        const col = s.isGoalkeeperSave ? COLOR_GOAL_SAVE : COLOR_GOAL_TOR;

        drawMarker(ctx, shotPt.x, shotPt.y, 12, col);
        drawMarker(ctx, goalPt.x, goalPt.y, 8, col);

        drawText(
            ctx,
            String(Math.ceil(s.gameSeconds / 60) || 0),
            shotPt.x,
            shotPt.y,
            '12px Arial',
            '#000'
        );
    });

    /* 5) Aktuelle, noch ungespeicherte Auswahl */
    drawTempMarkerIfAvailable(currentExactShotPos);
    drawTempMarkerIfAvailable(currentExactGoalPos);
}

/** Statistik-Update – Reihenfolge fixiert (shotContainer zuerst!) */
/**
 * Erzeugt/aktualisiert Statistik-Boxen (Shot Positions, Goal Areas).
 * ▸ Es werden **nur** die Würfe des aktuell gewählten Torwarts
 *   berücksichtigt (Filter über goalkeeperId).
 * ▸ Alte Datensätze ohne goalkeeperId → werden als GK 1 interpretiert.
 */
function updateStatistics() {
    /* ---- 1) Relevante Würfe für aktuellen Torwart vorfiltern ------ */
    const relevantShots = shots
        .filter(s => s.team !== 'rival' &&
            (s.goalkeeperId ?? 1) === currentGoalkeeper // Fallback=1
        );

    /* ---- 2) UI-Container für Shot- und Goal-Stats holen ----------- */
    const shotContainer = document.getElementById('shot-positions-stats');
    const goalContainer = document.getElementById('goal-areas-stats');

    /* ---- 3) Leerer Zustand (kein einziger relevanter Schuss) ------- */
    if (!relevantShots.length) {
        shotContainer.innerHTML = '<div class="stat-box">Keine Schüsse vorhanden</div>';
        goalContainer.innerHTML = '';
        return;
    }

    /* ---- 4) Grunddaten für Prozentberechnung ---------------------- */
    const total = relevantShots.length;

    /* ---- 5) Shot-Positions (Wurfzonen) ----------------------------- */
    shotContainer.innerHTML = '';
    shotAreas.forEach(area => {
        const count = relevantShots.filter(s => s.shotAreaId === area.id).length;
        const pct = ((count / total) * 100).toFixed(1);
        shotContainer.appendChild(makeStatBox(area.name, count, pct));
    });

    /* ---- 6) Goal-Areas ------------------------------------------------ */
    goalContainer.innerHTML = '';
    goalAreas.forEach(area => {
        const count = relevantShots.filter(s => s.goalAreaId === area.id).length;
        const pct = ((count / total) * 100).toFixed(1);
        goalContainer.appendChild(makeStatBox(area.name, count, pct));
    });

    /* ---- stat-Box-Factory ------------------------------------------ */
    function makeStatBox(label, count, pct) {
        const div = document.createElement('div');
        div.className = 'stat-box';
        div.innerHTML = `
            <div class="stat-position">${label}</div>
            <div class="stat-count">${count}</div>
            <div class="stat-percent">${pct}%</div>
        `;
        return div;
    }
}

// == 10. Timer-Logik =====================================================
async function initTimers() {
    const state = await getGameTimerState();
    gameSeconds = state.seconds;
    gameRunning = state.isRunning;

    document.getElementById('game-time').textContent = formatTime(gameSeconds);
    document.getElementById('reset-btn').disabled = gameRunning;
    const startPauseBtn = document.getElementById('start-pause-btn');
    startPauseBtn.textContent = gameRunning ? 'Pause' : 'Start';

    if (gameRunning) {
        gameInterval = setInterval(updateGameTime, 1000);
    }
}

function toggleGameTimer() {
    const btn = document.getElementById('start-pause-btn');

    if (gameRunning) {
        clearInterval(gameInterval);
        btn.textContent = 'Resume';
    } else {
        gameInterval = setInterval(updateGameTime, 1000);
        btn.textContent = 'Pause';
    }

    gameRunning = !gameRunning;
    document.getElementById('reset-btn').disabled = gameRunning;

    // Zustand speichern
    setGameTimerState(gameSeconds, gameRunning).then(r => {
    });
}

/**
 * Passt die Spielzeit um «diff» Sekunden an (clamped 0 … FULL_LENGTH)
 * und speichert den Zustand in IndexedDB.
 */
function adjustGameSeconds(diff) {
    const prevHalf = currentHalf(); // vorherige HZ merken

    gameSeconds = Math.max(0, Math.min(FULL_LENGTH, gameSeconds + diff));
    document.getElementById('game-time').textContent = formatTime(gameSeconds);

    if (currentHalf() !== prevHalf) { // Halbzeit gewechselt?
        refreshHalfDependentUI();
    }

    setGameTimerState(gameSeconds, gameRunning) // speichern
        .catch(console.error);
}

async function updateGameTime() {
    /* 1) Zeit hochzählen & Anzeige aktualisieren */
    gameSeconds++;
    document.getElementById('game-time').textContent = formatTime(gameSeconds);

    /* 2) Auto-Stopps bei 30:00 (HZ) und 60:00 (Ende) */
    if (gameSeconds === HALF_LENGTH || gameSeconds === FULL_LENGTH) {

        /* — Timer anhalten & Zustand speichern — */
        toggleGameTimer(); // pausiert + speichert State

        /* === 30:00 min ⇒ Halbzeit-Aktionen ===================== */
        if (gameSeconds === HALF_LENGTH) {
            await autoFillHalftimeScore(); // Ergebnis automatisch eintragen

            refreshHalfDependentUI();
        }

        /* === 60:00 min ⇒ Ende-Aktionen ========================= */
        if (gameSeconds === FULL_LENGTH)
            await autoFillFulltimeScore(); // Endstand eintragen
    }

    /* 3) Fortschritt persistent speichern */
    if (gameRunning) {
        await setGameTimerState(gameSeconds, true).catch(console.error);
    }
}

function resetGameTimer() {
    clearInterval(gameInterval);
    gameSeconds = 0;
    gameRunning = false;
    document.getElementById('start-pause-btn').textContent = 'Start';
    document.getElementById('game-time').textContent = formatTime(0);
    document.getElementById('reset-btn').disabled = false;

    // Zustand zurücksetzen
    setGameTimerState(0, false).catch(err =>
        console.error('[Timer] setGameTimerState fehlgeschlagen:', err)
    );
}

// Hilfsfunktion: Formatiert Sekundenwert in "m:ss"
const formatTime = sec =>
    `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

// == 11. Online/Offline & DB Sync =======================================
async function handleConnectionChange() {
    if (navigator.onLine) {
        document.querySelector('.toast--offline')?.remove();

        // --- 1) Alle **noch nicht** persistierten Shots (id == undefined)
        const unsynced = shots.filter(s => s.id == null);

        if (unsynced.length) {
            /* 2) Bulk-Insert – bulkAddShots ergänzt **in-place** die id   */
            await bulkAddShots(unsynced);

            /* 3) UI refreshen (IDs sind gesetzt) */
            updateStatistics();
            renderShotTable();
            // renderGkOverviewTable()
            renderGKStatTable();
            drawAreas();
            showToast('Offline-Daten synchronisiert ✓', 'update');
            updateButtonStates();
            renderRivalShotTable();
            enableRivalActionBtns(false);
        }
    } else {
        showToast('Keine Internet-Verbindung', 'offline');
    }

}

/* -----------------------------------------------------------
 * Halbzeit-Auto-Fill
 *  – Zählt alle Gegentore (Tor = roter Marker, also isGoalkeeperSave == false)
 *  bis 30:00 min und trägt sie – falls das Feld noch leer ist –
 *  in das Halbzeit-Input ein. Gleichzeitig wird der Wert in
 *  IndexedDB (key 'halftime') gespeichert.
 * ---------------------------------------------------------- */
async function autoFillHalftimeScore() {
    /* 1) DOM-Referenz suchen (Input mit Placeholder „Halbzeit“) */
    const htInput = document.getElementById('halftime-input');
    if (!htInput) return; // Feld existiert (noch) nicht
    if (htInput.value.trim() !== '') return; // Nutzer hat schon etwas eingetragen

    /* 2) Gegentore bis 30:00 addieren (Tor = !isGoalkeeperSave) */
    const conceded = shots.filter(
        s => s.team !== 'rival' &&
            !s.isGoalkeeperSave &&
            s.gameSeconds < HALF_LENGTH
    ).length;

    /* 3) Wert eintragen + persistent speichern */
    htInput.value = String(conceded);
    try {
        await setMatchInfo('halftime', String(conceded));
    } catch (err) {
        console.error('[HT-AutoFill] Speichern fehlgeschlagen:', err);
    }
}

/* -----------------------------------------------------------
 * Full-Time-Auto-Fill
 *  – Zählt alle Gegentore (Tor = roter Marker, also isGoalkeeperSave == false)
 *  bis 60:00 min und trägt sie – falls das Feld noch leer ist –
 *  in das FT ein. Gleichzeitig wird der Wert in
 *  IndexedDB (key 'fulltime') gespeichert.
 * ---------------------------------------------------------- */
async function autoFillFulltimeScore() {
    const ftInput = document.getElementById('fulltime-input');
    if (!ftInput || ftInput.value.trim() !== '') return;

    // gesamte Gegentore (Tor = !isGoalkeeperSave) in 60 min
    const conceded = shots.filter(
        s => s.team !== 'rival' && !s.isGoalkeeperSave
    ).length;

    ftInput.value = String(conceded);
    try {
        await setMatchInfo('fulltime', String(conceded));
    } catch (err) {
        console.error('[FT-AutoFill] Speichern fehlgeschlagen:', err);
    }
}

/**
 * Liefert die erste Shot-Area, in die der relative Punkt (relX, relY) fällt,
 * oder undefined, falls keine passt.
 *
 * • id 1-9 Legacy-Geometrie via isPointInShotAreaLegacy (Polygon/Radien)
 * • id ≥ 10 einfache Rechteckprüfung auf Basis der Bounding-Box
 */
const findShotAreaAtPoint = (relX, relY, areas) =>
    areas.find(area => {
        if (area.id <= 9) {
            return isPointInShotAreaLegacy(
                area,
                relX * canvasWidth,
                relY * canvasHeight
            );
        }

        const c = area.coords;
        return relX >= c.x1 && relX <= c.x2 &&
            relY >= c.y1 && relY <= c.y2;
    });

function findAreaAtPoint(relX, relY, areasArr) {
    return areasArr.find(a => {
        const coords = a.coords;
        if (coords.x3 !== undefined) {
            const pts = Object.entries(coords)
                .map(([k, v]) => ({
                    x: (k.startsWith('x') ? v : null) * canvasWidth,
                    y: (k.startsWith('y') ? v : null) * canvasHeight
                }))
                .filter(p => p.x != null && p.y != null);
            return isPointInPolygon(pts, {
                x: relX * canvasWidth,
                y: relY * canvasHeight
            });
        } else {
            return relX >= coords.x1 && relX <= coords.x2
                && relY >= coords.y1 && relY <= coords.y2;
        }
    });
}

// == 13. Helfer-Funktionen ===============================================
// ——— Helper: Ass-Zähler komplett zurücksetzen ——————————————
async function resetAssCounters() {
    // 1) In-Memory zurücksetzen
    ass = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};

    // 2) Persistenz
    await setAss(ass);

    // 3) UI refresh
    updateAssBadge();
    renderGKStatTable();

    // 4) „−“-Button deaktivieren
    const dec = document.getElementById('ass-decrement');
    if (dec) dec.disabled = true;
}

/* Helper: 7g6 komplett zurücksetzen */
async function resetSevenG6Counters() {
    sevenG6 = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};
    await setSevenG6(sevenG6);
    updateSevenG6Badge();
    renderGKStatTable();
    document.getElementById('seven-g6-decrement').disabled = true;
}

async function resetTorCounters() {
    torCount = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};
    await setTor(torCount);
    updateTorBadge();
    renderGKStatTable();
    document.getElementById('tor-decrement').disabled = true;
}

async function resetTFCounters() {
    tfCount = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};
    await setTF(tfCount);
    updateTFBadge();
    renderGKStatTable();
    document.getElementById('tf-decrement').disabled = true;
}

// ——— Ende Helper ————————————————————————————————————————————————

/* ---------- Spalten-Layout ---------- */
const ASS_IDX = 14; // Spalte „Ass“
const TOR_HEAD_IDX = 15; // Spalte „Tor“ (eigene Tore)
const DIVIDER_IDX = 16; // Trennspalte
const GOALS_TOTAL_IDX = 17; // Spalte „T“
const TOTAL_IDX = COLS - 2; // Gesamt
const PERCENT_IDX = COLS - 1; // %
const SEVENG6_IDX = COLS - 4; // 7g6
const TF_IDX = COLS - 3; // TF

const normalize = s => s
    ?.normalize('NFD').replace(/[\u0300-\u036f]/g, '') // ä → a
    .replace(/ß/g, 'ss');

function renderGKStatTable() {
    const tbody = document.querySelector('#gk-stat-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    /* ---- 1) Grundgerüst: 4 feste Zeilen --------------------------- */
    const ROW_META = [
        {gk: 1, half: 1, label: 'TW1', time: '01-30'},
        {gk: 1, half: 2, label: 'TW1', time: '31-60'},
        {gk: 2, half: 1, label: 'TW2', time: '01-30'},
        {gk: 2, half: 2, label: 'TW2', time: '31-60'}
    ];

    /* Map: key → <tr>-Element */
    const ROW_MAP = {};
    ROW_META.forEach(meta => {
        const key = `${meta.gk}-${meta.half}`;
        const tr = makeEmptyStatRow(`${meta.label} ${meta.half}. HZ`, meta.time);
        ROW_MAP[key] = tr;
        tbody.appendChild(tr);
    });

    /* ---- 2) Shots auswerten & in passende Zeile schreiben --------- */
    shots.forEach(sh => {
        if (sh.team === 'rival') return; // fremde Keeper ignorieren
        const gk = sh.goalkeeperId ?? 1;
        const half = sh.gameSeconds < HALF_LENGTH ? 1 : 2; // 30-Min-Grenze
        const key = `${gk}-${half}`;
        const tr = ROW_MAP[key];

        if (!tr) return;

        const td = tr.children;

        // 1) access per id O(1)
        const areaName = shotAreaMap.get(sh.shotAreaId)?.name ?? '';
        // 2) shotCategory
        const baseName = normalize(sh.shotCategory ?? areaName).toLowerCase();
        const colKey = AREA_TO_COL[baseName];

        if (!colKey) return; // falls unbekannte Kategorie

        if (sh.isGoalkeeperSave) {
            /* ---- Parade (links) ----------------------------------- */
            td[2].textContent = +td[2].textContent + 1;
            td[LEFT_COL_MAP[colKey]].textContent =
                +td[LEFT_COL_MAP[colKey]].textContent + 1;
        } else {
            /* ---- Gegentor (rechts) -------------------------------- */
            td[RIGHT_COL_MAP[colKey]].textContent =
                +td[RIGHT_COL_MAP[colKey]].textContent + 1;

            /* Gesamt-Tore (Spalte T) hochzählen */
            td[GOALS_TOTAL_IDX].textContent =
                +td[GOALS_TOTAL_IDX].textContent + 1;
        }
    });

    /* ---- 3) Gesamt & Quote je Zeile berechnen --------------------- */
    Object.values(ROW_MAP).forEach(tr => {
        const td = tr.children;
        const saves = +td[2].textContent;

        const goals = +td[GOALS_TOTAL_IDX].textContent; // „T“
        const total = saves + goals;


        if (total) { // erst ab mindestens 1 Wurf
            td[TOTAL_IDX].textContent = `${saves}/${total}`;
            td[PERCENT_IDX].textContent = Math.round((saves / total) * 100) + '%';
        } else {
            td[TOTAL_IDX].textContent = '';
            td[PERCENT_IDX].textContent = '';
        }
    });

    for (const gk of [1, 2]) {
        for (const half of [1, 2]) {
            const key = `${gk}-${half}`;
            const cell = ROW_MAP[key]?.children[ASS_IDX];

            /* --------------------------------------------------------------
                Ass-Wert in die Zelle schreiben.
                ➔ Falls der Wert 0 ist: leeres Feld („“) statt „0“ anzeigen.
                Das sorgt dafür, dass die Tabelle zu Beginn „clean“ aussieht.
            -------------------------------------------------------------- */
            if (cell) {
                const val = ass[gk]?.[half] ?? 0;
                cell.textContent = (val === 0 ? '' : String(val));
            }

            /* -------- 7g6-Wert in Spalte schreiben -------------------- */
            const cell7 = ROW_MAP[key]?.children[SEVENG6_IDX];
            if (cell7) {
                const v7 = sevenG6[gk]?.[half] ?? 0;
                cell7.textContent = v7 === 0 ? '' : String(v7);
            }

            /* -------- Tor-Wert in Spalte schreiben ------- */
            const cellTor = ROW_MAP[key]?.children[TOR_HEAD_IDX];
            if (cellTor) {
                const vT = torCount[gk]?.[half] ?? 0;
                cellTor.textContent = vT === 0 ? '' : String(vT);
            }

            /* -------- TF-Wert in Spalte schreiben -------------------- */
            const cellTF = ROW_MAP[key]?.children[TF_IDX];
            if (cellTF) {
                const vTF = tfCount[gk]?.[half] ?? 0;
                cellTF.textContent = vTF === 0 ? '' : String(vTF);
            }

        }
    }
}

/**
 * Aktualisiert den H2-Titel der Statistik-Sektion → wird immer aufgerufen, wenn sich der aktive Torwart ändert.
 */
function updateStatsHeading() {
    const h2 = document.getElementById('stats-heading');
    if (!h2) return; // Fallback: Element nicht gefunden
    h2.textContent = `Shot Statistics – Torwart ${currentGoalkeeper}`;
}

function getRelCoords(e) {
    const r = canvas.getBoundingClientRect();
    return {
        relX: (e.clientX - r.left) / canvasWidth,
        relY: (e.clientY - r.top) / canvasHeight
    };
}

function showToast(msg, variant = 'update') {
    const container = document.getElementById('toast-container');
    if (!container) return null; // Fallback: kein Container

    const t = document.createElement('div');
    t.className = `toast toast--${variant}`;
    t.textContent = msg;

    if (container.children.length > 10) container.firstChild.remove();

    container.appendChild(t);

    /* automatische Ausblendung nach 3 s */
    setTimeout(() => {
        t.style.animation = 'toast-slide-out .3s forwards';
        t.addEventListener('animationend', () => t.remove());
    }, 3000);

    return t; // wichtig: DOM-Element zurückgeben!
}

/**
 * Löscht wirklich ALLES aus UI & IndexedDB.
 * @param {boolean} silent – true ⇒ kein Confirm-Dialog, kein Toast
 */
async function clearAllData(silent = false) {
    /* Dialog nur zeigen, wenn nicht „silent“ */
    if (!silent && !confirm('Wirklich ALLE Würfe löschen?')) return;

    // ── Runtime-Arrays & UI ───────────────────────
    shots = [];
    rivalShots = [];

    updateStatistics();
    renderShotTable();
    // renderGkOverviewTable()
    renderGKStatTable(); // Tabelle leeren
    drawAreas();

    /* --- Rival-Tabelle & Buttons zurücksetzen ----------- */
    renderRivalShotTable();
    enableRivalActionBtns(false);

    // ── IndexedDB Store leeren ────────────────────
    try {
        const db = await initDB();
        const tx = db.transaction('shots', 'readwrite');
        await tx.store.clear();
        await tx.done;

        if (!silent) showToast('Alle Shots gelöscht', 'update');
    } catch (e) {
        console.error('[CLEAR]', e);
        if (!silent) showToast('DB-Fehler – siehe Konsole', 'offline');
    }
}

/**
 * Setzt *alles* auf Werkseinstellungen zurück:
 *   • alle Shots löschen • Timer anhalten & auf 0
 *   • UI-Workflow zurück • Torwart = 1
 *   • sämtliche Buttons/Indikatoren zurück
 */
async function hardResetGame() {
    /* 1) Alle Shots & Statistik zurücksetzen */
    await clearAllData(true);
    rivalShots = [];
    renderGKStatTable();

    /* 1a) Ass-Zähler wieder auf 0 setzen */
    await resetAssCounters();
    /* 1b) Ass-Zähler wieder auf 0 setzen */
    await resetSevenG6Counters();
    // 1c) Tor-Zähler zurücksetzen
    await resetTorCounters();
    // 1d) Technische Fehler zurücksetzen
    await resetTFCounters();

    /* 2) Registrierung zurücksetzen */
    resetRegistrationProcess(); // Step-Indikator & Buttons

    /* 3) Spiel-Timer stoppen & nullen */
    clearInterval(gameInterval);
    gameSeconds = 0;
    gameRunning = false;
    document.getElementById('game-time').textContent = formatTime(0);
    document.getElementById('start-pause-btn').textContent = 'Start';
    document.getElementById('reset-btn').disabled = false;
    await setGameTimerState(0, false);

    /* 4) Torwart wieder auf „1“ stellen */
    currentGoalkeeper = 1;
    await setCurrentGoalkeeper(1);

    updateGoalkeeperButton();
    refreshHalfDependentUI();
    updateStatsHeading();

    /* 5) Show-Lines-Schalter zurücksetzen */
    showShotLines = false;
    const toggle = document.getElementById('show-lines-toggle');
    if (toggle) toggle.checked = false;
    await setShowShotLines(false);
    drawAreas();

    /* 6) Match-Info zurücksetzen */
    try {
        // alle Match-Info-Keys in der IndexedDB leeren
        await Promise.all([
            setMatchInfo('competition', ''),
            setMatchInfo('date', ''),
            setMatchInfo('location', ''),
            setMatchInfo('opponent', ''),
            setMatchInfo('halftime', ''),
            setMatchInfo('fulltime', '')
        ]);
        // UI-Felder zurücksetzen
        document.querySelector('#information-container input[placeholder="Wettbewerb wählen"]').value = '';
        document.querySelector('#information-container input[placeholder="Datum eingeben"]').value = '';
        document.querySelector('#information-container input[placeholder="Spielort"]').value = '';
        document.querySelector('#summary-container input[placeholder="Gegner eintragen"]').value = '';
        document.querySelector('#summary-container input[placeholder="Halbzeit"]').value = '';
        document.querySelector('#summary-container input[placeholder="Endstand"]').value = '';
    } catch (err) {
        console.error('[RESET] Match-Info löschen fehlgeschlagen:', err);
    }

    /* 7) Feedback für den Nutzer */
    showToast('Spiel vollständig zurückgesetzt ✔', 'update');
}

/**
 * Initialisiert den Torwart-Toggle-Button.
 * – Umschalten 1 ↔ 2 ändert sofort Statistik, Überschrift & Button-Design.
 */
async function changeGoalkeeper() {
    /* --- DOM-Referenz & Startwert aus IndexedDB --------------- */
    const btn = document.getElementById('change-goalkeeper-btn');
    if (!btn) {
        console.warn('[GK] Button »change-goalkeeper-btn« nicht gefunden');
        return;
    }
    // Letzten Keeper aus IndexedDB laden (Default = 1)
    currentGoalkeeper = await getCurrentGoalkeeper();

    /* --- UI auf Initialwert bringen --------------------------- */
    updateGoalkeeperButton();
    refreshHalfDependentUI();
    updateStatsHeading();
    updateStatistics();
    renderShotTable();
    // renderGkOverviewTable()
    drawAreas();
    renderGKStatTable();

    /* --- Klick-Handler binden --------------------------------- */
    btn.addEventListener('click', async () => {
        /* 3.1 Keeper umschalten (1 ⇄ 2) */
        currentGoalkeeper = currentGoalkeeper === 1 ? 2 : 1;

        /* 3.2 Oberfläche anpassen: Button, Statistik & Überschrift */
        updateGoalkeeperButton();
        refreshHalfDependentUI();
        updateStatsHeading();
        updateStatistics();
        renderShotTable();
        renderGkOverviewTable()
        drawAreas();

        /* 3.3 Persistent speichern */
        try {
            await setCurrentGoalkeeper(currentGoalkeeper);
        } catch (err) {
            console.error('[GK] IndexedDB-Speichern fehlgeschlagen:', err);
            showToast('Torwart-Wechsel konnte nicht gespeichert werden', 'offline');
        }
    });
}

/**
 * Setzt den Text + Farbe der Torwart-Button entsprechend der akt. Auswahl.
 */
function updateGoalkeeperButton() {
    const btn = document.getElementById('change-goalkeeper-btn');
    btn.textContent = `Torwart ${currentGoalkeeper}`;
    btn.dataset.goalkeeperId = currentGoalkeeper;
    // Zustandsklassen (1 & 2) entfernen
    btn.classList.remove('goalkeeper-1', 'goalkeeper-2');
    // Neue Klasse setzen (z.B. „goalkeeper-2“)
    btn.classList.add(`goalkeeper-${currentGoalkeeper}`);
}

async function undoLastShot() {
    /* -----------------------------------------------------------------
        1. Früh-Exit, falls überhaupt keine Würfe vorliegen
        (verhindert TypeError bei shots.pop() → undefined.id)
------------------------------------------------------------------*/
    if (shots.length === 0) {
        showToast('Keine Shots zum Rückgängigmachen', 'offline');
        return;
    }

    /* -----------------------------------------------------------------
       2. Letzter Eintrag gehört dem Gegner? → Hinweis & Abbruch
    ------------------------------------------------------------------*/
    if (shots.at(-1)?.team === 'rival') {
        showToast(
            'Letzter Wurf = Gegner – Undo rechts benutzen.',
            'offline'
        );
        return;
    }

    const last = shots.pop(); // RAM
    if (last.id) { // bereits in DB → löschen
        try {
            await deleteShot(last.id);
        } catch {
            console.warn('[Undo] DB-Delete fehlgeschlagen');
        }
    }

    /* Offline-Shots (id undefined) sind damit einfach aus dem Array entfernt. */
    updateStatistics();
    renderShotTable();
    // renderGkOverviewTable()
    renderGKStatTable();
    drawAreas();
    showToast('Letzter Shot zurückgenommen', 'update');
    updateButtonStates();
}

function paintTempMarker(relX, relY, color = COLOR_TEMP_MARKER) {
    const {x, y} = relToCanvas(relX, relY, canvas);
    drawMarker(ctx, x, y, 8, color);
}

// == 14. Export & Download =============================================
//  -------------------------------------------------------------------
//  Vollständige exportData-Funktion mit Lade-Guard für XLSX
// =====================================================================
/**
 * Exportiert alle Shot-Datensätze nach XLSX und speichert parallel
 * einen Screenshot des Canvas als PNG.
 *
 * Das Alias const XLSX = window.XLSX wird erst nach erfolgreicher Guard-Prüfung erzeugt.
 * Dadurch kein Race-Condition-Risiko mehr, wenn die Bibliothek
 * beim Seiten-Reload noch nicht fertig geladen ist.
 */
function exportData() {
    /* ================================================================
       1) Guard – ist SheetJS (xlsx.full.min.js) bereits vollständig
          geladen?  Wir prüfen:
            a) window.XLSX        → globales Objekt existiert
            b) window.XLSX.utils  → Unterobjekt mit json_to_sheet etc.
       ================================================================ */
    if (!window.XLSX || !window.XLSX.utils) {
        showToast('XLSX-Bibliothek lädt noch … bitte kurz warten', 'offline');
        return; // frühzeitig abbrechen
    }

    /* 1a) Kurz-Alias NACH erfolgreicher Prüfung anlegen -------------- */
    /** @type {typeof import('xlsx')} */ // JSDoc-Typ für IntelliSense
    const XLSX = window.XLSX; // garantiert vollständig

    /* ================================================================
       2) Zweiter Guard – gibt es überhaupt Daten?
       ================================================================ */
    if (!shots.length) {
        alert('Keine Daten zum Exportieren.');
        return;
    }

    /* ================================================================
       3) XLSX-Export (try/catch für robuste Fehlerbehandlung)
       ================================================================ */
    try {
        /* 3.1 Arbeitsblatt aus unseren Shot-Objekten erzeugen */
        const sheet = XLSX.utils.json_to_sheet(shots);

        /* 3.2 Neues Workbook anlegen und Blatt einfügen */
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, sheet, 'Shots');

        /* 3.3 Workbook in einen ArrayBuffer schreiben */
        const wBout = XLSX.write(wb, {bookType: 'xlsx', type: 'array'});

        /* 3.4 Blob erzeugen + Download triggern */
        const xlsxBlob = new Blob(
            [wBout],
            {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
        );

        triggerDownload(
            xlsxBlob,
            `SCM-Shots_${new Date().toISOString().slice(0, 19)}.xlsx`
        );

    } catch (err) {
        console.error('[Export] XLSX fehlgeschlagen:', err);
        alert('XLSX-Export fehlgeschlagen – siehe Konsole.');
    }

    /* ================================================================
       4) PNG-Screenshot des Canvas als Bonus
       ================================================================ */
    canvas.toBlob(blob => {
        if (!blob) return;
        triggerDownload(
            blob,
            `SCM-ShotCanvas_${new Date().toISOString().slice(0, 19)}.png`
        );
    });
}

/**
 * Hilfsfunktion: Erzeugt einen temporären Download-Link und klickt ihn.
 */
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        link.remove();
    }, 250);
}

// == 15. Service-Worker Lifecycle =======================================
function initServiceWorkerLifecycle() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
        .register('src/sw/sw.js', {scope: 'src/sw/'})
        .then(reg => {
            if (reg.waiting) promptUserToUpdate(reg);
            reg.addEventListener('updatefound', () => {
                const newSW = reg.installing;
                if (newSW) {
                    newSW.addEventListener('statechange', () => {
                        if (newSW.state === 'installed' && reg.waiting) {
                            promptUserToUpdate(reg);
                        }
                    });
                }
            });
        })
        .catch(err => console.error('[SW] Registrierung fehlgeschlagen:', err));

    navigator.serviceWorker.addEventListener('controllerchange', () =>
        showToast('Update aktiv – Seite neu laden ✔', 'update')
    );
}

/**
 * Ändert den Ass-Zähler um den Delta-Wert.
 * @param {number} delta – Änderungsschritt: z.B. +1 oder -1
 */
async function changeAss(delta) {
    const gk = currentGoalkeeper;
    const half = currentHalf();

    /* --------------------------------------------------------------
       1)  Negative Klicks abfangen, *und* den Button sofort sperren.
    -------------------------------------------------------------- */
    if (delta < 0 && ass[gk][half] === 0) {
        const decBtn = document.getElementById('ass-decrement');
        if (decBtn) decBtn.disabled = true; // sofort „freeze“
        return;
    }

    /* 2) Wert anpassen (niemals < 0) */
    ass[gk][half] = Math.max(0, ass[gk][half] + delta);
    await setAss(ass); // persistieren

    /* 3) UI aktualisieren  ---------------------------------------- */
    updateAssBadge(); // Badge + Button-Status
    const td = document.querySelector(
        `#gk-stat-table tbody tr[data-key="${gk}-${half}"] td:nth-child(${ASS_IDX + 1})`
    );
    if (td) td.textContent = ass[gk][half] === 0 ? '' : String(ass[gk][half]);
}

/**
 * Ändert den 7g6-Zähler um «delta».
 * @param {number} delta – Änderungsschritt: z.B. +1 oder -1
 */
async function changeSevenG6(delta) {
    const gk = currentGoalkeeper;
    const half = currentHalf();

    if (delta < 0 && sevenG6[gk][half] === 0) return;

    sevenG6[gk][half] = Math.max(0, sevenG6[gk][half] + delta);
    await setSevenG6(sevenG6);

    updateSevenG6Badge();

    /* Tabellen-Zelle updaten */
    const td = document.querySelector(
        `#gk-stat-table tbody tr[data-key="${gk}-${half}"] td:nth-child(${SEVENG6_IDX + 1})`
    );
    if (td) td.textContent = sevenG6[gk][half] === 0 ? '' : String(sevenG6[gk][half]);
}

async function changeTor(delta) {
    const gk = currentGoalkeeper;
    const half = currentHalf();

    if (delta < 0 && torCount[gk][half] === 0) return;

    torCount[gk][half] = Math.max(0, torCount[gk][half] + delta);
    await setTor(torCount);

    updateTorBadge();

    /* Tabellen-Zelle updaten */
    const td = document.querySelector(
        `#gk-stat-table tbody tr[data-key="${gk}-${half}"] td:nth-child(${TOR_HEAD_IDX + 1})`
    );
    if (td) td.textContent = torCount[gk][half] === 0 ? '' : String(torCount[gk][half]);
}

async function changeTF(delta) {
    const gk = currentGoalkeeper;
    const half = currentHalf();

    if (delta < 0 && tfCount[gk][half] === 0) return;

    tfCount[gk][half] = Math.max(0, tfCount[gk][half] + delta);
    await setTF(tfCount);

    updateTFBadge();

    const td = document.querySelector(
        `#gk-stat-table tbody tr[data-key="${gk}-${half}"] td:nth-child(${TF_IDX + 1})`
    );
    if (td) td.textContent = tfCount[gk][half] === 0 ? '' : String(tfCount[gk][half]);
}

function promptUserToUpdate(reg) {
    /* Klickbarer Hinweis-Toast */
    const toast = showToast(
        'Update verfügbar – hier tippen, um neu zu laden',
        'update'
    );
    if (!toast) return;
    toast.addEventListener('click', () => {
        if (reg.waiting) {
            reg.waiting.postMessage({type: 'SKIP_WAITING'});
        }
    });
}

// Ende src/js/app.js
