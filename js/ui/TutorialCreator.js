/*
==========================================================
 PitSimulator
 Archivo: TutorialCreator.js
 "✏️ Crear tutorial" -- pensado para docentes que NO
 programan: arman el circuito en el lienzo (y, si quieren, el
 código), y este asistente genera solo los pasos:
   colocar cada componente -> cada cable (con el nombre de sus
   pines) -> guardar -> simular -> código.
 El docente solo cambia textos, ordena o borra pasos, y comparte.

 El resultado es un tutorial en el formato de TutorialFormat.js y
 pasa por el MISMO validador que un archivo importado: lo que sale
 de acá no tiene ningún privilegio extra. Todo el texto se muestra
 con textContent / .value (nunca innerHTML con datos).
==========================================================
*/

class TutorialCreator {

    static DRAFT_KEY = "pit_tutorial_draft_v1";
    static ICONS = ["💡", "🔘", "⚙️", "🌡️", "🚗", "📡", "🎵", "🤖", "🚦", "🔌", "📟", "🌈"];
    static MCU_RE = /esp32|arduino|pico|uno|nano/;
    static PHOTO_MAX_WIDTH = 900;

    constructor(tutorialManager, tutorialImport) {

        this.tm = tutorialManager;
        this.importer = tutorialImport;
        this.draft = null;

        this._buildDialog();

        this.tm.creatorHooks = {
            create: () => this.open(),
            edit: (t) => this.editImported(t),
        };
        this.tm.renderMenu();

    }

    // ====================================================
    // Generar el tutorial a partir de lo que hay en el simulador
    // ====================================================

    _components() {
        return this.tm.simulator.componentManager.getAll()
            .filter((c) => /^[a-z0-9_]{1,40}$/.test(c.type));
    }

    static _isMcu(c) { return TutorialCreator.MCU_RE.test(c.type); }

    static _pinLabel(pin) {
        if (pin.type === "ground") return "un pin GND";
        const name = (pin.name || pin.id || "").trim();
        return `el pin ${name}`;
    }

    // Pin -> cómo lo reconoce la condición del paso. GND: cualquiera del
    // componente (hay varios equivalentes); el resto: ese pin exacto,
    // así coincide con el código del docente.
    static _endpoint(comp, pin) {
        const e = { component: comp.type };
        if (pin.type === "ground") e.pinType = "ground";
        else if (/^[A-Za-z0-9_+.-]{1,24}$/.test(pin.id)) e.pin = pin.id;
        else e.pinType = pin.type;
        return e;
    }

    _generateSteps() {

        const comps = this._components();
        const cm = this.tm.simulator.componentManager;
        const wires = this.tm.simulator.wireManager.wires
            .map((w) => {
                const ca = cm.get(w.from.componentId), cb = cm.get(w.to.componentId);
                const pa = ca?.pins.find((p) => p.id === w.from.pinId);
                const pb = cb?.pins.find((p) => p.id === w.to.pinId);
                return ca && cb && pa && pb ? { ca, pa, cb, pb } : null;
            })
            .filter((w) => w && comps.includes(w.ca) && comps.includes(w.cb));

        const steps = [{
            preset: "newProject",
            title: "Crea un proyecto nuevo",
            text: "Antes de empezar, haz clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío.",
        }];

        const placed = new Set();
        const done = new Set();
        const count = {};

        const place = (c) => {
            count[c.type] = (count[c.type] || 0) + 1;
            const n = count[c.type];
            const name = c.name || c.type;
            const step = {
                title: n > 1 ? `Coloca otro ${name}` : `Coloca ${name}`,
                text: `Busca "${name}" en el panel de componentes (a la izquierda) y arrástralo hasta el lienzo.`,
                highlight: { type: "component", component: c.type },
                check: { type: "component", component: c.type },
            };
            if (n > 1) step.check.count = Math.min(n, 10);
            steps.push(step);
            placed.add(c);
        };

        const wireStep = (w) => {
            // El microcontrolador va primero en la frase ("de la ESP32 ... con ...").
            let { ca, pa, cb, pb } = w;
            if (!TutorialCreator._isMcu(ca) && TutorialCreator._isMcu(cb)) [ca, pa, cb, pb] = [cb, pb, ca, pa];
            const nameA = ca.name || ca.type, nameB = cb.name || cb.type;
            const shortB = pb.type === "ground" ? "GND" : (pb.name || pb.id);
            let title = `Conecta ${shortB} de ${nameB}`;
            // Ej. dos cables al GND del L298N (uno de la ESP32, otro de la batería).
            if (steps.some((s) => s.title === title)) title += ` (desde ${nameA})`;
            steps.push({
                title,
                text: `Traza un cable desde ${TutorialCreator._pinLabel(pa)} de ${nameA} hasta ${TutorialCreator._pinLabel(pb)} de ${nameB}.`,
                highlight: { type: "pins", pins: [TutorialCreator._endpoint(ca, pa), TutorialCreator._endpoint(cb, pb)] },
                check: { type: "wire", from: TutorialCreator._endpoint(ca, pa), to: TutorialCreator._endpoint(cb, pb) },
            });
            done.add(w);
        };

        // Placas primero; después cada componente seguido de SUS cables
        // (los que van a algo ya colocado), de izquierda a derecha.
        comps.filter(TutorialCreator._isMcu).forEach(place);
        comps.filter((c) => !TutorialCreator._isMcu(c))
            .sort((a, b) => (a.x || 0) - (b.x || 0))
            .forEach((c) => {
                place(c);
                wires.filter((w) => !done.has(w) && placed.has(w.ca) && placed.has(w.cb)).forEach(wireStep);
            });
        wires.filter((w) => !done.has(w)).forEach(wireStep);

        steps.push(
            { preset: "save", title: "Guarda tu proyecto", text: "Guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) para no perder el circuito." },
            { preset: "simulate", title: "Simula el circuito", text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación." },
            { preset: "code", title: "Escribe o carga el código", text: "Pon el programa en el editor con el botón de abajo, revisa que los pines sean los que conectaste y dale ▶ Ejecutar." },
        );

        return steps.slice(0, TutorialFormat.LIMITS.steps);
    }

    // Código que hay AHORA en el editor ("" si vacío o demasiado largo).
    _editorCode() {
        const rp = this.tm.replPanel;
        const code = (rp?.codeMirror ? rp.codeMirror.getValue() : rp?.editor?.value) || "";
        return code.trim() && code.length <= TutorialFormat.LIMITS.code ? code : "";
    }

    // Bloques que hay AHORA en el editor de bloques ("" si no hay).
    _workspaceXml() {
        const ws = window.blocklyPanel?.workspace;
        if (!ws || !ws.getAllBlocks(false).length || typeof Blockly === "undefined") return "";
        const xml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(ws));
        return xml.length <= TutorialFormat.LIMITS.xml ? xml : "";
    }

    static _sameCode(a, b) {
        const norm = (s) => (s || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").trim();
        return norm(a) === norm(b);
    }

    // Dos programas de bloques son "iguales" si generan el mismo Python
    // (mover un bloque de lugar en la pantalla no cuenta como cambio).
    static _xmlToPython(xml) {
        if (!xml || typeof Blockly === "undefined") return "";
        const ws = new Blockly.Workspace();
        try {
            Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(xml), ws);
            return Blockly.Python.workspaceToCode(ws);
        } catch (e) {
            return xml;
        } finally {
            ws.dispose();
        }
    }

    // ¿El editor / los bloques tienen algo distinto de lo que va en el tutorial?
    _diffs() {
        const { extras } = this.draft;
        const editor = this._editorCode();
        const xml = this._workspaceXml();
        return {
            code: !!editor && !TutorialCreator._sameCode(editor, extras.code),
            editorCode: editor,
            xml: !!xml && TutorialCreator._xmlToPython(xml) !== TutorialCreator._xmlToPython(extras.xml),
            currentXml: xml,
        };
    }

    async _captureExtras() {

        const extras = { code: this._editorCode(), xml: this._workspaceXml(), photo: "" };

        try {
            extras.photo = await this._capturePhoto();
        } catch (e) {
            console.warn("[TutorialCreator] No se pudo capturar el circuito", e);
        }

        return extras;
    }

    // Foto del circuito (misma captura que el reporte), achicada para que
    // entre en el límite de imagen del formato.
    async _capturePhoto() {
        // Sin nombres: la etiqueta de texto queda fuera del recuadro de la
        // captura y salía cortada en el borde.
        const res = await window.toolbar?._buildCircuitPngBlob?.({ showNames: false });
        if (!res?.blob) return "";
        const url = URL.createObjectURL(res.blob);
        try {
            const img = await new Promise((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = reject;
                el.src = url;
            });
            const scale = Math.min(1, TutorialCreator.PHOTO_MAX_WIDTH / img.naturalWidth);
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.naturalWidth * scale);
            canvas.height = Math.round(img.naturalHeight * scale);
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            let data = canvas.toDataURL("image/png");
            if (data.length > TutorialFormat.LIMITS.image * 0.9) data = canvas.toDataURL("image/jpeg", 0.85);
            return data.length <= TutorialFormat.LIMITS.image ? data : "";
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    static _newId(title) {
        const slug = (title || "tutorial").toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "tutorial";
        const rand = Math.random().toString(36).slice(2, 7);
        return `${slug}-${rand}`.replace(/^[^a-z0-9]+/, "t");
    }

    async _newDraftFromSimulator() {
        const extras = await this._captureExtras();
        this.draft = {
            data: {
                format: TutorialFormat.FORMAT,
                formatVersion: TutorialFormat.VERSION,
                id: "",
                title: "",
                author: localStorage.getItem("pit_tutorial_author") || "",
                icon: "💡",
                description: "",
                steps: this._generateSteps(),
            },
            extras,
            use: this._defaultUse(extras),
        };
        this._saveDraft();
    }

    // Qué se marca solo al tomar foto/código/bloques. Los bloques solo si
    // son los del código del editor (o el editor está vacío): el editor
    // de bloques puede tener cargado otro programa (ej. el que abrió el
    // botón de un tutorial), y ese NO debe colarse en el tutorial.
    _defaultUse(extras) {
        let xml = !!extras.xml;
        if (xml && extras.code) {
            const py = TutorialCreator._xmlToPython(extras.xml);
            const clean = window.blocklyPanel?._cleanCodeForDisplay?.(py) ?? py;
            xml = TutorialCreator._sameCode(clean, extras.code);
        }
        return { code: !!extras.code, xml, photo: !!extras.photo };
    }

    // Foto de un programa de bloques (para que el docente VEA qué bloques
    // van, en vez de leer el Python que generan). Se dibuja en un
    // workspace de Blockly fuera de pantalla, de solo lectura, que se
    // descarta enseguida -- no toca el editor de bloques del docente.
    static _imageCache = new Map();

    static async _blocksImage(xml) {
        if (!xml || typeof Blockly === "undefined" || typeof pitWorkspaceToSvg !== "function") return null;
        if (TutorialCreator._imageCache.has(xml)) return TutorialCreator._imageCache.get(xml);
        const host = document.createElement("div");
        host.style.cssText = "position:fixed;left:-10000px;top:0;width:1000px;height:800px;";
        document.body.appendChild(host);
        let ws = null;
        try {
            ws = Blockly.inject(host, { readOnly: true, media: "assets/blockly-media/", trashcan: false, scrollbars: false });
            Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(xml), ws);
            const svg = await pitWorkspaceToSvg(ws);
            const img = await pitSvgToPng(svg);
            const url = img?.dataUrl || null;
            if (TutorialCreator._imageCache.size > 20) TutorialCreator._imageCache.clear();
            TutorialCreator._imageCache.set(xml, url);
            return url;
        } catch (e) {
            console.warn("[TutorialCreator] No se pudo dibujar los bloques", e);
            return null;
        } finally {
            ws?.dispose();
            host.remove();
        }
    }

    // Pone la foto de "xml" en <img> (async; ignora resultados viejos).
    async _showBlocksImage(imgEl, xml) {
        const token = (imgEl._pitToken = (imgEl._pitToken || 0) + 1);
        if (!xml) { imgEl.classList.add("hidden"); imgEl.removeAttribute("src"); return; }
        const url = await TutorialCreator._blocksImage(xml);
        if (imgEl._pitToken !== token) return;
        imgEl.classList.toggle("hidden", !url);
        if (url) imgEl.src = url;
    }

    // ====================================================
    // Borrador (se guarda solo, para no perder lo escrito)
    // ====================================================

    _saveDraft() {
        if (!this.draft) return;
        try {
            localStorage.setItem(TutorialCreator.DRAFT_KEY, JSON.stringify(this.draft));
        } catch (e) {
            // Sin espacio (normalmente por la foto): se guarda sin ella.
            try {
                const light = { ...this.draft, extras: { ...this.draft.extras, photo: "" }, use: { ...this.draft.use, photo: false } };
                localStorage.setItem(TutorialCreator.DRAFT_KEY, JSON.stringify(light));
            } catch (e2) { /* no bloquea la edición */ }
        }
    }

    _loadDraft() {
        try {
            const d = JSON.parse(localStorage.getItem(TutorialCreator.DRAFT_KEY) || "null");
            if (d && d.data && Array.isArray(d.data.steps) && d.extras && d.use) return d;
        } catch (e) { /* borrador dañado: se ignora */ }
        return null;
    }

    _clearDraft() {
        try { localStorage.removeItem(TutorialCreator.DRAFT_KEY); } catch (e) { /* nada */ }
    }

    // ====================================================
    // Armar el tutorial final (y validarlo como cualquier importado)
    // ====================================================

    _build() {
        const d = this.draft;
        const data = JSON.parse(JSON.stringify(d.data));
        if (!data.id) data.id = d.data.id = TutorialCreator._newId(data.title);
        for (const k of ["author", "description"]) if (!data[k]) delete data[k];
        if (d.use.photo && d.extras.photo) data.demoImage = d.extras.photo;
        else delete data.demoImage;
        if (data.demoImage && !data.demoCaption) data.demoCaption = "Así se ve el circuito terminado -- sigue los pasos para armarlo tú.";

        // Botones de código: van al último paso de código (o a uno nuevo).
        let codeStep = [...data.steps].reverse().find((s) => s.preset === "code");
        const actions = [];
        if (d.use.code && d.extras.code) actions.push({ type: "insertCode", label: "📝 Poner el código en el editor", code: d.extras.code });
        if (d.use.xml && d.extras.xml) actions.push({ type: "openBlocks", label: "🧩 Abrir el programa en bloques", xml: d.extras.xml });
        if (actions.length && !codeStep) {
            codeStep = { preset: "code" };
            data.steps.push(codeStep);
        }
        for (const s of data.steps) {
            if (s.actions) s.actions = s.actions.filter((a) => a.type !== "insertCode" && a.type !== "openBlocks");
            if (s.actions && !s.actions.length) delete s.actions;
        }
        if (codeStep && actions.length) codeStep.actions = actions;
        return TutorialFormat.validate(data);
    }

    // ====================================================
    // Diálogo
    // ====================================================

    _buildDialog() {

        // Esqueleto estático; los datos del tutorial se cargan después
        // con .value / textContent.
        this.overlay = document.createElement("div");
        this.overlay.className = "tutorial-import-overlay tutorial-creator-overlay hidden";
        this.overlay.innerHTML = `
            <div class="tutorial-import-dialog tutorial-creator-dialog" role="dialog" aria-modal="true" aria-labelledby="tutorialCreatorTitle">
                <div class="tutorial-import-header">
                    <h3 id="tutorialCreatorTitle">✏️ Crear tutorial</h3>
                    <button type="button" class="tutorial-import-close tc-close" title="Cerrar (tu avance se guarda solo)">✕</button>
                </div>

                <div class="tc-section tc-intro hidden">
                    <p class="tc-big">Así de fácil:</p>
                    <ol class="tc-howto">
                        <li><b>Arma el circuito</b> en el lienzo, tal como quieres que lo armen tus alumnos.</li>
                        <li>Si quieres, <b>escribe el código</b> en el editor o arma los bloques 🧩.</li>
                        <li>Vuelve aquí: los pasos se escriben solos. Tú solo los revisas con tus palabras.</li>
                    </ol>
                    <p class="tc-hint tc-empty-hint"></p>
                    <div class="tutorial-import-actions">
                        <button type="button" class="tutorial-import-btn tutorial-import-secondary tc-close">Voy a armar el circuito</button>
                        <button type="button" class="tutorial-import-btn tc-generate">✨ Crear tutorial desde mi circuito</button>
                    </div>
                </div>

                <div class="tc-section tc-resume hidden">
                    <p class="tc-big">Tienes un tutorial a medio hacer:</p>
                    <p class="tc-resume-title"></p>
                    <div class="tutorial-import-actions">
                        <button type="button" class="tutorial-import-btn tutorial-import-secondary tc-start-over">Empezar otro nuevo</button>
                        <button type="button" class="tutorial-import-btn tc-continue">Continuar</button>
                    </div>
                </div>

                <div class="tc-section tc-editor hidden">
                    <div class="tc-block">
                        <p class="tc-step-label">1. Ponle nombre</p>
                        <label class="tc-field">Título del tutorial
                            <input type="text" class="tc-title" maxlength="80" placeholder="Ej.: Semáforo con ESP32">
                        </label>
                        <label class="tc-field">Tu nombre (lo verán tus alumnos)
                            <input type="text" class="tc-author" maxlength="60" placeholder="Ej.: Prof. Ana López">
                        </label>
                        <label class="tc-field">¿Qué van a aprender? (opcional)
                            <textarea class="tc-description" maxlength="400" rows="2"></textarea>
                        </label>
                        <div class="tc-field">Ícono
                            <div class="tc-icons"></div>
                        </div>
                    </div>

                    <div class="tc-block">
                        <p class="tc-step-label">2. Revisa los pasos</p>
                        <p class="tc-hint">Se armaron solos a partir de tu circuito. Cambia los textos con tus palabras; puedes moverlos (↑ ↓), borrarlos (🗑) o agregar explicaciones.</p>
                        <div class="tc-steps"></div>
                        <button type="button" class="tutorial-import-btn tutorial-import-secondary tc-add-step">＋ Agregar un paso con una explicación</button>
                    </div>

                    <div class="tc-block">
                        <p class="tc-step-label">3. ¿Qué más incluyo?</p>
                        <label class="tc-check"><input type="checkbox" class="tc-use-photo"> <span class="tc-photo-label"></span></label>
                        <img class="tc-photo-preview hidden" alt="Foto del circuito terminado">
                        <label class="tc-check"><input type="checkbox" class="tc-use-code"> <span class="tc-code-label"></span></label>
                        <p class="tc-hint tc-code-caption hidden">Este es EXACTAMENTE el código que recibirán tus alumnos:</p>
                        <pre class="tc-code-preview hidden"></pre>
                        <div class="tc-diff tc-code-diff hidden">
                            <span class="tc-code-diff-text"></span>
                            <button type="button" class="tutorial-import-btn tc-use-editor-code">📝 Usar el código que tengo ahora en el editor</button>
                        </div>
                        <label class="tc-check"><input type="checkbox" class="tc-use-xml"> <span class="tc-xml-label"></span></label>
                        <p class="tc-hint tc-xml-caption hidden">Estos son EXACTAMENTE los bloques que recibirán tus alumnos:</p>
                        <img class="tc-blocks-img tc-xml-preview hidden" alt="Bloques que van en el tutorial">
                        <div class="tc-diff tc-xml-diff hidden">
                            <span class="tc-xml-diff-text"></span>
                            <img class="tc-blocks-img tc-xml-current hidden" alt="Bloques que tienes ahora en 🧩">
                            <button type="button" class="tutorial-import-btn tc-use-current-xml">🧩 Usar mis bloques actuales</button>
                        </div>
                        <button type="button" class="tutorial-import-btn tutorial-import-secondary tc-recapture">↻ Volver a tomar foto, código y bloques del simulador</button>
                    </div>

                    <ul class="tutorial-import-error-list tc-errors hidden"></ul>

                    <div class="tutorial-import-actions tc-footer">
                        <button type="button" class="tutorial-import-btn tutorial-import-secondary tc-regenerate" title="Vuelve a crear los pasos desde el circuito actual">↻ Rehacer pasos</button>
                        <button type="button" class="tutorial-import-btn tutorial-import-secondary tc-try">▶ Probarlo</button>
                        <button type="button" class="tutorial-import-btn tc-share">📤 Guardar y compartir</button>
                    </div>
                </div>

                <div class="tc-section tc-choose hidden">
                    <p class="tc-big tc-choose-title"></p>
                    <p class="tc-hint tc-choose-hint"></p>
                    <button type="button" class="tc-choice tc-choice-current">
                        <span class="tc-choice-label"></span>
                        <pre class="tc-choice-code"></pre>
                        <img class="tc-blocks-img tc-choice-img hidden" alt="">
                    </button>
                    <button type="button" class="tc-choice tc-choice-saved">
                        <span class="tc-choice-label"></span>
                        <pre class="tc-choice-code"></pre>
                        <img class="tc-blocks-img tc-choice-img hidden" alt="">
                    </button>
                    <div class="tutorial-import-actions">
                        <button type="button" class="tutorial-import-btn tutorial-import-secondary tc-choose-cancel">← Volver sin guardar</button>
                    </div>
                </div>

                <div class="tc-section tc-shared hidden">
                    <p class="tc-big">✅ ¡Listo! Tu tutorial ya está en el menú 🎓.</p>
                    <p class="tc-hint">Para dárselo a tus alumnos elige una opción y envíalo por correo, WhatsApp o Classroom. Ellos lo abren en 🎓 → <b>📥 Abrir tutorial</b>.</p>
                    <div class="tc-share-buttons">
                        <button type="button" class="tutorial-import-btn tc-share-file">📄 Descargar archivo</button>
                        <button type="button" class="tutorial-import-btn tc-share-link">🔗 Copiar link</button>
                    </div>
                    <p class="tc-hint tc-share-note"></p>
                    <div class="tutorial-import-actions">
                        <button type="button" class="tutorial-import-btn tutorial-import-secondary tc-back-edit">✏️ Seguir editando</button>
                        <button type="button" class="tutorial-import-btn tc-finish">Terminar</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.overlay);

        const q = (s) => this.overlay.querySelector(s);
        this._els = {
            intro: q(".tc-intro"), emptyHint: q(".tc-empty-hint"),
            resume: q(".tc-resume"), resumeTitle: q(".tc-resume-title"),
            editor: q(".tc-editor"), shared: q(".tc-shared"),
            title: q(".tc-title"), author: q(".tc-author"), description: q(".tc-description"),
            icons: q(".tc-icons"), steps: q(".tc-steps"), errors: q(".tc-errors"),
            usePhoto: q(".tc-use-photo"), useCode: q(".tc-use-code"), useXml: q(".tc-use-xml"),
            photoLabel: q(".tc-photo-label"), codeLabel: q(".tc-code-label"), xmlLabel: q(".tc-xml-label"),
            photoPreview: q(".tc-photo-preview"), shareNote: q(".tc-share-note"),
            codeCaption: q(".tc-code-caption"), codePreview: q(".tc-code-preview"),
            codeDiff: q(".tc-code-diff"), codeDiffText: q(".tc-code-diff-text"),
            xmlDiff: q(".tc-xml-diff"), xmlDiffText: q(".tc-xml-diff-text"),
            xmlCaption: q(".tc-xml-caption"), xmlPreview: q(".tc-xml-preview"), xmlCurrent: q(".tc-xml-current"),
            choose: q(".tc-choose"), chooseTitle: q(".tc-choose-title"), chooseHint: q(".tc-choose-hint"),
            choiceCurrent: q(".tc-choice-current"), choiceSaved: q(".tc-choice-saved"),
        };

        q(".tc-use-editor-code").addEventListener("click", () => {
            this.draft.extras.code = this._editorCode();
            this.draft.use.code = !!this.draft.extras.code;
            this._saveDraft();
            this._renderExtras();
        });
        q(".tc-use-current-xml").addEventListener("click", () => {
            this.draft.extras.xml = this._workspaceXml();
            this.draft.use.xml = !!this.draft.extras.xml;
            this._saveDraft();
            this._renderExtras();
        });
        q(".tc-choose-cancel").addEventListener("click", () => this._choiceResolve?.(null));
        this._els.choiceCurrent.addEventListener("click", () => this._choiceResolve?.("current"));
        this._els.choiceSaved.addEventListener("click", () => this._choiceResolve?.("saved"));

        this.overlay.querySelectorAll(".tc-close").forEach((b) => b.addEventListener("click", () => this.close()));
        q(".tc-generate").addEventListener("click", () => this._startFromSimulator());
        q(".tc-continue").addEventListener("click", () => this._showEditor());
        q(".tc-start-over").addEventListener("click", () => {
            if (!confirm("¿Descartar el tutorial a medio hacer y empezar otro?")) return;
            this._clearDraft();
            this.draft = null;
            this._showIntro();
        });

        const bindText = (el, key) => el.addEventListener("input", () => {
            if (!this.draft) return;
            this.draft.data[key] = el.value;
            if (key === "author") { try { localStorage.setItem("pit_tutorial_author", el.value); } catch (e) { /* nada */ } }
            this._saveDraft();
        });
        bindText(this._els.title, "title");
        bindText(this._els.author, "author");
        bindText(this._els.description, "description");

        for (const icon of TutorialCreator.ICONS) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "tc-icon";
            b.textContent = icon;
            b.addEventListener("click", () => {
                this.draft.data.icon = icon;
                this._saveDraft();
                this._renderIcons();
            });
            this._els.icons.appendChild(b);
        }

        q(".tc-add-step").addEventListener("click", () => {
            this.draft.data.steps.push({ title: "Nuevo paso", text: "" });
            this._saveDraft();
            this._renderSteps();
            const inputs = this._els.steps.querySelectorAll(".tc-step-title");
            inputs[inputs.length - 1]?.select();
        });

        for (const [el, key] of [[this._els.usePhoto, "photo"], [this._els.useCode, "code"], [this._els.useXml, "xml"]]) {
            el.addEventListener("change", () => {
                this.draft.use[key] = el.checked;
                // Marcar algo que todavía no estaba guardado: se toma lo de ahora.
                if (el.checked && !this.draft.extras[key]) {
                    if (key === "code") this.draft.extras.code = this._editorCode();
                    if (key === "xml") this.draft.extras.xml = this._workspaceXml();
                }
                this._saveDraft();
                this._renderExtras();
            });
        }
        q(".tc-recapture").addEventListener("click", async () => {
            this.draft.extras = await this._captureExtras();
            this.draft.use = this._defaultUse(this.draft.extras);
            this._saveDraft();
            this._renderExtras();
        });
        q(".tc-regenerate").addEventListener("click", () => {
            if (!confirm("¿Volver a crear los pasos desde el circuito que hay ahora en el lienzo? Se pierden los cambios que hiciste en los pasos.")) return;
            this.draft.data.steps = this._generateSteps();
            this._saveDraft();
            this._renderSteps();
        });
        q(".tc-try").addEventListener("click", () => this._try());
        q(".tc-share").addEventListener("click", () => this._shareStep());
        q(".tc-share-file").addEventListener("click", () => this._lastSaved && this.importer.exportFile(this._lastSaved));
        q(".tc-share-link").addEventListener("click", () => this._lastSaved && this.importer.copyLink(this._lastSaved));
        q(".tc-back-edit").addEventListener("click", () => this._showEditor());
        q(".tc-finish").addEventListener("click", () => {
            this._clearDraft();
            this.draft = null;
            this.close();
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !this.overlay.classList.contains("hidden")) this.close();
        });

    }

    _section(name) {
        for (const s of ["intro", "resume", "editor", "choose", "shared"]) {
            this._els[s].classList.toggle("hidden", s !== name);
        }
        this.overlay.classList.remove("hidden");
    }

    open() {
        const draft = this._loadDraft();
        if (draft) {
            this.draft = draft;
            this._els.resumeTitle.textContent = `${draft.data.icon || "📘"} ${draft.data.title || "(sin título todavía)"} · ${draft.data.steps.length} pasos`;
            this._section("resume");
        } else {
            this._showIntro();
        }
    }

    close() {
        this._saveDraft();
        this._choiceResolve?.(null); // si estaba preguntando "¿cuál código?", cuenta como volver
        this.overlay.classList.add("hidden");
    }

    _showIntro() {
        const n = this._components().length;
        this._els.emptyHint.textContent = n
            ? `Tu lienzo tiene ${n} componente(s) y ${this.tm.simulator.wireManager.wires.length} cable(s). ¿Ya está como lo quieres?`
            : "Tu lienzo está vacío: arma primero el circuito (o crea el tutorial igual y escribe los pasos a mano).";
        this._section("intro");
    }

    async _startFromSimulator() {
        await this._newDraftFromSimulator();
        this._showEditor();
        this._els.title.focus();
    }

    // Editar un tutorial ya guardado (botón ✏️ del menú).
    editImported(tutorial) {
        const existing = this._loadDraft();
        if (existing && existing.data.id !== tutorial.source.id &&
            !confirm("Tienes otro tutorial a medio hacer. ¿Dejarlo de lado y editar este?")) return;
        const data = JSON.parse(TutorialFormat.toJSON(tutorial.source, false));
        const extras = { code: "", xml: "", photo: data.demoImage || "" };
        for (const s of data.steps) {
            for (const a of s.actions || []) {
                if (a.type === "insertCode") extras.code = a.code;
                if (a.type === "openBlocks") extras.xml = a.xml;
            }
        }
        delete data.demoImage;
        delete data.demoCaption;
        this.draft = { data, extras, use: { code: !!extras.code, xml: !!extras.xml, photo: !!extras.photo } };
        this._saveDraft();
        this._showEditor();
    }

    _showEditor() {
        const d = this.draft.data;
        this._els.title.value = d.title || "";
        this._els.author.value = d.author || "";
        this._els.description.value = d.description || "";
        this._els.errors.classList.add("hidden");
        this._renderIcons();
        this._renderSteps();
        this._renderExtras();
        this._section("editor");
    }

    _renderIcons() {
        for (const b of this._els.icons.children) b.classList.toggle("active", b.textContent === this.draft.data.icon);
    }

    // Frase simple de cuándo se marca ✓ (para que el docente entienda
    // qué revisa el simulador, sin ver nada técnico).
    _describeCheck(step) {
        const chk = step.check || (step.preset && TutorialFormat.PRESETS[step.preset]?.check);
        if (!chk) return "Este paso no se revisa solo: el alumno pasa con \"Siguiente\".";
        const names = this._typeNames();
        const nm = (t) => (t ? names[t] || t : "un pin");
        switch (chk.type) {
            case "emptyCanvas": return "✓ cuando el lienzo está vacío.";
            case "component":   return `✓ cuando el alumno coloca ${chk.count > 1 ? chk.count + " × " : ""}${nm(chk.component)}.`;
            case "wire":        return `✓ cuando hay un cable entre ${this._endpointText(chk.from, nm)} y ${this._endpointText(chk.to, nm)}.`;
            case "running":     return "✓ cuando la simulación está corriendo.";
            case "saved":       return "✓ cuando el proyecto está guardado.";
            case "code":        return "✓ cuando hay código en el editor.";
        }
        return "";
    }

    // "GPIO12 de ESP32 WeMos D1 R32", "GND de KY-004 Botón"...
    _endpointText(e, nm) {
        let pin = "";
        if (e.pinType === "ground") pin = "GND";
        else if (e.pin) {
            const comp = this._components().find((c) => c.type === e.component);
            pin = comp?.pins.find((p) => p.id === e.pin)?.name || e.pin;
        } else if (e.gpioOutput) pin = "un GPIO";
        else if (e.pinType) pin = e.pinType;
        return e.component ? `${pin} de ${nm(e.component)}` : pin || "un pin";
    }

    _typeNames() {
        const out = {};
        for (const c of this._components()) out[c.type] = c.name || c.type;
        document.querySelectorAll("#componentList .toolbox-item[data-type]").forEach((el) => {
            if (!out[el.dataset.type]) out[el.dataset.type] = (el.title || el.textContent || el.dataset.type).trim() || el.dataset.type;
        });
        return out;
    }

    _renderSteps() {

        const box = this._els.steps;
        box.textContent = "";
        const steps = this.draft.data.steps;

        steps.forEach((step, i) => {

            const card = document.createElement("div");
            card.className = "tc-step";

            const head = document.createElement("div");
            head.className = "tc-step-head";
            const num = document.createElement("span");
            num.className = "tc-step-num";
            num.textContent = `Paso ${i + 1}`;
            head.appendChild(num);

            const tools = document.createElement("div");
            tools.className = "tc-step-tools";
            const tool = (label, title, disabled, fn) => {
                const b = document.createElement("button");
                b.type = "button";
                b.className = "tc-step-tool";
                b.textContent = label;
                b.title = title;
                b.disabled = disabled;
                b.addEventListener("click", fn);
                tools.appendChild(b);
            };
            tool("↑", "Subir", i === 0, () => this._moveStep(i, -1));
            tool("↓", "Bajar", i === steps.length - 1, () => this._moveStep(i, 1));
            tool("🗑", "Borrar este paso", steps.length === 1, () => {
                steps.splice(i, 1);
                this._saveDraft();
                this._renderSteps();
            });
            head.appendChild(tools);
            card.appendChild(head);

            const preset = step.preset ? TutorialFormat.PRESETS[step.preset] : null;
            const title = document.createElement("input");
            title.type = "text";
            title.className = "tc-step-title";
            title.maxLength = TutorialFormat.LIMITS.stepTitle;
            title.value = step.title || preset?.title || "";
            title.addEventListener("input", () => { step.title = title.value; this._saveDraft(); });

            const text = document.createElement("textarea");
            text.className = "tc-step-text";
            text.rows = 2;
            text.maxLength = TutorialFormat.LIMITS.text;
            text.placeholder = "Explica a tus alumnos qué hacer en este paso…";
            text.value = step.text !== undefined ? step.text : (preset?.text || "");
            text.addEventListener("input", () => { step.text = text.value; this._saveDraft(); });

            const note = document.createElement("p");
            note.className = "tc-step-check";
            note.textContent = this._describeCheck(step);

            card.append(title, text, note);
            box.appendChild(card);

        });

    }

    _moveStep(i, delta) {
        const steps = this.draft.data.steps;
        const j = i + delta;
        if (j < 0 || j >= steps.length) return;
        [steps[i], steps[j]] = [steps[j], steps[i]];
        this._saveDraft();
        this._renderSteps();
    }

    _renderExtras() {
        const { extras, use } = this.draft;
        const diff = this._diffs();
        const set = (input, label, key, has, yes, no) => {
            input.disabled = !has;
            input.checked = has && use[key];
            label.textContent = has ? yes : no;
        };
        set(this._els.usePhoto, this._els.photoLabel, "photo", !!extras.photo,
            "Una foto del circuito terminado (la ven al empezar)", "Foto del circuito (no hay circuito en el lienzo)");
        const lines = (extras.code || diff.editorCode).trimEnd().split("\n").length;
        set(this._els.useCode, this._els.codeLabel, "code", !!(extras.code || diff.editorCode),
            `Código para tus alumnos (${lines} líneas), con un botón para ponerlo en su editor`, "Código (el editor está vacío)");
        set(this._els.useXml, this._els.xmlLabel, "xml", !!(extras.xml || diff.currentXml),
            "Bloques 🧩 para tus alumnos, con un botón para abrirlos", "Bloques (no hay bloques en 🧩)");

        // Foto de los bloques que van en el tutorial.
        const showXml = !!extras.xml && use.xml;
        this._els.xmlCaption.classList.toggle("hidden", !showXml);
        this._showBlocksImage(this._els.xmlPreview, showXml ? extras.xml : "");
        const show = extras.photo && use.photo;
        this._els.photoPreview.classList.toggle("hidden", !show);
        if (show) this._els.photoPreview.src = extras.photo;
        else this._els.photoPreview.removeAttribute("src");

        // El código que va en el tutorial, a la vista (textContent).
        const showCode = !!extras.code && use.code;
        this._els.codeCaption.classList.toggle("hidden", !showCode);
        this._els.codePreview.classList.toggle("hidden", !showCode);
        this._els.codePreview.textContent = showCode ? extras.code : "";

        // Avisos solo para lo que está marcado: si el docente desmarcó el
        // código o los bloques, no se le insiste.
        const codeDiff = diff.code && use.code && !!extras.code;
        this._els.codeDiff.classList.toggle("hidden", !codeDiff);
        this._els.codeDiffText.textContent = "⚠ El código que tienes ahora en el editor es DISTINTO del que va en el tutorial.";
        const xmlDiff = diff.xml && use.xml && !!extras.xml;
        this._els.xmlDiff.classList.toggle("hidden", !xmlDiff);
        this._els.xmlDiffText.textContent = "⚠ Los bloques que tienes ahora en 🧩 (abajo) son DISTINTOS de los que van en el tutorial (arriba).";
        this._showBlocksImage(this._els.xmlCurrent, xmlDiff ? diff.currentXml : "");
    }

    // Pantalla "¿cuál código reciben tus alumnos?" -- devuelve
    // "current" | "saved" | null (volver sin guardar).
    // currentXml/savedXml: si vienen, se muestra la FOTO de los bloques
    // en vez del texto.
    _askWhich({ title, hint, currentLabel, savedLabel, currentPreview, savedPreview, currentXml, savedXml }) {
        const firstLines = (s) => (s || "").split("\n").slice(0, 8).join("\n") + ((s || "").split("\n").length > 8 ? "\n…" : "");
        this._els.chooseTitle.textContent = title;
        this._els.chooseHint.textContent = hint;
        const blocksMode = currentXml !== undefined;
        for (const [btn, label, preview, xml] of [
            [this._els.choiceCurrent, currentLabel, currentPreview, currentXml],
            [this._els.choiceSaved, savedLabel, savedPreview, savedXml],
        ]) {
            btn.querySelector(".tc-choice-label").textContent = label;
            const pre = btn.querySelector(".tc-choice-code");
            pre.textContent = blocksMode ? "" : firstLines(preview);
            pre.classList.toggle("hidden", blocksMode || !preview);
            this._showBlocksImage(btn.querySelector(".tc-choice-img"), blocksMode ? xml : "");
        }
        this._section("choose");
        return new Promise((resolve) => {
            this._choiceResolve = (v) => { this._choiceResolve = null; resolve(v); };
        });
    }

    // Antes de guardar: si el editor o los bloques cambiaron desde que se
    // tomó la copia, el docente decide cuál va. false = canceló.
    async _confirmCodeChoices() {
        const d = this._diffs();
        const { extras, use } = this.draft;
        // Solo se pregunta por lo que está marcado para incluir.
        if (d.code && use.code && extras.code) {
            const pick = await this._askWhich({
                title: "¿Qué código reciben tus alumnos?",
                hint: "El código que tienes ahora en el editor no es el mismo que guardaste en el tutorial. Elige cuál va:",
                currentLabel: "📝 El que tengo AHORA en el editor",
                savedLabel: extras.code ? "📦 El que ya estaba en el tutorial" : "🚫 Ninguno (sin código)",
                currentPreview: d.editorCode,
                savedPreview: extras.code,
            });
            if (!pick) { if (!this.overlay.classList.contains("hidden")) this._section("editor"); return false; }
            if (pick === "current") { extras.code = d.editorCode; use.code = true; }
        }
        if (d.xml && use.xml && extras.xml) {
            const pick = await this._askWhich({
                title: "¿Qué bloques reciben tus alumnos?",
                hint: "Los bloques que tienes ahora en 🧩 no son los mismos que guardaste en el tutorial. Elige cuáles van:",
                currentLabel: "🧩 Los que tengo AHORA en 🧩",
                savedLabel: "📦 Los que ya estaban en el tutorial",
                currentXml: d.currentXml,
                savedXml: extras.xml,
            });
            if (!pick) { if (!this.overlay.classList.contains("hidden")) this._section("editor"); return false; }
            if (pick === "current") { extras.xml = d.currentXml; use.xml = true; }
        }
        this._saveDraft();
        this._renderExtras();
        return true;
    }

    // ====================================================
    // Guardar / probar / compartir
    // ====================================================

    _saveTutorial() {

        const errs = this._els.errors;
        errs.classList.add("hidden");
        errs.textContent = "";
        const showErr = (list) => {
            for (const m of list) {
                const li = document.createElement("li");
                li.textContent = m;
                errs.appendChild(li);
            }
            errs.classList.remove("hidden");
            errs.scrollIntoView({ block: "nearest", behavior: "smooth" });
        };

        if (!(this.draft.data.title || "").trim()) {
            showErr(["Falta el título del tutorial (arriba, en el punto 1)."]);
            this._els.title.focus();
            return null;
        }
        const emptySteps = this.draft.data.steps
            .map((s, i) => (!(s.title || (s.preset && TutorialFormat.PRESETS[s.preset].title) || "").trim() ? i + 1 : 0))
            .filter(Boolean);
        if (emptySteps.length) {
            showErr([`Ponle título al paso ${emptySteps.join(", ")}.`]);
            return null;
        }

        const r = this._build();
        if (!r.ok) {
            showErr(r.errors);
            return null;
        }
        try {
            this.importer._save(r.data);
        } catch (err) {
            showErr([err.message]);
            return null;
        }
        const tutorial = TutorialFormat.compile(r.data);
        this.tm.addImportedTutorial(tutorial);
        this._saveDraft();
        this._lastSaved = tutorial;
        return tutorial;
    }

    async _try() {
        if (!(await this._confirmCodeChoices())) return;
        const t = this._saveTutorial();
        if (!t) return;
        this.close();
        this.tm.start(t.id);
    }

    async _shareStep() {
        if (!(await this._confirmCodeChoices())) return;
        const t = this._saveTutorial();
        if (!t) return;
        const link = await TutorialImport.buildLink(t.source);
        this.overlay.querySelector(".tc-share-link").disabled = !link;
        this._els.shareNote.textContent = !link
            ? "Este tutorial es muy grande para un link: compártelo como archivo."
            : link.withoutImage
                ? "El link va sin la foto del circuito (la haría demasiado largo); el archivo sí la incluye."
                : "El link sirve tal cual; el archivo es útil si lo quieres guardar o subir a una plataforma.";
        this._section("shared");
    }

}
