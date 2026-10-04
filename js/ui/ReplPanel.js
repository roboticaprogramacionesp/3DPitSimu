/*
==========================================================
 PitSimulator
 Archivo: ReplPanel.js
 Panel REPL + Editor de código MicroPython.

 Flujo de ejecución:
   1. El usuario escribe código limpio (igual que en Wokwi)
   2. runEditorCode() manda primero el HAL pendiente (preloadHal():
        _base.hal.py ← siempre, <tipo>.hal.py ← por cada componente
        en el canvas), cada uno por paste mode (Ctrl+E … Ctrl+D)
   3. Recién después, el código del usuario viaja por PEDAZOS chicos
      confirmados uno por uno (_sendUserCodeChunked() -- ver el
      comentario grande junto a USER_CODE_CHUNK_B64_SIZE), no en un
      solo bloque gigante
==========================================================
*/

class ReplPanel {

    constructor(simulator) {

        this.simulator = simulator;

        this.open    = false;
        this.history = [];
        this.historyIndex = -1;

        // Tab activo: "repl" o "editor"
        this.activeTab = "repl";

        // Cache de fragmentos HAL ya descargados
        // null  = no existe para ese tipo
        // ""    = existe pero está vacío (marcador)
        // "..."  = contenido real
        this._halCache = {};

        // ANTES: _assembleCode() volvía a pegar TODO el HAL (base +
        // el de cada componente en el canvas) en CADA click de
        // "Ejecutar", aunque QEMU nunca se reinicia entre corridas
        // (ver el comentario de _base.hal.py) -- pegar por paste mode
        // es lento (va byte a byte por el WS/stdin), así que reenviar
        // el mismo HAL de siempre en cada corrida hacía que arrancar
        // tardara mucho más de lo necesario.
        //
        // AHORA: llevamos la cuenta de qué "type" de HAL ya se pegó
        // con éxito en la sesión ACTUAL de QEMU. Si ya está, no se
        // vuelve a mandar -- solo tu código. Se resetea en
        // "qemu:connected" (nueva conexión = asumimos firmware
        // recién arrancado, sin nada pegado todavía).
        this._halSentToFirmware = new Set();

        // Tipos que se van a intentar por el camino rápido ("import
        // _pit_hal_<tipo>") en vez de paste completo -- parte de la
        // lista ESTÁTICA generada en build (PIT_FROZEN_HAL_TYPES, ver
        // js/simulator/FrozenHalTypes.js), NO de una sonda en vivo al
        // firmware (esa se quitó, tenía una carrera real con su
        // propio timeout -- ver project_frozen_probe_timeout_fix.md
        // en la memoria del proyecto). Si el firmware conectado
        // resulta ser más viejo y el import falla de verdad, el
        // listener de "qemu:hal-error" saca ese tipo puntual de acá
        // para el resto de la conexión. Mismo lifecycle que
        // _halSentToFirmware -- se repuebla en cada conexión nueva
        // (_resyncHalAfterBoot).
        this._frozenHalTypes = new Set();

        // Cuántas veces se reintentó automáticamente el HAL de cada
        // "type" tras un HAL_ERROR (ver _retryHalAfterError) -- para
        // no reintentar por siempre si algo está genuinamente roto
        // (no solo una corrupción de transmisión pasajera). Se
        // resetea junto con _halSentToFirmware en cada conexión nueva.
        this._halRetryCounts = {};

        // Cola de envíos por paste mode (ver _enqueuePaste) -- así
        // preloadHal() y runEditorCode() nunca se pisan entre sí.
        this._pasteQueue = Promise.resolve();

        // true mientras se está pegando el HAL por paste mode --
        // oculta su eco en el panel (ver bindBusEvents/runEditorCode)
        this._suppressEcho = false;

        // true mientras una tanda de envío (Ctrl+E...líneas...Ctrl+D)
        // está en curso -- se usa para deshabilitar el botón
        // "▶ Ejecutar" y evitar que el usuario dispare una segunda
        // tanda por clickear varias veces seguidas.
        this._running = false;

        // BUG REAL (reportado: "ya detuve el simulador... pero sigue
        // corriendo por detrás"): "⏹ Detener" (evento "simulation:stop",
        // ver bindBusEvents) solo cerraba el WebSocket del lado del
        // navegador -- el envío del código (ver _sendUserCodeChunked())
        // seguía corriendo igual del lado de JS, mandando al vacío
        // (QemuBridge.send() ya no hace nada sin conexión) pero sin
        // enterarse de que el usuario pidió parar -- el panel seguía
        // mostrando "reintentando" varios segundos/minutos después del
        // click. Esta bandera la chequean _pasteBlock() (corta el envío
        // línea a línea) y _sendUserCodeChunked() (corta entre pedazos)
        // para abortar de inmediato en vez de seguir reintentando igual.
        this._stopRequested = false;

        // Se pone en true la primera vez que el firmware conectado
        // contesta "R\x00" (raw-paste NO soportado, ver
        // _sendUserCodeViaRawPaste()/server.js runRawPasteExec()) --
        // así el resto de ESTA SESIÓN de la app salta directo al
        // envío por pedazos de siempre, sin perder tiempo repitiendo
        // una negociación que ya sabemos que va a fallar. Ya NO se
        // resetea en cada reconexión (ver "qemu:connected" en
        // bindBusEvents) -- dentro de una misma sesión el firmware no
        // cambia entre reconexiones, y reintentar la negociación cada
        // vez solo sumaba ~8s perdidos por cada "Ejecutar". Solo se
        // resetea acá, en el constructor (recarga de página completa).
        this._rawPasteUnsupported = false;

        // BUG REAL, grave, encontrado en vivo (confirmado con un log
        // real: el HAL base se mandaba DOS VECES seguidas, cada una
        // compitiendo con la otra por el mismo canal): el primer
        // ">>>" que imprime MicroPython -- el del banner de arranque,
        // mucho ANTES de que _resyncHalAfterBoot() llegue a hacer
        // nada -- disparaba _onReplReady() de una (ver el chequeo
        // genérico de ">>>" en el listener de "qemu:output"),
        // habilitando "▶ Ejecutar" mientras el resync inicial
        // (sondeo + HAL pendiente) todavía estaba en curso. Si el
        // usuario (o un test automatizado) clickeaba Ejecutar en esa
        // ventana, runEditorCode() disparaba su PROPIO preloadHal()
        // en PARALELO con el que ya estaba corriendo desde
        // "qemu:connected" -- dos intentos de mandar el MISMO HAL
        // base, pisándose la cola el uno al otro, duplicando el
        // trabajo y la superficie de corrupción justo en el peor
        // momento (una conexión recién asentándose). Esta bandera
        // bloquea ese chequeo genérico mientras el resync inicial de
        // "qemu:connected" está en curso -- ver ese handler más abajo.
        this._awaitingInitialResync = false;

        // Actividad de pines (📌 GPIOxx → LOW/HIGH): con un teclado
        // matricial (o cualquier cosa que escanee GPIOs seguido) esto
        // puede inundar el panel con MUCHO ruido -- get_key() revisa
        // las 4 columnas en cada vuelta del loop, haya o no tecla
        // apretada. Es un log 100% cosmético (ver bindBusEvents más
        // abajo: no hay nada más en todo el proyecto escuchando
        // "gpio:changed" -- ni LEDs ni detección de botones dependen
        // de esto), así que:
        //   - se puede silenciar sin que se rompa NADA funcional
        //   - de paso, se pisa el mismo valor repetido consecutivo
        //     para el mismo pin (ver _lastGpioLogged), que era buena
        //     parte del ruido
        // El estado se guarda en localStorage para no tener que
        // volver a silenciarlo en cada sesión. Silenciado POR DEFECTO
        // (a pedido) -- solo se muestra si el usuario lo activó a
        // propósito alguna vez (valor guardado explícitamente "0").
        this._gpioLogMuted = localStorage.getItem("pit_gpio_log_muted") !== "0";
        this._lastGpioLogged = {};

        // true recién cuando el REPL de MicroPython mostró su propio
        // prompt ">>> " -- distinto de "el WebSocket está conectado"
        // (qemu:connected dispara apenas abre la conexión, pero QEMU
        // puede tardar un rato real en terminar de bootear antes de
        // llegar a un prompt interactivo de verdad). Mientras esto es
        // false, Ctrl+Enter/▶ Ejecutar (correr código) y Enter/Enviar
        // del REPL quedan bloqueados -- ver _onReplReady()/bindBusEvents.
        this._replReady = false;

        // Portapapeles nativo (app de escritorio, ver desktop/main.py
        // clase Api) -- stub por default, no-op fuera de ese entorno
        // (navegador normal). _bindNativeClipboard() los reemplaza si
        // corresponde. _pasteFromClipboard queda null hasta entonces
        // a propósito (los callers ya chequean su existencia antes de
        // usarlo).
        this._copyToClipboard = () => false;
        this._pasteFromClipboard = null;

        this.buildDOM();
        this.bindEvents();
        this.bindBusEvents();
        this._bindNativeClipboard();

    }

    // ====================================================
    // Construir el DOM
    // ====================================================

    buildDOM() {

        this.panel = document.createElement("div");
        this.panel.id = "replPanel";
        this.panel.className = "repl-panel repl-closed";

        // ---- Cabecera ----
        this.header = document.createElement("div");
        this.header.className = "repl-header";
        this.header.innerHTML = `
            <div class="repl-header-left">
                <span class="repl-icon">⚡</span>
                <span class="repl-title">MicroPython</span>
                <span id="qemuStatus" class="repl-status">🔴 Desconectado</span>
            </div>
            <div class="repl-header-right">
                <div class="repl-font-size-group" title="Tamaño de fuente">
                    <button class="repl-btn repl-font-btn" data-size="S">S</button>
                    <button class="repl-btn repl-font-btn" data-size="M">M</button>
                    <button class="repl-btn repl-font-btn" data-size="L">L</button>
                    <button class="repl-btn repl-font-btn" data-size="XL">XL</button>
                </div>
                <button class="repl-btn" id="replBtnInterrupt" title="Interrumpir (Ctrl+C)">■</button>
                <button class="repl-btn" id="replBtnReset"     title="Soft Reset (Ctrl+D) -- reinicia el firmware, no el simulador">↺</button>
                <button class="repl-btn" id="replBtnGpioLog"   title="Silenciar actividad de pines (📌 GPIOxx)">📌</button>
                <button class="repl-btn" id="replBtnClear"     title="Limpiar output">⌫</button>
                <button class="repl-btn repl-btn-toggle" id="replBtnToggle">▲</button>
            </div>
        `;

        // ---- Tabs ----
        this.tabBar = document.createElement("div");
        this.tabBar.className = "repl-tabbar";
        this.tabBar.innerHTML = `
            <button class="repl-tab repl-tab-active" data-tab="repl">REPL</button>
            <button class="repl-tab" data-tab="editor">Editor</button>
        `;

        // ---- Cuerpo ----
        this.body = document.createElement("div");
        this.body.className = "repl-body";

        // -- Panel REPL --
        this.replPane = document.createElement("div");
        this.replPane.className = "repl-pane";

        // Contenedor de la terminal real (xterm.js) -- se inicializa
        // en _initTerminal(), llamado al final de buildDOM() una vez
        // que this.panel ya está adjunto al documento (xterm.js
        // necesita medir un elemento YA visible para calcular filas/
        // columnas la primera vez).
        this.output = document.createElement("div");
        this.output.className = "repl-output";

        const inputRow = document.createElement("div");
        inputRow.className = "repl-input-row";

        this.prompt = document.createElement("span");
        this.prompt.className = "repl-prompt";
        this.prompt.textContent = ">>>";

        this.input = document.createElement("input");
        this.input.type = "text";
        this.input.className = "repl-input";
        this.input.placeholder = "Escribe código MicroPython...";
        this.input.setAttribute("autocomplete", "off");
        this.input.setAttribute("spellcheck", "false");
        // Arranca deshabilitado -- recién se habilita en _onReplReady()
        // (ver bindBusEvents), no hay ninguna conexión todavía al
        // construir el panel.
        this.input.disabled = true;

        this.sendBtn = document.createElement("button");
        this.sendBtn.className = "repl-btn repl-btn-send";
        this.sendBtn.textContent = "Enviar";
        this.sendBtn.disabled = true;

        inputRow.appendChild(this.prompt);
        inputRow.appendChild(this.input);
        inputRow.appendChild(this.sendBtn);

        this.replPane.appendChild(this.output);
        this.replPane.appendChild(inputRow);

        // -- Panel Editor --
        this.editorPane = document.createElement("div");
        this.editorPane.className = "repl-pane repl-pane-hidden";

        const editorToolbar = document.createElement("div");
        editorToolbar.className = "repl-editor-toolbar";
        editorToolbar.innerHTML = `
            <span class="repl-editor-label">editor.py</span>
            <div class="repl-editor-actions">
                <button class="repl-btn" id="replBtnLoadCode" title="Abrir código desde un archivo .py de tu computadora">📂 Abrir</button>
                <button class="repl-btn" id="replBtnSaveCode" title="Guardar el código del editor a un archivo .py">💾 Guardar</button>
                <button class="repl-btn repl-btn-run" id="replBtnRun" disabled title="Esperando a que el simulador esté corriendo y listo (>>>)">▶ Ejecutar</button>
            </div>
        `;

        // -- Cuerpo del editor: CodeMirror (resaltado de sintaxis real,
        // ver lib/codemirror/) sobre un <textarea> de respaldo. --
        // CodeMirror.fromTextArea() reemplaza visualmente el textarea
        // por su propio editor (con su propio gutter de números de
        // línea, ya no hace falta uno hecho a mano) pero deja el
        // textarea original escondido en el DOM y sincronizado en
        // cada cambio (ver el .on("change", ...) más abajo) -- así
        // TODO el resto de esta clase puede seguir leyendo/escribiendo
        // this.editor.value exactamente igual que antes.
        this.editorBody = document.createElement("div");
        this.editorBody.className = "repl-editor-body";

        this.editor = document.createElement("textarea");
        this.editor.className = "repl-editor";
        this.editor.setAttribute("spellcheck",     "false");
        this.editor.setAttribute("autocomplete",   "off");
        this.editor.setAttribute("autocorrect",    "off");
        this.editor.setAttribute("autocapitalize", "off");

        this.editorBody.appendChild(this.editor);

        this.editorPane.appendChild(editorToolbar);
        this.editorPane.appendChild(this.editorBody);

        this.codeMirror = CodeMirror.fromTextArea(this.editor, {
            mode: "python",
            theme: "dracula",
            lineNumbers: true,
            lineWrapping: true,
            indentUnit: 4,
            tabSize: 4,
            indentWithTabs: false,
            viewportMargin: Infinity,
            extraKeys: {
                "Ctrl-Enter": () => { this.runEditorCode(); },
            },
        });
        // Mantiene this.editor.value (el textarea escondido) al día
        // en cada tecleo -- el resto de la clase nunca se enteró de
        // que ahora hay un CodeMirror de por medio.
        this.codeMirror.on("change", () => this.codeMirror.save());

        // Placeholder propio -- CodeMirror core no trae uno (eso es
        // un addon aparte que no está vendorizado acá, ver
        // lib/codemirror/), así que se simula con un <pre> superpuesto
        // que se esconde apenas hay contenido o foco.
        this._editorPlaceholder = document.createElement("pre");
        this._editorPlaceholder.className = "repl-editor-placeholder";
        this._editorPlaceholder.textContent = [
            "# Escribe tu código MicroPython aquí",
            "# Ctrl+Enter o ▶ Ejecutar para correrlo",
            "",
            "from machine import Pin",
            "from time import sleep",
            "",
            "led = Pin(2, Pin.OUT)",
            "btn = Pin(4, Pin.IN, Pin.PULL_DOWN)",
            "",
            "while True:",
            "    led.value(btn.value())",
            "    sleep(0.02)",
        ].join("\n");
        this.editorBody.appendChild(this._editorPlaceholder);
        const syncPlaceholder = () => {
            this._editorPlaceholder.classList.toggle("hidden", this.codeMirror.getValue().length > 0);
        };
        this.codeMirror.on("change", syncPlaceholder);
        syncPlaceholder();

        // ---- Ensamblar ----
        this.body.appendChild(this.replPane);
        this.body.appendChild(this.editorPane);

        this.panel.appendChild(this.header);
        this.panel.appendChild(this.tabBar);
        this.panel.appendChild(this.body);

        // Se agrega dentro de #workspace (no de document.body) para que
        // el panel quede confinado al área del canvas/cableado -- antes,
        // colgado directo de <body> con position:fixed a todo el ancho,
        // tapaba también el toolbox (panel izquierdo) y el panel de
        // propiedades (panel derecho). #workspace ya tiene
        // position:relative en simulator.css, así que basta con que el
        // CSS de este panel pase de "fixed" a "absolute" (ver
        // repl-panel.css) para que quede acotado a esa columna del grid.
        const workspace = document.getElementById("workspace") || document.body;
        workspace.appendChild(this.panel);

        this._initTerminal();

    }

    // ====================================================
    // Tamaño de fuente del panel (S/M/L) -- mismo mecanismo que ya
    // usa el monitor serie de 3DPitBlocks (AppBlock3/serial-monitor.js,
    // SM_SIZES/SM_FONTSIZES aplicados a smTerm.options.fontSize):
    // botones discretos en vez de su slider, pero la misma idea --
    // afecta tanto la salida (xterm) como el editor (textarea + su
    // gutter de números de línea, que tienen que moverse JUNTOS o el
    // número de cada línea deja de alinear con su línea real).
    // Persistido en localStorage para no tener que re-elegirlo cada
    // sesión.
    // ====================================================

    static FONT_SIZES = {
        S:  { term: 11,   editor: 12 },
        M:  { term: 12.5, editor: 13 }, // default -- mismos valores que ya tenía el panel antes de este control
        L:  { term: 15,   editor: 16 },
        XL: { term: 19,   editor: 20 }, // mismo tope que SM_FONTSIZES=[10,12,15,19] de 3DPitBlocks
    };

    _applyFontSize(size) {

        const cfg = ReplPanel.FONT_SIZES[size] || ReplPanel.FONT_SIZES.M;
        this._fontSize = size in ReplPanel.FONT_SIZES ? size : "M";

        if (this.terminal) {
            this.terminal.options.fontSize = cfg.term;
            this._safeFit();
        }

        this.codeMirror.getWrapperElement().style.fontSize = `${cfg.editor}px`;
        this._editorPlaceholder.style.fontSize = `${cfg.editor}px`;
        this.codeMirror.refresh();

        this._fontSizeBtns?.forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.size === this._fontSize);
        });

        localStorage.setItem("pit_repl_font_size", this._fontSize);

    }

    // ====================================================
    // Cargar / Guardar el código del editor como archivo .py en el
    // disco del usuario -- mismo patrón (File System Access API con
    // fallback a <input type=file>/<a download>) que ya usa
    // ProjectManager para abrir/guardar el proyecto .json.
    // ====================================================

    async _loadCodeFromDisk() {

        try {

            let file = null;

            if (window.showOpenFilePicker) {

                const [handle] = await window.showOpenFilePicker({
                    multiple: false,
                    types: [{
                        description: "Código MicroPython",
                        accept: { "text/x-python": [".py"] }
                    }]
                });
                file = await handle.getFile();

            } else {

                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".py";
                file = await new Promise((resolve) => {
                    input.onchange = () => resolve(input.files?.[0] || null);
                    input.click();
                });

            }

            if (!file) return;

            this.codeMirror.setValue(await file.text());
            this.switchTab("editor");
            this.codeMirror.focus();

        } catch (err) {

            if (err?.name !== "AbortError") {
                alert("❌ Error abriendo el archivo: " + err.message);
            }

        }

    }

    async _saveCodeToDisk() {

        const blob = new Blob([this.editor.value], { type: "text/x-python" });
        // Usa el nombre de proyecto definido arriba en el toolbar
        // (#currentFileLabel, ver index.html -- lo maneja
        // Toolbar.bindCurrentFileLabel()/ProjectManager.currentFileName)
        // en vez de un "editor.py" fijo -- ese campo guarda el nombre
        // CON extensión del proyecto (ej. "proyecto_2026-07-31.json"),
        // así que se le saca esa extensión y se pone ".py". Si todavía
        // no hay proyecto guardado (default "Sin guardar", o vacío),
        // cae al nombre genérico de siempre.
        const projectLabel = document.getElementById("currentFileLabel")?.value?.trim();
        const baseName = (projectLabel && projectLabel !== "Sin guardar")
            ? projectLabel.replace(/\.[^./\\]+$/, "")
            : "editor";
        const suggestedName = `${baseName}.py`;

        if (window.showSaveFilePicker) {

            try {

                const handle = await window.showSaveFilePicker({
                    suggestedName,
                    types: [{
                        description: "Código MicroPython",
                        accept: { "text/x-python": [".py"] }
                    }]
                });

                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                return;

            } catch (err) {

                if (err?.name === "AbortError") return;
                console.warn("[ReplPanel] No se pudo abrir el selector de guardado:", err);

            }

        }

        // Fallback sin File System Access API (Firefox, Safari)
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedName;
        a.click();
        URL.revokeObjectURL(url);

    }

    // ====================================================
    // Terminal real (xterm.js) para la salida del REPL
    // ====================================================
    //
    // Por qué: la salida venía siendo un <div> de texto plano al que
    // le íbamos agregando <span> (ver el viejo appendOutput()) -- sin
    // ningún manejo real de secuencias ANSI, sin scrollback propio, y
    // con una estética de "log" en vez de una terminal serie de
    // verdad. xterm.js (ya vendorizado en lib/xterm/, antes suelto en
    // la raíz del repo sin usar) es el mismo motor de terminal que
    // usa VS Code -- lo usamos acá SOLO como SUPERFICIE DE SALIDA.
    //
    // La ENTRADA de comandos sigue siendo this.input/sendInput() tal
    // cual estaba (historial con flechas propio, envío de línea
    // completa, Ctrl+C manual) -- probado y confiable durante toda
    // esta sesión. Por eso `disableStdin: true`: esta terminal no
    // recibe foco de teclado directo, es un visor.
    _initTerminal() {

        this.terminal = new Terminal({
            convertEol: false, // normalizamos \r\n nosotros mismos, ver appendOutput()
            disableStdin: true,
            cursorBlink: false,
            fontSize: 12.5,
            fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
            scrollback: 5000,
            theme: {
                background: "#0d0f1a",
                foreground: "#00ff88", // mismo verde que tenía .repl-output por defecto
            },
        });

        this._fitAddon = new FitAddon.FitAddon();
        this.terminal.loadAddon(this._fitAddon);
        this.terminal.loadAddon(new WebLinksAddon.WebLinksAddon());

        this.terminal.open(this.output);
        this._safeFit();

        window.addEventListener("resize", () => {
            if (this.open) this._safeFit();
        });

    }

    // fit() puede tirar si el contenedor todavía mide 0x0 (panel
    // cerrado/pestaña oculta) -- pasa en el primer render, antes de
    // que el usuario abra el panel por primera vez.
    _safeFit() {
        try { this._fitAddon?.fit(); } catch (_) { /* contenedor sin medidas aún, ver toggle()/switchTab() */ }
    }

    // ====================================================
    // Eventos del DOM
    // ====================================================

    bindEvents() {

        // Toggle
        document.getElementById("replBtnToggle").addEventListener("click", () => this.toggle());
        this.header.addEventListener("click", (e) => {
            if (e.target.closest(".repl-btn, .repl-tabbar")) return;
            this.toggle();
        });

        // Tabs
        this.tabBar.addEventListener("click", (e) => {
            const tab = e.target.closest(".repl-tab");
            if (!tab) return;
            this.switchTab(tab.dataset.tab);
        });

        // REPL input
        this.sendBtn.addEventListener("click", () => this.sendInput());
        this.input.addEventListener("keydown", (e) => {
            if (e.key === "Enter")     { e.preventDefault(); this.sendInput(); return; }
            // BUG REAL encontrado (usuario reportó "las flechas no
            // navegan el historial"): this.history usa unshift() --
            // índice 0 es el comando MÁS RECIENTE, índices más altos son
            // más viejos, -1 es "sin selección" (input vacío/en blanco).
            // Con eso, "↑" (ir a comandos más viejos) tiene que SUMAR al
            // índice, no restar -- con el signo como estaba, arrancando
            // en -1, "↑" calculaba -1+(-1)=-2, el clamp de abajo lo
            // dejaba pegado en -1 para siempre (nunca mostraba nada).
            if (e.key === "ArrowUp")   { e.preventDefault(); this.navigateHistory(1);  return; }
            if (e.key === "ArrowDown") { e.preventDefault(); this.navigateHistory(-1); return; }
            if (e.ctrlKey && e.key === "c") {
                // Mismo Ctrl+C, dos sentidos posibles -- si el usuario
                // tiene texto SELECCIONADO (típicamente del output del
                // REPL, para copiarlo), gana copiar. Si no hay nada
                // seleccionado, es el Ctrl+C de "interrumpir" de
                // siempre. Sin esto, seleccionar una línea del output
                // y copiarla con el foco todavía en el input mandaría
                // un Ctrl+C real al firmware en vez de copiar.
                const selected = window.getSelection().toString();
                if (selected && this._copyToClipboard(selected)) {
                    e.preventDefault();
                    return;
                }
                e.preventDefault();
                this.simulator.qemuBridge?.interrupt();
                this.appendOutput("^C\n", "repl-ctrl");
                return;
            }
            if (e.ctrlKey && e.key === "v" && this._pasteFromClipboard) {
                e.preventDefault();
                this._pasteFromClipboard((text) => {
                    const start = this.input.selectionStart ?? this.input.value.length;
                    const end = this.input.selectionEnd ?? this.input.value.length;
                    this.input.setRangeText(text, start, end, "end");
                });
            }
        });

        // Botones cabecera
        document.getElementById("replBtnInterrupt").addEventListener("click", () => {
            this.simulator.qemuBridge?.interrupt();
            this.appendOutput("^C\n", "repl-ctrl");
        });
        document.getElementById("replBtnReset").addEventListener("click", () => {

            // A diferencia de "■ Interrumpir" (Ctrl+C, que SÍ tiene
            // que poder cortar algo trabado incluso a mitad de un
            // paste), este Ctrl+D no tiene apuro real -- y mandarlo
            // directo, sin encolar, es justo lo que podía cortar un
            // preloadHal()/_pasteBlock() en curso a mitad de camino
            // (bug real: el usuario reclickeaba "Soft Reset" viendo
            // que "no pasaba nada" mientras el HAL se estaba
            // repasteando solo tras un reinicio, y ese segundo Ctrl+D
            // caía DENTRO del paste mode todavía abierto, cortándolo
            // -- las líneas que quedaban en la cola de ese paste se
            // mandaban sueltas al prompt ya interactivo, disparando
            // IndentationError en cascada). Encolado detrás de
            // _pasteQueue, este Ctrl+D espera a que cualquier paste en
            // curso termine solo, en vez de interrumpirlo.
            this._enqueuePaste(async () => {
                this.simulator.qemuBridge?.softReset();
                this.appendOutput("↺ Soft reset...\n", "repl-ctrl");
            });

        });
        document.getElementById("replBtnClear").addEventListener("click", () => {
            this.terminal?.clear();
        });

        // Tamaño de fuente (S/M/L) -- ver _applyFontSize()
        this._fontSizeBtns = Array.from(this.header.querySelectorAll(".repl-font-btn"));
        this._fontSizeBtns.forEach((btn) => {
            btn.addEventListener("click", () => this._applyFontSize(btn.dataset.size));
        });
        const savedFontSize = localStorage.getItem("pit_repl_font_size");
        this._applyFontSize(savedFontSize in ReplPanel.FONT_SIZES ? savedFontSize : "M");

        // Silenciar/activar actividad de pines -- ver el comentario
        // largo en el constructor sobre por qué esto es 100% seguro
        // de tocar (no afecta LEDs ni detección de botones/teclado).
        // El botón en sí es una herramienta de DIAGNÓSTICO, no algo
        // pensado para el usuario final (alumno/profesor) -- oculto
        // salvo que se active window.PIT_DEBUG (mismo flag que ya usa
        // el resto del proyecto para logs de desarrollo, ver app.js).
        this._gpioLogBtn = document.getElementById("replBtnGpioLog");
        this._gpioLogBtn.style.display = window.PIT_DEBUG ? "" : "none";
        this._updateGpioLogBtn();
        this._gpioLogBtn.addEventListener("click", () => {
            this._gpioLogMuted = !this._gpioLogMuted;
            localStorage.setItem("pit_gpio_log_muted", this._gpioLogMuted ? "1" : "0");
            this._updateGpioLogBtn();
        });

        // Editor
        document.getElementById("replBtnRun").addEventListener("click", () => this.runEditorCode());
        document.getElementById("replBtnLoadCode").addEventListener("click", () => this._loadCodeFromDisk());
        document.getElementById("replBtnSaveCode").addEventListener("click", () => this._saveCodeToDisk());

        // Tab (4 espacios), Ctrl+Enter (ejecutar) y auto-indentación
        // tras ":" ahora los maneja CodeMirror nativamente (modo
        // "python" + indentUnit/tabSize/indentWithTabs, ver
        // buildDOM() -- "Ctrl-Enter" está en extraKeys ahí mismo).
        // Ya no hace falta ningún listener a mano sobre el textarea.

        // Atajo global
        window.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.key === "`") { e.preventDefault(); this.toggle(); }
        });

    }

    // ====================================================
    // Portapapeles nativo (solo dentro de la app de escritorio,
    // window.pywebview -- ver desktop/main.py, clase Api). El
    // copy/paste NATIVO del navegador (eventos "copy"/"paste", Ctrl+C/
    // Ctrl+V normales) no resultó confiable dentro del motor WebView2
    // que usa pywebview -- mismo síntoma que ya se había resuelto así
    // en la otra app de escritorio del proyecto (3DPit Blocks), con
    // un helper de Python vía PowerShell Get-Clipboard/Set-Clipboard
    // expuesto como js_api. Acá se conecta ESE helper a los dos
    // lugares donde hace falta: el input del REPL (ver bindEvents) y
    // el editor CodeMirror.
    //
    // window.pywebview.api se inyecta recién DESPUÉS de que la página
    // termina de cargar (evento "pywebvieready") -- si para cuando
    // este método corre todavía no está, se espera ese evento. Fuera
    // de la app de escritorio (navegador normal, como en desarrollo
    // con "npx serve") window.pywebview nunca existe -- los stubs del
    // constructor (_copyToClipboard siempre false, _pasteFromClipboard
    // null) dejan el comportamiento nativo del navegador intacto.
    // ====================================================

    _bindNativeClipboard() {

        const setup = () => {

            if (!window.pywebview?.api) return;

            this._copyToClipboard = (text) => {
                window.pywebview.api.set_clipboard(text).catch((err) =>
                    console.error("[ReplPanel] No se pudo copiar al portapapeles:", err)
                );
                return true;
            };

            this._pasteFromClipboard = (callback) => {
                window.pywebview.api.get_clipboard()
                    .then((text) => { if (text) callback(text); })
                    .catch((err) => console.error("[ReplPanel] No se pudo leer el portapapeles:", err));
            };

            // CodeMirror: mismo problema, mismo fix -- vía extraKeys
            // (ya tenía "Ctrl-Enter" ahí, ver buildDOM()).
            this.codeMirror.setOption("extraKeys", {
                ...this.codeMirror.getOption("extraKeys"),
                "Ctrl-V": () => {
                    this._pasteFromClipboard((text) => this.codeMirror.replaceSelection(text));
                },
                "Ctrl-C": (cm) => {
                    const selected = cm.getSelection();
                    if (selected) this._copyToClipboard(selected);
                },
            });

            // Caso restante: texto seleccionado con el mouse en el
            // OUTPUT del REPL (xterm.js) -- ahí el foco de teclado no
            // está ni en this.input ni en CodeMirror, así que ninguno
            // de los dos handlers de arriba se dispara. Un listener a
            // nivel de ventana cubre ese caso (y cualquier otro
            // selectable de la página) sin duplicar el manejo de
            // Ctrl+C específico del input (ver bindEvents -- ese ya
            // hace su propio preventDefault + copia/interrumpe).
            window.addEventListener("keydown", (e) => {
                if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "c") return;
                if (e.target === this.input || e.target.closest?.(".CodeMirror")) return;
                // xterm.js NO usa la selección nativa del navegador (la
                // pinta/gestiona con su propio SelectionService interno)
                // -- window.getSelection() siempre vuelve vacío para
                // texto seleccionado con el mouse en el output del REPL,
                // por eso hay que preguntarle a la terminal primero.
                const selected = (this.terminal?.hasSelection() && this.terminal.getSelection())
                    || window.getSelection().toString();
                if (selected) this._copyToClipboard(selected);
            });

            // Menú contextual PROPIO (clic derecho) -- WebView2
            // deshabilita el menú nativo del navegador (Cortar/Copiar/
            // Pegar/etc.) salvo que la app corra con debug=True, que
            // también expondría DevTools al usuario final (no
            // queremos eso). Mismo lenguaje visual que el menú del
            // canvas (ver ContextMenu.js -- reutiliza sus mismas
            // clases CSS .context-menu/.context-menu-item/etc., ver
            // simulator.css).
            this._bindClipboardContextMenu();

        };

        if (window.pywebview?.api) setup();
        else window.addEventListener("pywebviewready", setup, { once: true });

    }

    // Adaptador chico: mismas 5 acciones (cortar/copiar/pegar/
    // eliminar/seleccionar todo), traducidas a la API real de cada
    // widget -- el <input> del REPL (selectionStart/End nativos) o
    // CodeMirror (getSelection/replaceSelection propios).
    _clipboardAdapterFor(kind) {

        if (kind === "input") {
            const sel = () => this.input.value.substring(this.input.selectionStart, this.input.selectionEnd);
            return {
                getSelection: sel,
                cut: () => {
                    const text = sel();
                    if (text) this._copyToClipboard(text);
                    this.input.setRangeText("", this.input.selectionStart, this.input.selectionEnd, "end");
                },
                copy: () => { const text = sel(); if (text) this._copyToClipboard(text); },
                paste: () => this._pasteFromClipboard((text) => {
                    const start = this.input.selectionStart, end = this.input.selectionEnd;
                    this.input.setRangeText(text, start, end, "end");
                }),
                del: () => this.input.setRangeText("", this.input.selectionStart, this.input.selectionEnd, "end"),
                selectAll: () => this.input.select(),
            };
        }

        if (kind === "terminal") {
            // Salida del REPL (xterm.js, disableStdin:true) -- solo
            // lectura. getSelection() es la API PROPIA de xterm.js (no
            // window.getSelection(), ver el listener de Ctrl+C más
            // arriba: la terminal no expone su selección vía DOM
            // Selection nativa). Cortar/Pegar/Eliminar no aplican acá
            // -- readOnly:true hace que showMenu() los deshabilite.
            return {
                getSelection: () => this.terminal?.getSelection() || "",
                cut: () => {},
                copy: () => {
                    const text = this.terminal?.getSelection();
                    if (text) this._copyToClipboard(text);
                },
                paste: () => {},
                del: () => {},
                selectAll: () => this.terminal?.selectAll(),
                readOnly: true,
            };
        }

        return {
            getSelection: () => this.codeMirror.getSelection(),
            cut: () => {
                const text = this.codeMirror.getSelection();
                if (text) this._copyToClipboard(text);
                this.codeMirror.replaceSelection("");
            },
            copy: () => { const text = this.codeMirror.getSelection(); if (text) this._copyToClipboard(text); },
            paste: () => this._pasteFromClipboard((text) => this.codeMirror.replaceSelection(text)),
            del: () => this.codeMirror.replaceSelection(""),
            selectAll: () => this.codeMirror.execCommand("selectAll"),
        };

    }

    _bindClipboardContextMenu() {

        const showMenu = (e, adapter) => {

            e.preventDefault();

            document.querySelector(".repl-clipboard-menu")?.remove();

            const hasSelection = !!adapter.getSelection();

            const items = [
                { label: "Cortar",           shortcut: "Ctrl+X", action: adapter.cut,      disabled: !hasSelection || adapter.readOnly },
                { label: "Copiar",           shortcut: "Ctrl+C", action: adapter.copy,     disabled: !hasSelection },
                { label: "Pegar",            shortcut: "Ctrl+V", action: adapter.paste,    disabled: adapter.readOnly },
                { label: "Eliminar",         shortcut: "Del",    action: adapter.del,      disabled: !hasSelection || adapter.readOnly },
                "separator",
                { label: "Seleccionar todo", shortcut: "Ctrl+A", action: adapter.selectAll },
            ];

            const menu = document.createElement("div");
            // Mismas clases que ContextMenu.js (canvas) para el mismo
            // look -- "repl-clipboard-menu" aparte solo para poder
            // encontrar/cerrar ESTE menú puntual sin pisar el del canvas.
            menu.className = "context-menu repl-clipboard-menu";

            items.forEach((item) => {

                if (item === "separator") {
                    const sep = document.createElement("div");
                    sep.className = "context-menu-separator";
                    menu.appendChild(sep);
                    return;
                }

                const row = document.createElement("div");
                row.className = "context-menu-item" + (item.disabled ? " disabled" : "");

                const label = document.createElement("span");
                label.textContent = item.label;
                row.appendChild(label);

                const kbd = document.createElement("span");
                kbd.className = "context-menu-shortcut";
                kbd.textContent = item.shortcut;
                row.appendChild(kbd);

                if (!item.disabled) {
                    row.addEventListener("click", () => { item.action(); close(); });
                }

                menu.appendChild(row);

            });

            document.body.appendChild(menu);

            // Clampeo simple para no salirse de la pantalla (mismo
            // criterio que ContextMenu.positionElement).
            const rect = menu.getBoundingClientRect();
            let left = e.clientX, top = e.clientY;
            if (left + rect.width  > window.innerWidth)  left = window.innerWidth  - rect.width  - 8;
            if (top  + rect.height > window.innerHeight) top  = window.innerHeight - rect.height - 8;
            menu.style.left = `${Math.max(4, left)}px`;
            menu.style.top  = `${Math.max(4, top)}px`;

            const onPointerDown = (ev) => { if (!menu.contains(ev.target)) close(); };
            const onKeydown     = (ev) => { if (ev.key === "Escape") close(); };

            function close() {
                menu.remove();
                document.removeEventListener("pointerdown", onPointerDown);
                window.removeEventListener("keydown", onKeydown);
            }

            // Se registra en el siguiente tick -- si no, el mismo
            // pointerdown del clic derecho que abrió el menú lo
            // cerraría de inmediato.
            setTimeout(() => {
                document.addEventListener("pointerdown", onPointerDown);
                window.addEventListener("keydown", onKeydown);
            }, 0);

        };

        this.input.addEventListener("contextmenu", (e) => showMenu(e, this._clipboardAdapterFor("input")));
        this.codeMirror.getWrapperElement().addEventListener(
            "contextmenu", (e) => showMenu(e, this._clipboardAdapterFor("codemirror"))
        );
        // Salida del REPL (xterm.js) -- este era el que faltaba: el
        // menú solo estaba conectado al input y al editor, nunca al
        // output, así que clic derecho ahí no mostraba nada.
        this.output.addEventListener("contextmenu", (e) => showMenu(e, this._clipboardAdapterFor("terminal")));

    }

    // ====================================================
    // Stripper de docstrings triples ("""..."""/'''...''') para
    // los .hal.py.
    //
    // Solo saca un bloque cuando es un STATEMENT propio: la línea
    // donde abre no tiene nada más que espacios ANTES de las
    // comillas, y la línea donde cierra no tiene nada más que
    // espacios DESPUÉS de ellas. Eso es justo el patrón de un
    // docstring real (primera línea de una función/clase, o
    // cualquier string suelto usado solo como comentario largo) --
    // nunca toca un string de verdad que esté siendo asignado a una
    // variable o pasado como argumento (esos nunca abren la línea
    // solo con las comillas).
    //
    // Nadie en este proyecto lee __doc__ en runtime, así que
    // sacarlos no cambia el comportamiento -- solo el tamaño.
    // ====================================================

    _stripDocstrings(text) {

        return text.replace(/^([ \t]*)("""|''')[\s\S]*?\2[ \t]*$/gm, "");

    }

    // ====================================================
    // Stripper de comentarios/líneas vacías para los .hal.py.
    //
    // Los .hal.py tienen mucho más comentario que código real --
    // esas líneas no le sirven para nada a MicroPython. Como
    // _pasteBlock() manda el HAL LÍNEA POR LÍNEA (ver más abajo:
    // un qemu:send() por línea, con su propio delay), cada
    // comentario que sacamos acá es una línea entera -- y por lo
    // tanto un _lineDelayMs() completo -- menos que esperar durante
    // el pegado. Esto es justo lo que había que tocar del lado del
    // NAVEGADOR: el stripping equivalente en server.js nunca se
    // disparaba, porque a server.js le llega una línea a la vez, no
    // el archivo completo (ver el comentario en _pasteBlock).
    //
    // Solo saca líneas que son comentario COMPLETO (empiezan con
    // "#" después de espacios) o líneas vacías -- nunca toca un "#"
    // en medio de una línea de código real (ej. dentro de un
    // string), para no arriesgarse a romper nada por una heurística
    // de más.
    // ====================================================

    _stripComments(text) {

        return text
            .split("\n")
            .filter((line) => {
                const trimmed = line.trim();
                return trimmed !== "" && !trimmed.startsWith("#");
            })
            .join("\n");

    }

    // Aplica ambos strippers en el orden correcto: primero los
    // docstrings (que pueden abarcar varias líneas, hace falta el
    // texto completo con sus saltos de línea intactos para que el
    // regex los reconozca), y RECIÉN DESPUÉS las líneas de
    // comentario simple y las líneas vacías que puedan haber
    // quedado (ej. la línea en blanco que separaba el docstring del
    // código real).
    _stripPySource(text) {

        return this._stripComments(this._stripDocstrings(text));

    }

    // ====================================================
    // HAL — cargar un fragmento desde disco
    // Retorna el texto del .hal.py, o null si no existe.
    // Usa caché para no hacer fetch repetidos.
    // ====================================================

    async _loadHal(type) {

        if (type in this._halCache) return this._halCache[type];

        try {
            const res = await fetch(`components/${type}/${type}.hal.py`);
            if (!res.ok) {
                // OJO: antes acá se guardaba `this._halCache[type] = null`,
                // lo que "envenenaba" para siempre este tipo en memoria --
                // si el archivo todavía no existía (ej. lo estabas por
                // subir) o tenía el nombre equivocado, quedaba cacheado
                // el fallo y ni renombrando/subiendo el archivo correcto
                // se volvía a intentar, hasta un F5 completo de la página.
                // Ahora un fallo NO se cachea: la próxima vez que le des
                // a "Ejecutar" reintenta el fetch solo.
                return null;
            }
            const rawText = (await res.text()).trim();
            const text = this._stripPySource(rawText);
            this._halCache[type] = text;
            return text;
        } catch {
            // Igual que arriba: no cachear el fallo, para poder reintentar.
            return null;
        }

    }

    // ====================================================
    // Sanear texto antes de mandarlo por el puente serial a QEMU.
    //
    // El pty/serial de QEMU no tolera bien caracteres no-ASCII
    // (tildes, ñ, símbolos como ── ✓ ▶): al llegar corruptos
    // desalinean los bytes siguientes y el REPL termina viendo
    // "basura", lo que dispara SyntaxError en cascada y se come
    // caracteres de las líneas de después. Por eso todo lo que se
    // pega (HAL + código del usuario) pasa primero por acá.
    // ====================================================

    _sanitizeForSerial(text) {

        return text
            // á,é,í,ó,ú,ñ,ü... -> su versión sin acento/diéresis
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            // cualquier otro caracter no-ASCII (──, ✓, ▶, ⚡, etc.)
            .replace(/[^\x00-\x7F]/g, "-");

    }

    // ====================================================
    // Ensamblar el código pendiente de pegar:
    //   1. HAL base (siempre)
    //   2. HAL de cada tipo de componente en el canvas
    // ====================================================

    // Módulos "siempre presentes", en el orden EXACTO en que tienen
    // que pegarse -- cada uno puede depender de que el anterior ya
    // esté cargado (ej. _i2c_bus usa register_line_handler/
    // poll_input, que define _base). Sumar un módulo compartido
    // nuevo (un futuro _spi_bus, por ejemplo) es agregar un string
    // acá -- no hay que tocar el resto de _buildPendingHal() ni
    // duplicar el bloque de "cargar y marcar como enviado".
    //
    // Van con el mismo mecanismo de cache que ya tenía "_base" en
    // solitario (_halSentToFirmware): se pegan UNA sola vez por
    // sesión de QEMU, no en cada click de "Ejecutar" -- pegar por
    // paste mode es lento (va byte a byte por el WS/stdin, ver
    // writeToQemuThrottled en server.js), así que agregar más
    // módulos compartidos NO vuelve a pagar ese costo en cada
    // corrida, solo la primera vez después de un boot/reconexión.
    static ALWAYS_HAL_TYPES = ["_base", "_i2c_bus", "_adc_bus", "_uart_bus"];

    // ====================================================
    // Aislamiento de fallas entre componentes
    //
    // Hasta ahora, todo el bloque HAL (_base + _i2c_bus + cada
    // hal.py de componente) se pegaba como UN SOLO script. Si
    // CUALQUIER componente tenía un bug (ej. un import roto), la
    // excepción abortaba TODO lo que venía después en el mismo
    // texto -- incluidos otros componentes sin ningún problema
    // propio, sin ningún aviso claro de cuál fue el culpable (ver
    // el bug real: un import roto en el teclado dejó al LCD sin su
    // emulación de HD44780, silenciosamente, hasta que alguien
    // notó que el protocolo que salía no era el esperado).
    //
    // A partir de ahora, cada hal.py DE COMPONENTE (no los
    // "siempre presentes" -- ver más abajo por qué) se ejecuta
    // envuelto en su propio try/except: si explota, el error queda
    // contenido a ESE componente ("HAL_ERROR:<tipo>: ...") y todo
    // lo demás (otros componentes + el código del usuario) sigue
    // corriendo con normalidad.
    //
    // _base y _i2c_bus (ALWAYS_HAL_TYPES) quedan afuera de este
    // aislamiento a propósito: son la base de la que dependen
    // TODOS los componentes (register_line_handler, poll_input,
    // machine.Pin/I2C parchados) -- si esos fallan, no hay nada
    // que rescatar, mejor que el error sea ruidoso e inmediato en
    // vez de quedar "contenido" y generar fallos raros más abajo.
    //
    // Por qué exec(<base64>) y no reindentar el texto original
    // dentro de un "try:" a mano -- reindentar Python a ciegas es
    // frágil (docstrings, strings multilínea, comentarios con
    // sangría propia pueden romperse). Codificando el .hal.py
    // completo como un string opaco (mismo truco de
    // btoa(unescape(encodeURIComponent(...))) que ya usa
    // Toolbox.js para las imágenes de arrastre) y ejecutándolo con
    // exec(), no hace falta tocar ni una sola línea de su
    // contenido original.
    // ====================================================

    // Ancho de cada línea del base64 partido -- ver el comentario
    // grande de abajo sobre por qué se parte en primer lugar. No hay
    // nada mágico en 200: solo tiene que ser bastante menor a
    // cualquier buffer de línea razonable del lado del firmware/UART,
    // y bastante mayor a 1 para no explotar la cantidad de líneas por
    // gusto.
    static HAL_B64_LINE_WIDTH = 200;

    // Rompe corridas de un mismo PATRÓN CHICO (período 1 a 4
    // caracteres) repetido 3+ veces seguidas, insertando un "\n" cada
    // 2 repeticiones -- ver el comentario grande en
    // _wrapHalForIsolation() sobre por qué hace falta probar varios
    // períodos (no alcanza con "un caracter suelto repetido": una
    // corrida de bytes IDÉNTICOS en el texto original se convierte,
    // en base64, en el MISMO BLOQUE de hasta 4 caracteres repetido,
    // no en un caracter individual repetido).
    static _breakRepeatedPatterns(str) {

        let result = "";
        let i = 0;

        while (i < str.length) {

            let matched = false;

            for (let period = 1; period <= 4 && !matched; period++) {

                if (i + period * 3 > str.length) continue;

                const block = str.slice(i, i + period);
                let reps = 1;

                while (
                    i + (reps + 1) * period <= str.length &&
                    str.slice(i + reps * period, i + (reps + 1) * period) === block
                ) {
                    reps++;
                }

                if (reps >= 3) {
                    for (let r = 0; r < reps; r++) {
                        if (r > 0 && r % 2 === 0) result += "\n";
                        result += block;
                    }
                    i += reps * period;
                    matched = true;
                }

            }

            if (!matched) {
                result += str[i];
                i++;
            }

        }

        return result;

    }

    // Envuelve un .hal.py ya cargado en un exec(base64) aislado por
    // try/except (ver el comentario grande de más arriba, "Aislamiento
    // de fallas entre componentes"). El base64 se parte en líneas
    // cortas (mismo motivo de siempre: cada "\n" le da al lado
    // receptor un punto natural para drenar, ver server.js/
    // SEND_CHUNK_SIZE) pero TODAS esas líneas van DENTRO de un único
    // string triple-comillado ("""..."""), no como N strings
    // separados concatenados implícitamente ("a" "b" == "ab").
    //
    // Por qué el cambio (bug real, reproducible, reportado por el
    // usuario con ky_001): con N strings separados hacían falta 2*N
    // comillas dobles en TODA la transmisión (una de apertura y una
    // de cierre por línea) -- si el UART emulado de QEMU pierde UN
    // solo byte y ese byte resulta ser una de esas comillas, el
    // tokenizer de Python no tiene forma de saber dónde termina el
    // string roto: seguí leyendo caracteres (de las líneas
    // SIGUIENTES, sin importar qué contengan) hasta encontrar la
    // PRÓXIMA comilla suelta en cualquier lado del archivo. Eso
    // produce un SyntaxError CRUDO a mitad del paste completo (no
    // solo del HAL de este componente) -- ni siquiera llega a
    // ejecutarse el try/except de acá abajo, que es justamente lo
    // que existe para volver una corrupción "manejable". Confirmado
    // con logs reales: mismo componente, dos pastes distintos,
    // corrupción en un punto ligeramente distinto cada vez (timing,
    // no un bug determinístico de este HAL en particular) pero
    // siempre con el mismo síntoma (SyntaxError crudo).
    //
    // Con UN SOLO string triple-comillado para TODO el base64 (las
    // líneas de adentro son contenido, no sintaxis -- un "\n" ahí no
    // termina nada), la cantidad de comillas vulnerables en toda la
    // transmisión baja de 2*N a solo 6 (3 de apertura + 3 de cierre),
    // sin importar cuántas líneas tenga el base64 -- y aunque se
    // pierda alguna, el checksum de acá abajo (que si llega a
    // ejecutarse) sigue cubriendo cualquier corrupción DENTRO del
    // contenido. Los saltos de línea internos no son base64 válido,
    // así que se filtran con "".join(...split()) antes de decodificar
    // (ubinascii.a2b_base64 no promete tolerar whitespace embebido).
    _wrapHalForIsolation(type, hal) {

        // Representación binaria (1 char = 1 byte UTF-8) del código
        // fuente -- misma técnica que btoa(unescape(encodeURIComponent(...))),
        // separada acá para poder calcular largo/checksum sobre los
        // MISMOS bytes que va a producir a2b_base64() del otro lado,
        // sin duplicar la codificación.
        const binaryStr = unescape(encodeURIComponent(hal));
        const b64 = btoa(binaryStr);

        // Verificación de integridad -- ver el comentario grande de
        // server.js/SEND_CHUNK_SIZE: la UART emulada de QEMU puede
        // perder bytes sueltos en transmisiones largas incluso con el
        // throttling. Sin esto, una corrupción parcial se ve como un
        // UnicodeError/SyntaxError genérico e indistinguible de un
        // bug real del HAL -- con el largo y un checksum simple
        // calculados ACÁ (antes de que nada viaje) y verificados del
        // otro lado después de decodificar, un HAL corrupto se
        // reporta como tal, con la diferencia exacta de bytes, en vez
        // de como una excepción críptica.
        let checksum = 0;
        for (let i = 0; i < binaryStr.length; i++) {
            checksum = (checksum + binaryStr.charCodeAt(i)) % 65536;
        }
        const expectedLen = binaryStr.length;

        // Corridas largas de un mismo PATRÓN CHICO repetido (ej.
        // ky_001.hal.py tiene 12 espacios seguidos de indentación
        // doble ANTES de codificar -- base64 agrupa de a 3 bytes -> 4
        // caracteres, así que 12 bytes IDÉNTICOS se convierten en el
        // MISMO bloque de 4 caracteres repetido 4 veces seguidas,
        // "ICAg" x4 = "ICAgICAgICAgICAg"). Comparando byte a byte
        // varias transmisiones corruptas reales de ese mismo archivo,
        // la pérdida cayó SIEMPRE justo en esa corrida, en el mismo
        // offset exacto, sesión tras sesión -- consistente con que la
        // UART emulada (o el bridge stdin) pierda bytes específicamente
        // ante ráfagas largas del mismo patrón repetido, no un
        // problema de tamaño de mensaje en general (otros HAL mucho
        // más grandes, sin corridas tan largas, cargan bien).
        //
        // OJO -- primer intento de este fix (ya corregido acá) solo
        // buscaba un CARACTER SUELTO repetido 3+ veces
        // (/(.)\1{2,}/g), que nunca encuentra este caso: dentro de
        // "ICAgICAgICAgICAg" ningún caracter individual se repite 2
        // veces seguidas (I-C-A-g-I-C-A-g-...), el que se repite es
        // el BLOQUE de 4 caracteres completo. breakRepeatedPatterns()
        // prueba períodos de 1 a 4 caracteres (cualquier tamaño de
        // grupo base64 posible para una corrida de bytes idénticos,
        // sea cual sea el offset de 3 bytes en el que arranque) y
        // corta cada 2 repeticiones insertando un "\n" -- inofensivo,
        // ya se filtra todo whitespace con "".join(_hal_raw.split())
        // antes de decodificar, así que esto no cambia el contenido,
        // solo evita que el mismo patrón viaje más de un par de veces
        // seguidas por el WS/UART.
        const b64NoRuns = ReplPanel._breakRepeatedPatterns(b64);

        const width = ReplPanel.HAL_B64_LINE_WIDTH;
        const rawLines = [];
        for (let i = 0; i < b64NoRuns.length; i += width) {
            rawLines.push(b64NoRuns.slice(i, i + width));
        }
        // Sin indentación en las líneas de adentro: son CONTENIDO del
        // string triple-comillado, no sintaxis -- un espacio de más
        // acá viajaría como parte del payload (después filtrado igual
        // por el ''.join(...split()) del otro lado, pero es más
        // prolijo no depender de eso).
        const rawBlock = rawLines.join("\n");

        // Localización de la corrupción: el checksum global (arriba)
        // dice QUE algo se perdió pero no DÓNDE -- con archivos chicos
        // (ky_001, dht11) fallando casi siempre en el primer intento,
        // necesitamos saber en qué offset del base64 ocurre la
        // divergencia para poder diffear contra el fuente real y ver
        // si es el mismo patrón ya arreglado o uno nuevo. Iniciales
        // en 64 chars cada uno, sobre el string base64 SIN los "\n" de
        // breakRepeatedPatterns (equivalente a "".join(_hal_raw.split())
        // del lado Python) -- overhead de unos pocos cientos de bytes,
        // insignificante contra los ~1-3KB típicos de estos HAL chicos.
        const CHUNK = 64;
        const chunkSums = [];
        for (let i = 0; i < b64.length; i += CHUNK) {
            let s = 0;
            for (let j = i; j < Math.min(i + CHUNK, b64.length); j++) {
                s = (s + b64.charCodeAt(j)) % 65536;
            }
            chunkSums.push(s);
        }
        const chunkSumsLit = "[" + chunkSums.join(",") + "]";

        return (
            `# -- HAL: ${type} (aislado) --\n` +
            `try:\n` +
            `    import ubinascii as _ub_iso\n` +
            `    _hal_raw = """` + rawBlock + `"""\n` +
            `    _hal_joined = "".join(_hal_raw.split())\n` +
            `    _hal_cs = 64\n` +
            `    _hal_exp = ${chunkSumsLit}\n` +
            `    _hal_bad = -1\n` +
            `    for _hal_ci in range(len(_hal_exp)):\n` +
            `        _hal_chunk = _hal_joined[_hal_ci*_hal_cs:(_hal_ci+1)*_hal_cs]\n` +
            `        _hal_s = 0\n` +
            `        for _hal_c in _hal_chunk:\n` +
            `            _hal_s = (_hal_s + ord(_hal_c)) % 65536\n` +
            `        if _hal_s != _hal_exp[_hal_ci]:\n` +
            `            _hal_bad = _hal_ci\n` +
            `            break\n` +
            `    try:\n` +
            `        _hal_bytes = _ub_iso.a2b_base64(_hal_joined)\n` +
            `    except Exception as _hal_decerr:\n` +
            `        raise ValueError("b64 decode fallo: %s b64len=%d esperado=%d chunk_malo=%d offset~%d" % (repr(_hal_decerr), len(_hal_joined), ${b64.length}, _hal_bad, _hal_bad*_hal_cs))\n` +
            `    _hal_sum = sum(_hal_bytes) % 65536\n` +
            `    if len(_hal_bytes) != ${expectedLen} or _hal_sum != ${checksum} or _hal_bad != -1:\n` +
            `        raise ValueError("transmision corrupta: len=%d sum=%d chunk_malo=%d offset~%d (esperado len=${expectedLen} sum=${checksum})" % (len(_hal_bytes), _hal_sum, _hal_bad, _hal_bad*_hal_cs))\n` +
            `    exec(_hal_bytes.decode(), globals())\n` +
            `except Exception as _hal_err:\n` +
            `    print("HAL_ERROR:${type}: " + repr(_hal_err))\n`
        );

    }

    // ====================================================
    // Camino RÁPIDO: el firmware conectado PODRÍA tener el .hal.py de
    // este tipo CONGELADO (ver firmware/frozen_hal/README.md y
    // PIT_FROZEN_HAL_TYPES en js/simulator/FrozenHalTypes.js) -- en vez de pastear ~100-200
    // líneas de base64 por el pty serial emulado, mandamos un
    // "import _pit_hal_<tipo>" de una sola línea. Mismo aislamiento
    // try/except que _wrapHalForIsolation() (así HAL_ERROR:<tipo> y
    // el reintento automático de _retryHalAfterError() funcionan
    // idéntico), pero sin checksum/base64 -- no hace falta: un
    // import normal de MicroPython no viaja por ningún medio
    // propenso a corrupción, ya está adentro del firmware.
    //
    // sanitizeType() tiene que coincidir EXACTO con la de
    // firmware/frozen_hal/build_components.js (mismo nombre de
    // módulo de los dos lados) -- único caracter que un `type` puede
    // traer inválido para un identificador Python es "-" (ej.
    // "ky-018").
    _sanitizeHalType(type) {
        return type.replace(/-/g, "_");
    }

    _wrapFrozenImport(type) {

        const modName = `_pit_hal_${this._sanitizeHalType(type)}`;

        return (
            `# -- HAL: ${type} (congelado) --\n` +
            `try:\n` +
            `    import ${modName}\n` +
            `except Exception as _hal_err:\n` +
            `    print("HAL_ERROR:${type}: " + repr(_hal_err))\n`
        );

    }

    // "Modo desarrollo de HAL" -- ver firmware/frozen_hal/README.md.
    // Herramienta para iterar sobre un .hal.py sin recompilar
    // firmware en cada cambio: fuerza el camino dinámico de siempre
    // (fetch + paste) aunque el firmware conectado tenga ese tipo
    // congelado. Pensado para activarse a mano desde la consola del
    // navegador (localStorage.setItem("pit_hal_dev_mode","1")), no
    // hay UI -- es una herramienta de desarrollo de ESTE proyecto,
    // no algo para el usuario final.
    _halDevMode() {
        return localStorage.getItem("pit_hal_dev_mode") === "1";
    }

    async _buildPendingHal() {

        const parts = [];
        const newlySent = []; // types que se agregan en ESTA tanda -- recién se marcan "sent" si todo sale bien

        // ── 1. Módulos siempre presentes (solo los que falten en esta sesión) ──
        //
        // REVERTIDO -- se probó envolver esto con _wrapHalForIsolation()
        // (mismo checksum que cada componente) pensando que la
        // corrupción de ky_001 en realidad pegaba en este bloque grande
        // sin protección. Resultado real, peor: _base/_i2c_bus/_adc_bus
        // ya son varios cientos de líneas -- envueltos en base64 (que
        // infla el tamaño ~33%) más el propio boilerplate del wrapper,
        // el paste combinado se volvió considerablemente MÁS GRANDE que
        // antes. Con el wrapper puesto, los CUATRO bloques (los 3 base
        // + el del componente) fallaron a la vez en el primer intento
        // real -- peor que cualquier fallo aislado visto hasta ahora,
        // consistente con que un payload más grande tiene más
        // superficie para la corrupción, no menos. Mejor detección,
        // pero peor tasa de éxito neta -- no vale la pena el cambio.
        // Se mantiene el consejo de no recargar la página entre
        // reintentos (evita re-mandar este bloque grande de más) como
        // mitigación real, y el checksum queda SOLO en el HAL por
        // componente (mucho más chico, sección 2 más abajo).
        for (const type of ReplPanel.ALWAYS_HAL_TYPES) {

            if (this._halSentToFirmware.has(type)) continue;

            const hal = await this._loadHal(type);

            if (hal) {
                parts.push(hal);
                newlySent.push(type);
            } else {
                console.warn(`[ReplPanel] ${type}.hal.py no encontrado — puede faltar funcionalidad (bridge de pines/I2C).`);
            }

        }

        // ── 2. HAL por tipo de componente en el canvas (idem) ──────────────
        const loadedTypes = new Set(ReplPanel.ALWAYS_HAL_TYPES);   // ya están (pegados ahora o antes)

        for (const component of this.simulator.componentManager.getAll()) {

            const type = component.type;
            if (loadedTypes.has(type)) continue;
            loadedTypes.add(type);

            // El ESP32 (o cualquier otro microcontrolador futuro que
            // empiece con "esp32") es el anfitrión, no un periférico --
            // nunca va a tener su propio components/<type>/<type>.hal.py
            // (mismo criterio que ya usa QemuBridge.getEsp32() para
            // encontrarlo). Sin este salto, cada "Ejecutar" intentaba
            // ese fetch y lo dejaba en 404 en la consola sin ninguna
            // razón real.
            if (type.startsWith("esp32")) continue;

            if (this._halSentToFirmware.has(type)) continue; // ya está en el firmware, no lo repetimos

            // Camino rápido: el firmware conectado ya tiene este tipo
            // congelado (ver _wrapFrozenImport) -- nos ahorramos el
            // fetch Y el paste completo, mandamos solo el import.
            // _halDevMode() es la válvula de escape para iterar sobre
            // un .hal.py sin recompilar firmware (ver el comentario
            // grande de _halDevMode()).
            if (this._frozenHalTypes.has(type) && !this._halDevMode()) {
                parts.push(this._wrapFrozenImport(type));
                newlySent.push(type);
                continue;
            }

            const hal = await this._loadHal(type);

            if (hal) {
                // Ignorar archivos que son solo comentarios (marcadores vacíos)
                const hasCode = hal.split("\n").some(line => {
                    const t = line.trim();
                    return t && !t.startsWith("#");
                });

                if (hasCode) {
                    parts.push(this._wrapHalForIsolation(type, hal));
                }

                newlySent.push(type); // lo marcamos igual aunque sea "solo comentarios" -- ya lo revisamos, no hace falta volver a cargarlo/chequearlo

            }

        }

        const halBlock = parts.join("\n\n");

        return { halBlock, newlySent, hasPending: parts.length > 0 };

    }

    // Usado SOLO por WasmBridge (ejecución in-process en el Worker del
    // navegador, ver runEditorCode()) -- sin pty/serie de por medio ahí,
    // así que no hace falta el checksum/chunking que sí necesita QEMU
    // (ver _sendUserCodeChunked()). El código del usuario viaja tal
    // cual, sin envolver, para que lo que se muestra en el panel
    // (idéntico a lo que se manda) sea legible.
    async _assembleCode(userCode) {

        const { halBlock, newlySent } = await this._buildPendingHal();

        const parts = [];
        if (halBlock) parts.push(halBlock);
        parts.push(userCode);

        const fullCode = this._sanitizeForSerial(parts.join("\n\n"));

        return { fullCode, newlySent };

    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Cola de envíos por paste mode -- garantiza que preloadHal() y
    // runEditorCode() nunca manden dos bloques Ctrl+E...Ctrl+D al
    // mismo tiempo (eso sí los pisaría entre sí). Cada uno se anota
    // acá y se ejecuta en orden, aunque se hayan disparado a la vez.
    _enqueuePaste(fn) {
        const run = this._pasteQueue.then(fn, fn);
        this._pasteQueue = run.catch(() => {});
        return run;
    }

    // REVERTIDO -- se había sacado el pacing línea a línea de acá
    // (ver historial/memoria del proyecto) confiando en que la
    // sendQueue de server.js sola bastaba para evitar corrupción,
    // ahorrándose la doble espera. CONFIRMADO EN LA PRÁCTICA que NO
    // alcanza: reportado con un script de RC522 de ~15 líneas,
    // corrupción real perdiendo el PRINCIPIO de una línea corta
    // ("    rst=22,\n" llegó como "22,\n", "if status == rfid.OK:\n"
    // llegó como "s == rfid.OK:\n") -- mismo síntoma exacto que la
    // corrupción de HAL ya documentada, solo que esta vez en código
    // del USUARIO, que no tiene el checksum/aislamiento que sí
    // protege a los .hal.py (por eso se veía como un SyntaxError
    // confuso en vez de un HAL_ERROR claro). Como acá arriba mismo
    // quedó anotado como la señal a esperar, se vuelve a la espera
    // por línea, calculada contra los mismos SEND_CHUNK_SIZE/
    // SEND_CHUNK_DELAY_MS reales de server.js -- si esos valores
    // cambian de un lado, cambiar del otro también.
    static SEND_CHUNK_SIZE      = 6;  // debe igualar a server.js
    static SEND_CHUNK_DELAY_MS  = 35; // ms -- debe igualar a server.js
    static PASTE_LINE_DELAY_MS  = 20; // piso mínimo, para líneas cortas

    // Tope de espera post-Ctrl+D para pegados SILENCIOSOS (preloadHal)
    // -- ver _pasteBlock()/_waitForNextPrompt() más abajo.
    static PASTE_FINISH_TIMEOUT_MS = 6000;

    // Bytes reales (no caracteres JS) que va a pesar la línea al
    // viajar por el WS -- importante si hay UTF-8 multibyte, aunque
    // _sanitizeForSerial ya debería dejar todo en ASCII puro.
    //
    // marginMultiplier (default 1): deja margen para que un futuro
    // llamador agrande el pacing (ej. en un reintento) sin tocar esta
    // función -- actualmente ningún llamador lo usa (el código del
    // usuario viaja por pedazos chicos, ver _sendUserCodeChunked(), que
    // no lo necesitó).
    _lineDelayMs(line, marginMultiplier = 1) {
        const bytes  = new TextEncoder().encode(line + "\r\n").length;
        const chunks = Math.max(1, Math.ceil(bytes / ReplPanel.SEND_CHUNK_SIZE));
        // El primer trozo sale ~inmediato; los siguientes pagan el
        // delay entre trozos (ver writeNextChunk en server.js).
        const serverTimeMs = (chunks - 1) * ReplPanel.SEND_CHUNK_DELAY_MS * marginMultiplier;
        return Math.max(ReplPanel.PASTE_LINE_DELAY_MS, serverTimeMs + ReplPanel.PASTE_LINE_DELAY_MS);
    }

    // Manda un bloque por paste mode (Ctrl+E, líneas con delay,
    // Ctrl+D). Si silent=true nunca se muestra nada (uso: precarga
    // de HAL en segundo plano, sin código de usuario de por medio).
    // Si no, se oculta el eco solo hasta halLineCount (uso normal:
    // Ejecutar, donde sí queremos ver correr el código del usuario).
    async _pasteBlock(fullCode, halLineCount, { silent = false, marginMultiplier = 1 } = {}) {

        // Traba: mientras dure este bloque Ctrl+E...Ctrl+D, ningún otro
        // emisor (RTC:/TEMP:/DIST:/ADC:/IN:/etc. -- ver la nota grande
        // en QemuBridge.send()) puede meter una línea propia en medio
        // del paste. Se libera SIEMPRE en el finally, incluso si algo
        // de acá adentro tira una excepción.
        this.simulator.qemuBridge?.beginPasteLock();

        try {

            // Interrumpe lo que estuviera corriendo antes y da un margen
            // para que MicroPython vuelva al prompt ">>>" antes del Ctrl+E.
            //
            // BUG REAL, grave (reportado en vivo: "ni el LED más simple
            // funciona ya", con tracebacks de KeyboardInterrupt cayendo
            // A MITAD de un reboot de boot.py/_pit_base.py/machine.py, y
            // líneas del bloque partidas a la mitad con un ">>>" de la
            // nada en el medio): este Ctrl+C ANTES usaba
            // qemuBridge.interrupt() -- el bypass RÁPIDO de server.js
            // (un solo byte 0x03/0x04 que salta la cola throttled
            // entera, ver ws.on("message") ahí) -- a propósito, para no
            // quedar haciendo fila detrás de un posible "while True"
            // trabado. Pero en los reintentos de _sendUserCodeChunked
            // (varios _pasteBlock() seguidos, uno por intento), ese
            // bypass salta por encima de lo que TODAVÍA está drenando
            // de nuestro PROPIO intento anterior (que no estaba
            // trabado, solo terminando de mandarse) -- el Ctrl+C
            // adelantado corta ese drenaje a la mitad, y lo que queda
            // sin drenar se mezcla con el intento nuevo que arranca
            // acá. Usar "qemu:send" (como cualquier línea normal, por
            // _sendImmediate -- que le agrega "\r\n" y SÍ cae en la
            // misma cola lenta de siempre, nunca la salta) hace que
            // este Ctrl+C espere su turno detrás de lo que de verdad
            // falte drenar, en vez de atravesarlo. La probe de arranque
            // (_probeWarmBootOnce) y el botón "■ Interrumpir" siguen
            // usando el bypass real -- ahí sí hace falta cortar YA un
            // "while True" genuinamente en curso, no un paste nuestro
            // recién terminado.
            this.simulator.eventBus.emit("qemu:send", "\x03");
            await this._sleep(150);

            this._suppressEcho = true;
            this.simulator.eventBus.emit("qemu:send", "\x05"); // Ctrl+E: paste mode

            // Ver el comentario grande de _waitForPasteModeStart() --
            // confirmar que paste mode arrancó de VERDAD antes de
            // mandar una sola línea del cuerpo. Si el Ctrl+E se perdió
            // en tránsito, cada línea de abajo se tiparía suelta en el
            // prompt normal, y el Ctrl+D final dispararía un soft
            // reboot real en vez de ejecutar nada.
            const pasteModeStarted = await this._waitForPasteModeStart(ReplPanel.PASTE_MODE_START_TIMEOUT_MS);
            if (!pasteModeStarted) {
                this._suppressEcho = false;
                this.simulator.qemuBridge?.interrupt(); // Ctrl+C -- nunca Ctrl+D acá
                return;
            }

            const lines = fullCode.split("\n");
            let stoppedEarly = false;

            for (let i = 0; i < lines.length; i++) {
                // Ver this._stopRequested en el constructor -- corta el
                // envío línea a línea apenas el usuario pide "Detener",
                // en vez de seguir mandando (al vacío, si ya se cerró
                // el WS) el resto de un bloque que ya no le importa a
                // nadie.
                if (this._stopRequested) { stoppedEarly = true; break; }
                await this._sleep(this._lineDelayMs(lines[i], marginMultiplier));
                if (!silent && i === halLineCount) {
                    // A partir de acá lo que se pega es código del
                    // usuario: dejamos de ocultar el eco.
                    this._suppressEcho = false;
                }
                this.simulator.eventBus.emit("qemu:send", lines[i] + "\n");
            }

            if (stoppedEarly) {
                // Ctrl+C (no Ctrl+D) -- cancela paste mode de una, sin
                // intentar ejecutar un bloque a medio mandar (eso solo
                // generaría un SyntaxError más, sin sentido si ya nadie
                // va a leer el resultado).
                this._suppressEcho = false;
                this.simulator.eventBus.emit("qemu:send", "\x03");
                return;
            }

            await this._sleep(ReplPanel.PASTE_LINE_DELAY_MS);
            this.simulator.eventBus.emit("qemu:send", "\x04"); // Ctrl+D: ejecutar

            // BUG REAL encontrado (reportado por el usuario: código
            // "oculto" -- el wrapper del HAL -- apareciendo crudo en
            // el panel): en un pegado SILENCIOSO (preloadHal, HAL
            // grande como el del LCD I2C con ~3KB de base64),
            // _suppressEcho se apagaba acá con un delay FIJO de solo
            // 20ms -- pero MicroPython todavía puede estar
            // ecoando/ejecutando el bloque (el checksum, el decode,
            // el exec real) bastante más de 20ms después de recibir
            // el Ctrl+D. La COLA de esa salida (las últimas líneas
            // del wrapper) llegaba DESPUÉS de que ya habíamos
            // destapado el eco -- se mostraba cruda, aunque el resto
            // del mismo pegado sí había quedado oculto.
            //
            // En un pegado NO silencioso (Ejecutar código del
            // usuario), _suppressEcho ya se destapó ANTES, a mitad
            // del loop de arriba (ver "!silent && i === halLineCount")
            // -- ahí este delay fijo sigue alcanzando, y esperar un
            // ">>>" real no serviría de nada si el código del usuario
            // es un "while True" infinito (nunca vuelve al prompt).
            if (silent) {
                await this._waitForNextPrompt(ReplPanel.PASTE_FINISH_TIMEOUT_MS);
            } else {
                await this._sleep(ReplPanel.PASTE_LINE_DELAY_MS);
            }

            this._suppressEcho = false;

        } finally {

            this.simulator.qemuBridge?.endPasteLock();

        }

    }


    // ====================================================
    // ¿Reconexión "en caliente" o firmware realmente recién
    // arrancado? Manda un solo print() interactivo (NO pasa por
    // _enqueuePaste/paste mode -- es un comando suelto, como si el
    // usuario lo tipeara a mano) preguntando si sys.modules ya tiene
    // "_pit_state" sembrado por una corrida anterior de _base_hal.py.
    //
    // ANTES se ocultaba con _suppressEcho (igual que el paste mode del
    // HAL) para que este comando de diagnóstico no ensuciara el panel
    // -- pero _suppressEcho tapa TODO lo que llegue mientras está
    // prendido, sin importar la fuente. Esto se manda apenas se abre
    // la conexión (ver "qemu:connected" en bindBusEvents), justo
    // cuando QEMU/MicroPython puede estar todavía imprimiendo su
    // propio banner de arranque real (rst:0x1, boot:0x12, "MicroPython
    // vX.Y.Z on ...") -- con _suppressEcho de por medio, esa salida
    // real se comía en silencio, sin ninguna forma de verla. Ahora en
    // vez de tapar todo, se deja pasar todo tal cual y solo se filtra
    // la línea puntual de ESTE print() de diagnóstico (ver
    // PROBE_MARK) en el filtro de "qemu:output" de bindBusEvents(),
    // igual que ya se filtran las líneas de protocolo (GPIO:/IN:/etc).
    //
    // PROBE_TIMEOUT_MS: tope de seguridad para _probeWarmBoot(). Si
    // no llega nada a tiempo (REPL trabado, desconexión rara, primera
    // vez que arranca todo el stack), se resuelve como "no" -- ni en
    // el peor caso esto deja al firmware SIN HAL: como mucho
    // repasteamos de más.
    //
    // Subido de 800ms a 2500ms (2026-08-02): 800ms resultó ser poco
    // margen para un viaje de ida y vuelta real sobre QEMU+GDB, sobre
    // todo viniendo justo después del propio Ctrl+C + 150ms de espera
    // que ya manda este mismo probe. La misma sonda-con-timeout, pero
    // para tipos con HAL congelado (_probeFrozenTypes()), se
    // terminó sacando del todo en vez de solo subirle el timeout --
    // ver el comentario grande cerca de _resyncHalAfterBoot() y
    // project_frozen_probe_timeout_fix.md en la memoria del proyecto.
    // ====================================================

    static PROBE_TIMEOUT_MS = 2500;
    static PROBE_MARK = "_PIT_WARM_";

    // Tope de seguridad para _waitForBridgeReady() -- ver ese método.
    // Un bridge viejo (build anterior a este fix, ej. un .exe que
    // alguien todavía no actualizó) nunca va a mandar la señal
    // "bridgeReady" -- sin este tope, esta espera colgaría para
    // siempre y el síntoma sería peor que el que vinimos a arreglar
    // (Ejecutar deshabilitado para siempre, en vez de "a veces"). Bien
    // por encima de lo que tarda GDB en adjuntarse en la práctica (unos
    // segundos), para no disparar en falso en una máquina lenta.
    static BRIDGE_READY_TIMEOUT_MS = 15000;

    // ====================================================
    // Espera a que el bridge avise que GDB ya terminó de adjuntarse y
    // el target REALMENTE volvió a ejecutar (ver el "\x00STATUS:" con
    // bridgeReady:true que manda server.js, y el comentario grande en
    // el constructor de QemuBridge). "conectado" (WebSocket abierto)
    // y "listo para hablar con MicroPython" NO son lo mismo -- sondear
    // antes de tiempo contra un CPU todavía pausado por GDB es lo que
    // causaba el repasteo completo de HAL innecesario reportado (ver
    // el comentario grande donde se llama a este método).
    // ====================================================

    _waitForBridgeReady() {

        const bridge = this.simulator.qemuBridge;

        if (!bridge || bridge.isWasmBridge || bridge.bridgeReady) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {

            let settled = false;

            const onReady = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.simulator.eventBus.off("qemu:bridge-ready", onReady);
                resolve();
            };

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                this.simulator.eventBus.off("qemu:bridge-ready", onReady);
                console.warn(
                    `[ReplPanel] No llegó la señal de "bridge listo" en ${ReplPanel.BRIDGE_READY_TIMEOUT_MS}ms -- ` +
                    "seguimos igual (puente de una build vieja, o GDB tardó más de lo esperado)."
                );
                resolve();
            }, ReplPanel.BRIDGE_READY_TIMEOUT_MS);

            this.simulator.eventBus.on("qemu:bridge-ready", onReady);

        });

    }

    // BUG REAL encontrado (reportado por el usuario: "el botón de
    // Ejecutar no se activa después de correr el simulador", pero SÍ
    // se activaba en cuanto pegaba el HAL de algún componente): esta
    // sonda antes mandaba el print() de diagnóstico DIRECTO, sin
    // interrumpir nada antes. Si la sesión anterior de QEMU había
    // quedado con un programa del usuario corriendo (ej. un
    // "while True" que no llegó a interrumpirse del todo antes de
    // que disconnectWs() cerrara el socket -- 100ms de margen no
    // siempre alcanza), el intérprete no está en su prompt
    // interactivo: el print() de la sonda cae en saco roto, nunca
    // hay respuesta, _probeWarmBoot() agota el timeout sin ver nunca
    // un ">>>" real, y _onReplReady() jamás se dispara -- el REPL/
    // Ejecutar quedan deshabilitados para siempre en esa conexión.
    // _pasteBlock() (el que SÍ manda HAL) ya mandaba Ctrl+C + una
    // pausa antes de su propio trabajo, por eso agregar un componente
    // "arreglaba" el síntoma -- no por casualidad, sino porque ESO
    // interrumpía el programa viejo. Ahora la sonda hace lo mismo:
    // Ctrl+C primero, para llegar a un prompt de verdad sin importar
    // en qué quedó la sesión anterior.
    // BUG REAL (reportado: repasteos gigantes de HAL -- cientos de
    // líneas, con IndentationError/SyntaxError en cadena -- pese a
    // que el firmware ya tiene el HAL congelado y _PIT_WARM_1 venía
    // saliendo bien en la mayoría de las reconexiones): confirmado con
    // un log real que el propio MENSAJE DEL SONDEO llegaba corrompido
    // de tanto en tanto ('print("_PIT_WARM" if ...' -- perdió
    // "_" + ("1" if "_pit_state" in __import__("sys").modules else "0"
    // adentro del envío, sin ningún Ctrl+C superpuesto de por medio).
    // La UART emulada de QEMU puede perder bytes bajo carga real
    // (documentado hace rato en server.js/writeToQemuThrottled, nunca
    // 100% eliminado solo con pacing) -- cuando le toca justo al
    // sondeo, _resyncHalAfterBoot() concluye "arranque frío" por error
    // y dispara el repasteo COMPLETO (cientos de líneas, sección 1 de
    // _buildPendingHal) -- un envío mucho más largo, con mucha más
    // superficie para que la MISMA corrupción vuelva a pegar, y en
    // cascada. Ya se probó envolver ese repasteo grande con el mismo
    // checksum que protege el HAL por componente (ver el comentario
    // "REVERTIDO" en _buildPendingHal()) y empeoró las cosas (base64
    // +33% de tamaño, los 4 bloques fallando juntos). La sonda en sí
    // es MUCHO más barata de reintentar que repastear todo -- si un
    // intento no responde a tiempo (nunca llegó nada reconocible, lo
    // más probable con esta corrupción puntual), reintentar un par de
    // veces ANTES de resignarse a "frío" evita pagar el repasteo caro
    // por una falla transitoria y chica.
    static PROBE_ATTEMPTS = 3;

    async _probeWarmBoot() {

        for (let attempt = 1; attempt <= ReplPanel.PROBE_ATTEMPTS; attempt++) {

            const result = await this._probeWarmBootOnce();

            if (result !== null) return result; // respuesta real (true/false), no hace falta reintentar

            if (attempt < ReplPanel.PROBE_ATTEMPTS) {
                console.warn(`[ReplPanel] Intento ${attempt}/${ReplPanel.PROBE_ATTEMPTS} del sondeo de arranque sin respuesta -- reintentando (probable corrupción puntual en la UART emulada).`);
            }

        }

        // BUG REAL, el más caro de toda esta saga (reportado otra vez
        // hoy, con un log real: 2+ MINUTOS antes de llegar siquiera a
        // mandar el código del usuario): después de agotar los
        // reintentos de arriba, esto asumía "boot frío" -- y un boot
        // "frío" dispara el repasteo COMPLETO de los 4 módulos
        // siempre presentes (_base/_i2c_bus/_adc_bus/_uart_bus,
        // CIENTOS de líneas) por paste mode, sin ningún checksum (ver
        // "REVERTIDO" en _buildPendingHal -- envolverlos con checksum
        // ya se probó y empeoró las cosas, por el tamaño). Ese
        // repasteo gigante, sin protección, es EXACTAMENTE la cascada
        // de IndentationError/SyntaxError que se ve una y otra vez en
        // una máquina con mucha corrupción -- mucha más superficie
        // para fallar que la sonda misma que la disparó.
        //
        // Pero este proyecto SIEMPRE compila su propio firmware con
        // esos 4 módulos CONGELADOS (ver firmware/frozen_hal/README.md
        // -- boot.py los importa incondicionalmente en CUALQUIER
        // boot, frío o tibio, sin que haga falta pastear nada). Si la
        // sonda no pudo confirmar nada (ni "sí" ni "no" -- silencio
        // total, la misma corrupción puntual de siempre), la razón
        // MÁS PROBABLE, por lejos, es que la sonda en sí se perdió en
        // tránsito, NO que este firmware particular sea uno viejo sin
        // el freeze. Asumir "tibio" (no pastear nada) es el default
        // seguro: si por algún motivo real el firmware NO los tiene
        // congelados, el código del usuario va a fallar con un
        // NameError claro y diagnosticable (ej. "machine.Pin" no
        // definido) -- mucho mejor que una cascada de minutos
        // reintentando un repasteo gigante sin checksum que la
        // mayoría de las veces ni hacía falta.
        console.warn(`[ReplPanel] El sondeo de arranque no respondió en ${ReplPanel.PROBE_ATTEMPTS} intentos -- asumiendo "tibio" (el HAL base de este proyecto siempre viaja congelado en el firmware, no hace falta pastearlo de nuevo).`);
        return true;

    }

    // ====================================================
    // Envío CONFIABLE del código del usuario: por PEDAZOS chicos,
    // confirmados uno por uno, en vez de un bloque gigante verificado
    // recién al final.
    //
    // HISTORIA (2026-10-01, con un script real de NeoMatrix -- arrays de
    // píxeles largos -- en una máquina real bajo carga normal):
    //   1. Detectar por SyntaxError/IndentationError -- corrupción
    //      silenciosa (código sintácticamente válido con un valor
    //      cualquiera) pasaba desapercibida.
    //   2. Checksum sobre el bloque ENTERO (mismo mecanismo que ya
    //      protege el HAL, ver _wrapHalForIsolation) -- detecta
    //      CUALQUIER pérdida con certeza, pero reintentar significa
    //      volver a mandar los ~2-3KB enteros de nuevo, con las MISMAS
    //      chances de corromperse otra vez. Confirmado en la práctica:
    //      6 reintentos completos del bloque entero, los 6 fallaron --
    //      "de nada sirve intentarlo 6 veces si en todas falla".
    //   3. Exigir confirmación POSITIVA (USER_CODE_OK_MARKER), no solo
    //      ausencia del marcador de corrupción -- una línea de CONTROL
    //      corrompida (no el payload) podía dejar todo en silencio, sin
    //      marcador de corrupción NI ejecución real, asumiendo éxito
    //      por error.
    //   4. ACTUAL: el mismo checksum, pero por PEDAZO chico (~200
    //      caracteres de base64), confirmado ANTES de mandar el
    //      siguiente. Un pedazo chico tiene mucha menos superficie para
    //      corromperse que el bloque entero, y reintentarlo es barato
    //      (unos pocos cientos de bytes, no 2-3KB) -- en vez de apostar
    //      todo a que el bloque GIGANTE llegue entero de una, cada
    //      pedazo se confirma por separado antes de seguir. Una vez
    //      confirmados TODOS los pedazos, un último paso arma y
    //      verifica el PAYLOAD COMPLETO (mismo checksum de siempre,
    //      como red de seguridad final) antes de ejecutar.
    // ====================================================

    static USER_CODE_CORRUPT_MARKER   = "USER_CODE_CORRUPT:";
    static USER_CODE_OK_MARKER        = "USER_CODE_OK:";
    static USER_CODE_CHUNK_OK_MARKER  = "UC_CHUNK_OK:";
    static USER_CODE_CHUNK_BAD_MARKER = "UC_CHUNK_BAD:";

    // Paste mode ecoa el código tal cual se pega, ANTES de ejecutar nada
    // -- si un marcador aparece completo, de corrido, en el propio texto
    // fuente (ej. `print("USER_CODE_CORRUPT:...")` como UN SOLO string
    // literal), el detector de corrupción lo confunde con el RESULTADO
    // real (BUG REAL, confirmado con un test directo: una tanda
    // perfecta, sin ninguna corrupción, agotaba igual todos los
    // reintentos). Por eso TODOS los marcadores de acá se arman en
    // runtime con dos strings de Python concatenados -- el texto PEGADO
    // nunca contiene el marcador completo de corrido, solo el RESULTADO
    // real de ejecutarlo lo arma.
    static _splitMarker(marker) {
        const mid = Math.ceil(marker.length / 2);
        return [marker.slice(0, mid), marker.slice(mid)];
    }

    // Caracteres de base64 (no bytes crudos) por pedazo -- chico a
    // propósito. Tunable: más chico = menos superficie de corrupción
    // por pedazo pero más vueltas de Ctrl+E...Ctrl+D (cada una con su
    // propio overhead fijo, ~150ms de Ctrl+C+asentamiento); más grande
    // = menos vueltas pero más parecido al problema original.
    static USER_CODE_CHUNK_B64_SIZE = 200;

    // Reintentos POR PEDAZO -- mucho más baratos que reintentar el
    // envío entero, así que se puede ser generoso. Confirmado con un
    // log real (máquina bajo carga pesada) que un mismo pedazo puede
    // corromperse 4 veces seguidas, cada vez de una forma distinta --
    // subido a 5 para darle un intento más de margen (con el margen
    // creciente de USER_CODE_CHUNK_MARGIN_STEP ya deberían alcanzar,
    // pero no cuesta nada tener uno de más).
    static USER_CODE_CHUNK_ATTEMPTS = 5;

    // Reintentos para el paso FINAL (armar + verificar + ejecutar) --
    // separado de los pedazos: si este paso falla, NO hay que volver a
    // mandar ningún pedazo (ya están confirmados y guardados en
    // _uc_parts del lado de MicroPython), solo repetir este bloque chico.
    static USER_CODE_FINAL_ATTEMPTS = 3;

    // Tope de espera por paso (pedazo o final) -- ver la lección de
    // USER_CODE_OK_MARKER: si no llega NINGÚN marcador (ni éxito ni
    // corrupción/mal) dentro de este margen, se trata como fallo del
    // paso, no como éxito por default -- silencio total (ej. una línea
    // de control corrompida de una forma que ni imprime error ni
    // ejecuta nada) es tan buena señal de "reintentá" como un marcador
    // explícito de corrupción.
    static USER_CODE_STEP_SETTLE_MS = 2500;

    // Tope de tiempo TOTAL para todo el envío (todos los pedazos + el
    // armado final) -- si algo anda mal con la conexión en general (no
    // con un pedazo puntual), cortar con un aviso claro en vez de
    // reintentar en silencio por minutos.
    //
    // BUG REAL probado contra el .exe real con el script largo de
    // NeoMatrix en una máquina con una tasa de corrupción muy alta:
    // con reintentos POR PEDAZO (baratos, el punto central de este
    // mecanismo) un envío de ~16 pedazos puede necesitar bastante más
    // de 75s en un caso realmente malo (confirmado: 10 pedazos ya
    // habían consumido ~79s). Subido a 180s -- el usuario pidió
    // explícitamente confiabilidad por sobre velocidad ("de nada sirve
    // intentarlo 6 veces si en todas falla, necesitamos que se
    // ejecute"), y cada reintento individual sigue siendo barato
    // (nunca se vuelve a mandar el payload entero) -- lo único que
    // compra este tope más alto es margen para que una conexión
    // realmente mala tenga tiempo de terminar en vez de cortar a mitad
    // de camino.
    static USER_CODE_SEND_TIME_BUDGET_MS = 180000;

    // ====================================================
    // Camino PRINCIPAL para mandar el código del usuario: "raw-paste",
    // el control de flujo REAL que MicroPython ya trae para links
    // lentos/no confiables (ver el comentario grande en
    // server.js/runRawPasteExec() para el protocolo completo). El
    // envío por pedazos chicos de más abajo (_sendUserCodeChunked)
    // queda como RESPALDO -- se usa solo si este firmware puntual no
    // soporta raw-paste (algunos builds viejos/recortados de
    // MicroPython no lo traen), nunca se borra.
    //
    // Por qué esto reemplaza al pacing calculado a mano
    // (SEND_CHUNK_SIZE/SEND_CHUNK_DELAY_MS en server.js): ese pacing
    // es una ESTIMACIÓN de cuánto va a tardar MicroPython en drenar
    // cada trozo -- confirmado en vivo, muchas veces esta sesión, que
    // en una máquina lenta/bajo carga ninguna estimación fija alcanza
    // siempre (el mismo pedazo de 200 bytes llegó a fallar 5 de 5
    // veces, con pacing hasta 3x más lento). Raw-paste no estima nada:
    // el DISPOSITIVO le dice al host cuánto espacio tiene ("window") y
    // manda una señal real ("\x01") recién cuando drena lo suficiente
    // como para aceptar más -- el host espera esa señal, nunca un
    // timer. Nunca hace falta pastear por partes ni reintentar un
    // pedazo puntual: raw-paste manda el PAYLOAD COMPLETO en una sola
    // operación, con control de flujo real de punta a punta.
    //
    // Ya NO hace falta correr el chequeo de "¿arrancó paste mode?" (ver
    // _waitForPasteModeStart() en _pasteBlock()) -- raw REPL no tiene
    // eco interactivo como el paste mode normal, así que no hay texto
    // humano que confundir. El checksum (USER_CODE_OK_MARKER/
    // USER_CODE_CORRUPT_MARKER, mismo mecanismo de siempre) se
    // mantiene igual como red de seguridad final -- raw-paste
    // garantiza que los BYTES llegaron, pero vale la pena seguir
    // verificando el CONTENIDO antes de ejecutarlo a ciegas.
    static USER_CODE_RAWPASTE_ATTEMPTS = 3;

    // Tope de espera para la respuesta de server.js a UN pedido de
    // raw-paste (ver QemuBridge.sendRawPasteRequest()/"qemu:rawpaste-result")
    // -- bien por encima de lo que tarda la negociación + envío real
    // (server.js ya tiene sus propios topes internos, más chicos, por
    // paso -- ver RAW_REPL_STEP_TIMEOUT_MS ahí), como red de
    // seguridad si el mensaje de resultado se perdiera por completo.
    static RAW_PASTE_RESULT_TIMEOUT_MS = 30000;

    // Arma el payload COMPLETO (base64 + checksum, mismo mecanismo que
    // ya protege al HAL) para mandar de una sola vez por raw-paste --
    // a diferencia de _buildUserCodeChunkBlock(), no hace falta
    // partirlo: raw-paste no tiene el problema de "mandar un bloque
    // gigante a ciegas" que motivó partirlo en primer lugar, porque
    // el control de flujo real evita que QEMU se sature sea cual sea
    // el tamaño.
    _buildRawPasteUserBlock(userCode) {

        const binaryStr = unescape(encodeURIComponent(userCode));
        const b64 = btoa(binaryStr);

        let checksum = 0;
        for (let i = 0; i < binaryStr.length; i++) {
            checksum = (checksum + binaryStr.charCodeAt(i)) % 65536;
        }
        const expectedLen = binaryStr.length;

        const [corruptPart1, corruptPart2] = ReplPanel._splitMarker(ReplPanel.USER_CODE_CORRUPT_MARKER);
        const [okPart1, okPart2]           = ReplPanel._splitMarker(ReplPanel.USER_CODE_OK_MARKER);

        return (
            `import ubinascii as _uc_iso\n` +
            `_uc_raw = """${b64}"""\n` +
            `_uc_joined = "".join(_uc_raw.split())\n` +
            `try:\n` +
            `    _uc_bytes = _uc_iso.a2b_base64(_uc_joined)\n` +
            `except Exception:\n` +
            `    _uc_bytes = b""\n` +
            `if len(_uc_bytes) != ${expectedLen} or sum(_uc_bytes) % 65536 != ${checksum}:\n` +
            `    print("${corruptPart1}" + ("${corruptPart2}len=%d sum=%d esperado_len=${expectedLen} esperado_sum=${checksum}" % (len(_uc_bytes), sum(_uc_bytes) % 65536)))\n` +
            `else:\n` +
            `    print("${okPart1}" + "${okPart2}")\n` +
            `    exec(_uc_bytes.decode(), globals())\n`
        );

    }

    // Manda UN pedido de raw-paste a server.js y espera SU resultado
    // (ver QemuBridge.sendRawPasteRequest()/"qemu:rawpaste-result") --
    // toda la negociación byte a byte vive en server.js (ver el
    // comentario grande junto a runRawPasteExec() ahí), acá solo se
    // espera la respuesta. Devuelve { ok, reason? } tal cual lo manda
    // el servidor, o { ok:false, reason:"no_result"/"not_connected" }
    // si nunca llegó nada.
    _sendRawPasteExec(code) {

        return new Promise((resolve) => {

            let settled = false;

            const onResult = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.simulator.eventBus.off("qemu:rawpaste-result", onResult);
                resolve(result);
            };

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                this.simulator.eventBus.off("qemu:rawpaste-result", onResult);
                resolve({ ok: false, reason: "no_result" });
            }, ReplPanel.RAW_PASTE_RESULT_TIMEOUT_MS);

            this.simulator.eventBus.on("qemu:rawpaste-result", onResult);

            const sent = this.simulator.qemuBridge?.sendRawPasteRequest(code);
            if (!sent) onResult({ ok: false, reason: "not_connected" });

        });

    }

    // Manda el código del usuario por raw-paste -- si ESTE firmware
    // puntual no lo soporta (señal explícita "R\x00", ver
    // runRawPasteExec() en server.js), cae una sola vez al envío por
    // pedazos de siempre y se acuerda para el resto de esta conexión
    // (this._rawPasteUnsupported, ver el constructor) para no perder
    // tiempo reintentando una negociación que ya sabemos que va a
    // fallar. Cualquier OTRO fallo (timeout puntual, el dispositivo
    // abortó a mitad de camino) reintenta el envío COMPLETO -- sigue
    // siendo barato porque raw-paste nunca tuvo que partirlo en
    // pedazos.
    // Motivos de fallo durante la NEGOCIACIÓN (antes de que un solo
    // byte de datos llegue a viajar) -- reintentar el envío COMPLETO
    // ante estos no tiene sentido: si Ctrl+A no hizo entrar a raw
    // REPL la primera vez, no lo va a hacer la segunda. Confirmado en
    // vivo contra el firmware real de este proyecto: "no_raw_repl" en
    // una conexión totalmente limpia (sin ninguna corrupción de por
    // medio) -- este firmware puntual (compilado a medida para la
    // integración con el puente GDB/GPIO) no responde al Ctrl+A
    // estándar de MicroPython. Se trata igual que la señal explícita
    // "raw_paste_unsupported" -- cae al respaldo DE UNA, sin gastar
    // los 3 intentos completos (serían ~24s perdidos antes de llegar
    // al mismo resultado). Reservado para DESPUÉS de la negociación
    // (datos ya en vuelo, algo salió mal a mitad de camino):
    // "device_aborted_or_timeout"/"no_eot_ack" -- esos SÍ vale la pena
    // reintentar, porque ya sabemos que raw-paste funciona en esta
    // conexión.
    static RAW_PASTE_NEGOTIATION_FAILURES = new Set([
        "no_process", "not_connected", "no_result",
        "no_raw_repl", "no_response", "raw_paste_unsupported",
        "unexpected_header", "no_window", "bad_window",
    ]);

    async _sendUserCodeViaRawPaste(userCode) {

        if (this._rawPasteUnsupported) {
            await this._sendUserCodeChunked(userCode);
            return;
        }

        const block = this._buildRawPasteUserBlock(userCode);
        let fellBackUnsupported = false;

        this.simulator.qemuBridge?.beginPasteLock();

        try {

            for (let attempt = 1; attempt <= ReplPanel.USER_CODE_RAWPASTE_ATTEMPTS; attempt++) {

                if (this._stopRequested) return;

                if (attempt > 1) {
                    this.appendOutput(
                        `\n⚠️ Posible error de transmisión -- reintentando (${attempt}/${ReplPanel.USER_CODE_RAWPASTE_ATTEMPTS})...\n`,
                        "repl-info"
                    );
                }

                let okSeen = false;
                let badSeen = false;
                let markerSeenEarly = () => {};
                const markerSeenPromise = new Promise((resolve) => { markerSeenEarly = resolve; });

                const check = (text) => {
                    if (!text) return;
                    if (text.includes(ReplPanel.USER_CODE_OK_MARKER))      { okSeen  = true; markerSeenEarly(); }
                    if (text.includes(ReplPanel.USER_CODE_CORRUPT_MARKER)) { badSeen = true; markerSeenEarly(); }
                };
                this.simulator.eventBus.on("qemu:output", check);
                this.simulator.eventBus.on("qemu:history", check);

                let result;
                try {
                    result = await this._sendRawPasteExec(block);
                    if (result.ok) {
                        // Los bytes YA llegaron (raw-paste lo
                        // confirma) -- esto solo espera el veredicto
                        // del checksum (la red de seguridad final),
                        // no la entrega en sí.
                        await Promise.race([
                            this._waitForNextPrompt(ReplPanel.USER_CODE_STEP_SETTLE_MS),
                            markerSeenPromise,
                        ]);
                    }
                } finally {
                    this.simulator.eventBus.off("qemu:output", check);
                    this.simulator.eventBus.off("qemu:history", check);
                }

                if (ReplPanel.RAW_PASTE_NEGOTIATION_FAILURES.has(result.reason)) {
                    fellBackUnsupported = true;
                    this._rawPasteUnsupported = true;
                    break;
                }

                if (result.ok && okSeen && !badSeen) return; // éxito confirmado de punta a punta

            }

        } finally {
            this.simulator.qemuBridge?.endPasteLock();
        }

        if (this._stopRequested) return;

        this.appendOutput(
            fellBackUnsupported
                ? "\n⏳ Este firmware no soporta el envío rápido y confiable (raw-paste) -- usando el envío por pedazos de siempre.\n"
                : `\n⚠️ El envío rápido falló ${ReplPanel.USER_CODE_RAWPASTE_ATTEMPTS} veces seguidas -- probando el envío por pedazos como respaldo.\n`,
            "repl-info"
        );

        await this._sendUserCodeChunked(userCode);

    }

    // BUG REAL encontrado probando esto contra el .exe real: un pedazo
    // de ~200 caracteres puede corromperse VARIAS VECES SEGUIDAS al
    // mismo ritmo (confirmado con un log real: el mismo pedazo falló 4
    // veces de 4, cada vez de una forma distinta -- comillas cortadas,
    // nombre de variable truncado, un byte cambiado) -- reintentar
    // EXACTAMENTE al mismo ritmo que ya falló no le da ninguna ventaja
    // extra a la UART emulada (misma lección que ya se había aprendido
    // y se había sacado sin querer al simplificar esto para pedazos
    // chicos). Mismo esquema de antes: más margen en cada reintento
    // sucesivo, tope en 3x.
    static USER_CODE_CHUNK_MARGIN_STEP = 0.5;
    static USER_CODE_CHUNK_MARGIN_MAX  = 3;

    // Arma el bloque de UN pedazo del payload -- isFirst agrega el
    // preámbulo (import + lista vacía). Mismo truco que
    // _wrapHalForIsolation() para el contenido (base64 +
    // _breakRepeatedPatterns + ancho fijo dentro de un string
    // triple-comillado).
    //
    // BUG REAL, grave, encontrado en vivo (reportado: un script CORTO
    // -- 5 pedazos -- fallaba con el checksum final mostrando SIEMPRE
    // ~150 bytes MÁS de los esperados, justo el tamaño de UN pedazo):
    // `_uc_parts.append(_uc_c)` no es idempotente. Si la confirmación
    // real de un pedazo (el "UC_CHUNK_OK:N" que imprime MicroPython)
    // llega justo DESPUÉS de que _sendStepAndConfirm() ya se haya
    // rendido por el tope de espera (ver USER_CODE_STEP_SETTLE_MS) --
    // perfectamente posible en una máquina lenta -- el código concluye
    // (mal) "hay que reintentar este pedazo" aunque YA se había
    // appendeado del otro lado. El reintento vuelve a mandar el MISMO
    // pedazo, que YA pasa su propio checksum (el contenido nunca
    // estuvo corrompido, solo la CONFIRMACIÓN llegó tarde) -- `.append()`
    // lo agrega una SEGUNDA vez, duplicando ese pedazo en el payload
    // final. Fix: en vez de `.append()` (nunca seguro de reintentar),
    // cada pedazo escribe su PROPIO índice fijo en una lista ya armada
    // del tamaño total (`_uc_parts[N] = _uc_c`) -- reintentar el mismo
    // índice las veces que haga falta siempre pisa el mismo lugar,
    // nunca duplica nada.
    _buildUserCodeChunkBlock(chunkB64, index, isFirst, totalChunks) {

        const chunkBroken = ReplPanel._breakRepeatedPatterns(chunkB64);
        const width = ReplPanel.HAL_B64_LINE_WIDTH;
        const chunkLines = [];
        for (let i = 0; i < chunkBroken.length; i += width) {
            chunkLines.push(chunkBroken.slice(i, i + width));
        }
        const chunkBlock = chunkLines.join("\n");

        let chunkChecksum = 0;
        for (let i = 0; i < chunkB64.length; i++) {
            chunkChecksum = (chunkChecksum + chunkB64.charCodeAt(i)) % 65536;
        }

        const [badPart1, badPart2] = ReplPanel._splitMarker(ReplPanel.USER_CODE_CHUNK_BAD_MARKER);
        const [okPart1, okPart2]   = ReplPanel._splitMarker(ReplPanel.USER_CODE_CHUNK_OK_MARKER);

        return (
            (isFirst ? `import ubinascii as _uc_iso\n_uc_parts = [""] * ${totalChunks}\n` : ``) +
            `_uc_c_raw = """` + chunkBlock + `"""\n` +
            `_uc_c = "".join(_uc_c_raw.split())\n` +
            `if len(_uc_c) != ${chunkB64.length} or sum(_uc_c.encode()) % 65536 != ${chunkChecksum}:\n` +
            `    print("${badPart1}" + ("${badPart2}%d" % ${index}))\n` +
            `else:\n` +
            `    _uc_parts[${index}] = _uc_c\n` +
            `    print("${okPart1}" + ("${okPart2}%d" % ${index}))\n`
        );

    }

    // Arma el bloque FINAL: junta todos los pedazos ya confirmados,
    // verifica el checksum del payload COMPLETO (red de seguridad
    // final, mismo mecanismo de siempre) y recién ahí ejecuta. También
    // devuelve el índice de la línea "exec(...)" -- _pasteBlock()
    // oculta el eco hasta esa línea, así la salida real del programa se
    // ve apenas arranca (sin esperar a que vuelva un prompt que un
    // "while True:" nunca va a dar).
    //
    // REVERTIDO (2026-10-03) -- esta sesión probó proteger también la
    // línea literal "exec(_uc_bytes.decode(), globals())" (que puede
    // corromperse en silencio, viajando sin checksum propio) con una
    // "colita" en base64. Encontré y corregí 2 bugs reales de esa
    // protección (checksum calculado sobre la capa equivocada,
    // indentación anidada de más), pero el usuario reportó en vivo que
    // el resultado NETO seguía siendo peor que antes: más líneas, más
    // indentación, más reintentos "en el paso final" de los que había
    // antes de tocar nada -- en una transmisión ya al límite, CUALQUIER
    // byte extra importa. El caso que esa protección cubría (un AttributeError
    // confuso en vez de un reintento limpio) es raro y menos grave que
    // la regresión real y reproducible de "ahora falla más seguido".
    // Vuelto al diseño simple de siempre: un solo nivel de indentación,
    // el mínimo de líneas posible. Si el AttributeError raro vuelve a
    // aparecer, al menos ahora se sabe exactamente qué lo causa (ver
    // el historial de este archivo en git, commits e7d4a55/75cb997).
    _buildUserCodeFinalBlock(expectedLen, checksum) {

        const [corruptPart1, corruptPart2] = ReplPanel._splitMarker(ReplPanel.USER_CODE_CORRUPT_MARKER);
        const [okPart1, okPart2]           = ReplPanel._splitMarker(ReplPanel.USER_CODE_OK_MARKER);

        const lines = [
            `_uc_joined = "".join(_uc_parts)`,
            `try:`,
            `    _uc_bytes = _uc_iso.a2b_base64(_uc_joined)`,
            `except Exception:`,
            `    _uc_bytes = b""`,
            `if len(_uc_bytes) != ${expectedLen} or sum(_uc_bytes) % 65536 != ${checksum}:`,
            `    print("${corruptPart1}" + ("${corruptPart2}len=%d sum=%d esperado_len=${expectedLen} esperado_sum=${checksum}" % (len(_uc_bytes), sum(_uc_bytes) % 65536)))`,
            `else:`,
            `    print("${okPart1}" + "${okPart2}")`,
            `    exec(_uc_bytes.decode(), globals())`,
        ];

        return { block: lines.join("\n") + "\n", execLineIndex: lines.length - 1 };

    }

    // Manda UN paso (un pedazo, o el bloque final) y espera su
    // confirmación -- busca okMarker/badMarker en "qemu:output" Y
    // "qemu:history" (una reconexión a mitad de envío puede hacer
    // llegar la respuesta por el canal de historial, no en vivo -- ver
    // QemuBridge/"\x00HISTORY:"), y NO asume éxito si no ve NINGUNO de
    // los dos dentro del margen -- silencio total se trata como fallo,
    // igual que una corrupción explícita (ver USER_CODE_STEP_SETTLE_MS).
    // Devuelve true (confirmado, sin corrupción) / false (hay que
    // reintentar este mismo paso).
    async _sendStepAndConfirm(block, { silent, halLineCount, okMarker, badMarker, marginMultiplier = 1 }) {

        let okSeen = false;
        let badSeen = false;

        let markerSeenEarly = () => {};
        const markerSeenPromise = new Promise((resolve) => { markerSeenEarly = resolve; });

        const check = (text) => {
            if (!text) return;
            if (text.includes(okMarker))  { okSeen = true; markerSeenEarly(); }
            if (text.includes(badMarker)) { badSeen = true; markerSeenEarly(); }
        };
        this.simulator.eventBus.on("qemu:output", check);
        this.simulator.eventBus.on("qemu:history", check);

        try {
            await this._pasteBlock(block, halLineCount, { silent, marginMultiplier });
            await Promise.race([
                this._waitForNextPrompt(Math.round(ReplPanel.USER_CODE_STEP_SETTLE_MS * marginMultiplier)),
                markerSeenPromise,
            ]);
        } finally {
            this.simulator.eventBus.off("qemu:output", check);
            this.simulator.eventBus.off("qemu:history", check);
        }

        return okSeen && !badSeen;

    }

    // Manda el código del usuario COMPLETO: por pedazos chicos
    // confirmados uno por uno, y recién al final un armado+verificación
    // del payload entero antes de ejecutar -- ver el comentario grande
    // más arriba para la historia completa de por qué.
    async _sendUserCodeChunked(userCode) {

        const binaryStr = unescape(encodeURIComponent(userCode));
        const b64 = btoa(binaryStr);

        let checksum = 0;
        for (let i = 0; i < binaryStr.length; i++) {
            checksum = (checksum + binaryStr.charCodeAt(i)) % 65536;
        }
        const expectedLen = binaryStr.length;

        const chunkSize = ReplPanel.USER_CODE_CHUNK_B64_SIZE;
        const chunks = [];
        for (let i = 0; i < b64.length; i += chunkSize) {
            chunks.push(b64.slice(i, i + chunkSize));
        }
        if (chunks.length === 0) chunks.push(""); // código vacío -- igual hace falta el paso final (_uc_parts = [])

        // Aviso de progreso -- sin esto, un script largo (muchos
        // pedazos, cada uno silencioso si sale bien a la primera) no
        // muestra NADA en el panel hasta terminar, indistinguible de un
        // cuelgue real (mismo motivo que el aviso de "esto puede
        // tardar" del lado WASM). Solo para scripts que de verdad
        // tardan varios pedazos -- no tiene sentido para uno chico.
        if (chunks.length > 3) {
            this.appendOutput(
                `\n⏳ Mandando tu código en ${chunks.length} pedazos chicos (más confiable que uno solo gigante)...\n`,
                "repl-info"
            );
        }

        const startedAt = Date.now();

        const withinTimeBudget = () => {
            if (Date.now() - startedAt <= ReplPanel.USER_CODE_SEND_TIME_BUDGET_MS) return true;
            this.appendOutput(
                `\n⚠️ "Ejecutar" lleva más de ${Math.round(ReplPanel.USER_CODE_SEND_TIME_BUDGET_MS / 1000)}s reintentando -- ` +
                `algo anda mal con la conexión (no es tu código). Probá "⏹ Detener" y "▶ Simular" de nuevo.\n`,
                "repl-error"
            );
            return false;
        };

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {

            const isFirst = chunkIndex === 0;
            let confirmed = false;

            for (let attempt = 1; attempt <= ReplPanel.USER_CODE_CHUNK_ATTEMPTS; attempt++) {

                if (this._stopRequested) return;
                if (!withinTimeBudget()) return;

                if (attempt > 1) {
                    this.appendOutput(
                        `\n⚠️ Posible error de transmisión -- reintentando pedazo ${chunkIndex + 1}/${chunks.length} ` +
                        `(intento ${attempt}/${ReplPanel.USER_CODE_CHUNK_ATTEMPTS})...\n`,
                        "repl-info"
                    );
                }

                const block = this._sanitizeForSerial(this._buildUserCodeChunkBlock(chunks[chunkIndex], chunkIndex, isFirst, chunks.length));

                // Ver USER_CODE_CHUNK_MARGIN_STEP/_MAX -- más margen en
                // cada reintento sucesivo de ESTE pedazo puntual.
                const marginMultiplier = Math.min(
                    ReplPanel.USER_CODE_CHUNK_MARGIN_MAX,
                    1 + (attempt - 1) * ReplPanel.USER_CODE_CHUNK_MARGIN_STEP
                );

                confirmed = await this._sendStepAndConfirm(block, {
                    silent: true,
                    halLineCount: 0,
                    okMarker: ReplPanel.USER_CODE_CHUNK_OK_MARKER,
                    badMarker: ReplPanel.USER_CODE_CHUNK_BAD_MARKER,
                    marginMultiplier,
                });

                if (confirmed) break;

            }

            if (!confirmed) {
                this.appendOutput(
                    `\n⚠️ No se pudo mandar el código de forma confiable (el pedazo ${chunkIndex + 1}/${chunks.length} ` +
                    `falló ${ReplPanel.USER_CODE_CHUNK_ATTEMPTS} veces seguidas) -- probá "⏹ Detener" y "▶ Simular" de nuevo.\n`,
                    "repl-error"
                );
                return;
            }

            // Latido de progreso cada 5 pedazos -- para un envío largo
            // SIN ningún problema de transmisión (ninguna de las líneas
            // de arriba se imprime), el panel se quedaría mudo hasta el
            // final, indistinguible de un cuelgue real.
            if (chunks.length > 5 && (chunkIndex + 1) % 5 === 0 && chunkIndex + 1 < chunks.length) {
                this.appendOutput(`   (pedazo ${chunkIndex + 1}/${chunks.length} confirmado)\n`, "repl-info");
            }

        }

        // Todos los pedazos confirmados y guardados en _uc_parts (del
        // lado de MicroPython) -- último paso: armar el payload
        // completo, verificarlo (red de seguridad final) y ejecutar. Si
        // ESTE paso falla, se reintenta SOLO ESTE bloque chico -- nunca
        // hay que volver a mandar ningún pedazo.
        for (let attempt = 1; attempt <= ReplPanel.USER_CODE_FINAL_ATTEMPTS; attempt++) {

            if (this._stopRequested) return;
            if (!withinTimeBudget()) return;

            if (attempt > 1) {
                this.appendOutput(
                    `\n⚠️ Posible error de transmisión en el paso final -- reintentando (${attempt}/${ReplPanel.USER_CODE_FINAL_ATTEMPTS})...\n`,
                    "repl-info"
                );
            }

            const { block, execLineIndex } = this._buildUserCodeFinalBlock(expectedLen, checksum);

            const marginMultiplier = Math.min(
                ReplPanel.USER_CODE_CHUNK_MARGIN_MAX,
                1 + (attempt - 1) * ReplPanel.USER_CODE_CHUNK_MARGIN_STEP
            );

            const confirmed = await this._sendStepAndConfirm(this._sanitizeForSerial(block), {
                silent: false,
                halLineCount: execLineIndex,
                okMarker: ReplPanel.USER_CODE_OK_MARKER,
                badMarker: ReplPanel.USER_CODE_CORRUPT_MARKER,
                marginMultiplier,
            });

            if (confirmed) return;

        }

        this.appendOutput(
            `\n⚠️ El paso final (verificar y correr tu código) falló ${ReplPanel.USER_CODE_FINAL_ATTEMPTS} veces seguidas -- ` +
            `probá "⏹ Detener" y "▶ Simular" de nuevo.\n`,
            "repl-error"
        );

    }

    // Un solo intento del sondeo -- devuelve true/false si llegó una
    // respuesta real, o null si agotó el timeout sin ver nada
    // reconocible (señal de "reintentá", no "es un boot frío" --
    // ver _probeWarmBoot() arriba).
    async _probeWarmBootOnce() {

        // BUG REAL encontrado (2026-07-31, reportado como "después de
        // Detener y volver a Simular, el REPL/editor ya no responde"):
        // este Ctrl+C se mandaba con eventBus.emit("qemu:send", "\x03")
        // -> QemuBridge._sendImmediate(), que le agrega "\r\n" a
        // cualquier texto que no termine en salto de línea -- "\x03"
        // se convertía en "\x03\r\n" (3 bytes), y server.js SOLO manda
        // directo a stdin (bypaseando su cola con pausa entre trozos)
        // los mensajes de UN byte exacto que sean 0x03/0x04 (ver
        // ws.on("message") en server.js). Al dejar de calificar para
        // ese bypass, este Ctrl+C cae en la MISMA cola lenta que
        // cualquier paste normal -- si la sesión anterior dejó algo
        // sin drenar del todo (ej. el reset de disconnectWs() no
        // alcanzó a interrumpir un "while True" a tiempo), este
        // segundo intento de interrumpir queda haciendo fila DETRÁS
        // de eso en vez de cortarlo YA, la sonda nunca ve un ">>>"
        // real, _onReplReady() nunca se dispara, y el input/Ejecutar
        // quedan deshabilitados para siempre en esa conexión -- el
        // síntoma exacto reportado. QemuBridge.interrupt() manda el
        // byte crudo de un solo golpe (this.ws.send("\x03") directo,
        // sin pasar por _sendImmediate), preservando el bypass real.
        this.simulator.qemuBridge?.interrupt();
        await this._sleep(150);

        return new Promise((resolve) => {

            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                this._warmProbe = null;
                // Diagnóstico para la próxima vez que esto se sospeche
                // de nuevo (ver PROBE_TIMEOUT_MS más arriba, ronda
                // 2026-08-02) -- si esto se ve seguido en la consola,
                // confirma que el timeout sigue siendo insuficiente.
                console.warn(`[ReplPanel] _probeWarmBootOnce() no respondió en ${ReplPanel.PROBE_TIMEOUT_MS}ms.`);
                resolve(null);
            }, ReplPanel.PROBE_TIMEOUT_MS);

            this._warmProbe = (isWarm) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(isWarm);
            };

            this.simulator.eventBus.emit(
                "qemu:send",
                `print("${ReplPanel.PROBE_MARK}" + ("1" if "_pit_state" in __import__("sys").modules else "0"))`
            );

        });

    }

    // ====================================================
    // _probeFrozenTypes() (sonda en vivo "¿qué tipos tenés
    // congelados?") se QUITÓ (2026-08-02) -- tenía una carrera real
    // con su propio timeout (ver project_frozen_probe_timeout_fix.md
    // en la memoria del proyecto: con TM1637 primero y lcd_16x2_i2c
    // después, la respuesta llegaba bien pero después de que el
    // timeout ya había resuelto con un Set vacío, degradando TODA la
    // conexión al paste completo aunque el firmware sí tuviera tipos
    // congelados). Reemplazada por la lista ESTÁTICA generada en
    // tiempo de build (PIT_FROZEN_HAL_TYPES, ver
    // js/simulator/FrozenHalTypes.js y _resyncHalAfterBoot() más
    // arriba) + fallback automático al paste completo si el import
    // falla de verdad (ver el listener de "qemu:hal-error").
    // ====================================================

    // ====================================================
    // Esperar a que aparezca un ">>>" real en la salida cruda -- ver
    // _pasteBlock() (rama "silent"). Igual que _warmProbe, el chequeo
    // vive en el listener de "qemu:output" de bindBusEvents(), ANTES
    // del "if (this._suppressEcho) return;" -- tiene que poder
    // detectar el prompt mientras el eco sigue oculto, que es
    // exactamente el estado en el que se usa esto.
    // ====================================================

    _waitForNextPrompt(timeoutMs) {

        return new Promise((resolve) => {

            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                this._promptWatcher = null;
                resolve(false);
            }, timeoutMs);

            this._promptWatcher = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(true);
            };

        });

    }

    // BUG REAL, severo, encontrado probando _sendUserCodeChunked() de
    // punta a punta con muchos pedazos chicos en una máquina con una
    // tasa de corrupción muy alta: _pasteBlock() mandaba Ctrl+E y
    // asumía (con un sleep fijo de 150ms, pensado para el Ctrl+C
    // ANTERIOR, no para esto) que paste mode ya había arrancado antes
    // de empezar a mandar líneas. Con UN SOLO pegado grande, perder el
    // byte de Ctrl+E era raro y, aunque pasara, el checksum lo
    // detectaba al final igual. Con DECENAS de pegados chicos
    // seguidos (un Ctrl+E por pedazo), las chances de perder ESE byte
    // puntual en AL MENOS uno se multiplican -- y cuando pasa, cada
    // línea del pedazo se tipea SUELTA en el prompt normal
    // (IndentationError/SyntaxError en cascada), y el Ctrl+D final
    // -- que debería terminar paste mode -- cae en el prompt
    // interactivo normal y dispara un SOFT REBOOT real del firmware
    // (confirmado en un log real: "MPY: soft reboot" repetido),
    // borrando TODO lo acumulado en _uc_parts hasta ese momento.
    //
    // Ahora _pasteBlock() confirma que paste mode arrancó de verdad
    // (ve "paste mode;" o "=== " en la salida) ANTES de mandar una sola
    // línea del cuerpo -- si no lo confirma a tiempo, cancela con
    // Ctrl+C (nunca con Ctrl+D) y no manda nada más, dejando que el
    // llamador reintente desde cero (ver _sendStepAndConfirm: ningún
    // marcador de éxito/mal llega, silencio total, mismo criterio de
    // "silencio = hay que reintentar" ya usado en todos lados).
    static PASTE_MODE_START_TIMEOUT_MS = 1500;

    _waitForPasteModeStart(timeoutMs) {

        return new Promise((resolve) => {

            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                this._pasteModeWatcher = null;
                resolve(false);
            }, timeoutMs);

            this._pasteModeWatcher = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(true);
            };

        });

    }

    // ====================================================
    // Precargar el HAL pendiente en segundo plano, apenas se
    // conecta a QEMU -- así, cuando el usuario le da "Ejecutar" más
    // tarde, ya no hay que esperar los ~60ms/línea del HAL (que
    // puede ser bastante largo con varios componentes en el
    // canvas): solo se manda su propio código, que suele ser mucho
    // más corto.
    //
    // Completamente silenciosa -- no se ve nada en el panel, ni
    // "Ejecutando...", ni el eco del paste mode.
    // ====================================================

    // ====================================================
    // Decidir qué HAL hace falta (re)pastear después de que el
    // intérprete arrancó -- sea por una conexión WS nueva o por un
    // soft reboot (Ctrl+D en el prompt, que reinicia MicroPython sin
    // cerrar la conexión) -- y precargarlo. Compartido por ambos
    // casos (ver "qemu:connected" y el detector de "MPY: soft reboot"
    // en bindBusEvents) para que los dos apliquen EXACTAMENTE la
    // misma lógica -- antes el de soft reboot vaciaba
    // _halSentToFirmware a ciegas (incluidos _base/_i2c_bus/_adc_bus/
    // _uart_bus) y volvía a mandar TODO por paste mode, aunque el
    // firmware ya los tuviera CONGELADOS (ver firmware/frozen_hal/
    // boot.py) y se recargaran solos en cada boot sin que hiciera
    // falta pastear nada -- un repasteo grande e innecesario, que
    // además corría el riesgo real de chocar con un segundo click de
    // "↺ Soft Reset" del usuario a mitad de camino (ver el comentario
    // grande en el detector de soft reboot).
    //
    // _probeWarmBoot() manda un solo comando de REPL (sin paste mode)
    // que pregunta si "_pit_state" ya está en sys.modules -- eso es
    // justo lo que deja sembrado _base.hal.py (pegado o congelado, da
    // igual) apenas corre una vez. Si dice que SÍ, los 4 "siempre
    // presentes" ya están activos -- se marcan como enviados sin
    // pastear nada. Si dice que NO (o no responde a tiempo), se
    // asume que hace falta pastearlos de cero, igual que un arranque
    // realmente frío.
    // ====================================================

    async _resyncHalAfterBoot() {

        const warmBoot = await this._probeWarmBoot();

        // En AMBOS casos hay que olvidar qué HAL "por componente" se
        // había mandado antes -- un reboot (frío o "tibio") borra
        // todo el estado de Python que no esté congelado en boot.py,
        // y ahí SOLO viven _base/_i2c_bus/_adc_bus/_uart_bus
        // (ALWAYS_HAL_TYPES). El HAL propio de cada componente
        // (lcd_16x2_i2c.hal.py, l298n.hal.py, etc.) nunca está
        // congelado, así que sigue perdido después de un soft
        // reboot aunque warmBoot haya dado true -- si acá solo
        // agregábamos ALWAYS_HAL_TYPES sin tocar el resto del Set,
        // preloadHal() los seguía viendo como "ya enviados" y nunca
        // los volvía a pastear (bug real: tras un soft reset, los
        // componentes con hal.py propio quedaban sin su driver).
        this._halRetryCounts = {};

        if (!warmBoot) {
            this._halSentToFirmware.clear();
        } else {
            this._halSentToFirmware = new Set(ReplPanel.ALWAYS_HAL_TYPES);
        }

        // Qué tipos de componente PODRÍAN estar congelados en el
        // firmware conectado -- ya NO se le pregunta al firmware en
        // vivo (esto sondeaba con un print() + timeout de 800ms,
        // encontrado con una carrera real: si la respuesta tardaba
        // más que el timeout -- nada raro sobre QEMU+GDB, sobre todo
        // justo después de la sonda de warm-boot -- este Set quedaba
        // vacío para TODA la conexión aunque el firmware sí tuviera
        // el tipo congelado, ver project_frozen_probe_timeout_fix.md
        // en la memoria del proyecto). Ahora se parte de la lista
        // ESTÁTICA generada en tiempo de build (PIT_FROZEN_HAL_TYPES,
        // ver js/simulator/FrozenHalTypes.js) -- se intenta el import
        // rápido de una, sin esperar ningún viaje de ida y vuelta. Si
        // el firmware conectado resulta ser más viejo y en realidad
        // NO tiene ese tipo congelado, el import falla con un
        // HAL_ERROR normal y el listener de "qemu:hal-error" (más
        // abajo) saca ese tipo puntual de este Set, así el reintento
        // automático cae solo al paste completo -- ver ese listener.
        this._frozenHalTypes = new Set(
            typeof PIT_FROZEN_HAL_TYPES !== "undefined" ? PIT_FROZEN_HAL_TYPES : []
        );

        await this.preloadHal();

    }

    // ====================================================
    // Igual que _resyncHalAfterBoot(), pero para el caso puntual de
    // un SOFT REBOOT (Ctrl+D en el prompt) -- ver el comentario
    // grande en bindBusEvents(), rama "MPY: soft reboot", sobre por
    // qué hace falta este paso extra acá y no alcanza con llamar
    // directo a _resyncHalAfterBoot(): boot.py (donde vive el HAL
    // congelado, si el firmware lo tiene) recién EMPIEZA a correr
    // cuando aparece el texto "MPY: soft reboot" -- el Ctrl+C que
    // manda _probeWarmBoot() lo interrumpiría a mitad de camino. Acá
    // se espera (sin mandar nada) a que el propio reinicio termine
    // solo y vuelva a un prompt ocioso de verdad, y RECIÉN AHÍ se
    // corre la sonda -- en ese momento su Ctrl+C ya es inofensivo.
    // ====================================================

    async _resyncAfterSoftReboot() {

        await this._waitForNextPrompt(ReplPanel.PASTE_FINISH_TIMEOUT_MS);
        await this._resyncHalAfterBoot();

    }

    async preloadHal() {

        const { halBlock, newlySent, hasPending } = await this._buildPendingHal();

        if (!hasPending) return;

        // Marcar ACÁ (optimista, antes de mandar de verdad) para que
        // si el usuario le da "Ejecutar" mientras esto todavía está
        // en la cola, _assembleCode() no vuelva a incluir el mismo
        // HAL una segunda vez.
        newlySent.forEach(type => {
            this._halSentToFirmware.add(type);
            delete this._halRetryCounts[type]; // exito -- si vuelve a fallar mas adelante, cuenta de nuevo desde 0
        });

        if (this.simulator.qemuBridge?.isWasmBridge) {
            // Mismo motivo que en runEditorCode(): no hay paste mode
            // acá, se manda directo. Sin esta rama, un componente ya
            // en el lienzo AL CONECTAR (ej. DHT11) nunca recibía su
            // .hal.py hasta el primer "Ejecutar" -- cualquier valor
            // empujado desde el panel ANTES de eso (slider de
            // temperatura, etc.) se perdía en silencio: register_line_handler
            // todavía no había corrido, así que process_line() no
            // tenía a quién avisarle (reportado por el usuario, DHT11
            // devolviendo siempre el default).
            await this.simulator.qemuBridge.sendData(halBlock);
        } else {
            await this._enqueuePaste(() => this._pasteBlock(halBlock, 0, { silent: true }));
        }

    }

    // ====================================================
    // Reintento automático tras un HAL_ERROR (ver QemuBridge.parseLine,
    // rama "HAL_ERROR:", y el listener de "qemu:hal-error" en
    // bindBusEvents). Antes, un HAL corrupto en tránsito quedaba
    // marcado como "no enviado" (para que el PRÓXIMO click en
    // "Ejecutar" lo reintentara) pero exigía que el usuario mismo
    // clickeara de nuevo cada vez -- con una transmisión que se
    // corrompe seguido, eso significaba muchos clicks manuales
    // seguidos sin ninguna garantía de cuántos iban a hacer falta.
    //
    // Acá se reintenta SOLO, en segundo plano (silencioso, igual que
    // preloadHal), hasta HAL_RETRY_MAX veces por tipo, con una pausa
    // corta entre intento e intento -- así, para cuando el usuario
    // vuelve a clickear "Ejecutar" (o si ni se dio cuenta del primer
    // fallo), lo más probable es que el HAL ya haya quedado bien
    // cargado solo. No reemplaza al checksum (que sigue siendo la
    // única forma de saber si hizo falta reintentar) ni "arregla" la
    // corrupción en sí -- solo automatiza el mismo reintento manual
    // que ya funcionaba, para no depender de que el usuario esté
    // mirando la pantalla en cada intento.
    static HAL_RETRY_MAX = 8;
    static HAL_RETRY_DELAY_MS = 400;

    _retryHalAfterError(type) {

        const count = (this._halRetryCounts[type] || 0) + 1;
        this._halRetryCounts[type] = count;

        if (count > ReplPanel.HAL_RETRY_MAX) {
            const msg = this.simulator.qemuBridge?.isWasmBridge
                ? `\n⚠️ El componente "${type}" no carga en modo navegador -- probablemente usa algo que este modo ` +
                  `todavía no soporta (no es un problema pasajero, reintentar no lo va a arreglar). Si este componente ` +
                  `te hace falta, probá el modo normal (QEMU).\n`
                : `\n⚠️ El HAL de "${type}" falló ${ReplPanel.HAL_RETRY_MAX} veces seguidas -- ` +
                  `puede ser algo más que ruido de transmisión. Probá "Ejecutar" de nuevo a mano, ` +
                  `o revisá la consola del servidor.\n`;
            this.appendOutput(msg, "repl-error");
            return;
        }

        setTimeout(() => {
            // Si para cuando se cumple la pausa YA se volvió a marcar
            // "enviado" (ej. el usuario le dio a "Ejecutar" a mano
            // mientras tanto y esta vez salió bien), no hay nada que
            // reintentar.
            if (this._halSentToFirmware.has(type)) return;
            this.preloadHal();
        }, ReplPanel.HAL_RETRY_DELAY_MS);

    }

    // ====================================================
    // Ejecutar código del editor
    // El usuario escribe MicroPython limpio.
    // El HAL se inyecta automáticamente e invisiblemente
    // (ni los mensajes de carga ni el eco del paste mode del
    // HAL se muestran en el panel -- solo tu propio código).
    // ====================================================

    async runEditorCode() {

        // Ver _onReplReady() -- "▶ Ejecutar"/Ctrl+Enter no tienen que
        // poder mandar nada mientras el simulador no esté realmente
        // corriendo y el intérprete no haya mostrado su prompt ">>> "
        // todavía (aunque el botón ya queda deshabilitado en el DOM
        // en ese estado, ver bindBusEvents, Ctrl+Enter es un atajo de
        // teclado aparte que no pasa por ese disabled).
        if (!this._replReady) {
            this.appendOutput(
                "\n⚠️ Todavía no está listo -- esperá a que el REPL muestre \">>>\" (o presioná ▶ Simular si no está corriendo).\n",
                "repl-error"
            );
            return;
        }

        const userCode = this.editor.value.trim();
        if (!userCode) return;

        // Si ya hay una tanda en curso, ignoramos el click en vez
        // de arrancar una segunda tanda en paralelo -- eso era lo
        // que causaba el texto pisado/duplicado ("frofrofrom...")
        // cuando se clickeaba "Ejecutar" varias veces seguidas.
        if (this._running) return;

        this._running = true;
        this._stopRequested = false;
        const runBtn = document.getElementById("replBtnRun");
        if (runBtn) runBtn.disabled = true;

        this.switchTab("repl");
        this.appendOutput("\n▶ Ejecutando...\n", "repl-info");

        if (this.simulator.qemuBridge?.isWasmBridge) {

            const { fullCode, newlySent } = await this._assembleCode(userCode);

            // Lo marcamos ya acá (optimista, antes de confirmar que
            // terminó de correr) -- mismo criterio que preloadHal().
            newlySent.forEach(type => {
                this._halSentToFirmware.add(type);
                delete this._halRetryCounts[type]; // exito -- si vuelve a fallar mas adelante, cuenta de nuevo desde 0
            });

            // Modo navegador: no hay pty/paste mode que proteger --
            // se manda el código entero de una sola vez (ver
            // WasmBridge.sendData()/wasmWorker.js, mp.runPython()
            // sincrónico).
            //
            // A diferencia de QEMU (donde el pty real hace eco de todo
            // lo que se pega, así que el código aparece solo en la
            // terminal), acá nada lo muestra por su cuenta -- sin
            // esto, "▶ Ejecutando..." no dejaba ver QUÉ se mandó a
            // correr (reportado por el usuario). Se imprime el mismo
            // fullCode que se manda, tal cual -- mismo criterio que
            // el eco de paste mode real.
            this.appendOutput(fullCode + "\n", "repl-info");

            // sendData() acá devuelve una Promise que recién se
            // resuelve cuando el código TERMINÓ de correr de verdad
            // (no cuando se mandó) -- si no se espera, el botón
            // ▶ Ejecutar se reactivaba casi al instante aunque el
            // script siguiera corriendo/colgado adentro del Worker
            // (reportado por el usuario).
            //
            // ANTES: un aviso por timeout (2.5s) sugería "puede tener
            // un bucle (while True:)" -- pedido explícito del usuario:
            // quitarlo. Era puramente por TIEMPO transcurrido, nunca
            // miraba el código fuente, y terminó confundiendo a
            // usuarios con scripts que tardan unos segundos pero SÍ
            // terminan solos (ej. un FOR con sleep()). El código sigue
            // visible arriba (_assembleCode, "fullCode + \n") y el
            // botón ▶ Ejecutar sigue deshabilitado hasta que termine
            // -- esa señal alcanza sin necesidad de un mensaje aparte.
            await this.simulator.qemuBridge.sendData(fullCode);

        } else {
            // DOS llamadas separadas a propósito, no una sola anidada
            // adentro de _enqueuePaste -- preloadHal() YA encola su
            // propio _pasteBlock() internamente (ver _enqueuePaste()),
            // así que envolver todo esto en OTRO _enqueuePaste() de
            // afuera encadenaría la cola contra sí misma (la llamada de
            // adentro esperaría a que la de afuera termine, y la de
            // afuera está esperando a la de adentro -- deadlock real,
            // encontrado al escribir esto, nunca llegó a correr así).
            // Dos awaits seguidos alcanzan: _enqueuePaste() ya garantiza
            // que cada uno espera su turno en orden, sin que se pisen
            // los Ctrl+E entre sí.
            await this.preloadHal();
            await this._enqueuePaste(() => this._sendUserCodeViaRawPaste(userCode));
        }

        this._running = false;
        if (runBtn) runBtn.disabled = false;

    }

    // ====================================================
    // Cambiar tab
    // ====================================================

    switchTab(tab) {

        this.activeTab = tab;

        this.tabBar.querySelectorAll(".repl-tab").forEach(btn => {
            btn.classList.toggle("repl-tab-active", btn.dataset.tab === tab);
        });

        this.replPane.classList.toggle("repl-pane-hidden",   tab !== "repl");
        this.editorPane.classList.toggle("repl-pane-hidden", tab !== "editor");

        if (tab === "repl") {
            this.input.focus();
            // El contenedor de xterm.js estaba con display:none
            // (repl-pane-hidden) mientras se veía el Editor -- había
            // que remedir/reajustar filas y columnas recién ahora que
            // vuelve a ser visible, si no quedaba con la última medida
            // (posiblemente 0x0) de antes de esconderse.
            this._safeFit();
        }
        if (tab === "editor") {
            // Igual que _safeFit() para xterm arriba: el editor estaba
            // con display:none (repl-pane-hidden) mientras se veía el
            // REPL, así que CodeMirror necesita un refresh() recién
            // ahora que vuelve a ser visible o el resaltado/cursor
            // queda mal medido.
            this.codeMirror.refresh();
            this.codeMirror.focus();
        }

    }

    // ====================================================
    // Toggle panel
    // ====================================================

    toggle() {

        this.open = !this.open;

        this.panel.classList.toggle("repl-closed", !this.open);
        this.panel.classList.toggle("repl-open",    this.open);

        document.getElementById("replBtnToggle").textContent = this.open ? "▼" : "▲";

        if (this.open) {
            if (this.activeTab === "repl")   this.input.focus();
            if (this.activeTab === "editor") { this.codeMirror.refresh(); this.codeMirror.focus(); }
            // #replPanel anima su "height" con CSS (0.25s, ver
            // repl-panel.css) -- medir el contenedor ACÁ MISMO, en el
            // mismo tick que recién disparó esa transición, todavía
            // ve la altura VIEJA (32px, colapsado) y calculaba una
            // terminal de 1 sola fila. Hay que esperar a que la
            // transición termine antes de volver a medir.
            setTimeout(() => this._safeFit(), 260);
            this.scrollToBottom();
        }

    }

    // ====================================================
    // EventBus
    // ====================================================

    bindBusEvents() {

        // Prefijos de protocolo interno -- mensajes que los HAL mandan
        // por stdout para que el simulador los interprete (ver
        // SignalEngine/QemuBridge), no texto que el usuario espere ver
        // en su consola.
        // "HAL_ERROR:" se suma acá porque ya existe un mensaje amigable
        // que lo reemplaza ("🔄 Se detectó ruido en la transmisión...",
        // ver el listener de "qemu:hal-error") -- sin este filtro, el
        // repr() crudo de la excepción también se mostraba (en verde,
        // como si fuera código normal), duplicado y más confuso que útil.
        const PROTOCOL_PREFIXES = ["GPIO:", "IN:", "ADC:", "I2C:", "DBG:", "OLED:", "LCD:", "TEMP:", "DIST:", "SERVOOUT:", "HAL_ERROR:"];

        // Mensajes de arranque del propio firmware (no del HAL) que
        // tampoco le sirven al alumno -- "Performing initial setup" lo
        // imprime el port esp32 de MicroPython cuando el filesystem de
        // flash está vacío y hace falta formatearlo (nuestro caso: el
        // filesystem nunca tuvo un boot.py real, ver
        // firmware/frozen_hal/README.md -- solo pasa la primera vez que
        // arranca un flash_image.bin nuevo/en blanco). Se filtra igual
        // que las líneas de protocolo, no como "prefijo de HAL".
        const FIRMWARE_BOOT_NOISE = ["Performing initial setup"];

        const isProtocolLine = (line) => {
            const t = line.trim();
            // La línea que imprime _probeWarmBoot() (ver más abajo) no
            // es un prefijo fijo al INICIO de la línea como los de
            // arriba -- puede venir precedida por el eco del propio
            // print(...) que la generó -- así que se busca en
            // cualquier parte de la línea, no solo al principio.
            if (t.includes(ReplPanel.PROBE_MARK)) return true;
            if (FIRMWARE_BOOT_NOISE.some(p => t.startsWith(p))) return true;
            return PROTOCOL_PREFIXES.some(p => t.startsWith(p));
        };

        // ¿Este fragmento (todavía sin "\n") PODRÍA ser el arranque de
        // un mensaje de protocolo si le siguiera llegando más texto?
        // -- ej. "OLED:128x64" (prefijo completo + falta el hex) o
        // incluso solo "OLE" (prefijo a medio llegar). Si no calza con
        // ninguno de los dos casos, es texto normal y se muestra ya.
        const looksLikeProtocolStart = (fragment) => {
            const t = fragment.replace(/^\r+/, "");
            if (!t) return false;
            if (ReplPanel.PROBE_MARK.startsWith(t) || t.includes(ReplPanel.PROBE_MARK)) return true;
            if (FIRMWARE_BOOT_NOISE.some(p => p.startsWith(t) || t.startsWith(p))) return true;
            return PROTOCOL_PREFIXES.some(p => p.startsWith(t) || t.startsWith(p));
        };

        this.simulator.eventBus.on("qemu:output", (text) => {

            // Marcador de _probeWarmBoot() (ver más abajo) -- se
            // chequea ANTES del "if (this._suppressEcho) return;" de
            // acá abajo a propósito, porque _probeWarmBoot() prende
            // _suppressEcho mientras espera la respuesta (para no
            // mostrar el print() de diagnóstico en el panel).
            if (this._warmProbe && text.includes(ReplPanel.PROBE_MARK)) {
                const idx = text.indexOf(ReplPanel.PROBE_MARK) + ReplPanel.PROBE_MARK.length;
                const flag = text[idx];
                if (flag === "0" || flag === "1") {
                    this._warmProbe(flag === "1");
                    this._warmProbe = null;
                }
            }

            // Marcador de _waitForNextPrompt() (ver _pasteBlock()) --
            // mismo criterio que _warmProbe de arriba: se chequea
            // ANTES del "if (this._suppressEcho) return;", porque
            // esto se usa justo MIENTRAS el eco sigue oculto.
            // Marcador de _waitForPasteModeStart() (ver _pasteBlock())
            // -- mismo criterio: chequeado mientras _suppressEcho sigue
            // prendido, porque es justo cuando se usa.
            if (this._pasteModeWatcher && /paste mode|=== ?$/m.test(text)) {
                this._pasteModeWatcher();
                this._pasteModeWatcher = null;
            }

            if (this._promptWatcher && text.includes(">>>")) {
                this._promptWatcher();
                this._promptWatcher = null;
            }

            // Un reinicio de MicroPython (Ctrl+D en el prompt en vez
            // de en medio de un paste -- el botón "↺ Soft Reset", o
            // cualquiera que lo dispare) borra TODOS los módulos que
            // NO estén congelados en el firmware -- el HAL POR
            // COMPONENTE (bmp180, lcd_16x2_i2c, etc., pegado por
            // paste mode) se pierde entero. Sin esto, el próximo
            // "Ejecutar" mandaba SOLO el código del usuario (asumiendo
            // que el HAL seguía cargado) y fallaba con NameError.
            //
            // OJO -- bug real de la primera versión de este fix: acá
            // se limpiaba _halSentToFirmware A CIEGAS (incluidos
            // _base/_i2c_bus/_adc_bus/_uart_bus) y se volvía a mandar
            // TODO por paste mode. Con el firmware que ya los tiene
            // CONGELADOS (ver firmware/frozen_hal/boot.py), esos 4
            // ya se recargan solos en CADA boot -- cold o soft, da lo
            // mismo, boot.py corre siempre -- así que repastearlos
            // era 100% innecesario. Peor: mientras ese repasteo grande
            // estaba en curso, el usuario (viendo que "no pasaba
            // nada") volvía a apretar "↺ Soft Reset" -- ese click
            // manda su Ctrl+D DIRECTO (ver replBtnReset más abajo,
            // ahora encolado por la misma razón), que caía a mitad
            // del paste en curso y lo cortaba -- de ahí la cascada de
            // "IndentationError"/"SyntaxError" reportada (líneas del
            // HAL, huérfanas de su paste mode, ejecutándose sueltas
            // en el prompt interactivo).
            //
            // Ahora se usa el mismo mecanismo que una conexión nueva
            // (_resyncHalAfterBoot -- sonda primero, recién después
            // decide qué repastear), así que en firmware con HAL
            // congelado esto no manda NADA de más.
            //
            // BUG REAL encontrado (reportado con un log real): esto NO
            // podía llamar a _resyncHalAfterBoot() directo -- esa
            // función arranca con _probeWarmBoot(), que manda un
            // Ctrl+C ANTES de preguntar. El texto "MPY: soft reboot"
            // llega apenas EMPIEZA el reinicio, mientras boot.py
            // (que en el firmware congelado importa _pit_base ->
            // machine, etc.) TODAVÍA se está ejecutando -- un Ctrl+C
            // ahí lo interrumpe a mitad de camino con un
            // KeyboardInterrupt REAL (confirmado en el log: "File
            // boot.py... File _pit_base.py, line 71... File
            // machine.py... KeyboardInterrupt"), así que _pit_state
            // nunca termina de armarse y la sonda reporta "no está" --
            // aunque el firmware SÍ tenga el HAL congelado. Es decir,
            // el propio código de este simulador causaba el problema
            // que decía estar evitando.
            //
            // Arreglo: esperar a que el reinicio termine SOLO (sin
            // mandar nada, ver _waitForNextPrompt) antes de recién
            // ahí correr la sonda -- una vez que MicroPython ya volvió
            // a un prompt ocioso de verdad, el Ctrl+C de la sonda es
            // inofensivo (mismo caso que una conexión nueva normal).
            if (text.includes("MPY: soft reboot")) {
                this._resyncAfterSoftReboot();
            }

            // Mientras se está pegando el HAL (ver runEditorCode),
            // no mostramos nada -- ni el eco del paste mode ("===...")
            // ni el propio texto del HAL. Así el usuario solo ve su
            // código, igual que en Wokwi.
            if (this._suppressEcho) return;

            if (!text) return;

            // ANTES: filtrábamos cada mensaje de "qemu:output" por
            // separado. Problema: QEMU no manda necesariamente una
            // línea completa por mensaje -- un framebuffer de OLED
            // (2000+ caracteres) puede llegar partido en 2+ mensajes.
            // Si "OLED:128x64" llega en un mensaje (sin "\n" todavía)
            // y el resto del hex llega en el siguiente, el primer
            // pedazo SÍ se filtraba (empieza con "OLED:") pero el
            // segundo NO (ya es un resto suelto sin el prefijo) --
            // se colaba como si fuera texto normal.
            //
            // AHORA: acumulamos en this._outputBuffer. Las líneas
            // completas (con "\n") se filtran y muestran como antes.
            // El fragmento final sin "\n" todavía SOLO se retiene si
            // parece el arranque de un mensaje de protocolo -- el
            // resto (ej. el prompt ">>> ", texto normal sin salto de
            // línea) se sigue mostrando al toque, sin esperar nada.
            this._outputBuffer = (this._outputBuffer || "") + text;

            const parts = this._outputBuffer.split("\n");
            const tail  = parts.pop(); // último fragmento, sin "\n" todavía

            let out = parts
                .filter(line => !isProtocolLine(line))
                .map(line => line + "\n")
                .join("");

            if (looksLikeProtocolStart(tail)) {
                this._outputBuffer = tail; // esperar más datos / el "\n"
            } else {
                if (tail) out += tail;
                this._outputBuffer = "";
            }

            if (out) this.appendOutput(out);

            // Recién ACÁ se considera "listo de verdad" -- ver
            // _replReady en el constructor y _onReplReady() más abajo.
            // ">>> " es el prompt real que imprime MicroPython, sea
            // porque terminó de bootear (banner completo) o porque
            // respondió el print() de _probeWarmBoot() -- cualquiera
            // de los dos casos significa que el intérprete YA puede
            // recibir comandos de verdad.
            if (!this._replReady && !this._awaitingInitialResync && out.includes(">>>")) {
                this._onReplReady();
            }

        });

        // Historial que server.js manda apenas se conecta (ver la nota
        // grande en server.js/OUTPUT_HISTORY_MAX_BYTES) -- por ejemplo,
        // el banner real de arranque (rst:0x1, "MicroPython vX.Y.Z on
        // ..."), que QEMU imprime UNA sola vez al bootear, mucho antes
        // de que el navegador llegue a conectarse. Se muestra igual que
        // "qemu:output" (mismo filtro de líneas de protocolo), pero
        // NUNCA dispara _onReplReady(): es texto VIEJO, puede incluir
        // un ">>>" de hace rato aunque el intérprete esté ocupado
        // ahora mismo -- la sonda real (_probeWarmBoot) sigue siendo la
        // única fuente de verdad sobre si se puede mandar código YA.
        this.simulator.eventBus.on("qemu:history", (text) => {

            if (!text) return;

            const shown = text
                .split("\n")
                .filter(line => !isProtocolLine(line))
                .join("\n");

            if (shown.trim()) this.appendOutput(shown, "repl-info");

        });

        this.simulator.eventBus.on("qemu:connect-hint", () => {
            this.appendOutput(
                "\n⚠️ No se pudo conectar al puente local.\n" +
                "\n" +
                "Para usar el simulador con MicroPython real hace falta tener\n" +
                "el \"puente local\" instalado y corriendo en TU computadora\n" +
                "(no alcanza con abrir esta página -- ver el enlace de descarga\n" +
                "que te haya pasado tu profesor/a).\n" +
                "\n" +
                "Si ya lo tenés corriendo y aun así falla, es probable que Chrome\n" +
                "esté bloqueando el acceso a la red local de esta página. Fijate si\n" +
                "apareció un cartel/permiso para \"acceder a la red local\" y\n" +
                "aceptalo -- si no aparece, hacé clic en el candado 🔒 junto a la\n" +
                "dirección del sitio → \"Configuración de sitios\" → buscá \"Red local\"\n" +
                "y ponelo en \"Permitir\", después recargá la página.\n" +
                "\n" +
                "Mientras tanto podés usar el 🌐 modo navegador (sin instalar nada,\n" +
                "aunque no actualiza los controles del panel en vivo mientras corre\n" +
                "un bucle).\n",
                "repl-error"
            );
        });

        this.simulator.eventBus.on("qemu:connected", async () => {

            this._lastGpioLogged = {};

            // BUG REAL (reportado: "si ya sabemos que no funciona el
            // raw-paste, para qué lo seguimos probando"): esto ANTES
            // reseteaba this._rawPasteUnsupported acá, con la idea de
            // "una conexión nueva podría tener un firmware distinto".
            // En la práctica, dentro de una misma sesión de la app,
            // el firmware NUNCA cambia entre reconexiones (son el
            // mismo QEMU/.exe de siempre reconectando el WebSocket,
            // no un reflasheo real) -- y las reconexiones son bastante
            // frecuentes en una máquina con mucha corrupción. Resetear
            // esto en cada una hacía que CADA "Ejecutar" pagara de
            // nuevo los ~8s de negociación de raw-paste para
            // descubrir, otra vez, que este firmware no lo soporta --
            // puro desperdicio para scripts cortos, donde esos 8s son
            // la mayor parte del tiempo total. Ya NO se resetea acá --
            // solo en el constructor (una recarga de página SÍ cuenta
            // como "quizás cambió algo", vale la pena probar de nuevo
            // una sola vez ahí).

            // Modo navegador (WasmBridge, ver plan "PitSimulator en
            // GitHub Pages"): nada de lo de abajo aplica -- no hay
            // "warm boot"/HAL congelado que sondear (_probeWarmBoot
            // manda interrupt() como parte del probe, que en
            // WasmBridge reinicia el Worker -> "qemu:connected" de
            // nuevo -> loop infinito, confirmado en la práctica). El
            // Worker ya cargó _base_wasm.py/_i2c_bus_wasm.py antes de
            // mandar "ready", así que queda listo de una.
            if (this.simulator.qemuBridge?.isWasmBridge) {
                // Pedido explícito del usuario: que se vea como el banner
                // real que imprime MicroPython al arrancar (QEMU), en vez
                // de un mensaje genérico -- usa la versión REAL de este
                // puerto (v1.28.0, confirmada en assets/wasm/micropython.wasm,
                // "MicroPython v1.28.0-dirty on 2026-08-01") en vez de
                // inventar "v1.29.0"/"Generic ESP32 module" como el banner
                // de QEMU: ESO sí corre sobre hardware ESP32 emulado de
                // verdad, esto es el intérprete solo, sin esa capa --
                // decir "ESP32" acá sería mentirle al alumno sobre qué
                // está corriendo en realidad.
                this.appendOutput(
                    "\nMicroPython v1.28.0 (puerto WebAssembly); 3DPit-Blockly (modo navegador)\n\nType \"help()\" for more information.\n",
                    "repl-info"
                );

                // Los módulos "siempre presentes" (_base/_i2c_bus/etc.)
                // NUNCA se fetchean/mandan acá -- wasmWorker.js ya cargó
                // sus equivalentes _*_wasm.py (components_wasm/) al
                // conectar. Si se mandaran los .hal.py REALES de QEMU
                // encima, chocan: esos esperan un machine.Pin real (ej.
                // Pin.IRQ_RISING), y acá machine.Pin es el fake de
                // _base_wasm.py -- confirmado en la práctica
                // (AttributeError). Marcarlos "sent" de entrada evita
                // que _buildPendingHal() los toque.
                this._halRetryCounts = {};
                this._halSentToFirmware = new Set(ReplPanel.ALWAYS_HAL_TYPES);

                this._onReplReady();

                // Mismo motivo que preloadHal() en QEMU (ver
                // _resyncHalAfterBoot): un componente que YA está en
                // el lienzo al conectar necesita su .hal.py cargado
                // DE UNA, no recién en el primer "Ejecutar" -- si no,
                // cualquier valor empujado desde el panel antes de
                // eso (slider de temperatura, lux, etc.) se pierde en
                // silencio.
                await this.preloadHal();

                this.simulator.signalEngine.resyncAllComponents();
                return;
            }

            this.appendOutput("\n✅ ESP32 conectada — esperando que MicroPython termine de arrancar...\n", "repl-info");

            // Todavía NO se habilita el input/Ejecutar acá -- recién
            // cuando se vea el prompt ">>> " de verdad (_onReplReady).
            // "Conectado" solo dice que el WebSocket abrió, no que el
            // intérprete ya esté listo para recibir comandos (el
            // arranque real de QEMU/MicroPython puede tardar bastante
            // más que el WebSocket en sí).
            this._replReady = false;
            this.input.disabled   = true;
            this.sendBtn.disabled = true;
            const runBtn = document.getElementById("replBtnRun");
            if (runBtn) runBtn.disabled = true;

            // Ver el comentario grande de this._awaitingInitialResync
            // en el constructor -- bloquea el chequeo genérico de
            // ">>>" (que si no, dispara _onReplReady() con el primer
            // prompt del banner de arranque, MUCHO antes de que el
            // resync de más abajo termine) hasta que ese resync
            // inicial termine de verdad.
            this._awaitingInitialResync = true;

            // BUG REAL (reportado: "al ejecutar el código se carga
            // muy rápido, no se colocan bien las letras", con
            // repasteos completos de HAL pese a que el firmware ya lo
            // trae congelado): "conectado" solo dice que el WebSocket
            // abrió -- GDB puede tardar varios segundos más en
            // adjuntarse y armar su breakpoint (ver runGpioEventBridge
            // en server.js), y el target queda PAUSADO por GDB
            // mientras tanto. El sondeo de _resyncHalAfterBoot() de
            // más abajo manda un Ctrl+C que, si llega en esa ventana,
            // no tiene ningún CPU corriendo del otro lado para
            // responderle -- concluía "arranque frío" por error y
            // disparaba un repasteo completo e innecesario, en el peor
            // momento posible (justo cuando el bridge recién está
            // terminando de asentarse). Esperamos la señal real del
            // bridge antes de sondear nada -- ver _waitForBridgeReady().
            await this._waitForBridgeReady();

            // BUG REAL sospechado (no 100% confirmado, pero con indicios
            // fuertes en un log real): "bridgeReady" se pone en true
            // apenas gdb.resume() vuelve -- pero eso es el MOMENTO EXACTO
            // en que GDB recién termina su propio trabajo interno (cargar
            // símbolos, armar el breakpoint). Se vio en vivo texto de
            // diagnóstico del bridge ("[Bridge] Breakpoint listo...")
            // mezclado CARACTER A CARACTER con el eco del primer paste
            // de HAL que arranca apenas llega esta señal -- consistente
            // con que todavía no pasó margen real desde que GDB se
            // "asentó" del todo. Un respiro corto, una sola vez por
            // conexión (no por pedazo -- no vale la pena para HAL ya
            // cacheado), antes del primer repasteo.
            await this._sleep(400);

            // Ver _resyncHalAfterBoot() -- sondea primero (¿ya está
            // "_pit_state" en sys.modules, sea por reconexión en
            // caliente o por HAL congelado en el firmware?) y recién
            // después decide qué repastear, en vez de asumir "conexión
            // nueva = arrancar de cero" a ciegas.
            await this._resyncHalAfterBoot();

            // Recién ACÁ el resync inicial terminó de verdad -- ver
            // this._awaitingInitialResync en el constructor. Si algún
            // ">>>" ya pasó mientras estaba bloqueado (lo normal: el
            // propio resync genera varios), este es el que
            // efectivamente habilita "Ejecutar" -- _onReplReady() ya
            // es un no-op si por algún motivo el chequeo genérico de
            // ">>>" alcanzó a dispararse después de este punto.
            this._awaitingInitialResync = false;
            if (!this._replReady) this._onReplReady();

            // Re-enviar estado de componentes tipo RC522 (tarjeta
            // "Hold" prendida desde un proyecto recién cargado, o
            // desde antes de esta reconexión) -- ver la nota "resync"
            // en ComponentBehaviorRegistry.js. Tiene que ir DESPUÉS
            // de preloadHal(): si el mensaje llega antes de que el
            // .hal.py del componente registre su protocolo, se
            // pierde igual que cualquier mensaje sin listener.
            this.simulator.signalEngine.resyncAllComponents();
        });

        // Ver el comentario grande de this._stopRequested en el
        // constructor -- esto es lo que faltaba para que "⏹ Detener"
        // corte de verdad un reintento de "Ejecutar" en curso, en vez
        // de dejarlo terminar sus hasta 6 intentos solo.
        this.simulator.eventBus.on("simulation:stop", () => {
            this._stopRequested = true;
        });

        this.simulator.eventBus.on("qemu:disconnected", () => {
            this.appendOutput("\n🔴 ESP32 desconectada\n", "repl-error");
            this._replReady = false;
            this.input.disabled   = true;
            this.sendBtn.disabled = true;
            const runBtn = document.getElementById("replBtnRun");
            if (runBtn) runBtn.disabled = true;
            this.prompt.style.color = "#666";
        });

        // Un HAL puntual falló al cargarse (ver el comentario grande
        // en QemuBridge.parseLine(), rama "HAL_ERROR:") -- lo sacamos
        // de _halSentToFirmware para que el PRÓXIMO "Ejecutar" lo
        // reintente solo, en vez de quedar marcado como "ya enviado"
        // para siempre en esta sesión del navegador (que era el
        // comportamiento de antes: sin esto, un HAL corrupto una vez
        // quedaba roto hasta un F5 completo de la página).
        this.simulator.eventBus.on("qemu:hal-error", (type) => {

            // Aviso corto y claro -- justo antes de esto, el usuario
            // suele ver el eco crudo del wrapper Python (líneas de
            // código, no una traza real) porque la corrupción de
            // transmisión también desincroniza el mecanismo normal de
            // "ocultar el eco mientras se pega" (_suppressEcho). Sin
            // este mensaje, ese ruido se ve como si algo se hubiera
            // roto de verdad -- pero _retryHalAfterError() ya lo
            // reintenta solo, en segundo plano, así que esto es solo
            // contexto, no dispara ningún reintento nuevo por sí mismo.
            // En modo navegador (WasmBridge) no hay NINGUNA transmisión
            // serial de por medio -- mp.runPython() recibe el mismo
            // string de JS tal cual, sin UART ni paste mode. Un
            // HAL_ERROR ahí NUNCA es "ruido" (no hay nada que corromper):
            // es un error real (ImportError/AttributeError porque ese
            // componente usa algo que el intérprete WASM no tiene, o un
            // bug genuino del propio .hal.py) que reintentar con el
            // MISMO código jamás va a arreglar. Mostrar el mensaje de
            // "ruido, reintentando solo" -- pensado para la corrupción
            // real de QEMU -- sería directamente mentirle al usuario
            // sobre qué pasó.
            if (this.simulator.qemuBridge?.isWasmBridge) {
                this.appendOutput(
                    `\n⚠️ El componente "${type}" no pudo cargar en modo navegador (no es un problema de transmisión -- ` +
                    `puede que use algo que este modo todavía no soporta). Mirá el error justo arriba.\n`,
                    "repl-error"
                );
            } else {
                this.appendOutput(
                    `\n🔄 Se detectó ruido en la transmisión del HAL de "${type}" -- reintentando solo, no hace falta hacer nada.\n`,
                    "repl-info"
                );
            }

            // Si este tipo se había intentado por el camino rápido
            // ("import _pit_hal_<tipo>", ver _frozenHalTypes más
            // arriba) y falló, sacarlo del Set ANTES de reintentar --
            // el error puede ser un firmware más viejo que en
            // realidad no lo tiene congelado (ModuleNotFoundError) o
            // un nombre no reexportado en ese namespace propio (ver
            // el mismo problema ya encontrado con process_line() en
            // project_resync_idle_repl_fix.md) -- en CUALQUIERA de
            // los dos casos, el paste completo (que corre en el
            // namespace global del REPL, con todo ya disponible) es
            // más probable que funcione. Sin esto, el reintento
            // automático volvía a probar el mismo import roto hasta
            // agotar HAL_RETRY_MAX, sin autocorregirse nunca.
            this._frozenHalTypes.delete(type);

            this._halSentToFirmware.delete(type);
            this._retryHalAfterError(type);
        });

        // Auto-Ejecutar al hacer clic -- pedido explícito del usuario
        // ("no puedo hacer clic en botón y luego soltar y dar clic en
        // Ejecutar"): en modo navegador (WasmBridge), un clic en un
        // componente interactivo (tecla de teclado, ADKEY, botón,
        // TAP de RC522) NO se ve reflejado en Python hasta la
        // PRÓXIMA corrida -- esa es la limitación real de WASM ya
        // documentada (ver _base_wasm.py y el comentario grande en
        // WasmBridge.sendData()/wasmWorker.js: nada puede inyectarse
        // mientras un script ya está corriendo). En vez de obligar a
        // un segundo clic manual en "▶ Ejecutar" después de cada
        // interacción, acá se dispara esa misma corrida SOLA: el
        // alumno aprieta la tecla/botón UNA sola vez y ve el
        // resultado directo, siempre que ya haya código cargado, el
        // REPL esté listo, y no haya otra corrida en curso (si la
        // hay, se ignora -- iniciar una segunda tanda en paralelo es
        // justo el bug que _running ya previene en runEditorCode()).
        // Ver Renderer.js (bindPressButton/bindAdKey/bindKeypadMatrix)
        // y SignalEngine.tapRc522() para los emisores de este evento.
        this.simulator.eventBus.on("component:pressed", () => {
            if (!this.simulator.qemuBridge?.isWasmBridge) return;
            if (!this._replReady || this._running) return;
            if (!this.editor.value.trim()) return;
            this.runEditorCode();
        });

        this.simulator.eventBus.on("gpio:changed", ({ gpio, value }) => {

            if (this._gpioLogMuted) return;

            // No repetir el mismo valor consecutivo para el mismo
            // pin -- esto es lo que generaba líneas tipo "LOW ▼" dos
            // veces seguidas sin ningún HIGH en el medio. Un cambio
            // de verdad (LOW→HIGH o HIGH→LOW) siempre se muestra.
            if (this._lastGpioLogged[gpio] === value) return;
            this._lastGpioLogged[gpio] = value;

            this.appendOutput(
                `📌 GPIO${gpio} → ${value ? "HIGH ▲" : "LOW  ▼"}\n`,
                "repl-gpio"
            );
        });

    }

    _updateGpioLogBtn() {
        if (!this._gpioLogBtn) return;
        // Estilo inline (no clase CSS nueva) porque repl-panel.css no
        // está en este cambio -- si en algún momento se agrega una
        // clase ".repl-btn-muted" ahí, se puede reemplazar esto por
        // classList.toggle() para mantenerlo consistente con el
        // resto de los botones.
        this._gpioLogBtn.style.opacity = this._gpioLogMuted ? "0.4" : "1";
        this._gpioLogBtn.title = this._gpioLogMuted
            ? "Actividad de pines silenciada (click para mostrarla)"
            : "Silenciar actividad de pines (📌 GPIOxx)";
    }

    // ====================================================
    // Se vio el prompt ">>> " real por primera vez desde que se
    // conectó -- ver el listener de "qemu:output" en bindBusEvents().
    // Recién acá se habilitan de verdad el REPL y "▶ Ejecutar"/
    // Ctrl+Enter (ver el guard correspondiente en sendInput()/
    // runEditorCode()) -- estar "conectado" (WebSocket abierto) no es
    // lo mismo que estar "listo" (intérprete recibiendo comandos).
    // ====================================================

    _onReplReady() {

        this._replReady = true;

        this.input.disabled   = false;
        this.sendBtn.disabled = false;
        this.prompt.style.color = "#00ff88";

        const runBtn = document.getElementById("replBtnRun");
        if (runBtn) runBtn.disabled = false;

        // BUG REAL (reportado: "en ocasiones me impide enviar comandos
        // o ejecutar código, se queda trabado" -- clickeando Simular/
        // Detener rápido varias veces seguidas): Toolbar.js mantenía el
        // botón "⏹ Detener" habilitado desde que el WebSocket abría
        // (evento "simulation:started"), mucho antes de este punto --
        // GDB puede tardar varios segundos más en adjuntarse (ver
        // bridgeReady en QemuBridge/server.js). Un click en "Detener"
        // en esa ventana manda su propio Ctrl+C, que puede interrumpir
        // a mitad de camino el sondeo de arranque en caliente de la
        // PRÓXIMA conexión -- no corrompe datos (ver rawStdinWrite en
        // server.js), pero fuerza un repasteo completo más lento en
        // vez de uno instantáneo, dando la sensación de "trabado".
        // Este evento le avisa a Toolbar.js que recién ACÁ es seguro
        // habilitar "Detener" de verdad -- ver bindSimToggle().
        this.simulator.eventBus.emit("repl:ready");

    }

    // ====================================================
    // REPL helpers
    // ====================================================

    sendInput() {

        // Ver _onReplReady() -- sin esto, Enter/"Enviar" mandarían
        // texto a un intérprete que todavía puede estar a mitad de
        // bootear. En la práctica this.input.disabled ya bloquea la
        // interacción real del usuario (ver bindBusEvents), pero este
        // guard cubre también una llamada programática directa.
        if (!this._replReady) return;

        const text = this._sanitizeForSerial(this.input.value.trim());
        if (!text) return;

        this.history.unshift(text);
        if (this.history.length > 50) this.history.pop();
        this.historyIndex = -1;

        // NO pintamos ">>> texto" acá a mano. QEMU/MicroPython ya
        // tiene echo activado del otro lado del pty: apenas le llega
        // esta línea, nos la devuelve él mismo por el WS (junto con
        // su propio prompt ">>> " y el resultado), y eso ya lo
        // muestra el handler de "qemu:output" tal cual. Si además
        // la pintábamos acá, quedaba duplicada (">>> >>> texto").
        this.simulator.eventBus.emit("qemu:send", text);
        this.input.value = "";

    }

    navigateHistory(direction) {

        if (this.history.length === 0) return;

        this.historyIndex = Math.max(-1,
            Math.min(this.history.length - 1, this.historyIndex + direction));

        this.input.value = this.historyIndex >= 0 ? this.history[this.historyIndex] : "";

        setTimeout(() => {
            this.input.selectionStart = this.input.selectionEnd = this.input.value.length;
        }, 0);

    }

    // Paleta simplificada a pedido: VERDE para todo lo que sea código
    // (salida normal, ✅ conectado, ▶ Ejecutando, ^C, GPIO, etc.) y ROJO
    // solo para errores/advertencias (⚠️, 🔴 desconectado). Antes había
    // 4 colores (azul/rojo/amarillo/violeta para info/error/ctrl/gpio)
    // -- ahora solo "repl-error" tiene código ANSI propio; cualquier
    // otra clase (incluidas repl-info/repl-ctrl/repl-gpio, que se
    // siguen usando como etiquetas semánticas aunque ya no cambien de
    // color) cae al default de la terminal, que YA es el verde de
    // siempre (ver _initTerminal(), foreground: "#00ff88").
    static _ANSI_COLORS = {
        "repl-error": "\x1b[38;2;255;82;82m",
    };

    appendOutput(text, cssClass = "") {

        if (!text || !this.terminal) return;

        // xterm.js es una terminal real: "\n" (LF) solo baja una fila
        // SIN volver a la columna 0 (igual que una terminal serie de
        // verdad) -- hace falta "\r\n" para un salto de línea "normal".
        // El texto que llega acá puede traer cualquiera de los dos
        // (crudo de QEMU, o literales JS con solo "\n"), así que
        // normalizamos siempre a "\r\n".
        const normalized = text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

        const color = ReplPanel._ANSI_COLORS[cssClass];
        this.terminal.write(color ? `${color}${normalized}\x1b[0m` : normalized);

        this.scrollToBottom();

    }

    scrollToBottom() {
        this.terminal?.scrollToBottom();
    }

}