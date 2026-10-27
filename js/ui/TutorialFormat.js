/*
==========================================================
 PitSimulator
 Archivo: TutorialFormat.js
 Formato de tutoriales importables (los que arma un docente y
 comparte como archivo .json o como link #tutorial=...).

 SEGURIDAD -- la regla de este archivo: un tutorial importado
 es DATOS, nunca código.
   - Se lee con JSON.parse; jamás eval / new Function / <script>.
   - Solo se aceptan las claves y los "tipos" de esta lista
     blanca (pasos, condiciones, resaltados, acciones). Una clave
     desconocida o un valor fuera de rango rechaza el archivo
     entero, con un mensaje que dice qué campo falló.
   - Cada condición/resaltado/acción se traduce acá a funciones
     YA escritas por nosotros (compile()); el archivo solo elige
     entre ellas y les pasa valores validados.
   - Los textos se limpian (caracteres de control, marcas de
     dirección bidi que sirven para disfrazar texto) y se muestran
     siempre con textContent (ver TutorialManager.goTo).
   - Selectores CSS: el archivo NUNCA trae uno; elige un nombre de
     una lista fija (UI_TARGETS). Tipos de componente y pines se
     validan con regex estrictas antes de usarse en un selector.
   - Imagen: solo data:image/png|gif|jpeg|webp en base64 (sin SVG,
     que puede llevar scripts; sin URLs externas, que permitirían
     rastrear a los alumnos), con chequeo de "firma" del archivo.
   - Bloques (.xml de Blockly): solo etiquetas de Blockly, sin
     DOCTYPE/entidades/CDATA/instrucciones de procesamiento.
   - Código Python: se pone en el editor, NUNCA se ejecuta solo --
     el alumno tiene que apretar ▶ Ejecutar, y corre en el
     MicroPython del simulador (WebAssembly dentro de un Worker).
   - Límites de tamaño en todo (archivo, pasos, textos, imagen).
==========================================================
*/

const TutorialFormat = (() => {

    const FORMAT = "pitsim-tutorial";
    const VERSION = 1;

    const LIMITS = {
        fileChars: 3_000_000,     // texto del .json completo
        linkChars: 120_000,       // fragmento #tutorial=... (comprimido)
        steps: 100,
        tutorialTitle: 80,
        stepTitle: 120,
        author: 60,
        icon: 8,
        description: 400,
        text: 4000,
        caption: 400,
        actionsPerStep: 3,
        label: 60,
        xml: 200_000,
        code: 50_000,
        image: 2_000_000,         // caracteres del data: URI (~1.5 MB)
        pins: 6,
        componentCount: 10,
    };

    const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
    const COMPONENT_RE = /^[a-z0-9_]{1,40}$/;
    const PIN_RE = /^[A-Za-z0-9_+.-]{1,24}$/;
    const PIN_TYPES = ["gpio", "ground", "power", "signal", "input", "output"];

    // Nombre -> selectores FIJOS de la interfaz (el archivo elige el nombre).
    const UI_TARGETS = {
        newProject:   ["#pdNewProject"],
        save:         ["#pdSaveProject"],
        simulate:     ["#btnSimToggle"],
        editor:       ["#replPanel .repl-header", "#replBtnRun"],
        deviceSelect: ["#replPanel .repl-device-select", "#replPanel .repl-header", "#replBtnRun"],
        blocks:       ["#btnBlockly"],
        phone:        ["#btnBlePanelToggle"],
        workspace:    ["#workspace"],
        toolbox:      ["#toolbox"],
    };

    const OPEN_TARGETS = ["projectMenu", "editor"];

    const CHECK_TYPES = ["emptyCanvas", "component", "wire", "running", "saved", "code"];
    const HIGHLIGHT_TYPES = ["ui", "component", "pins"];
    const ACTION_TYPES = ["openBlocks", "insertCode"];

    // Pasos "de siempre" -- el docente escribe { "preset": "simulate" }
    // y obtiene el mismo paso que traen los tutoriales oficiales.
    const PRESETS = {
        newProject: {
            title: "Crea un proyecto nuevo",
            text: "Antes de empezar, haz clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío.",
            highlight: { type: "ui", target: "newProject" },
            open: "projectMenu",
            check: { type: "emptyCanvas" },
        },
        save: {
            title: "Guarda tu proyecto",
            text: "Guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) para no perder el circuito.",
            highlight: { type: "ui", target: "save" },
            open: "projectMenu",
            check: { type: "saved" },
        },
        simulate: {
            title: "Simula el circuito",
            text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación.",
            highlight: { type: "ui", target: "simulate" },
            check: { type: "running" },
        },
        code: {
            title: "Escribe o carga tu código",
            text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí. Después dale clic al botón verde ▶ Ejecutar para correrlo.",
            highlight: { type: "ui", target: "editor" },
            open: "editor",
            check: { type: "code" },
        },
    };

    const XML_TAGS = new Set([
        "xml", "block", "shadow", "field", "value", "statement", "next",
        "mutation", "variables", "variable", "comment", "data", "arg",
    ]);

    const IMAGE_RE = /^data:image\/(png|gif|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

    // ----------------------------------------------------
    // Helpers de validación
    // ----------------------------------------------------

    const isPlainObject = (v) =>
        typeof v === "object" && v !== null && !Array.isArray(v) &&
        Object.getPrototypeOf(v) === Object.prototype;

    // Control chars (menos \n y \t), C1, BOM y marcas bidi (U+202A-202E,
    // U+2066-2069) -- estas últimas permiten "dar vuelta" texto visible.
    const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩﻿]/g;

    function cleanText(s, multiline) {
        let out = s.replace(/\r\n?/g, "\n").replace(UNSAFE_CHARS, "");
        if (!multiline) out = out.replace(/[\n\t]+/g, " ");
        return out.trim();
    }

    class Ctx {
        constructor() { this.errors = []; }
        err(path, msg) { this.errors.push(`${path}: ${msg}`); }

        keys(obj, path, allowed) {
            if (!isPlainObject(obj)) { this.err(path, "tiene que ser un objeto { ... }"); return false; }
            for (const k of Object.keys(obj)) {
                if (!allowed.includes(k)) this.err(path, `campo no permitido "${k}" (permitidos: ${allowed.join(", ")})`);
            }
            return true;
        }

        str(obj, key, path, { max, required = false, multiline = false, min = 0 }) {
            const v = obj[key];
            if (v === undefined) {
                if (required) this.err(`${path}.${key}`, "es obligatorio");
                return undefined;
            }
            if (typeof v !== "string") { this.err(`${path}.${key}`, "tiene que ser texto"); return undefined; }
            if (v.length > max) { this.err(`${path}.${key}`, `es demasiado largo (máximo ${max} caracteres)`); return undefined; }
            const out = cleanText(v, multiline);
            if (out.length < min || (required && !out)) { this.err(`${path}.${key}`, "no puede estar vacío"); return undefined; }
            return out;
        }

        oneOf(obj, key, path, list, { required = false } = {}) {
            const v = obj[key];
            if (v === undefined) { if (required) this.err(`${path}.${key}`, "es obligatorio"); return undefined; }
            if (typeof v !== "string" || !list.includes(v)) {
                this.err(`${path}.${key}`, `valor no permitido (usa uno de: ${list.join(", ")})`);
                return undefined;
            }
            return v;
        }

        re(obj, key, path, re, what, { required = false } = {}) {
            const v = obj[key];
            if (v === undefined) { if (required) this.err(`${path}.${key}`, "es obligatorio"); return undefined; }
            if (typeof v !== "string" || !re.test(v)) { this.err(`${path}.${key}`, `no es ${what} válido`); return undefined; }
            return v;
        }

        int(obj, key, path, min, max) {
            const v = obj[key];
            if (v === undefined) return undefined;
            if (!Number.isInteger(v) || v < min || v > max) { this.err(`${path}.${key}`, `tiene que ser un entero entre ${min} y ${max}`); return undefined; }
            return v;
        }
    }

    // ----------------------------------------------------
    // Piezas
    // ----------------------------------------------------

    function endpoint(c, e, path, { needComponent }) {
        if (!c.keys(e, path, ["component", "pin", "pinType", "gpioOutput"])) return null;
        const out = {};
        const comp = c.re(e, "component", path, COMPONENT_RE, "un tipo de componente", { required: needComponent });
        if (comp) out.component = comp;
        const pin = c.re(e, "pin", path, PIN_RE, "un id de pin");
        if (pin) out.pin = pin;
        const pinType = c.oneOf(e, "pinType", path, PIN_TYPES);
        if (pinType) out.pinType = pinType;
        if (e.gpioOutput !== undefined) {
            if (typeof e.gpioOutput !== "boolean") c.err(`${path}.gpioOutput`, "tiene que ser true o false");
            else if (e.gpioOutput) out.gpioOutput = true;
        }
        if (!out.component && !out.pin && !out.pinType && !out.gpioOutput) {
            c.err(path, "indica al menos component, pin, pinType o gpioOutput");
        }
        return out;
    }

    function check(c, v, path) {
        if (!c.keys(v, path, ["type", "component", "count", "from", "to"])) return null;
        const type = c.oneOf(v, "type", path, CHECK_TYPES, { required: true });
        if (!type) return null;
        const allowedByType = {
            emptyCanvas: ["type"], running: ["type"], saved: ["type"], code: ["type"],
            component: ["type", "component", "count"],
            wire: ["type", "from", "to"],
        };
        for (const k of Object.keys(v)) {
            if (!allowedByType[type].includes(k)) c.err(path, `"${k}" no se usa con type "${type}"`);
        }
        const out = { type };
        if (type === "component") {
            out.component = c.re(v, "component", path, COMPONENT_RE, "un tipo de componente", { required: true });
            out.count = c.int(v, "count", path, 1, LIMITS.componentCount) || 1;
        }
        if (type === "wire") {
            if (v.from === undefined || v.to === undefined) { c.err(path, "un cable necesita \"from\" y \"to\""); return out; }
            out.from = endpoint(c, v.from, `${path}.from`, { needComponent: false });
            out.to = endpoint(c, v.to, `${path}.to`, { needComponent: false });
        }
        return out;
    }

    function highlight(c, v, path) {
        if (!c.keys(v, path, ["type", "target", "component", "pins"])) return null;
        const type = c.oneOf(v, "type", path, HIGHLIGHT_TYPES, { required: true });
        if (!type) return null;
        const allowedByType = { ui: ["type", "target"], component: ["type", "component"], pins: ["type", "pins"] };
        for (const k of Object.keys(v)) {
            if (!allowedByType[type].includes(k)) c.err(path, `"${k}" no se usa con type "${type}"`);
        }
        const out = { type };
        if (type === "ui") out.target = c.oneOf(v, "target", path, Object.keys(UI_TARGETS), { required: true });
        if (type === "component") out.component = c.re(v, "component", path, COMPONENT_RE, "un tipo de componente", { required: true });
        if (type === "pins") {
            if (!Array.isArray(v.pins) || v.pins.length === 0 || v.pins.length > LIMITS.pins) {
                c.err(`${path}.pins`, `tiene que ser una lista de 1 a ${LIMITS.pins} pines`);
            } else {
                out.pins = v.pins.map((p, i) => endpoint(c, p, `${path}.pins[${i}]`, { needComponent: true }));
            }
        }
        return out;
    }

    function validateXml(c, xml, path) {
        const s = xml.trim();
        if (!/^<xml[\s>]/.test(s) || !/<\/xml>$/.test(s)) { c.err(path, "tiene que ser un programa de bloques (<xml> ... </xml>)"); return; }
        if (/<!|<\?/.test(s)) { c.err(path, "no puede tener <!DOCTYPE>, <!ENTITY>, <![CDATA[ ni <?...?>"); return; }
        const tagRe = /<\/?([A-Za-z_][\w:.-]*)/g;
        let m;
        while ((m = tagRe.exec(s))) {
            if (!XML_TAGS.has(m[1])) { c.err(path, `etiqueta no permitida <${m[1]}>`); return; }
        }
    }

    function blockTypesOf(xml) {
        const types = new Set();
        const re = /<(?:block|shadow)\b[^>]*\btype="([^"]*)"/g;
        let m;
        while ((m = re.exec(xml))) types.add(m[1]);
        return [...types];
    }

    function action(c, v, path) {
        if (!c.keys(v, path, ["type", "label", "xml", "code"])) return null;
        const type = c.oneOf(v, "type", path, ACTION_TYPES, { required: true });
        if (!type) return null;
        const out = { type };
        const label = c.str(v, "label", path, { max: LIMITS.label });
        if (label) out.label = label;
        if (type === "openBlocks") {
            if (v.code !== undefined) c.err(path, "\"code\" no se usa con openBlocks");
            const xml = c.str(v, "xml", path, { max: LIMITS.xml, required: true, multiline: true });
            if (xml) { validateXml(c, xml, `${path}.xml`); out.xml = xml; }
        } else {
            if (v.xml !== undefined) c.err(path, "\"xml\" no se usa con insertCode");
            const code = v.code;
            if (typeof code !== "string" || !code.trim()) c.err(`${path}.code`, "es obligatorio (texto)");
            else if (code.length > LIMITS.code) c.err(`${path}.code`, `es demasiado largo (máximo ${LIMITS.code} caracteres)`);
            // El código conserva su indentación: solo se sacan caracteres de control.
            else out.code = code.replace(/\r\n?/g, "\n").replace(UNSAFE_CHARS, "");
        }
        return out;
    }

    function image(c, v, path) {
        if (typeof v !== "string") { c.err(path, "tiene que ser texto (data:image/...;base64,...)"); return undefined; }
        if (v.length > LIMITS.image) { c.err(path, "la imagen es demasiado grande (máximo ~1.5 MB)"); return undefined; }
        const m = IMAGE_RE.exec(v);
        if (!m) { c.err(path, "solo se aceptan imágenes PNG, GIF, JPEG o WEBP embebidas (data:image/...;base64,...)"); return undefined; }
        let head = "";
        try { head = atob(m[2].slice(0, 24)); } catch (e) { /* abajo */ }
        const sig = {
            png: head.startsWith("\x89PNG"),
            gif: head.startsWith("GIF8"),
            jpeg: head.startsWith("\xFF\xD8\xFF"),
            webp: head.startsWith("RIFF") && head.slice(8, 12) === "WEBP",
        };
        if (!sig[m[1]]) { c.err(path, `el contenido no es realmente una imagen ${m[1].toUpperCase()}`); return undefined; }
        return v;
    }

    function step(c, v, i) {
        const path = `steps[${i}]`;
        if (!c.keys(v, path, ["preset", "title", "text", "highlight", "check", "open", "actions"])) return null;
        const preset = c.oneOf(v, "preset", path, Object.keys(PRESETS));
        const base = preset ? PRESETS[preset] : {};

        const out = {};
        if (preset) out.preset = preset;
        const title = c.str(v, "title", path, { max: LIMITS.stepTitle, required: !preset });
        const text = c.str(v, "text", path, { max: LIMITS.text, multiline: true });
        if (title) out.title = title;
        if (text !== undefined) out.text = text;
        if (v.highlight !== undefined) out.highlight = highlight(c, v.highlight, `${path}.highlight`);
        if (v.check !== undefined) out.check = check(c, v.check, `${path}.check`);
        const open = c.oneOf(v, "open", path, OPEN_TARGETS);
        if (open) out.open = open;
        if (v.actions !== undefined) {
            if (!Array.isArray(v.actions) || v.actions.length > LIMITS.actionsPerStep) {
                c.err(`${path}.actions`, `tiene que ser una lista de hasta ${LIMITS.actionsPerStep} acciones`);
            } else {
                out.actions = v.actions.map((a, j) => action(c, a, `${path}.actions[${j}]`));
            }
        }
        // Resuelto (preset + lo que el docente sobreescribió) -- lo usa compile().
        out._resolved = {
            title: out.title || base.title || "",
            text: out.text !== undefined ? out.text : (base.text || ""),
            highlight: out.highlight || base.highlight,
            check: out.check || base.check,
            open: out.open || base.open,
        };
        return out;
    }

    // ----------------------------------------------------
    // API
    // ----------------------------------------------------

    // raw: texto JSON u objeto ya parseado. Devuelve
    // { ok, errors, data } -- data es la versión limpia/canónica
    // (la que se guarda, exporta y comparte).
    function validate(raw) {
        const c = new Ctx();
        let obj = raw;
        if (typeof raw === "string") {
            if (raw.length > LIMITS.fileChars) return { ok: false, errors: ["El archivo es demasiado grande (máximo 3 MB)."] };
            try { obj = JSON.parse(raw); } catch (e) { return { ok: false, errors: ["No es un archivo JSON válido: " + e.message] }; }
        }
        if (!c.keys(obj, "tutorial", [
            "format", "formatVersion", "id", "title", "author", "icon",
            "description", "demoImage", "demoCaption", "steps",
        ])) return { ok: false, errors: c.errors };

        if (obj.format !== FORMAT) c.err("format", `tiene que ser "${FORMAT}"`);
        if (obj.formatVersion !== VERSION) {
            c.err("formatVersion", typeof obj.formatVersion === "number" && obj.formatVersion > VERSION
                ? `este tutorial usa la versión ${obj.formatVersion} del formato; actualiza el simulador`
                : `tiene que ser ${VERSION}`);
        }

        const data = { format: FORMAT, formatVersion: VERSION };
        data.id = c.re(obj, "id", "tutorial", ID_RE, "un id (minúsculas, números, - y _; hasta 40)", { required: true });
        data.title = c.str(obj, "title", "tutorial", { max: LIMITS.tutorialTitle, required: true });
        const author = c.str(obj, "author", "tutorial", { max: LIMITS.author });
        if (author) data.author = author;
        const icon = c.str(obj, "icon", "tutorial", { max: LIMITS.icon });
        if (icon) data.icon = icon;
        const description = c.str(obj, "description", "tutorial", { max: LIMITS.description, multiline: true });
        if (description) data.description = description;
        if (obj.demoImage !== undefined) {
            const img = image(c, obj.demoImage, "tutorial.demoImage");
            if (img) data.demoImage = img;
        }
        const caption = c.str(obj, "demoCaption", "tutorial", { max: LIMITS.caption, multiline: true });
        if (caption) data.demoCaption = caption;

        if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
            c.err("tutorial.steps", "tiene que ser una lista con al menos un paso");
        } else if (obj.steps.length > LIMITS.steps) {
            c.err("tutorial.steps", `demasiados pasos (máximo ${LIMITS.steps})`);
        } else {
            data.steps = obj.steps.map((s, i) => step(c, s, i));
        }

        if (c.errors.length) return { ok: false, errors: c.errors.slice(0, 25) };
        return { ok: true, errors: [], data };
    }

    // Versión para guardar/exportar: sin los campos internos (_resolved).
    function toJSON(data, pretty = true) {
        return JSON.stringify(data, (k, v) => (k === "_resolved" ? undefined : v), pretty ? 2 : 0);
    }

    // Resumen para la pantalla de confirmación.
    function summarize(data) {
        let xmlCount = 0, codeCount = 0;
        const blockTypes = new Set();
        const components = new Set();
        for (const s of data.steps) {
            for (const a of s.actions || []) {
                if (a.type === "openBlocks") { xmlCount++; blockTypesOf(a.xml).forEach((t) => blockTypes.add(t)); }
                if (a.type === "insertCode") codeCount++;
            }
            const r = s._resolved;
            if (r.check?.type === "component") components.add(r.check.component);
            if (r.highlight?.type === "component") components.add(r.highlight.component);
            for (const e of [r.check?.from, r.check?.to, ...(r.highlight?.pins || [])]) if (e?.component) components.add(e.component);
        }
        return {
            steps: data.steps.length, hasImage: !!data.demoImage,
            xmlCount, codeCount, blockTypes: [...blockTypes], components: [...components],
        };
    }

    // ----------------------------------------------------
    // compile: datos validados -> tutorial que entiende TutorialManager.
    // Todas las funciones de acá son NUESTRAS; el archivo solo aporta
    // valores ya validados.
    // ----------------------------------------------------

    function endpointMatcher(e) {
        return (comp, pin) =>
            (!e.component || comp.type === e.component) &&
            (!e.pin || pin.id === e.pin) &&
            (!e.pinType || pin.type === e.pinType) &&
            (!e.gpioOutput || (pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart"));
    }

    function compileCheck(chk) {
        switch (chk.type) {
            case "emptyCanvas": return (tm) => tm.simulator.componentManager.getAll().length === 0;
            case "component":   return (tm) => tm.hasComponentCount(chk.component, chk.count || 1);
            case "running":     return (tm) => !!tm.simulator.isRunning;
            case "saved":       return (tm) => !tm.simulator.projectManager.dirty;
            case "code":        return (tm) => !!tm.replPanel?.editor?.value?.trim();
            case "wire": {
                const a = endpointMatcher(chk.from), b = endpointMatcher(chk.to);
                return (tm) => tm.hasWireBetweenComponents(a, b);
            }
        }
        return undefined;
    }

    function compileHighlight(h) {
        if (!h) return () => {};
        switch (h.type) {
            case "ui":        return (tm) => tm.highlightElements(UI_TARGETS[h.target] || []);
            case "component": return (tm) => tm.highlightToolboxAndCanvas(h.component);
            case "pins": {
                const entries = h.pins.map((p) => {
                    const m = endpointMatcher({ ...p, component: undefined });
                    return { type: p.component, match: (pin) => m(null, pin) };
                });
                return (tm) => tm.highlightPins(entries);
            }
        }
        return () => {};
    }

    function compileOpen(open) {
        if (open === "projectMenu") {
            return () => {
                document.getElementById("projectDrawer")?.classList.remove("hidden");
                document.getElementById("btnProjectMenu")?.classList.add("active");
            };
        }
        if (open === "editor") {
            return (tm) => {
                if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                tm.replPanel?.switchTab("editor");
            };
        }
        return undefined;
    }

    function compileAction(a) {
        if (a.type === "openBlocks") {
            return { label: a.label || "🧩 Abrir el programa en bloques", run: () => window.blocklyPanel?.openXmlText(a.xml) };
        }
        return {
            label: a.label || "📝 Poner el código en el editor",
            run: (tm) => {
                const rp = tm.replPanel;
                if (!rp?.codeMirror) return;
                const current = rp.editor?.value?.trim();
                if (current && !confirm("¿Reemplazar el código que tienes en el editor por el del tutorial?")) return;
                rp.codeMirror.setValue(a.code);
                if (!rp.open) rp.toggle();
                rp.switchTab("editor");
            },
        };
    }

    function compile(data) {
        const n = data.steps.length;
        return {
            id: "import:" + data.id,
            imported: true,
            source: data,
            title: data.title,
            author: data.author || "",
            icon: data.icon || "📘",
            category: "📥 Importados",
            demoGif: data.demoImage,
            demoCaption: data.demoCaption,
            steps: data.steps.map((s, i) => {
                const r = s._resolved;
                const title = /^paso\s+\d+/i.test(r.title) ? r.title : `Paso ${i + 1} — ${r.title}`;
                const st = {
                    title,
                    text: r.text,
                    highlight: compileHighlight(r.highlight),
                };
                if (r.check) st.isDone = compileCheck(r.check);
                const onEnter = compileOpen(r.open);
                if (onEnter) st.onEnter = onEnter;
                if (s.actions?.length) st.actions = s.actions.map(compileAction);
                if (i === n - 1) st.isLast = true;
                return st;
            }),
        };
    }

    return { FORMAT, VERSION, LIMITS, UI_TARGETS, PRESETS, validate, compile, summarize, toJSON, blockTypesOf, cleanText };

})();

if (typeof module !== "undefined") module.exports = TutorialFormat;
