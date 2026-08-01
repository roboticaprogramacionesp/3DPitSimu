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
    // etc.) -- se arranca solo con GPIO acá (LED, ver Fase 3 del
    // plan); PWM/I2CR/ADC se suman cuando se porten esos componentes.
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

        const halErrorMatch = line.match(/^HAL_ERROR:([^:]+):/);
        if (halErrorMatch) {
            this.simulator.eventBus.emit("qemu:hal-error", halErrorMatch[1]);
            return true;
        }

        return false;

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

    sendData(data) {

        if (!this.worker || !this._connected) return;

        if (WasmBridge.PROTOCOL_LINE_RE.test(data)) {
            this.worker.postMessage({ type: "processLine", line: data.trim() });
            return;
        }

        this.worker.postMessage({ type: "run", code: data });

    }

    // "Interrumpir" real (ver limitación conocida arriba): mata el
    // Worker y arranca uno nuevo. Pierde variables/estado del
    // intérprete -- documentado a propósito, no es un bug. Mismo
    // ciclo disconnected→connected que QemuBridge.onClose()/onOpen(),
    // así que el resto de la UI (ReplPanel, LED power del ESP32) no
    // necesita saber que esto es un bridge distinto.
    interrupt() {

        if (!this._connected) return;

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

        this._spawnWorker();

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
