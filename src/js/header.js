/*  -------------------------------------------------------------------------
    src/js/header.js – Kopfbereich (Match-Infos) der PWA
    -------------------------------------------------------------------------
    ▸ Dieses Skript erzeugt im Header **eine** gemeinsame Tabelle:
       - Allgemeine Match-Informationen (Competition · Date · Location · Logo)
       - Match-Zusammenfassung (Gegner, Halbzeitstand, Endstand)
    ▸ Alle Eingaben werden sofort in IndexedDB persistiert.
    ▸ Beim Laden werden die gespeicherten Werte ausgelesen und befüllen die Inputs.
    ---------------------------------------------------------------------- */

import {getMatchInfo, initDB, setMatchInfo} from "./db.js";

/* =====================================================================
 *  1. Hilfsfunktionen
 * ===================================================================*/

/**
 * Erzeugt ein <input>-Feld mit optionaler Datalist.
 */
function createInputCell(
    placeholder,
    options = [],
    width = "100%",
    defaultValue = "",
    id = ""
) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = placeholder;
    inp.style.width = width;
    if (id) inp.id = id;
    if (defaultValue) inp.value = defaultValue;

    if (options.length) {
        const dl = document.createElement("datalist");
        dl.id = `dl-${placeholder.replace(/\s+/g, "-")}`;
        options.forEach((o) => {
            const opt = document.createElement("option");
            opt.value = o;
            dl.appendChild(opt);
        });
        document.body.appendChild(dl);
        inp.setAttribute("list", dl.id);
    }
    return inp;
}

/**
 * Formatiert ein JS-Date in DD.MM.YYYY.
 */
function formatDateGerman(date) {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yy = date.getFullYear();
    return `${dd}.${mm}.${yy}`;
}

/**
 * Baut eine Tabelle aus dem 2D-Array »rows«.
 */
function createTable(
    containerId,
    rows,
    widths = [],
    spans = [],
    aligns = [],
    fullWidth = false
) {
    const makeRow = (cells, spanCfg = [], alignCfg = []) => {
        const tr = document.createElement("tr");
        cells.forEach((c, i) => {
            const td = document.createElement("td");
            if (typeof c === "string") td.textContent = c;
            else if (c instanceof HTMLElement) td.appendChild(c);

            const sp = spanCfg[i] || {};
            if (sp.colSpan) td.colSpan = sp.colSpan;
            if (sp.rowSpan) td.rowSpan = sp.rowSpan;

            td.style.textAlign = alignCfg[i] || "left";
            tr.appendChild(td);
        });
        return tr;
    };

    const tbl = document.createElement("table");
    if (fullWidth) tbl.style.width = "100%";
    tbl.style.borderCollapse = "collapse";
    tbl.style.borderSpacing = "0";

    if (widths.length) {
        const cg = document.createElement("colgroup");
        widths.forEach((w) => {
            const col = document.createElement("col");
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

/* =====================================================================
 *  2. Initialisierung – ein einziger Event-Listener
 * ===================================================================*/
document.addEventListener("DOMContentLoaded", async () => {
    /* --------------------------------------------------
     *  Theme-Switcher (Light | Auto | Dark)
     * -------------------------------------------------- */
    const themeModes = ['light', 'auto', 'dark'];

    function applyTheme(mode = 'auto') {
        const html = document.documentElement;
        if (mode === 'auto') {
            html.removeAttribute('data-theme');        // OS entscheidet
        } else {
            html.setAttribute('data-theme', mode);     // light | dark
        }
        localStorage.themeMode = mode;
        // Sliderposition synchron halten
        const idx = themeModes.indexOf(mode);
        document.getElementById('theme-slider')?.setAttribute('data-pos', idx);
    }

    /* --- UI-Element erzeugen ----------------------------------- */
    const makeThemeSlider = () => {
        const wrap = document.createElement('div');
        wrap.className = 'theme-switcher';
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '8px';

        // Labels
        const lbls = ['Hell', 'Dunkel'];
        lbls.forEach((t, i) => {
            const l = document.createElement('span');
            l.textContent = t;
            l.style.fontSize = '.7rem';
            if (i === 1) l.style.flex = '0 0 auto';
            wrap.appendChild(l);
            if (i === 0 || i === 1) {
                const sep = document.createElement('div');
                sep.style.flex = '1 1 8px';
                wrap.appendChild(sep);
            }
        });

        /* Range-Slider */
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = 0;
        slider.max = 2;
        slider.step = 1;
        slider.id = 'theme-slider';
        slider.style.width = '110px';
        slider.value = themeModes.indexOf(localStorage.themeMode || 'auto');
        slider.addEventListener('input', e => {
            applyTheme(themeModes[Number(e.target.value)]);
        });
        // Positionierung zwischen Label 1 und Label 3
        wrap.children[1].appendChild(slider);
        return wrap;
    };

    /* In die Timer-Leiste einhängen */
    document.querySelector('.timer-container')?.appendChild(makeThemeSlider());

    /* Theme beim Laden setzen */
    applyTheme(localStorage.themeMode || 'auto');

    /* --------------------- IndexedDB-Bootstrap ---------------------- */
    await initDB();

    /*  Laufzeit-Sicherheit: alter DB-Stand ohne »team«-Key  */
    {
        const db = await initDB();
        const tx = db.transaction("matchInfo", "readwrite");
        const store = tx.store;
        if (!(await store.get("team"))) {
            await store.put({id: "team", value: ""});
        }
        await tx.done;
    }

    const matchInfo = await getMatchInfo();

    /* --------------------- Input-Felder ------------------------------ */
    const teamInput = createInputCell(
        "Team wählen",
        ["1. Mannschaft", "Youngsters", "A-Jugend"],
        "100%",
        matchInfo.team || "",
        "team-input"
    );

    const competitionInput = createInputCell(
        "Wettbewerb wählen",
        ["Bundesliga", "Pokal", "Europapokal", "3. Liga", "Testspiel"],
        "100%",
        matchInfo.competition || "",
        "competition-input"
    );

    const dateInput = createInputCell(
        "Datum eingeben",
        [],
        "100%",
        matchInfo.date || formatDateGerman(new Date()),
        "date-input"
    );

    const locationInput = createInputCell(
        "Spielort",
        ["Magdeburg", "Dessau"],
        "100%",
        matchInfo.location || "",
        "location-input"
    );

    const opponentInput = createInputCell(
        "Gegner eintragen",
        [],
        "100%",
        matchInfo.opponent || "",
        "opponent-input"
    );

    const halftimeInput = createInputCell(
        "Halbzeit",
        [],
        "60px",
        matchInfo.halftime || "",
        "halftime-input"
    );

    const fulltimeInput = createInputCell(
        "Endstand",
        [],
        "60px",
        matchInfo.fulltime || "",
        "fulltime-input"
    );

    /* --------------------- Score-Block (HT/FT) ---------------------- */
    const scoreBlock = (() => {
        const wrap = document.createElement("div");
        wrap.className = "score-block";

        const mkGroup = (lbl, inp) => {
            const g = document.createElement("div");
            g.className = "score-input-group";
            g.innerHTML = `<label>${lbl}</label>`;
            g.appendChild(inp);
            return g;
        };
        wrap.appendChild(mkGroup("HT", halftimeInput));
        wrap.appendChild(mkGroup("FT", fulltimeInput));
        return wrap;
    })();

    /* --------------------- Tabelle rendern -------------------------- */
    createTable(
        "information-container",
        [
            ["SC Magdeburg -", opponentInput, "Datum", dateInput],
            ["Team", teamInput, "Spielort", locationInput],
            ["Wettbewerb", competitionInput, "", ""],
        ],
        ["23%", "27%", "23%", "27%"],
        [],
        [
            ["right", "left", "right", "left"],
            ["right", "left", "right", "left"],
            ["right", "left", "right", "left"],
        ],
        true
    );

    /* Score-Block neben dem Timer platzieren */
    document.querySelector(".timer-container")?.appendChild(scoreBlock);

    /* --------------------- Change-Listener --------------------------- */
    teamInput.addEventListener("change", (e) => setMatchInfo("team", e.target.value));
    competitionInput.addEventListener("change", (e) =>
        setMatchInfo("competition", e.target.value)
    );
    dateInput.addEventListener("change", (e) => setMatchInfo("date", e.target.value));
    locationInput.addEventListener("change", (e) =>
        setMatchInfo("location", e.target.value)
    );
    opponentInput.addEventListener("change", (e) =>
        setMatchInfo("opponent", e.target.value)
    );
    halftimeInput.addEventListener("change", (e) =>
        setMatchInfo("halftime", e.target.value)
    );
    fulltimeInput.addEventListener("change", (e) =>
        setMatchInfo("fulltime", e.target.value)
    );
});

// Ende src/js/header.js