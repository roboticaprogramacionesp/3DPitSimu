/*
==========================================================
 PitSimulator — WasmBridge.js

 Equivalente a QemuBridge.js pero para el runtime 100% en navegador
 (MicroPython compilado a WebAssembly, ver
 ~/projects/micropython-v1.28/ports/webassembly en el checkout de
 build -- no forma parte de este repo, se compila aparte y se sirve
 como assets/wasm/micropython.mjs + .wasm, ver plan en curso).

 Mismo contrato público que QemuBridge.js (los métodos/eventos que
 realmente consumen ReplPanel.js/SignalEngine.js, mapeados a mano
 antes de escribir esto): .connected (getter), .sendData(str),
 .interrupt(), .softReset(), .beginPasteLock()/.endPasteLock(), y los
 eventos "qemu:connected"/"qemu:disconnected"/"qemu:output"/
 "qemu:hal-error" sobre simulator.eventBus. Object para que
 ReplPanel.js/SignalEngine.js puedan usar cualquiera de los dos
 bridges sin saber cuál está activo (ver Fase 4 del plan, todavía no
 hecha -- este archivo no se importa desde index.html todavía).

 LIMITACIÓN CONOCIDA (ver plan, Fase 0, confirmado empíricamente): NO
 hay Ctrl+C real -- mientras un script corre (ej. un while True:),
 nada puede interrumpirlo desde afuera (time.sleep() no le devuelve
 el control a JS en ningún momento en este puerto). interrupt() acá
 mata el Worker entero y arranca uno nuevo -- pierde variables/estado,
 a diferencia del Ctrl+C real de QemuBridge.js. beginPasteLock/
 endPasteLock quedan como no-ops: no hay paste mode serial que
 proteger (no existe el concepto acá, runPython() manda el código
 entero de una).
==========================================================
*/

class WasmBridge {

    // Ruta a los assets compilados del puerto webassembly -- ver
    // Fase 1/2 del plan para cómo se generan.
    static WORKER_PATH = "js/simulator/wasmWorker.js";

    // Marca para que ReplPanel.js (y cualquier otro código que
    // dependa de this.simulator.qemuBridge genéricamente) pueda
    // distinguir este bridge del QemuBridge real SIN un import/
    // instanceof cruzado -- ver los puntos donde ReplPanel.js hace
    // cosas específicas de QEMU (probe de warm-boot/HAL congelado,
    // paste mode) que no aplican acá.
    isWasmBridge = true;

    // esp32Component: el componente ESP32 (del componentManager) que
    // ESTE bridge representa -- null para el caso "sin ninguna placa
    // en el lienzo" (se sigue permitiendo correr Python puro sin
    // hardware, mismo comportamiento que existía antes de soportar
    // multi-ESP32). A diferencia de QemuBridge (siempre 1 sola
    // instancia global), puede haber VARIOS WasmBridge vivos a la vez
    // -- ver Simulator.spawnBridgesForAllEsp32()/sim.bridges, que es
    // quien decide cuántos crear y con qué ESP32 cada uno.
    //
    // Ya NO se auto-suscribe a "simulation:start"/"simulation:stop"
    // (como sí hacía cuando solo existía UN bridge posible): con
    // varios bridges, cada uno reaccionando por su cuenta al mismo
    // evento global no deja ningún lugar central para decidir "cuáles
    // ESP32 hay ahora" -- esa decisión vive en
    // Simulator.spawnBridgesForAllEsp32()/teardownAllBridges(), que
    // llama a connect()/disconnect() de cada bridge a mano.
    constructor(simulator, esp32Component = null) {

        this.simulator = simulator;
        this.esp32 = esp32Component;

        this.worker = null;
        this._connected = false;

        // Buffer de líneas completas -- igual que QemuBridge.js, el
        // Worker puede mandar stdout en pedazos que no coinciden con
        // saltos de línea.
        this._lineBuf = "";

        // Multi-ESP32 (ver plan ESP-NOW, Fase 2 -- selector de
        // dispositivo en ReplPanel.js): este listener sigue en
        // simulator.eventBus (compartido por TODOS los bridges, nunca
        // uno privado por instancia), pero se ignora de una si este
        // bridge no es "el activo" en este momento (this !==
        // simulator.qemuBridge) -- ReplPanel._switchActiveDevice()
        // repunta simulator.qemuBridge al bridge seleccionado en el
        // dropdown, así que una línea tipeada en el input de abajo del
        // REPL solo le llega al Worker que se está mirando, nunca a
        // los demás. Con un solo ESP32 (caso de siempre, selector
        // oculto), simulator.qemuBridge === this siempre, cero cambio
        // de comportamiento.
        //
        // ReplPanel.sendInput() (el input de una línea + botón
        // "Enviar" del REPL, abajo del todo -- distinto de ▶ Ejecutar,
        // que ya usa sendData() directo, ver runEditorCode()) NO llama
        // a qemuBridge.sendData() -- emite "qemu:send", mismo evento
        // que QemuBridge.js usa para TODO su tráfico de bajo nivel
        // (paste mode, Ctrl+C/D, líneas sueltas). Sin este listener,
        // cualquier cosa tipeada ahí se perdía en silencio -- no
        // llegaba a ningún lado (reportado por el usuario: "led.on()"
        // tipeado en el REPL no hacía nada). Los bytes de control que
        // sí manda ReplPanel por acá (Ctrl+C/D/E, paste mode) no
        // aplican al modelo de WasmBridge -- runEditorCode() ya evita
        // mandarlos para este bridge, así que en la práctica solo
        // llegan líneas sueltas de código real.
        this.simulator.eventBus.on("qemu:send", (text) => {
            if (this.simulator.qemuBridge !== this) return;

            if (text === "\x03") { this.interrupt(); return; }
            if (text === "\x04" || text === "\x05") return; // paste mode, no aplica acá

            // Eco tipo REPL -- QEMU real lo hace solo (el pty lo
            // devuelve), acá no hay pty, así que sin esto el usuario
            // no ve NADA en la terminal para algo como "led.on()"
            // (correcto que no imprima nada -- ni en hardware real lo
            // hace -- pero entonces no queda ninguna confirmación
            // visible de que se ejecutó).
            this.simulator.eventBus.emit("qemu:output", `>>> ${text}\n`);

            // BUG REAL reportado: escribir una línea sola con el
            // NOMBRE de una variable (ej. "a" después de "a = 'Hola'")
            // no mostraba nada -- a diferencia de un REPL real, donde
            // escribir una expresión suelta la muestra sola (sin
            // necesidad de print()). mp.runPython(code) (lo que usa
            // sendData() normalmente) corre el código como un script
            // (exec), que siempre DESCARTA el valor de una expresión
            // suelta -- nunca iba a mostrar nada, con o sin corrupción
            // de por medio. replEcho:true (solo para esta línea
            // suelta del input de abajo, nunca para "▶ Ejecutar") le
            // pide al Worker que la corra con semántica de REPL real
            // (ver _pit_repl_eval en _base_wasm.py): si es una
            // expresión, muestra su repr -- igual que tipear "a" en
            // una terminal Python de verdad. print() ya funcionaba
            // antes de este fix y sigue igual (no depende de esto).
            this.sendData(text, { replEcho: true });
        });

    }

    get connected() {
        return this._connected;
    }

    // ====================================================
    // Conexión (equivalente a "arrancar QEMU")
    // ====================================================

    connect() {

        this._spawnWorker();

    }

    _spawnWorker() {

        if (this.worker) {
            try { this.worker.terminate(); } catch (err) { /* no-op */ }
        }

        // Resolvers de sendData()-tipo-"run" pendientes -- si el
        // Worker se mata (interrupt()) a mitad de un run, ese
        // "runDone" nunca va a llegar (ver wasmWorker.js): sin esto,
        // el Promise de esa llamada quedaría colgado para siempre.
        // Se resuelven todos acá, al levantar el Worker NUEVO --
        // buen momento para "dar por terminado" cualquier run previo.
        if (this._pendingRunResolvers) {
            this._pendingRunResolvers.forEach(resolve => resolve());
        }
        this._pendingRunResolvers = new Map();
        this._runIdCounter = 0;

        this.worker = new Worker(WasmBridge.WORKER_PATH, { type: "module" });

        this.worker.onmessage = (e) => this._onWorkerMessage(e.data);

        this.worker.onerror = (e) => {
            console.error("[WasmBridge] error en el Worker:", e.message);
        };

        // macHex: MAC de este ESP32 sin ":" (ver _espnow_wasm.py) --
        // this.esp32 es null en el bridge "sin placa" (ver
        // Simulator.spawnBridgesForAllEsp32()), de ahí el fallback.
        const macHex = this.esp32?.properties?.macAddress
            ? this.esp32.properties.macAddress.replace(/:/g, "").toLowerCase()
            : "000000000000";
        this.worker.postMessage({ type: "init", macHex });

    }

    _onWorkerMessage(msg) {

        if (msg.type === "ready") {
            this._connected = true;

            // Multi-ESP32 (Fase 2): updateStatus()/"qemu:connected" son
            // UI del dispositivo que se está mirando en el REPL (badge
            // de arriba, banner de bienvenida) -- si ESTE bridge no es
            // el activo (ver gating en "qemu:send" más arriba), no se
            // tocan: el usuario los ve recién al elegir este
            // dispositivo en el selector (ver ReplPanel._switchActiveDevice(),
            // que llama a _activateWasmDeviceReady() a mano para ese
            // caso). startSimulation()/setEsp32PowerLed() SÍ corren
            // siempre -- son estado real de la simulación/del propio
            // ESP32, no de qué pestaña del REPL está abierta.
            if (this.simulator.qemuBridge === this) {
                this.updateStatus("connected");
            }

            // BUG REAL (reportado: "doy clic en Simular y tarda un monton
            // mostrando Conectando, pero el boton Ejecutar ya esta
            // habilitado" -- la UI quedaba inconsistente, aunque no
            // rompia nada funcionalmente): el orden de estas dos lineas
            // estaba invertido. startSimulation() dispara
            // "simulation:started" -> Toolbar.updateUI(true), que deja
            // el botón ▶Simular/⏹Detener en "⏳ Conectando..."
            // deshabilitado (correcto como estado INICIAL, pensado para
            // QEMU, donde el WebSocket abre mucho antes de que el
            // intérprete esté listo). Pero en modo WASM, "qemu:connected"
            // YA deja todo listo de una (ver el comentario grande en
            // ReplPanel.js sobre esto) -- dispara _onReplReady()
            // SINCRÓNICAMENTE, que habilita "▶ Ejecutar" Y emite
            // "repl:ready" (que pone el botón en "⏹ Detener" habilitado).
            // Si "qemu:connected" se emite ANTES de startSimulation()
            // (como estaba), ese startSimulation() de ACÁ ABAJO corre
            // DESPUÉS y pisa el "⏹ Detener" que "repl:ready" recién puso,
            // dejando el botón trabado en "Conectando..." para siempre
            // aunque el REPL ya esté 100% listo. Invertido: ahora
            // startSimulation() (y su "Conectando..." inicial) corre
            // PRIMERO, y "qemu:connected" (que deja todo listo de una)
            // corre último -- el mismo orden que ya tenía sentido para
            // QEMU, solo que acá ambos pasos ocurren casi en el mismo
            // instante en vez de estar separados por varios segundos.
            this.simulator.startSimulation();
            if (this.simulator.qemuBridge === this) {
                this.simulator.eventBus.emit("qemu:connected");
            }

            if (this.esp32) this.simulator.renderer.setEsp32PowerLed(this.esp32, true);

            return;
        }

        if (msg.type === "stdout") {
            this._handleStdout(msg.data);
            return;
        }

        if (msg.type === "error") {
            // Mismo criterio que _handleStdout() -- no descartar si
            // este bridge no es el activo ahora mismo (ver su comentario
            // grande), se acumula para mostrarlo al volver a mirarlo.
            if (this.simulator.qemuBridge === this) {
                this.simulator.eventBus.emit("qemu:output", msg.data);
            } else {
                this._pendingVisibleOutput = (this._pendingVisibleOutput || "") + msg.data;
            }
            return;
        }

        if (msg.type === "runDone") {
            const resolve = this._pendingRunResolvers?.get(msg.runId);
            if (resolve) {
                this._pendingRunResolvers.delete(msg.runId);
                resolve();
            }
            return;
        }

    }

    // ====================================================
    // Salida del intérprete -- mismo criterio línea por línea que
    // QemuBridge.js (parsea protocolo, el resto va al terminal).
    // ====================================================

    _handleStdout(data) {

        this._lineBuf += data;

        const lines = this._lineBuf.split("\n");
        this._lineBuf = lines.pop();

        const visibleLines = [];

        lines.forEach(line => {

            if (this._tryParseProtocolLine(line)) return;

            visibleLines.push(line);

        });

        // Multi-ESP32 (Fase 2/3): el parseo de protocolo de arriba
        // (_tryParseProtocolLine, GPIO/PWM/OLED/etc.) corre SIEMPRE,
        // para todos los bridges, porque es el estado real del
        // hardware simulado de CADA uno, no de qué pestaña del REPL
        // está abierta. El TEXTO visible (prints del alumno) sí
        // depende de eso -- pero en vez de descartarlo cuando este
        // bridge no es el activo, se acumula en _pendingVisibleOutput
        // y ReplPanel._switchActiveDevice() lo vuelca al terminal
        // apenas se vuelve a mirar este dispositivo.
        //
        // BUG REAL reportado al probar ESP-NOW con 2 ESP32 (el caso de
        // uso central de esta fase): un script típico registra
        // irq(on_recv) y después print() lo que llegó -- con el
        // comportamiento ANTERIOR (descartar sin más), ese print()
        // desaparecía para siempre si el mensaje llegaba mientras el
        // usuario miraba el OTRO dispositivo (el caso normal: A manda,
        // B recibe, pero B no está seleccionado en ese momento) -- no
        // había NINGUNA forma de confirmar que el mensaje había
        // llegado sin adivinar o escribir código extra a propósito
        // solo para consultar una variable.
        if (visibleLines.length > 0) {
            const text = visibleLines.join("\n") + "\n";
            if (this.simulator.qemuBridge === this) {
                this.simulator.eventBus.emit("qemu:output", text);
            } else {
                this._pendingVisibleOutput = (this._pendingVisibleOutput || "") + text;
            }
        }

    }

    // Mismo formato de protocolo que QemuBridge.js ("GPIO:<n>:<v>",
    // etc.) -- ADC/I2CR (simulador→firmware) todavía no aplican acá,
    // se suman cuando se porten componentes que los necesiten.
    _tryParseProtocolLine(line) {

        if (line.startsWith("GPIO:")) {
            const parts = line.split(":");
            if (parts.length >= 3) {
                const pin   = parseInt(parts[1], 10);
                const value = parseInt(parts[2], 10);
                if (!isNaN(pin) && (value === 0 || value === 1)) {
                    this._applyGpioChange(pin, value);
                }
            }
            return true;
        }

        if (line.startsWith("PWM:")) {
            // Formato: PWM:<gpio>:<freq>:<duty> -- ver _base_wasm.py
            // (misma clase PWM sintética que components/_base/_base.hal.py).
            const parts = line.split(":");
            if (parts.length >= 4) {
                const gpio = parseInt(parts[1], 10);
                const freq = parseInt(parts[2], 10);
                const duty = parseInt(parts[3], 10);
                if (!isNaN(gpio) && !isNaN(freq)) {
                    this.simulator.signalEngine.setPwmState(this._espId(), `io${gpio}`, freq, duty);
                }
            }
            return true;
        }

        if (line.startsWith("NEOR:")) {
            // Formato: NEOR:<n>:<RGB888 por pixel en hex, 6 hex chars cada
            // uno> -- mismo protocolo y mismo método de render que ya usa
            // QemuBridge.js (ver su propio comentario junto a "NEOR:") al
            // recibir esto de neopixel_ring.hal.py. Acá lo manda
            // _neopixel_wasm.py, idéntico salvo que corre en el Worker en
            // vez de en QEMU -- SignalEngine.applyNeopixelRingFrame() no
            // sabe ni le importa de dónde vino la línea.
            const parts = line.split(":");
            if (parts.length >= 3) {
                const n = parseInt(parts[1], 10);
                if (!Number.isNaN(n)) {
                    const hex = parts.slice(2).join(":");
                    this.simulator.signalEngine.applyNeopixelRingFrame(hex, n);
                }
            }
            return true;
        }

        if (line.startsWith("SERVOOUT:")) {
            // Formato: SERVOOUT:<gpio>:<angulo> -- ver QemuBridge.js
            // (sg90.hal.py al llamar servo.duty()/duty_u16()).
            const parts = line.split(":");
            if (parts.length >= 3) {
                const gpio = parseInt(parts[1], 10);
                const angle = parseFloat(parts[2]);
                if (!isNaN(gpio) && !isNaN(angle)) {
                    this.simulator.signalEngine.applyServoAngleFromFirmware(gpio, angle);
                }
            }
            return true;
        }

        if (line.startsWith("OLED:")) {
            // Formato: OLED:<ancho>x<alto>:<framebuffer en hex> -- mismo
            // protocolo que QemuBridge.js (ver su propio comentario junto
            // a "OLED:"), lo manda components/oled/oled.hal.py tal cual,
            // corra en QEMU o en este Worker.
            const parts = line.split(":");
            if (parts.length >= 3) {
                const dims = parts[1].match(/^(\d+)x(\d+)$/);
                if (dims) {
                    const width  = parseInt(dims[1], 10);
                    const height = parseInt(dims[2], 10);
                    const hex    = parts.slice(2).join(":");
                    this.simulator.signalEngine.applyOledFramebuffer(hex, width, height);
                }
            }
            return true;
        }

        if (line.startsWith("OLEDC:")) {
            // Formato: OLEDC:<contraste 0-255> -- ver QemuBridge.js.
            const value = parseInt(line.slice("OLEDC:".length), 10);
            if (!isNaN(value)) {
                this.simulator.signalEngine.applyOledContrast(value);
            }
            return true;
        }

        if (line.startsWith("LCD:")) {
            // Formato: LCD:<cols>x<rows>:<backlight>:<display_on>:
            //          <cursor_on>:<blink_on>:<cursor_col>:<cursor_row>:
            //          <fila0 hex>:<fila1 hex>... -- ver QemuBridge.js.
            const parts = line.split(":");
            if (parts.length >= 9) {
                const dims = parts[1].match(/^(\d+)x(\d+)$/);
                if (dims) {
                    const cols = parseInt(dims[1], 10);
                    const rows = parseInt(dims[2], 10);
                    const backlight = parts[2] === "1";
                    const cursorState = {
                        displayOn: parts[3] === "1",
                        cursorOn:  parts[4] === "1",
                        blinkOn:   parts[5] === "1",
                        cursorCol: parseInt(parts[6], 10),
                        cursorRow: parseInt(parts[7], 10),
                    };
                    const rowsHex = parts.slice(8);
                    this.simulator.signalEngine.applyLcdFramebuffer(rowsHex, cols, rows, backlight, cursorState);
                }
            }
            return true;
        }

        if (line.startsWith("MAX:")) {
            // Formato: MAX:<ancho>x<alto>:<bitmap hex, 1 bit/pixel> -- ver
            // QemuBridge.js.
            const parts = line.split(":");
            if (parts.length >= 3) {
                const dims = parts[1].match(/^(\d+)x(\d+)$/);
                if (dims) {
                    const width  = parseInt(dims[1], 10);
                    const height = parseInt(dims[2], 10);
                    const hex    = parts.slice(2).join(":");
                    this.simulator.signalEngine.applyMax7219Framebuffer(hex, width, height);
                }
            }
            return true;
        }

        if (line.startsWith("TM1637:")) {
            // Formato: TM1637:<8 caracteres hex = 4 bytes> -- ver QemuBridge.js.
            const hex = line.slice("TM1637:".length);
            this.simulator.signalEngine.applyTm1637Segments(hex);
            return true;
        }

        if (line.startsWith("TFT:")) {
            // Formato: TFT:<x>:<y>:<ancho>x<alto>:<hex RGB565 o "S<hex4>"
            // para relleno sólido> -- ver QemuBridge.js.
            const parts = line.split(":");
            if (parts.length >= 5) {
                const x = parseInt(parts[1], 10);
                const y = parseInt(parts[2], 10);
                const dims = parts[3].match(/^(\d+)x(\d+)$/);
                if (dims && !isNaN(x) && !isNaN(y)) {
                    const width  = parseInt(dims[1], 10);
                    const height = parseInt(dims[2], 10);
                    const hex    = parts.slice(4).join(":");
                    if (hex.startsWith("S")) {
                        const colorValue = parseInt(hex.slice(1), 16);
                        if (!isNaN(colorValue)) {
                            this.simulator.signalEngine.applyTftSolidFill(colorValue, x, y, width, height);
                        }
                    } else {
                        this.simulator.signalEngine.applyTftRegion(hex, x, y, width, height);
                    }
                }
            }
            return true;
        }

        if (line.startsWith("NEO:")) {
            // Formato: NEO:<ancho>x<alto>:<RGB888 por pixel en hex> -- ver
            // QemuBridge.js (matriz 2D framebuf, a diferencia de "NEOR:").
            const parts = line.split(":");
            if (parts.length >= 3) {
                const dims = parts[1].match(/^(\d+)x(\d+)$/);
                if (dims) {
                    const width  = parseInt(dims[1], 10);
                    const height = parseInt(dims[2], 10);
                    const hex    = parts.slice(2).join(":");
                    this.simulator.signalEngine.applyNeopixelFramebuffer(hex, width, height);
                }
            }
            return true;
        }

        if (line.startsWith("PININFO:")) {
            // Formato: PININFO:<key>:<pin1>=<gpio>,... -- ver el
            // comentario grande en QemuBridge.js: valida que el cable
            // dibujado llegue al mismo pin que declaró el firmware. Sin
            // esto, cualquier componente con esta validación (lcd/oled/
            // tm1637/tft/keypad_i2c) nunca se consideraría "bien cableado"
            // en modo navegador.
            const rest = line.slice("PININFO:".length);
            const sepIdx = rest.lastIndexOf(":");
            if (sepIdx > 0) {
                const key = rest.slice(0, sepIdx);
                const pairsStr = rest.slice(sepIdx + 1);
                const pins = {};
                pairsStr.split(",").forEach(pair => {
                    const [name, numStr] = pair.split("=");
                    const num = parseInt(numStr, 10);
                    if (name && !Number.isNaN(num)) pins[name] = num;
                });
                this.simulator.signalEngine.setDeclaredPins(key, pins);
            }
            return true;
        }

        if (line.startsWith("I2CW:")) {
            // Formato: I2CW:<addr>:<byte> -- ver _i2c_bus_wasm.py.
            const parts = line.split(":");
            if (parts.length >= 3) {
                const addr  = parseInt(parts[1], 10);
                const value = parseInt(parts[2], 10);
                if (!isNaN(addr) && !isNaN(value)) {
                    this.simulator.signalEngine.setI2cWrittenByte(addr, value);
                }
            }
            return true;
        }

        if (line.startsWith("ESPNOW_TX:")) {
            // Formato: ESPNOW_TX:<mac hex SIN ":">:<payload hex> --
            // ver _espnow_wasm.py (ESPNow.send()). A diferencia de
            // GPIO/I2C/etc., esto NO llama a signalEngine -- EspNowBus
            // decide a qué otro(s) ESP32 del lienzo les llega, según
            // su MAC (comparación por propiedades, no por cableado:
            // ESP-NOW es inalámbrico, no hay "net" de SignalEngine que
            // caminar acá).
            const parts = line.split(":");
            if (parts.length >= 3 && this.esp32) {
                this.simulator.espNowBus.send(this.esp32.id, parts[1], parts[2]);
            }
            return true;
        }

        if (line.startsWith("HTTP_REQ:")) {
            // Formato: HTTP_REQ:<id>:<method hex>:<url hex>:<headers
            // JSON, hex>:<body hex> -- ver _requests_wasm.py
            // (request()). A diferencia de ESPNOW_TX, esto no es
            // instantáneo (fetch() real a internet) -- _handleHttpRequest()
            // es async y contesta por su cuenta cuando termine, no
            // bloquea el resto del parseo de esta línea.
            const parts = line.split(":");
            if (parts.length >= 6) {
                this._handleHttpRequest(parts[1], parts[2], parts[3], parts[4], parts[5]);
            }
            return true;
        }

        if (line.startsWith("BLE_ADV:")) {
            // Formato: BLE_ADV:<nombre hex> -- ver _bluetooth_wasm.py
            // (BLE.gap_advertise(), solo cuando reconoce el Nordic
            // UART Service). Avisa que ESTE ESP32 ahora es "visible"
            // para el teléfono virtual -- ver BlePanel.js.
            const name = WasmBridge._hexToUtf8(line.slice("BLE_ADV:".length));
            if (this.esp32) {
                this.simulator.eventBus.emit("ble:advertising", { esp32Id: this.esp32.id, name });
            }
            return true;
        }

        if (line.startsWith("BLE_NOTIFY:")) {
            // Formato: BLE_NOTIFY:<hex> -- ver _bluetooth_wasm.py
            // (BLE.gatts_notify() sobre el characteristic TX de NUS).
            const data = WasmBridge._hexToUtf8(line.slice("BLE_NOTIFY:".length));
            if (this.esp32) {
                this.simulator.eventBus.emit("ble:notify", { esp32Id: this.esp32.id, data });
            }
            return true;
        }

        const halErrorMatch = line.match(/^HAL_ERROR:([^:]+):/);
        if (halErrorMatch) {
            // Multi-ESP32 (Fase 2): mismo criterio que "qemu:output".
            // OJO -- a diferencia de ese caso, acá SÍ hay un efecto de
            // comportamiento, no solo visual: el listener de
            // ReplPanel dispara _retryHalAfterError(), que lee/escribe
            // this._halSentToFirmware/_halRetryCounts -- campos POR
            // DISPOSITIVO (ver _switchActiveDevice()). Si esto no se
            // filtrara, un HAL roto en un dispositivo en SEGUNDO PLANO
            // terminaría reintentando contra el estado del dispositivo
            // ACTIVO, mezclando los dos. Se acepta como límite conocido:
            // un componente roto en un dispositivo no mirado no
            // reintenta hasta que se lo selecciona (en la práctica no
            // cambia el resultado final -- en modo navegador un
            // HAL_ERROR nunca es ruido pasajero, reintentar con el
            // mismo código nunca lo arregla, ver el comentario grande
            // en bindBusEvents() de ReplPanel.js).
            if (this.simulator.qemuBridge === this) {
                this.simulator.eventBus.emit("qemu:hal-error", halErrorMatch[1]);
            }
            return true;
        }

        return false;

    }

    // ====================================================
    // WiFi (fetch() real) -- ver plan ESP-NOW→WiFi→BLE, Fase WiFi, y
    // _requests_wasm.py para el protocolo completo. El request en sí
    // (método/url/headers/body) viaja hex-codificado DENTRO de la
    // línea de protocolo -- helpers acá en vez de en _requests_wasm.py
    // porque acá se necesita ida (decodificar el pedido) Y vuelta
    // (codificar la respuesta), y porque TextEncoder/TextDecoder son
    // nativos de JS (no hace falta reimplementar UTF-8 a mano como sí
    // hace falta del lado Python).
    // ====================================================

    static _hexToUtf8(hex) {
        if (!hex) return "";
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return new TextDecoder().decode(bytes);
    }

    static _utf8ToHex(str) {
        const bytes = new TextEncoder().encode(str);
        return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    async _handleHttpRequest(rid, methodHex, urlHex, headersHex, bodyHex) {

        const method = WasmBridge._hexToUtf8(methodHex);
        const url = WasmBridge._hexToUtf8(urlHex);
        const bodyText = WasmBridge._hexToUtf8(bodyHex);

        let headers = {};
        try {
            headers = JSON.parse(WasmBridge._hexToUtf8(headersHex) || "{}");
        } catch (err) {
            // Headers mal formados de origen (no debería pasar, los
            // arma json.dumps() del lado Python) -- mandar sin ellos
            // antes que no mandar nada.
        }

        try {

            const fetchOpts = { method, headers };
            // fetch() tira TypeError si GET/HEAD trae body -- mismo
            // caso raro que requests.py real ignora en la práctica.
            if (bodyText && method !== "GET" && method !== "HEAD") {
                fetchOpts.body = bodyText;
            }

            const response = await fetch(url, fetchOpts);
            const respBodyText = await response.text();

            const respHeaders = {};
            response.headers.forEach((value, key) => { respHeaders[key] = value; });

            const reasonHex  = WasmBridge._utf8ToHex(response.statusText || "");
            const headersOutHex = WasmBridge._utf8ToHex(JSON.stringify(respHeaders));
            const bodyOutHex = WasmBridge._utf8ToHex(respBodyText);

            this._deliverHttpResponse(rid, `${response.status}|${reasonHex}|${headersOutHex}|${bodyOutHex}`);

        } catch (err) {

            // Causa más común con mucha ventaja: CORS -- el navegador
            // bloquea la respuesta de un servidor que no mandó
            // Access-Control-Allow-Origin, y fetch() lo reporta como
            // un TypeError genérico ("Failed to fetch") sin más
            // detalle (restricción del propio navegador, no hay forma
            // de distinguirlo de "sin internet"/"URL no existe" desde
            // JS) -- el mensaje avisa de las 3 causas más probables en
            // vez de repetir el texto críptico del navegador tal cual.
            const msgHex = WasmBridge._utf8ToHex(
                `No se pudo completar la solicitud a "${url}" -- ` +
                `puede ser que no haya internet, que la URL esté mal, o que ese ` +
                `servidor no permita pedidos desde el navegador (CORS). Detalle: ${err.message || err}`
            );
            this._deliverHttpResponse(rid, `ERROR|${msgHex}`);

        }

    }

    // BUG REAL encontrado en vivo (ver el comentario grande de
    // "setGlobal" en wasmWorker.js): la respuesta HTTP NO se manda por
    // sendData()/processLine (eso dispara un mp.runPython() nuevo),
    // porque el script que la está esperando casi siempre sigue
    // "en vuelo" (suspendido en SU PROPIO time.sleep() de sondeo,
    // dentro de request()) -- dos mp.runPython() superpuestos en el
    // mismo módulo Asyncify revientan con "We cannot start an async
    // operation when one is already in flight". mp.globals.set() en
    // cambio no ejecuta nada, así que es seguro en cualquier momento;
    // request() del lado Python ya está despierto cada poll_ms
    // revisando este mismo valor, no hace falta "empujarlo" con una
    // ejecución nueva.
    _deliverHttpResponse(rid, packedValue) {
        if (!this.worker) return;
        this.worker.postMessage({ type: "setGlobal", key: `_pit_http_res_${rid}`, value: packedValue });
    }

    // ====================================================
    // BLE -- acciones del teléfono virtual (ver BlePanel.js) hacia
    // ESTE ESP32. Bajo volumen (clics puntuales del usuario, no un
    // sondeo en loop), así que van por el mecanismo processLine de
    // siempre -- mismo patrón ya probado seguro que ESPNOW_RX.
    // ====================================================

    bleConnect() {
        this.sendData("BLE_CONNECT:");
    }

    bleDisconnect() {
        this.sendData("BLE_DISCONNECT:");
    }

    bleWrite(text) {
        this.sendData(`BLE_WRITE:${WasmBridge._utf8ToHex(text)}`);
    }

    _espId() {
        return this.esp32?.id;
    }

    // Mismo criterio que QemuBridge.applyGpioChange() -- búsqueda en
    // vivo del PIN (el ESP32 ya no se busca acá, es this.esp32, fijo
    // para toda la vida de este bridge -- ver constructor).
    _applyGpioChange(gpioNumber, value) {

        const esp32 = this.esp32;
        if (!esp32) return;

        const exactId = `io${gpioNumber}`;
        let pin = esp32.pins.find(p => p.id === exactId);

        if (!pin) {
            const regex = new RegExp(`\\bgpio${gpioNumber}\\b`);
            pin = esp32.pins.find(p => p.name && regex.test(p.name.toLowerCase()));
        }

        if (!pin) {
            console.warn(`[WasmBridge] GPIO${gpioNumber} no encontrado en el ESP32`);
            return;
        }

        this.simulator.signalEngine.setDriverState(esp32.id, pin.id, value);
        this.simulator.eventBus.emit("gpio:changed", { gpio: gpioNumber, pinId: pin.id, value });

    }

    // ====================================================
    // Envío de código -- a diferencia de QemuBridge.js (paste mode
    // serial, línea por línea con delay), acá se manda el código
    // ENTERO de una sola vez: no hay pty que corromper.
    //
    // sendData() cumple DOS roles distintos, igual que en
    // QemuBridge.js -- ejecutar código del alumno, Y mandar
    // protocolo simulador→firmware (ej. "IN:<gpio>:<valor>\n" que
    // manda SignalEngine._notifyButtonToFirmware() al apretar un
    // botón). En QEMU ambos caminos son "escribir al mismo stdin".
    // Acá NO son el mismo camino (uno va por "run", el otro por
    // "processLine", ver wasmWorker.js) -- pero ACTUALIZADO: "IN:" SÍ
    // puede llegar a aplicarse EN VIVO mientras un script ya está
    // corriendo, siempre que ese script esté en un yield de Asyncify
    // (adentro de un time.sleep()) en el momento en que llega -- ver
    // mp_hal_delay_ms() en mphalport.c del build de micropython.mjs.
    // Si el script no tiene ningún sleep() en su bucle (nunca cede el
    // control), sigue aplicando solo para la PRÓXIMA corrida, como
    // antes.
    // Heurística para distinguir protocolo ("IN:18:1", "BH1750:35:500.0")
    // de código real del alumno -- todo lo que manda SignalEngine.js
    // por sendData() tiene esta forma (PREFIJO:número:...). No es
    // perfecto (una anotación de tipo Python a nivel módulo, "X: int",
    // podría calzar) pero alcanza porque en la práctica sendData()
    // nunca mezcla las dos cosas en un mismo llamado (ver Fase 4 del
    // plan -- ahí se separa en dos métodos explícitos en vez de
    // heredar esta ambigüedad del modelo de stream único de QEMU).
    static PROTOCOL_LINE_RE = /^[A-Z][A-Z0-9_]*:[\d.]/;

    // BUG REAL encontrado en vivo probando rc522 (RFID:): a diferencia
    // de TODOS los demás protocolos simulador→firmware (que siempre
    // tienen un NÚMERO pegado al primer ":" -- dirección I2C, número
    // de GPIO, etc.), "RFID:<uid_hex8>"/"RFID:NONE" tiene el PAYLOAD
    // mismo ahí (un UID hexadecimal que la mitad de las veces arranca
    // con una letra A-F, o literalmente "NONE") -- PROTOCOL_LINE_RE
    // nunca matcheaba esos casos, así que la línea se mandaba entera a
    // mp.runPython() como si fuera código del alumno (y revienta con
    // NameError/SyntaxError, silenciado en el Worker). Resultado real:
    // tapear una tarjeta en el canvas en modo navegador no hacía NADA
    // la mayoría de las veces (solo "funcionaba" por casualidad cuando
    // el UID generado arrancaba con un dígito 0-9). Se agrega como
    // caso aparte en vez de intentar generalizar la regex (es el único
    // protocolo con esta forma, ver el resto de SignalEngine.js).
    //
    // BLE_CONNECT:/BLE_DISCONNECT: (ver BlePanel.js) no tienen NINGÚN
    // payload después del ":" -- la regex de arriba exige un carácter
    // ahí, así que nunca matchea una línea vacía. BLE_WRITE:<hex>
    // tiene el mismo problema que RFID: (el hex puede arrancar con
    // a-f).
    static PROTOCOL_LINE_PREFIXES = ["RFID:", "BLE_CONNECT:", "BLE_DISCONNECT:", "BLE_WRITE:"];

    static _isProtocolLine(data) {
        if (WasmBridge.PROTOCOL_LINE_RE.test(data)) return true;
        return WasmBridge.PROTOCOL_LINE_PREFIXES.some(prefix => data.startsWith(prefix));
    }

    // Snapshot de teclado(s) matriciales I2C (keypad4x4_i2c) para
    // _keypad_i2c_wasm.py -- ver ese archivo para el porqué completo
    // (get_key() escribe y lee I2C en la MISMA llamada sincrónica, el
    // mecanismo genérico I2CR:/I2CW: no llega a tiempo). Formato texto
    // plano "<addr>=<fila,col>;<fila,col>|<addr>=..." (sin JSON, no
    // depende de que "json" esté compilado en este build del puerto).
    // Misma lógica de dirección por defecto que
    // keypad4x4_i2c.behavior.js (_keypadI2cAddress) para no divergir.
    _computeKeypadI2cSnapshot() {
        const parts = [];
        for (const c of this.simulator.componentManager.getAll()) {
            if (c.type !== "keypad4x4_i2c") continue;
            const pressed = c.keypadPressed;
            if (!pressed || pressed.size === 0) continue;
            const raw = c.properties?.address;
            let addr;
            if (raw === undefined || raw === null || raw === "") {
                addr = 0x20;
            } else {
                addr = typeof raw === "string"
                    ? parseInt(raw, raw.trim().toLowerCase().startsWith("0x") ? 16 : 10)
                    : raw;
                if (!Number.isFinite(addr)) addr = 0x20;
            }
            parts.push(`${addr}=${[...pressed].join(";")}`);
        }
        return parts.join("|");
    }

    // Para código real (rama "run"): devuelve una Promise que se
    // resuelve cuando el Worker confirma que mp.runPython() TERMINÓ
    // de verdad (mensaje "runDone", ver wasmWorker.js) -- no cuando
    // el postMessage() se mandó. runEditorCode() la espera para no
    // reactivar el botón ▶ Ejecutar mientras el script todavía está
    // corriendo (ej. un while True: con time.sleep(), que puede
    // tardar para siempre -- ver la LIMITACIÓN CONOCIDA arriba: la
    // única forma de que esta Promise SI o SI se resuelva es que el
    // script termine solo o que se llame a interrupt(), que resuelve
    // todo lo pendiente al matar el Worker viejo).
    sendData(data, { replEcho = false } = {}) {

        if (!this.worker || !this._connected) return Promise.resolve();

        if (WasmBridge._isProtocolLine(data)) {
            this.worker.postMessage({ type: "processLine", line: data.trim() });
            return Promise.resolve();
        }

        const runId = ++this._runIdCounter;
        const promise = new Promise(resolve => this._pendingRunResolvers.set(runId, resolve));
        const keypadSnapshot = this._computeKeypadI2cSnapshot();
        this.worker.postMessage({ type: "run", code: data, runId, replEcho, keypadSnapshot });
        return promise;

    }

    // Estado compartido entre interrupt() y disconnect(): apaga todo
    // lo visual/de simulación, mismo criterio que QemuBridge.onClose().
    _teardown() {

        if (!this._connected) return false;

        this._connected = false;

        // Multi-ESP32 (Fase 2): mismo criterio que el resto -- UI del
        // dispositivo activo solamente. stopSimulation() sí corre
        // siempre (ver decisión de diseño #1 del plan: un solo
        // ⏹ Detener para todos los ESP32 a la vez, no hay stop por
        // dispositivo en esta entrega).
        if (this.simulator.qemuBridge === this) {
            this.updateStatus("disconnected");
            this.simulator.eventBus.emit("qemu:disconnected");
        }
        this.simulator.stopSimulation();

        if (this.esp32) {
            this.simulator.renderer.setEsp32PowerLed(this.esp32, false);
            this.simulator.renderer.setEsp32GpioLed(this.esp32, false);
        }

        return true;

    }

    // "Interrumpir" real (ver limitación conocida arriba): mata el
    // Worker y arranca uno nuevo DE UNA -- queda listo para la
    // próxima corrida. Pierde variables/estado del intérprete --
    // documentado a propósito, no es un bug. Mismo ciclo
    // disconnected→connected que QemuBridge.onClose()/onOpen(), así
    // que el resto de la UI (ReplPanel, LED power del ESP32) no
    // necesita saber que esto es un bridge distinto.
    interrupt() {

        if (!this._teardown()) return;
        this._spawnWorker();

    }

    // "⏹ Detener" (botón de arriba, distinto de "■ Interrumpir" del
    // panel REPL): mata el Worker y NO arranca uno nuevo -- queda
    // desconectado de verdad hasta que el usuario le dé
    // "▶ Simular" otra vez. Reportado por el usuario: antes nada
    // escuchaba "simulation:stop" para WasmBridge, así que este
    // botón no hacía nada (ver QemuBridge.disconnectWs(), mismo
    // criterio acá pero matando el Worker en vez de cerrar un WS).
    disconnect() {

        if (!this._teardown()) return;

        if (this.worker) {
            try { this.worker.terminate(); } catch (err) { /* no-op */ }
            this.worker = null;
        }

        if (this._pendingRunResolvers) {
            this._pendingRunResolvers.forEach(resolve => resolve());
            this._pendingRunResolvers.clear();
        }

    }

    softReset() {
        this.interrupt();
    }

    // No-ops: no existe paste mode serial acá, nada que proteger.
    beginPasteLock() {}
    endPasteLock() {}

    // Mismo criterio (y mismo elemento del DOM, #qemuStatus) que
    // QemuBridge.updateStatus() -- duplicado acá en vez de compartido
    // porque es puro DOM, sin ningún estado específico de QEMU.
    updateStatus(status) {

        const el = document.getElementById("qemuStatus");
        if (!el) return;

        const labels = {
            connecting:   "⏳ Conectando...",
            connected:    "✅ Simulando",
            disconnected: "🔴 Detenido",
            error:        "⚠️ Error",
        };

        const colors = {
            connecting:   "#f2c94c",
            connected:    "#00ff88",
            disconnected: "#666",
            error:        "#ff9800",
        };

        el.textContent = labels[status] || status;
        el.style.color = colors[status] || "#eee";

    }

}
