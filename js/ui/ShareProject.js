/*
==========================================================
 PitSimulator — ShareProject.js
 Botón 🔗 (junto al 📄 de ReportGenerator, ver index.html) para
 compartir el proyecto actual (circuito + código de cada ESP32) como
 un link + código QR.

 Dos caminos, con fallback automático del primero al segundo:

 1) LINK CORTO DE VERDAD, vía el backend chiquito de worker/ (Cloudflare
    Workers + KV, mismo mecanismo que usa MakeCode/micro:bit para
    "Compartir" -- NO es un acortador tipo bit.ly, es un guardado propio:
    el proyecto comprimido se sube a WORKER_ENDPOINT, que devuelve un ID
    corto random, y el link queda "#p=<id>" -- siempre chico (~8
    caracteres) sin importar qué tan grande sea el proyecto, así que el
    QR también queda siempre chico/legible. Requiere desplegar ese
    Worker una sola vez (ver worker/README.md) y pegar su URL acá abajo.

 2) LINK AUTOCONTENIDO (el original, sin backend) -- si WORKER_ENDPOINT
    no está configurado, o el Worker no responde (sin red, caído, etc.),
    se cae automáticamente a este camino: el proyecto entero viaja
    comprimido dentro del propio link ("#compartir=<comprimido>"), nada
    se guarda en ningún servidor -- la URL ES el proyecto. Mismo
    espíritu que la app hermana (3DPitBlockly, static/main.js: función
    compartir()), pero con DEFLATE nativo en vez de lz-string (ver más
    abajo el por qué) para que el QR entre en proyectos reales, no solo
    en los vacíos.

 Por qué no un acortador público (TinyURL/is.gd/etc.) para el camino 1:
 se probaron todos los de siempre y NINGUNO deja llamarlos directo
 desde el navegador (no mandan Access-Control-Allow-Origin, el fetch()
 muere por CORS) -- de ahí el Worker propio en vez de "pagar un
 servicio de acortar".

 Por qué DEFLATE nativo (CompressionStream) y NO lz-string para el
 camino 2: se probó primero con lz-string y el QR fallaba ("no entra
 ni en la versión 40") con CUALQUIER proyecto real -- hasta el ejemplo
 más chico del repo (examples/lcd/lcd.json, 4 componentes, sin código)
 ya comprimía a ~3000 caracteres, por encima del tope de un QR (~2950
 bytes en modo byte, versión 40). CompressionStream('deflate-raw')
 (soportado nativo en todos los navegadores modernos, sin vendorizar
 nada) comprime MUCHO mejor en este tipo de JSON repetitivo -- el mismo
 lcd.json queda en ~1450 caracteres, y hasta un proyecto sintético de
 16 ESP32 con código largo en cada uno (85KB de JSON) entra cómodo en
 ~2200.

 Carga del lado de quien recibe el link: ver ShareProject.tryLoadFromHash()
 (método estático, se llama una sola vez al arrancar la app -- ver
 app.js -- ANTES de crear ReplPanel, para que cuando éste busque el
 código guardado del ESP32 activo ya esté el proyecto compartido en
 el canvas, no el que hubiera quedado en localStorage).
==========================================================
*/

class ShareProject {

    // URL del Worker (ver worker/README.md para desplegarlo) -- vacío
    // por default a propósito: sin esto configurado, share() cae
    // directo al link autocontenido (#compartir=) sin siquiera
    // intentar la llamada de red, así que el botón funciona igual
    // aunque nadie despliegue nunca el backend.
    static WORKER_ENDPOINT = "https://pitsimulator-share.jp790276.workers.dev";

    // Prefijos de hash -- "#p=<id>" (link corto, vía Worker) y
    // "#compartir=<comprimido>" (autocontenido, sin backend). Dos
    // prefijos propios (no solo "#") para no pisar "#modo=qemu" (ver
    // app.js) ni cualquier otro hash que la app use o llegue a usar.
    static SHORT_HASH_PREFIX = "#p=";
    static HASH_PREFIX = "#compartir=";

    // Tope real de qrcode-generator (ver lib/qrcode-generator/qrcode.js):
    // typeNumber 0 = auto-elige la versión QR más chica que entre, hasta
    // la versión 40 -- si el texto no entra ni en esa, tira una
    // excepción. Nivel de corrección "L" (el más bajo) a propósito:
    // maximiza cuántos bytes entran a costa de tolerar menos daño/mala
    // lectura -- aceptable para un QR que se genera y escanea en el
    // momento, no uno impreso para durar.
    static QR_ERROR_CORRECTION = "L";

    constructor(simulator, replPanel) {

        this.simulator = simulator;
        this.replPanel = replPanel;

        this.buildDOM();

    }

    // ====================================================
    // DOM: botón + modal (link + QR)
    // ====================================================

    buildDOM() {

        this.btn = document.getElementById("btnShareProject");
        this.btn?.addEventListener("click", () => this.share());

        this.overlay = document.createElement("div");
        this.overlay.className = "share-modal-overlay hidden";
        this.overlay.innerHTML = `
            <div class="share-modal">
                <div class="share-modal-header">
                    <span class="share-modal-title">🔗 Compartir proyecto</span>
                    <button class="share-modal-close" title="Cerrar">✕</button>
                </div>

                <p class="share-modal-hint">
                    Quien abra este link (o escanee el QR) ve una copia
                    de este circuito con su código.
                </p>

                <p class="share-modal-loading hidden">⏳ Generando link…</p>

                <div class="share-modal-qr-wrap">
                    <div class="share-modal-qr"></div>
                </div>

                <div class="share-modal-field">
                    <label for="shareProjectUrl">Link para compartir</label>
                    <input type="text" id="shareProjectUrl" readonly autocomplete="off" spellcheck="false">
                </div>

                <p class="share-modal-warning hidden"></p>

                <div class="share-modal-actions">
                    <button class="share-modal-copy">📋 Copiar link</button>
                    <button class="share-modal-done">Cerrar</button>
                </div>
            </div>
        `;
        document.body.appendChild(this.overlay);

        this._els = {
            qrWrap:  this.overlay.querySelector(".share-modal-qr"),
            qrField: this.overlay.querySelector(".share-modal-qr-wrap"),
            urlField: this.overlay.querySelector(".share-modal-field"),
            urlBox:  this.overlay.querySelector("#shareProjectUrl"),
            warning: this.overlay.querySelector(".share-modal-warning"),
            loading: this.overlay.querySelector(".share-modal-loading"),
            copyBtn: this.overlay.querySelector(".share-modal-copy"),
        };

        this.overlay.querySelector(".share-modal-close").addEventListener("click", () => this.closeModal());
        this.overlay.querySelector(".share-modal-done").addEventListener("click", () => this.closeModal());
        this.overlay.addEventListener("click", (e) => { if (e.target === this.overlay) this.closeModal(); });

        this._els.urlBox.addEventListener("click", () => this._els.urlBox.select());
        this._els.copyBtn.addEventListener("click", () => this._copyLink());

    }

    closeModal() {
        this.overlay.classList.add("hidden");
    }

    // ====================================================
    // Armar el link + QR a partir del proyecto actual
    // ====================================================

    async share() {

        if (this.simulator.componentManager.getAll().length === 0) {
            alert("No hay ningún componente en el lienzo todavía -- armá el circuito antes de compartirlo.");
            return;
        }

        // Volcar el código del editor al ESP32 activo YA (en vez de
        // esperar los 800ms del debounce normal, ver ReplPanel --
        // "change" de codeMirror) -- si no, un "Compartir" justo
        // después de tipear podía viajar con el código de ANTES del
        // último cambio.
        this.replPanel?._persistActiveDeviceCode?.();

        // El modal se abre YA, con el QR/link ocultos y un
        // "Generando..." en su lugar -- el paso que sigue (subir al
        // Worker, ver _tryShorten) es una llamada de red, no instantánea:
        // sin este estado de carga, con conexión lenta el botón 🔗 no
        // mostraba nada hasta que todo terminaba, se sentía trabado.
        // this.btn también se deshabilita mientras tanto para que un
        // doble click no dispare dos subidas en paralelo.
        this._setLoading(true);
        this.overlay.classList.remove("hidden");

        try {

            const data = this.simulator.projectManager.serialize();
            const json = JSON.stringify(data);

            let encoded;
            try {
                encoded = await ShareProject._compress(json);
            } catch (err) {
                console.error("[ShareProject] No se pudo comprimir el proyecto:", err);
                alert("❌ No se pudo armar el link (" + err.message + "). ¿El navegador es muy viejo? Probá con una versión reciente de Chrome/Edge.");
                this.closeModal();
                return;
            }

            const shortId = await ShareProject._tryShorten(encoded);

            const url = shortId
                ? location.origin + location.pathname + ShareProject.SHORT_HASH_PREFIX + shortId
                : location.origin + location.pathname + ShareProject.HASH_PREFIX + encoded;

            this._els.urlBox.value = url;
            this._renderQr(url);

            this._setLoading(false);
            this._els.urlBox.focus();
            this._els.urlBox.select();

        } finally {
            this.btn.disabled = false;
        }

    }

    _setLoading(isLoading) {

        this.btn.disabled = isLoading;

        this._els.loading.classList.toggle("hidden", !isLoading);
        this._els.qrField.classList.toggle("hidden", isLoading);
        this._els.urlField.classList.toggle("hidden", isLoading);
        this._els.copyBtn.disabled = isLoading;

    }

    // Sube el proyecto comprimido al Worker (ver worker/src/index.js)
    // y devuelve el ID corto que asignó, o null si no hay Worker
    // configurado o la llamada falla por cualquier motivo (sin red,
    // Worker caído, CORS, lo que sea) -- CUALQUIER falla acá cae en
    // silencio al link autocontenido en share() arriba, nunca bloquea
    // "Compartir" por completo. No se avisa con un alert() de este
    // fallback a propósito: para el usuario el resultado final (un
    // link que funciona) es el mismo, solo cambia si es corto o largo.
    static async _tryShorten(encoded) {

        if (!ShareProject.WORKER_ENDPOINT) return null;

        try {

            const res = await fetch(ShareProject.WORKER_ENDPOINT + "/share", {
                method: "POST",
                headers: { "Content-Type": "text/plain" },
                body: encoded,
            });

            if (!res.ok) throw new Error("HTTP " + res.status);

            const { id } = await res.json();
            return id || null;

        } catch (err) {

            console.warn("[ShareProject] No se pudo armar un link corto (se usa el autocontenido):", err);
            return null;

        }

    }

    // qrcode-generator (ver lib/qrcode-generator/qrcode.js) tira una
    // excepción si el texto no entra ni en la versión QR más grande
    // (40) -- con DEFLATE esto ya no pasa en la práctica (ver el
    // comentario grande arriba), pero un proyecto realmente enorme
    // (decenas de ESP32 con código larguísimo cada uno) todavía
    // podría lograrlo. En ese caso no hay QR posible, pero el LINK
    // sigue siendo válido igual (pegarlo en el navegador funciona) --
    // se avisa y se deja solo el campo de texto.
    _renderQr(url) {

        this._els.qrWrap.innerHTML = "";
        this._els.warning.classList.add("hidden");

        try {

            const qr = qrcode(0, ShareProject.QR_ERROR_CORRECTION);
            qr.addData(url);
            qr.make();

            this._els.qrWrap.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });

        } catch (err) {

            console.warn("[ShareProject] El proyecto es muy grande para un QR, se deja solo el link:", err);
            this._els.warning.textContent = "⚠ El proyecto es muy grande y no entra en un QR -- usá el link de abajo (igual funciona).";
            this._els.warning.classList.remove("hidden");

        }

    }

    async _copyLink() {

        const text = this._els.urlBox.value;
        const ok = await this._writeClipboard(text);

        const original = this._els.copyBtn.textContent;
        this._els.copyBtn.textContent = ok ? "✔ Copiado" : "❌ No se pudo copiar";
        setTimeout(() => { this._els.copyBtn.textContent = original; }, 1500);

    }

    // Mismo problema de siempre dentro de la app de escritorio (ver
    // ReplPanel._bindNativeClipboard()): navigator.clipboard.writeText()
    // no es confiable adentro de pywebview/WebView2 -- hay que pasar
    // por el helper nativo (Get-Clipboard/Set-Clipboard vía PowerShell)
    // que expone window.pywebview.api.set_clipboard(). Fuera de la app
    // de escritorio (navegador normal) window.pywebview no existe --
    // cae directo al camino estándar.
    async _writeClipboard(text) {

        if (window.pywebview?.api?.set_clipboard) {
            try {
                await window.pywebview.api.set_clipboard(text);
                return true;
            } catch (err) {
                console.error("[ShareProject] No se pudo copiar vía pywebview:", err);
            }
        }

        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            console.error("[ShareProject] No se pudo copiar al portapapeles:", err);
            return false;
        }

    }

    // ====================================================
    // Compresión: DEFLATE nativo del navegador (sin librerías) +
    // base64url (alfabeto seguro para ir en el fragmento de una URL,
    // sin "+"/"/" que normalmente habría que escapar). Ver el
    // comentario grande al principio del archivo para el por qué.
    // ====================================================

    static async _compress(str) {

        const stream = new Blob([str]).stream().pipeThrough(new CompressionStream("deflate-raw"));
        const buf = await new Response(stream).arrayBuffer();
        return ShareProject._bytesToBase64Url(new Uint8Array(buf));

    }

    static async _decompress(base64url) {

        const bytes = ShareProject._base64UrlToBytes(base64url);
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        const buf = await new Response(stream).arrayBuffer();
        return new TextDecoder().decode(buf);

    }

    static _bytesToBase64Url(bytes) {

        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

        return btoa(binary)
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");

    }

    static _base64UrlToBytes(base64url) {

        const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
        const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));

        const binary = atob(base64 + pad);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        return bytes;

    }

    // ====================================================
    // Lado de quien RECIBE el link -- llamado una sola vez al
    // arrancar la app (ver app.js). Reemplaza lo que haya en el
    // canvas (lo mismo que "Abrir proyecto") con el proyecto viajado
    // en el hash, y después LO BORRA de la URL (history.replaceState)
    // -- sin esto, cada F5 posterior volvería a pisar el trabajo que
    // el alumno haga después de abrir el link, reimportando para
    // siempre la misma foto vieja del proyecto compartido.
    // ====================================================

    static async tryLoadFromHash(simulator) {

        const hash = location.hash;

        const isShort = hash.startsWith(ShareProject.SHORT_HASH_PREFIX);
        const isSelfContained = hash.startsWith(ShareProject.HASH_PREFIX);
        if (!isShort && !isSelfContained) return false;

        // Se borra ANTES de intentar decodificar -- un link roto
        // (copiado a medias, truncado por el cliente de chat/email
        // que lo mandó, o un ID de Worker vencido/inexistente) no debe
        // dejar a la app reintentando el mismo hash inválido en cada F5.
        history.replaceState(null, "", location.pathname + location.search);

        try {

            // Link corto (#p=<id>): hay que resolverlo contra el Worker
            // ANTES de poder descomprimir -- lo que viajó en la URL es
            // solo el ID, no el proyecto. Link autocontenido
            // (#compartir=<comprimido>): el fragmento YA es el
            // proyecto comprimido, directo a _decompress().
            const encoded = isShort
                ? await ShareProject._resolveShortId(hash.slice(ShareProject.SHORT_HASH_PREFIX.length))
                : hash.slice(ShareProject.HASH_PREFIX.length);

            const json = await ShareProject._decompress(encoded);
            const data = JSON.parse(json);

            const ok = await simulator.projectManager.loadFromSharedData(data);
            if (!ok) throw new Error("El proyecto del link tiene un formato inválido");

            alert("🔗 Proyecto cargado desde un link compartido.");
            return true;

        } catch (err) {

            console.error("[ShareProject] No se pudo cargar el proyecto del link:", err);
            alert("❌ No se pudo cargar el proyecto del link compartido: " + err.message + " (¿se cortó al copiarlo, venció, o el navegador es muy viejo?)");
            return false;

        }

    }

    // Trae el proyecto comprimido guardado bajo ese ID en el Worker
    // (ver worker/src/index.js, GET /share/:id) -- tira si no hay
    // WORKER_ENDPOINT configurado (un link "#p=" solo puede existir si
    // en algún momento SÍ hubo un Worker funcionando) o si el ID ya no
    // existe (vencido a los 180 días, ver TTL_SECONDS del Worker, o
    // nunca existió).
    static async _resolveShortId(id) {

        if (!ShareProject.WORKER_ENDPOINT) {
            throw new Error("este link corto necesita un backend que no está configurado");
        }

        const res = await fetch(ShareProject.WORKER_ENDPOINT + "/share/" + id);
        if (!res.ok) throw new Error("HTTP " + res.status);

        return res.text();

    }

}
