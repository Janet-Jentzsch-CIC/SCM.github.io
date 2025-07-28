/*  -------------------------------------------------------------------------
    src/js/header.js – Kopfbereich (Match-Infos) der PWA
    -------------------------------------------------------------------------
    ▸ Dieses Skript erzeugt im Header **eine** gemeinsame Tabelle:
       - Allgemeine Match-Informationen (Competition · Date · Location · Logo)
       - Match-Zusammenfassung (Gegner, Halbzeitstand, Endstand)
    ▸ Alle Eingaben werden sofort in IndexedDB persistiert.
    ▸ Beim Laden werden die gespeicherten Werte ausgelesen und befüllen die Inputs.
    ---------------------------------------------------------------------- */

import {getMatchInfo, initDB, setMatchInfo} from './db.js';

/* ==== 1. Hilfsfunktionen =============================================== */

/**
 * Erzeugt ein <input>-Feld mit optionaler Datalist.
 */
function createInputCell(placeholder, options = [], width = '100%', defaultValue = '', id = '') {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = placeholder;
    inp.style.width = width;
    if (id) inp.id = id;
    if (defaultValue) inp.value = defaultValue;

    if (options.length) {
        const dl = document.createElement('datalist');
        dl.id = `dl-${placeholder.replace(/\s+/g, '-')}`;
        options.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o;
            dl.appendChild(opt);
        });
        document.body.appendChild(dl);
        inp.setAttribute('list', dl.id);
    }
    return inp;
}

/**
 * Formatiert ein JS-Date in DD.MM.YYYY.
 */
function formatDateGerman(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yy = date.getFullYear();
    return `${dd}.${mm}.${yy}`;
}

/**
 * Baut eine Tabelle aus dem 2D-Array „rows“.
 */
function createTable(containerId, rows, widths = [], spans = [], aligns = [], fullWidth = false) {
    const makeRow = (cells, spanCfg = [], alignCfg = []) => {
        const tr = document.createElement('tr');
        cells.forEach((c, i) => {
            const td = document.createElement('td');
            if (typeof c === 'string') td.textContent = c;
            else if (c instanceof HTMLElement) td.appendChild(c);

            const sp = spanCfg[i] || {};
            if (sp.colSpan) td.colSpan = sp.colSpan;
            if (sp.rowSpan) td.rowSpan = sp.rowSpan;

            td.style.textAlign = alignCfg[i] || 'left';
            tr.appendChild(td);
        });
        return tr;
    };

    const tbl = document.createElement('table');
    if (fullWidth) tbl.style.width = '100%';
    tbl.style.borderCollapse = 'collapse';
    tbl.style.borderSpacing = '0';

    if (widths.length) {
        const cg = document.createElement('colgroup');
        widths.forEach(w => {
            const col = document.createElement('col');
            col.style.width = w;
            cg.appendChild(col);
        });
        tbl.appendChild(cg);
    }

    rows.forEach((cells, rowIdx) =>
        tbl.appendChild(makeRow(cells, spans[rowIdx] || [], aligns[rowIdx] || []))
    );

    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`[header] Container "${containerId}" nicht gefunden`);
        return;
    }
    container.appendChild(tbl);
}

/* ==== 2. DOM-ContentLoaded ============================================= */
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    const matchInfo = await getMatchInfo();

    // --- Input-Felder vorbereiten (inkl. IDs für spätere Event-Listener)
    const teamInput = createInputCell(
        'Team wählen', ['1. Mannschaft', 'Youngsters', 'A-Jugend'], '100%', matchInfo.team || ''
    );
    const competitionInput = createInputCell(
        'Wettbewerb wählen', ['Bundesliga', 'Pokal', 'Europapokal', '3. Liga', 'Testspiel'], '100%', matchInfo.competition || ''
    );
    const dateInput = createInputCell(
        'Datum eingeben', [], '100%', matchInfo.date || formatDateGerman(new Date())
    );
    const locationInput = createInputCell(
        'Spielort', ['Magdeburg', 'Dessau'], '100%', matchInfo.location || ''
    );
    const opponentInput = createInputCell(
        'Gegner eintragen', [], '100%', matchInfo.opponent || '', 'opponent-input'
    );

    const halftimeInput = createInputCell('Halbzeit', [], '60px',
        matchInfo.halftime || '', 'halftime-input');
    const fulltimeInput = createInputCell('Endstand', [], '60px',
        matchInfo.fulltime || '', 'fulltime-input');

    /* ----------  Score-Block (HT/FT) bauen -------------------------- */
    const scoreBlock = (() => {
        const wrap = document.createElement('div');
        wrap.className = 'score-block';

        const mkGroup = (lbl, inp) => {
            const g = document.createElement('div');
            g.className = 'score-input-group';
            g.innerHTML = `<label>${lbl}</label>`;
            g.appendChild(inp);
            return g;
        };
        wrap.appendChild(mkGroup('HT', halftimeInput));
        wrap.appendChild(mkGroup('FT', fulltimeInput));
        return wrap;
    })();


    // Logo-Bild erstellen
    const makeLogo = () => {
        const img = document.createElement('img');
        img.src = 'src/images/scm_logo_sterne.jpg';
        img.alt = 'Handball-Bundesliga';
        img.style.maxWidth = '45px';
        img.style.height = 'auto';
        return img;
    };

    /*  -----------------------------------------------------------------
        4-Spalten-Tabelle (Label | Input | Label | Input).
       -----------------------------------------------------------------*/
    createTable(
        'information-container',
        [
            /* 1) Gegner-Zeile ganz nach oben */
            ['SC Magdeburg -', opponentInput,   'Datum',     dateInput     ],

            /* 2) Team jetzt zweite Zeile */
            ['Team',          teamInput,        'Spielort',  locationInput ],

            /* 3) Wettbewerb steht darunter (rechte Spalten leer) */
            ['Wettbewerb',    competitionInput, '',          ''            ]
        ],
        ['23%','27%','23%','27%'], // gleichmäßige Breiten
        [], // keine Row/Col-Spans
        [ ['right','left','right','left'], // Zeile 1
            ['right','left','right','left'], // Zeile 2
            ['right','left','right','left'] ], // Zeile 3
        true // volle Breite
    );

    // Score-Block direkt rechts neben dem Torwart-Toggle einhängen
    document.querySelector('.timer-container')
        .appendChild(scoreBlock);

    // ==== Change-Listener ====
    document.querySelector('#information-container input[placeholder="Wettbewerb wählen"]').addEventListener('change', e =>
        setMatchInfo('competition', e.target.value)
    );
    document.querySelector('#information-container input[placeholder="Datum eingeben"]').addEventListener('change', e =>
        setMatchInfo('date', e.target.value)
    );
    document.querySelector('#information-container input[placeholder="Spielort"]').addEventListener('change', e =>
        setMatchInfo('location', e.target.value)
    );
    opponentInput.addEventListener('change', e =>
        setMatchInfo('opponent', e.target.value)
    );
    halftimeInput.addEventListener('change', e =>
        setMatchInfo('halftime', e.target.value)
    );
    fulltimeInput.addEventListener('change', e =>
        setMatchInfo('fulltime', e.target.value)
    );
});

// Ende src/js/header.js
