/*
==========================================================
 PitSimulator
 Archivo: ReplPanel.js
 Panel REPL + Editor de código MicroPython.

 Flujo de ejecución:
   1. El usuario escribe código limpio (igual que en Wokwi)
   2. runEditorCode() ensambla automáticamente:
        _base.hal.py          ← siempre
        <tipo>.hal.py         ← por cada componente en el canvas
        código del usuario    ← sin modificar
   3. El bloque completo se envía a QEMU por paste mode
      (Ctrl+E … líneas … Ctrl+D)
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
        // volver a silenciarlo en cada sesión.
        this._gpioLogMuted = localStorage.getItem("pit_gpio_log_muted") === "1";
        this._lastGpioLogged = {};

        this.buildDOM();
        this.bindEvents();
        this.bindBusEvents();

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
                <button class="repl-btn" id="replBtnInterrupt" title="Interrumpir (Ctrl+C)">■</button>
                <button class="repl-btn" id="replBtnReset"     title="Soft Reset (Ctrl+D)">↺</button>
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

        this.output = document.createElement("div");
        this.output.className = "repl-output";
        this.output.setAttribute("aria-live", "polite");

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

        this.sendBtn = document.createElement("button");
        this.sendBtn.className = "repl-btn repl-btn-send";
        this.sendBtn.textContent = "Enviar";

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
                <button class="repl-btn repl-btn-run" id="replBtnRun">▶ Ejecutar</button>
            </div>
        `;

        this.editor = document.createElement("textarea");
        this.editor.className = "repl-editor";
        this.editor.setAttribute("spellcheck",     "false");
        this.editor.setAttribute("autocomplete",   "off");
        this.editor.setAttribute("autocorrect",    "off");
        this.editor.setAttribute("autocapitalize", "off");
        this.editor.placeholder = [
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

        this.editorPane.appendChild(editorToolbar);
        this.editorPane.appendChild(this.editor);

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
            if (e.key === "ArrowUp")   { e.preventDefault(); this.navigateHistory(-1); return; }
            if (e.key === "ArrowDown") { e.preventDefault(); this.navigateHistory(1);  return; }
            if (e.ctrlKey && e.key === "c") {
                e.preventDefault();
                this.simulator.eventBus.emit("qemu:send", "\x03");
                this.appendOutput("^C\n", "repl-ctrl");
            }
        });

        // Botones cabecera
        document.getElementById("replBtnInterrupt").addEventListener("click", () => {
            this.simulator.eventBus.emit("qemu:send", "\x03");
            this.appendOutput("^C\n", "repl-ctrl");
        });
        document.getElementById("replBtnReset").addEventListener("click", () => {
            this.simulator.eventBus.emit("qemu:send", "\x04");
            this.appendOutput("↺ Soft reset...\n", "repl-ctrl");
        });
        document.getElementById("replBtnClear").addEventListener("click", () => {
            this.output.innerHTML = "";
        });

        // Silenciar/activar actividad de pines -- ver el comentario
        // largo en el constructor sobre por qué esto es 100% seguro
        // de tocar (no afecta LEDs ni detección de botones/teclado).
        this._gpioLogBtn = document.getElementById("replBtnGpioLog");
        this._updateGpioLogBtn();
        this._gpioLogBtn.addEventListener("click", () => {
            this._gpioLogMuted = !this._gpioLogMuted;
            localStorage.setItem("pit_gpio_log_muted", this._gpioLogMuted ? "1" : "0");
            this._updateGpioLogBtn();
        });

        // Editor
        document.getElementById("replBtnRun").addEventListener("click", () => this.runEditorCode());
        this.editor.addEventListener("keydown", (e) => {
            if (e.key === "Tab") {
                e.preventDefault();
                const s = this.editor.selectionStart;
                this.editor.value =
                    this.editor.value.substring(0, s) + "    " +
                    this.editor.value.substring(s);
                this.editor.selectionStart = this.editor.selectionEnd = s + 4;
            }
            if (e.ctrlKey && e.key === "Enter") {
                e.preventDefault();
                this.runEditorCode();
            }
        });

        // Atajo global
        window.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.key === "`") { e.preventDefault(); this.toggle(); }
        });

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
    // Ensamblar el código completo:
    //   1. HAL base (siempre)
    //   2. HAL de cada tipo de componente en el canvas
    //   3. Código del usuario (sin modificar)
    //
    // Devuelve también halLineCount: cuántas líneas del bloque
    // final corresponden al HAL (base + componentes), para que
    // runEditorCode() sepa hasta dónde ocultar el eco del paste
    // mode y a partir de dónde es "código del usuario" -- así
    // el HAL queda invisible en el panel, igual que en Wokwi.
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
    static ALWAYS_HAL_TYPES = ["_base", "_i2c_bus", "_adc_bus"];

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

    // Envuelve un .hal.py ya cargado en un exec(base64) aislado por
    // try/except (ver el comentario grande de más arriba, "Aislamiento
    // de fallas entre componentes"). El base64 se parte acá en varias
    // líneas cortas (concatenación implícita de strings de Python
    // dentro de los paréntesis -- "a" "b" == "ab", válido en
    // cualquier indentación mientras esté dentro de "(...)") en vez
    // de mandarse como UNA sola línea gigante sin ningún salto.
    //
    // Por qué importa: se confirmó en la práctica (ver
    // server.js/SEND_CHUNK_SIZE) que la UART emulada de QEMU pierde
    // bytes en transmisiones largas sin puntos de pausa -- el código
    // Python normal (muchas líneas cortas) sobrevive mejor que un
    // base64 de varios KB en una sola línea, probablemente porque
    // cada "\n" le da al lado receptor un punto natural para drenar
    // antes de que siga llegando más. Esto es una segunda capa de
    // defensa independiente del throttling de server.js -- no
    // reemplaza a SEND_CHUNK_SIZE/SEND_CHUNK_DELAY_MS, se suma.
    _wrapHalForIsolation(type, hal) {

        const b64 = btoa(unescape(encodeURIComponent(hal)));

        const width = ReplPanel.HAL_B64_LINE_WIDTH;
        const lines = [];
        for (let i = 0; i < b64.length; i += width) {
            lines.push(`        "${b64.slice(i, i + width)}"`);
        }

        return (
            `# -- HAL: ${type} (aislado) --\n` +
            `try:\n` +
            `    import ubinascii as _ub_iso\n` +
            `    exec(_ub_iso.a2b_base64(\n` +
            lines.join("\n") + "\n" +
            `    ).decode(), globals())\n` +
            `except Exception as _hal_err:\n` +
            `    print("HAL_ERROR:${type}: " + repr(_hal_err))\n`
        );

    }

    async _buildPendingHal() {

        const parts = [];
        const newlySent = []; // types que se agregan en ESTA tanda -- recién se marcan "sent" si todo sale bien

        // ── 1. Módulos siempre presentes (solo los que falten en esta sesión) ──
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

    async _assembleCode(userCode) {

        const { halBlock, newlySent } = await this._buildPendingHal();

        // Líneas que ocupa todo el HAL junto (antes de agregar el
        // código del usuario) -- +1 por cada "\n\n" de separación
        // entre partes que se agrega más abajo con parts.join.
        const halLineCount = halBlock ? halBlock.split("\n").length + 1 : 0;

        // ── Código del usuario ─────────────────────────────────────────
        const parts = [];
        if (halBlock) parts.push(halBlock);
        parts.push(`# -- Tu codigo --\n${userCode}`);

        const fullCode = this._sanitizeForSerial(parts.join("\n\n"));

        return { fullCode, halLineCount, newlySent };

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

    // Delay entre línea y línea al pegar en paste mode.
    //
    // ANTES: 60ms fijo por línea (después bajado a 20ms) -- pero un
    // número fijo no tiene en cuenta que server.js (writeToQemuThrottled)
    // parte cada línea en trozos de SEND_CHUNK_SIZE bytes con
    // SEND_CHUNK_DELAY_MS entre trozo y trozo. Una línea corta
    // ("import sys") entra en un trozo y el delay fijo sobraba. Pero
    // una línea de "def" larga/indentada podía pesar 3-4 trozos --
    // más tiempo real en el servidor que lo que nosotros esperábamos
    // acá. Como server.js procesa todo en una cola en orden (nunca
    // pierde nada, pero tampoco salta líneas), el resultado era que
    // la cola se iba acumulando línea a línea: arrancaba rápido
    // (líneas cortas al principio) y se iba poniendo cada vez más
    // lento a medida que aparecían líneas largas dentro de los "def".
    //
    // AHORA: calculamos cuánto va a tardar REALMENTE server.js en
    // mandar esa línea puntual (según su tamaño en bytes) y esperamos
    // al menos eso -- así nunca se forma cola, sea la línea corta o
    // larga. Estos dos valores tienen que coincidir con los de
    // server.js (SEND_CHUNK_SIZE / SEND_CHUNK_DELAY_MS) -- si se
    // cambian de un lado, cambiar del otro también.
    
    static SEND_CHUNK_SIZE      = 256; //32; // bytes -- debe igualar a server.js
    static SEND_CHUNK_DELAY_MS  =  2; //8;  // ms    -- debe igualar a server.js
    static PASTE_LINE_DELAY_MS  = 20; // piso mínimo, para líneas cortas

    // Bytes reales (no caracteres JS) que va a pesar la línea al
    // viajar por el WS -- importante si hay UTF-8 multibyte, aunque
    // _sanitizeForSerial ya debería dejar todo en ASCII puro.
    _lineDelayMs(line) {
        const bytes  = new TextEncoder().encode(line + "\r\n").length;
        const chunks = Math.max(1, Math.ceil(bytes / ReplPanel.SEND_CHUNK_SIZE));
        // El primer trozo sale ~inmediato; los siguientes pagan el
        // delay entre trozos (ver writeNextChunk en server.js).
        const serverTimeMs = (chunks - 1) * ReplPanel.SEND_CHUNK_DELAY_MS;
        return Math.max(ReplPanel.PASTE_LINE_DELAY_MS, serverTimeMs + ReplPanel.PASTE_LINE_DELAY_MS);
    }

    // Manda un bloque por paste mode (Ctrl+E, líneas con delay,
    // Ctrl+D). Si silent=true nunca se muestra nada (uso: precarga
    // de HAL en segundo plano, sin código de usuario de por medio).
    // Si no, se oculta el eco solo hasta halLineCount (uso normal:
    // Ejecutar, donde sí queremos ver correr el código del usuario).
    async _pasteBlock(fullCode, halLineCount, { silent = false } = {}) {

        // Interrumpe lo que estuviera corriendo antes y da un margen
        // para que MicroPython vuelva al prompt ">>>" antes del Ctrl+E.
        this.simulator.eventBus.emit("qemu:send", "\x03");
        await this._sleep(150);

        this._suppressEcho = true;
        this.simulator.eventBus.emit("qemu:send", "\x05"); // Ctrl+E: paste mode

        const lines = fullCode.split("\n");

        for (let i = 0; i < lines.length; i++) {
            await this._sleep(this._lineDelayMs(lines[i]));
            if (!silent && i === halLineCount) {
                // A partir de acá lo que se pega es código del
                // usuario: dejamos de ocultar el eco.
                this._suppressEcho = false;
            }
            this.simulator.eventBus.emit("qemu:send", lines[i] + "\n");
        }

        await this._sleep(ReplPanel.PASTE_LINE_DELAY_MS);
        this.simulator.eventBus.emit("qemu:send", "\x04"); // Ctrl+D: ejecutar
        await this._sleep(ReplPanel.PASTE_LINE_DELAY_MS);

        this._suppressEcho = false;

    }


    // ====================================================
    // ¿Reconexión "en caliente" o firmware realmente recién
    // arrancado? Manda un solo print() interactivo (NO pasa por
    // _enqueuePaste/paste mode -- es un comando suelto, como si el
    // usuario lo tipeara a mano) preguntando si sys.modules ya tiene
    // "_pit_state" sembrado por una corrida anterior de _base_hal.py.
    //
    // Se oculta con _suppressEcho para que este comando de
    // diagnóstico no ensucie el panel -- se restaura apenas se
    // resuelve la promesa (por respuesta o por timeout).
    //
    // PROBE_TIMEOUT_MS: tope de seguridad. Si no llega nada a
    // tiempo (REPL trabado, desconexión rara, primera vez que
    // arranca todo el stack), se resuelve como "no" -- incluso en
    // el peor caso, esto nunca deja al firmware SIN HAL: como mucho
    // repasteamos de más, que es exactamente el comportamiento que
    // había antes de este cambio.
    // ====================================================

    static PROBE_TIMEOUT_MS = 800;
    static PROBE_MARK = "_PIT_WARM_";

    _probeWarmBoot() {

        return new Promise((resolve) => {

            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                this._warmProbe = null;
                this._suppressEcho = false;
                resolve(false);
            }, ReplPanel.PROBE_TIMEOUT_MS);

            this._warmProbe = (isWarm) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this._suppressEcho = false;
                resolve(isWarm);
            };

            this._suppressEcho = true;
            this.simulator.eventBus.emit(
                "qemu:send",
                `print("${ReplPanel.PROBE_MARK}" + ("1" if "_pit_state" in __import__("sys").modules else "0"))`
            );

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

    async preloadHal() {

        const { halBlock, newlySent, hasPending } = await this._buildPendingHal();

        if (!hasPending) return;

        // Marcar ACÁ (optimista, antes de mandar de verdad) para que
        // si el usuario le da "Ejecutar" mientras esto todavía está
        // en la cola, _assembleCode() no vuelva a incluir el mismo
        // HAL una segunda vez.
        newlySent.forEach(type => this._halSentToFirmware.add(type));

        await this._enqueuePaste(() => this._pasteBlock(halBlock, 0, { silent: true }));

    }

    // ====================================================
    // Ejecutar código del editor
    // El usuario escribe MicroPython limpio.
    // El HAL se inyecta automáticamente e invisiblemente
    // (ni los mensajes de carga ni el eco del paste mode del
    // HAL se muestran en el panel -- solo tu propio código).
    // ====================================================

    async runEditorCode() {

        const userCode = this.editor.value.trim();
        if (!userCode) return;

        // Si ya hay una tanda en curso, ignoramos el click en vez
        // de arrancar una segunda tanda en paralelo -- eso era lo
        // que causaba el texto pisado/duplicado ("frofrofrom...")
        // cuando se clickeaba "Ejecutar" varias veces seguidas.
        if (this._running) return;

        this._running = true;
        const runBtn = document.getElementById("replBtnRun");
        if (runBtn) runBtn.disabled = true;

        this.switchTab("repl");
        this.appendOutput("\n▶ Ejecutando...\n", "repl-info");

        const { fullCode, halLineCount, newlySent } = await this._assembleCode(userCode);

        // Lo marcamos ya acá (optimista, antes de confirmar que QEMU
        // terminó de procesar el paste) -- si esta tanda falla a mitad
        // de camino, el peor caso es que algún HAL quede "marcado"
        // sin haberse pegado del todo, y el usuario tenga que volver
        // a intentar/perder ese componente puntual. Preferible a
        // esperar una confirmación que este protocolo no tiene forma
        // simple de dar.
        newlySent.forEach(type => this._halSentToFirmware.add(type));

        // _enqueuePaste hace que esto espere su turno si justo había
        // una precarga de HAL (preloadHal) todavía mandándose --
        // nunca se pisan los dos Ctrl+E entre sí.
        await this._enqueuePaste(() => this._pasteBlock(fullCode, halLineCount, { silent: false }));

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

        if (tab === "repl")   this.input.focus();
        if (tab === "editor") this.editor.focus();

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
            if (this.activeTab === "editor") this.editor.focus();
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
        const PROTOCOL_PREFIXES = ["GPIO:", "IN:", "ADC:", "I2C:", "DBG:", "OLED:", "LCD:", "TEMP:", "DIST:", "SERVOOUT:"];

        const isProtocolLine = (line) => {
            const t = line.trim();
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

        });

        this.simulator.eventBus.on("qemu:connected", async () => {
            this.appendOutput("\n✅ Conectado a QEMU — MicroPython listo\n", "repl-info");
            this.input.disabled   = false;
            this.sendBtn.disabled = false;
            this.prompt.style.color = "#00ff88";

            this._lastGpioLogged = {};

            // ANTES: cualquier reconexión de WebSocket vaciaba
            // _halSentToFirmware sin preguntar nada, asumiendo
            // "nueva conexión = firmware recién arrancado". Pero
            // node server.js lanza QEMU UNA sola vez -- si el
            // usuario solo apretó "Detener" y volvió a "Simular"
            // (sin reiniciar el server), MicroPython del otro lado
            // sigue vivo con todo el HAL ya cargado en memoria, y
            // repastearlo entero es tiempo perdido (varios segundos
            // con muchos componentes en el canvas).
            //
            // AHORA: le preguntamos primero. _probeWarmBoot() manda
            // un solo comando de REPL (sin pasar por paste mode) que
            // imprime si sys.modules["_pit_state"] ya existe -- eso
            // es justo lo que _base_hal.py deja sembrado la primera
            // vez que corre (ver el truco de "estado persistente
            // entre re-pasteos" en su propio archivo). Si dice que
            // SÍ, no tocamos _halSentToFirmware (nada para repastear).
            // Si dice que NO -- o no llega respuesta a tiempo, ver
            // PROBE_TIMEOUT_MS -- asumimos arranque limpio, igual que
            // antes: ante la duda, preferimos repastear de más que
            // dejar al firmware sin HAL.
            const warmBoot = await this._probeWarmBoot();
            if (!warmBoot) {
                this._halSentToFirmware.clear();
            }

            // Precargar el HAL pendiente en segundo plano YA, sin
            // esperar al primer "Ejecutar" -- para cuando el usuario
            // termine de escribir su código, el HAL (que puede
            // tardar varios segundos con muchos componentes en el
            // canvas) ya debería estar cargado, y "Ejecutar" solo
            // manda el código propiamente dicho.
            this.preloadHal();
        });

        this.simulator.eventBus.on("qemu:disconnected", () => {
            this.appendOutput("\n🔴 Desconectado de QEMU\n", "repl-error");
            this.input.disabled   = true;
            this.sendBtn.disabled = true;
            this.prompt.style.color = "#666";
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
    // REPL helpers
    // ====================================================

    sendInput() {

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

    appendOutput(text, cssClass = "") {

        if (!text) return;

        const span = document.createElement("span");
        if (cssClass) span.className = cssClass;
        span.textContent = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

        this.output.appendChild(span);

        // Limitar historial del output para no llenar la memoria
        while (this.output.childNodes.length > 2000) {
            this.output.removeChild(this.output.firstChild);
        }

        this.scrollToBottom();

    }

    scrollToBottom() {
        this.output.scrollTop = this.output.scrollHeight;
    }

}