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

    constructor(simulator) {

        this.simulator = simulator;

        this.worker = null;
        this._connected = false;

        // Buffer de líneas completas -- igual que QemuBridge.js, el
        // Worker puede mandar stdout en pedazos que no coinciden con
        // saltos de línea.
        this._lineBuf = "";

        // Mismo patrón que QemuBridge.js: el botón ▶ Simular de
        // Toolbar.js no conoce ni le importa qué bridge está activo,
        // solo emite "simulation:start" -- cada bridge se suscribe
        // por su cuenta. Como solo UNO de los dos bridges existe por
        // carga de página (ver js/app.js, decidido por
        // ?modo=wasm en la URL, nunca en runtime), nunca hay dos
        // instancias escuchando el mismo evento a la vez.
        this.simulator.eventBus.on("simulation:start", () => this.connect());
        this.simulator.eventBus.on("simulation:stop",  () => this.disconnect());

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
            if (text === "\x03") { this.interrupt(); return; }
            if (text === "\x04" || text === "\x05") return; // paste mode, no aplica acá

            // Eco tipo REPL -- QEMU real lo hace solo (el pty lo
            // devuelve), acá no hay pty, así que sin esto el usuario
            // no ve NADA en la terminal para algo como "led.on()"
            // (correcto que no imprima nada -- ni en hardware real lo
            // hace -- pero entonces no queda ninguna confirmación
            // visible de que se ejecutó).
            this.simulator.eventBus.emit("qemu:output", `>>> ${text}\n`);
            this.sendData(text);
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

        this.worker.postMessage({ type: "init" });

    }

    _onWorkerMessage(msg) {

        if (msg.type === "ready") {
            this._connected = true;
            this.updateStatus("connected");
            this.simulator.eventBus.emit("qemu:connected");
            this.simulator.startSimulation();

            const esp32 = this.simulator.componentManager
                .getAll()
                .find(c => c.type.startsWith("esp32"));
            if (esp32) this.simulator.renderer.setEsp32PowerLed(esp32, true);

            return;
        }

        if (msg.type === "stdout") {
            this._handleStdout(msg.data);
            return;
        }

        if (msg.type === "error") {
            this.simulator.eventBus.emit("qemu:output", msg.data);
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

        if (visibleLines.length > 0) {
            this.simulator.eventBus.emit("qemu:output", visibleLines.join("\n") + "\n");
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

        const halErrorMatch = line.match(/^HAL_ERROR:([^:]+):/);
        if (halErrorMatch) {
            this.simulator.eventBus.emit("qemu:hal-error", halErrorMatch[1]);
            return true;
        }

        return false;

    }

    _espId() {
        return this.simulator.componentManager.getAll().find(c => c.type.startsWith("esp32"))?.id;
    }

    // Mismo criterio que QemuBridge.applyGpioChange() -- búsqueda en
    // vivo del pin (nunca cachear esp32/pin entre llamadas, ver el
    // comentario grande del original sobre el bug de import de
    // proyecto).
    _applyGpioChange(gpioNumber, value) {

        const esp32 = this.simulator.componentManager
            .getAll()
            .find(c => c.type.startsWith("esp32"));
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
    // Acá NO -- ver la LIMITACIÓN CONOCIDA arriba: mientras un script
    // corre, nada puede inyectarse. "IN:" solo puede actualizar el
    // estado para la PRÓXIMA vez que el script llame a Pin.value()
    // (si el script ya está en un while True: leyendo ese pin, este
    // cambio no lo va a ver hasta la próxima corrida) -- limitación
    // real, documentada, no un bug.
    // Heurística para distinguir protocolo ("IN:18:1", "BH1750:35:500.0")
    // de código real del alumno -- todo lo que manda SignalEngine.js
    // por sendData() tiene esta forma (PREFIJO:número:...). No es
    // perfecto (una anotación de tipo Python a nivel módulo, "X: int",
    // podría calzar) pero alcanza porque en la práctica sendData()
    // nunca mezcla las dos cosas en un mismo llamado (ver Fase 4 del
    // plan -- ahí se separa en dos métodos explícitos en vez de
    // heredar esta ambigüedad del modelo de stream único de QEMU).
    static PROTOCOL_LINE_RE = /^[A-Z][A-Z0-9_]*:[\d.]/;

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
    sendData(data) {

        if (!this.worker || !this._connected) return Promise.resolve();

        if (WasmBridge.PROTOCOL_LINE_RE.test(data)) {
            this.worker.postMessage({ type: "processLine", line: data.trim() });
            return Promise.resolve();
        }

        const runId = ++this._runIdCounter;
        const promise = new Promise(resolve => this._pendingRunResolvers.set(runId, resolve));
        this.worker.postMessage({ type: "run", code: data, runId });
        return promise;

    }

    // Estado compartido entre interrupt() y disconnect(): apaga todo
    // lo visual/de simulación, mismo criterio que QemuBridge.onClose().
    _teardown() {

        if (!this._connected) return false;

        this._connected = false;
        this.updateStatus("disconnected");
        this.simulator.eventBus.emit("qemu:disconnected");
        this.simulator.stopSimulation();

        const esp32 = this.simulator.componentManager
            .getAll()
            .find(c => c.type.startsWith("esp32"));
        if (esp32) {
            this.simulator.renderer.setEsp32PowerLed(esp32, false);
            this.simulator.renderer.setEsp32GpioLed(esp32, false);
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
