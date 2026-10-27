/*
==========================================================
 PitSimulator
 Archivo: TutorialImport.js
 Importar / compartir tutoriales creados por docentes.

   - Entrada: archivo .json o link #tutorial=<comprimido>.
   - SIEMPRE pasa por TutorialFormat.validate() (lista blanca,
     ver ese archivo) y por una pantalla de revisión: nada se
     agrega ni se abre sin que la persona lo confirme, ni siquiera
     al entrar con un link.
   - Se guardan en localStorage de ESTE navegador, en su forma
     canónica (la que devolvió el validador), y se vuelven a validar
     cada vez que se cargan.
   - Todo el texto que viene del archivo se muestra con textContent.
==========================================================
*/

class TutorialImport {

    static STORAGE_KEY = "pit_imported_tutorials_v1";
    static HASH_PREFIX = "#tutorial=";
    static MAX_STORED = 30;
    static TEMPLATE_URL = "examples/tutoriales/plantilla_boton.json";

    constructor(tutorialManager) {

        this.tm = tutorialManager;
        this._pending = null; // datos validados esperando confirmación

        this._buildDialog();

        this.tm.importHooks = {
            openImport: () => this.open(),
            copyLink:   (t) => this.copyLink(t),
            exportFile: (t) => this.exportFile(t),
            remove:     (t) => this.remove(t),
        };

        for (const data of this._loadStored()) {
            this.tm.addImportedTutorial(TutorialFormat.compile(data));
        }
        this.tm.renderMenu();

    }

    // ====================================================
    // Almacenamiento local
    // ====================================================

    _readStore() {
        try {
            const arr = JSON.parse(localStorage.getItem(TutorialImport.STORAGE_KEY) || "[]");
            return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
        } catch (e) {
            return [];
        }
    }

    _writeStore(arr) {
        localStorage.setItem(TutorialImport.STORAGE_KEY, JSON.stringify(arr)); // puede tirar (cuota llena)
    }

    // Revalida todo lo guardado: si algo se corrompió o lo editaron a
    // mano en el navegador, simplemente no se carga.
    _loadStored() {
        const out = [];
        for (const json of this._readStore()) {
            const r = TutorialFormat.validate(json);
            if (r.ok) out.push(r.data);
            else console.warn("[TutorialImport] Tutorial guardado inválido, se ignora:", r.errors);
        }
        return out;
    }

    _save(data) {
        const json = TutorialFormat.toJSON(data, false);
        const others = this._readStore().filter((s) => {
            const r = TutorialFormat.validate(s);
            return r.ok && r.data.id !== data.id;
        });
        if (others.length >= TutorialImport.MAX_STORED) {
            throw new Error(`Ya tienes ${TutorialImport.MAX_STORED} tutoriales importados; quita alguno (🗑) antes de agregar otro.`);
        }
        try {
            this._writeStore([...others, json]);
        } catch (e) {
            throw new Error("No hay espacio en el navegador para guardarlo (¿la imagen es muy grande?).");
        }
    }

    _storedIds() {
        return new Set(this._loadStored().map((d) => d.id));
    }

    // ====================================================
    // Diálogo
    // ====================================================

    _buildDialog() {

        // Esqueleto estático (sin datos externos) -- el contenido que
        // viene del archivo se agrega después con textContent.
        this.overlay = document.createElement("div");
        this.overlay.className = "tutorial-import-overlay hidden";
        this.overlay.innerHTML = `
            <div class="tutorial-import-dialog" role="dialog" aria-modal="true" aria-labelledby="tutorialImportTitle">
                <div class="tutorial-import-header">
                    <h3 id="tutorialImportTitle">📥 Importar tutorial</h3>
                    <button type="button" class="tutorial-import-close" title="Cerrar">✕</button>
                </div>
                <div class="tutorial-import-pick">
                    <p class="tutorial-import-note">Un tutorial importado solo trae texto, pasos y, si quiere, un programa de ejemplo. No puede ejecutar nada por sí solo: antes de agregarlo vas a ver qué contiene.</p>
                    <button type="button" class="tutorial-import-btn tutorial-import-file-btn">📂 Elegir archivo .json</button>
                    <input type="file" class="tutorial-import-file" accept=".json,application/json" hidden>
                    <label class="tutorial-import-label">…o pega un link de tutorial:</label>
                    <div class="tutorial-import-link-row">
                        <input type="text" class="tutorial-import-link" placeholder="https://…#tutorial=…" spellcheck="false" autocomplete="off">
                        <button type="button" class="tutorial-import-btn tutorial-import-link-btn">Abrir</button>
                    </div>
                    <button type="button" class="tutorial-import-btn tutorial-import-secondary tutorial-import-template">⬇ Descargar plantilla para crear uno</button>
                </div>
                <div class="tutorial-import-errors hidden">
                    <p class="tutorial-import-errors-title">❌ No se puede importar este tutorial:</p>
                    <ul class="tutorial-import-error-list"></ul>
                    <button type="button" class="tutorial-import-btn tutorial-import-secondary tutorial-import-back">← Volver</button>
                </div>
                <div class="tutorial-import-review hidden">
                    <p class="tutorial-import-review-title">Revisa antes de agregar:</p>
                    <dl class="tutorial-import-summary"></dl>
                    <ul class="tutorial-import-warnings"></ul>
                    <div class="tutorial-import-actions">
                        <button type="button" class="tutorial-import-btn tutorial-import-secondary tutorial-import-cancel">Cancelar</button>
                        <button type="button" class="tutorial-import-btn tutorial-import-accept">Agregar y abrir</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.overlay);

        const q = (sel) => this.overlay.querySelector(sel);
        this._els = {
            pick: q(".tutorial-import-pick"),
            file: q(".tutorial-import-file"),
            link: q(".tutorial-import-link"),
            errors: q(".tutorial-import-errors"),
            errorList: q(".tutorial-import-error-list"),
            review: q(".tutorial-import-review"),
            summary: q(".tutorial-import-summary"),
            warnings: q(".tutorial-import-warnings"),
            accept: q(".tutorial-import-accept"),
        };

        q(".tutorial-import-close").addEventListener("click", () => this.close());
        q(".tutorial-import-cancel").addEventListener("click", () => this.close());
        q(".tutorial-import-back").addEventListener("click", () => this._show("pick"));
        q(".tutorial-import-file-btn").addEventListener("click", () => this._els.file.click());
        this._els.file.addEventListener("change", () => this._onFile());
        q(".tutorial-import-link-btn").addEventListener("click", () => this._onLink(this._els.link.value));
        this._els.link.addEventListener("keydown", (e) => { if (e.key === "Enter") this._onLink(this._els.link.value); });
        q(".tutorial-import-template").addEventListener("click", () => this._downloadTemplate());
        this._els.accept.addEventListener("click", () => this._accept());
        this.overlay.addEventListener("pointerdown", (e) => { if (e.target === this.overlay) this.close(); });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !this.overlay.classList.contains("hidden")) this.close();
        });

    }

    _show(section) {
        this._els.pick.classList.toggle("hidden", section !== "pick");
        this._els.errors.classList.toggle("hidden", section !== "errors");
        this._els.review.classList.toggle("hidden", section !== "review");
    }

    open() {
        this._pending = null;
        this._els.link.value = "";
        this._els.file.value = "";
        this._show("pick");
        this.overlay.classList.remove("hidden");
    }

    close() {
        this._pending = null;
        this.overlay.classList.add("hidden");
    }

    _showErrors(errors) {
        this._els.errorList.textContent = "";
        for (const msg of errors) {
            const li = document.createElement("li");
            li.textContent = msg;
            this._els.errorList.appendChild(li);
        }
        this._show("errors");
        this.overlay.classList.remove("hidden");
    }

    // ====================================================
    // Entradas
    // ====================================================

    async _onFile() {
        const file = this._els.file.files?.[0];
        this._els.file.value = "";
        if (!file) return;
        if (file.size > TutorialFormat.LIMITS.fileChars) {
            this._showErrors(["El archivo es demasiado grande (máximo 3 MB)."]);
            return;
        }
        let text;
        try { text = await file.text(); } catch (e) { this._showErrors(["No se pudo leer el archivo."]); return; }
        this._review(text);
    }

    async _onLink(value) {
        const v = String(value || "").trim();
        const i = v.indexOf(TutorialImport.HASH_PREFIX);
        if (i < 0) { this._showErrors(["Ese no es un link de tutorial (tiene que contener \"#tutorial=\")."]); return; }
        await this._reviewEncoded(v.slice(i + TutorialImport.HASH_PREFIX.length));
    }

    async _reviewEncoded(encoded) {
        try {
            if (!encoded || encoded.length > TutorialFormat.LIMITS.linkChars || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
                throw new Error("El link está incompleto o dañado (¿se cortó al copiarlo?).");
            }
            const json = await TutorialImport._inflateCapped(encoded, TutorialFormat.LIMITS.fileChars);
            this._review(json);
        } catch (err) {
            this._showErrors([err.message || "No se pudo leer el link."]);
        }
    }

    // Lo llama app.js al arrancar: si se entró con un link de tutorial,
    // muestra la revisión (nunca lo agrega ni lo abre solo).
    async tryLoadFromHash() {
        if (!location.hash.startsWith(TutorialImport.HASH_PREFIX)) return false;
        const encoded = location.hash.slice(TutorialImport.HASH_PREFIX.length);
        history.replaceState(null, "", location.pathname + location.search);
        await this._reviewEncoded(encoded);
        return true;
    }

    // ====================================================
    // Revisión + confirmación
    // ====================================================

    _review(raw) {

        const r = TutorialFormat.validate(raw);
        if (!r.ok) { this._showErrors(r.errors); return; }

        const data = r.data;
        const sum = TutorialFormat.summarize(data);

        // Bloques que este simulador no conoce: se rechaza (Blockly
        // fallaría al abrirlos).
        if (typeof Blockly !== "undefined") {
            const unknown = sum.blockTypes.filter((t) => !Blockly.Blocks[t]);
            if (unknown.length) {
                this._showErrors([`El programa en bloques usa bloques que este simulador no tiene: ${unknown.slice(0, 8).join(", ")}`]);
                return;
            }
        }

        const known = new Set(Array.from(document.querySelectorAll("#componentList .toolbox-item[data-type]"), (el) => el.dataset.type));
        const missing = known.size ? sum.components.filter((c) => !known.has(c)) : [];

        // Resumen
        const dl = this._els.summary;
        dl.textContent = "";
        const row = (k, v) => {
            const dt = document.createElement("dt"); dt.textContent = k;
            const dd = document.createElement("dd"); dd.textContent = v;
            dl.append(dt, dd);
        };
        row("Título", `${data.icon || "📘"} ${data.title}`);
        row("Creado por", data.author || "(sin indicar)");
        if (data.description) row("Descripción", data.description);
        row("Pasos", String(sum.steps));
        const extras = [];
        if (sum.hasImage) extras.push("imagen de demostración");
        if (sum.xmlCount) extras.push(`${sum.xmlCount} programa(s) en bloques`);
        if (sum.codeCount) extras.push(`${sum.codeCount} código(s) Python`);
        row("Incluye", extras.length ? extras.join(", ") : "solo texto y pasos");

        // Avisos
        const ul = this._els.warnings;
        ul.textContent = "";
        const warn = (msg) => { const li = document.createElement("li"); li.textContent = msg; ul.appendChild(li); };
        warn("⚠ Lo creó otra persona. Agrégalo solo si confías en quien te lo envió.");
        if (sum.xmlCount || sum.codeCount) {
            warn("💻 Trae código: se pondrá en el editor cuando presiones su botón, pero solo se ejecuta si tú presionas ▶ Ejecutar. Léelo antes de ejecutarlo.");
        }
        if (missing.length) warn(`🧩 Usa componentes que este simulador no tiene (${missing.join(", ")}): esos pasos no se van a poder marcar como hechos.`);
        if (this._storedIds().has(data.id)) warn(`♻ Reemplazará al tutorial importado que ya tienes con el mismo id ("${data.id}").`);

        this._pending = data;
        this._show("review");
        this.overlay.classList.remove("hidden");
        this._els.accept.focus();

    }

    _accept() {
        const data = this._pending;
        if (!data) return;
        try {
            this._save(data);
        } catch (err) {
            this._showErrors([err.message]);
            return;
        }
        const tutorial = TutorialFormat.compile(data);
        this.tm.addImportedTutorial(tutorial);
        this.close();
        this.tm.start(tutorial.id);
    }

    // ====================================================
    // Compartir / exportar / quitar
    // ====================================================

    async copyLink(tutorial) {
        const json = TutorialFormat.toJSON(tutorial.source, false);
        const encoded = await TutorialImport._deflate(json);
        if (encoded.length > TutorialFormat.LIMITS.linkChars) {
            alert("Este tutorial es demasiado grande para un link (seguramente por la imagen). Compártelo como archivo con el botón ⬇.");
            return;
        }
        const url = location.origin + location.pathname + TutorialImport.HASH_PREFIX + encoded;
        try {
            await navigator.clipboard.writeText(url);
            alert("🔗 Link copiado. Quien lo abra verá primero qué contiene el tutorial y decidirá si lo agrega.");
        } catch (e) {
            prompt("Copia este link:", url);
        }
    }

    exportFile(tutorial) {
        const blob = new Blob([TutorialFormat.toJSON(tutorial.source, true)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${tutorial.source.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    remove(tutorial) {
        if (!confirm(`¿Quitar el tutorial "${tutorial.title}"? Podrás volver a importarlo desde su archivo o link.`)) return;
        try {
            this._writeStore(this._readStore().filter((s) => {
                const r = TutorialFormat.validate(s);
                return r.ok && r.data.id !== tutorial.source.id;
            }));
        } catch (e) { /* si no se pudo escribir, al menos se quita de esta sesión */ }
        this.tm.removeImportedTutorial(tutorial.id);
    }

    async _downloadTemplate() {
        try {
            const res = await fetch(TutorialImport.TEMPLATE_URL, { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = new Blob([await res.text()], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "plantilla_tutorial.json";
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            alert("❌ No se pudo descargar la plantilla: " + err.message);
        }
    }

    // ====================================================
    // Compresión (mismo formato que ShareProject: deflate-raw + base64url)
    // con tope de tamaño al descomprimir -- un link chiquito no puede
    // "inflarse" a cientos de MB y colgar el navegador.
    // ====================================================

    static async _deflate(str) {
        const stream = new Blob([str]).stream().pipeThrough(new CompressionStream("deflate-raw"));
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    static async _inflateCapped(base64url, maxChars) {
        const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
        const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
        let binary;
        try { binary = atob(base64 + pad); } catch (e) { throw new Error("El link está dañado."); }
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
        const chunks = [];
        let total = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.length;
                if (total > maxChars * 4) { // bytes UTF-8, con margen
                    await reader.cancel();
                    throw new Error("El tutorial del link es demasiado grande.");
                }
                chunks.push(value);
            }
        } catch (err) {
            if (/demasiado grande/.test(err.message)) throw err;
            throw new Error("El link está dañado (no se pudo descomprimir).");
        }
        const all = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { all.set(c, off); off += c.length; }
        try {
            return new TextDecoder("utf-8", { fatal: true }).decode(all);
        } catch (e) {
            throw new Error("El link está dañado (texto inválido).");
        }
    }

}
