/*
==========================================================
 PitSimulator - Puente QEMU
 Archivo: gdbMiClient.js

 En vez de hablar el protocolo GDB Remote Serial a mano
 (frágil -- el ESP32 es dual-core y el handshake de threads
 lo complica), lanzamos el GDB real que ya viene con
 ESP-IDF (xtensa-esp-elf-gdb) en modo "machine interface"
 (--interpreter=mi2) y le mandamos comandos por stdin,
 leyendo las respuestas de stdout. Todo el trabajo fino del
 protocolo se lo delegamos a un GDB real y probado.
==========================================================
*/

const { spawn } = require("child_process");

class GdbMiClient {

    constructor(gdbBinary, targetHost = "127.0.0.1", targetPort = 1234, options = {}) {

        this.gdbBinary = gdbBinary;
        this.targetHost = targetHost;
        this.targetPort = targetPort;

        // Esta consola la comparte QEMU con su REPL serie (por el
        // stdio:"inherit" en server.js) -- si imprimimos cada
        // comando/respuesta de GDB acá, el prompt ">>>" de
        // MicroPython queda enterrado y es imposible escribirle.
        // Por default se queda callado; activar con GDB_DEBUG=1
        // solo para depurar el propio bridge.
        this.debug = !!options.debug;

        this.proc = null;
        this.buffer = "";

        this.tokenCounter = 1;

        // token -> { resolve, reject }
        this.pending = new Map();

        // Resolvers esperando el próximo "*stopped" asíncrono.
        // -exec-interrupt devuelve ^done casi al toque, pero el
        // target recién queda realmente detenido cuando llega el
        // *stopped -- si leemos memoria antes de eso, GDB devuelve
        // el error "Cannot execute this command while the target
        // is running."
        this.stopWaiters = [];

        // Si ya llegó un *stopped y todavía nadie lo esperaba
        // (por ejemplo el que ocurre justo al conectar), lo dejamos
        // marcado para no perdernos el estado.
        this.isStopped = false;

        // Suscriptores permanentes a CADA *stopped (a diferencia de
        // stopWaiters, que se consumen una sola vez). Se usa para
        // detectar breakpoints -- ej: "¿se llamó gpio_set_level()?"
        this.stopListeners = [];

    }

    //------------------------------------------------------
    // Suscribirse a todos los *stopped futuros (breakpoints,
    // señales, etc.). Devuelve { reason, raw }.
    //------------------------------------------------------

    onStopped(callback) {

        this.stopListeners.push(callback);

    }

    //------------------------------------------------------
    // Arrancar el proceso de GDB y conectarlo al puerto
    // GDB que expone QEMU
    //------------------------------------------------------

    start(elfPath = null) {

        return new Promise((resolve, reject) => {

            console.log(`[GdbMi] Lanzando ${this.gdbBinary} --interpreter=mi2`);

            this.proc = spawn(this.gdbBinary, ["--interpreter=mi2", "-q"]);

            this.proc.stdout.on("data", (data) => this.onData(data.toString()));

            this.proc.stderr.on("data", (data) => {
                console.error("[GdbMi stderr]", data.toString().trim());
            });

            this.proc.on("error", (err) => {

                reject(new Error(`No se pudo lanzar "${this.gdbBinary}": ${err.message}. Verificá la ruta en GDB_BIN.`));

            });

            this.proc.on("exit", (code) => {
                console.log(`[GdbMi] gdb terminó con código ${code}`);
            });

            // Le damos un momento a gdb para iniciar antes de
            // mandarle comandos.
            setTimeout(async () => {

                try {

                    // Los comandos de arranque usan un timeout largo:
                    // la primera vez que se lanza gdb.exe en Windows
                    // puede tardar varios segundos en responder (carga
                    // del binario, antivirus escaneándolo la primera
                    // vez, I/O más lenta si el proyecto vive dentro de
                    // una carpeta sincronizada con OneDrive, etc). Esto
                    // no es lo mismo que un comando realmente colgado
                    // durante el polling.
                    const STARTUP_TIMEOUT_MS = 15000;

                    await this.sendCommand("-gdb-set mi-async on", STARTUP_TIMEOUT_MS);

                    // IMPORTANTE: el ELF se carga ANTES de conectar al
                    // remoto. Sin esto, GDB todavía no sabe qué variante
                    // exacta de xtensa/registros esperar y usa un layout
                    // por defecto -- que en algunas combinaciones de
                    // gdb/qemu no coincide con lo que el stub realmente
                    // manda, y produce:
                    //   "Remote 'g' packet reply is too long (expected
                    //    N bytes, got M bytes)"
                    // Cargarlo primero le da a GDB la info de arquitectura
                    // real antes de negociar el paquete 'g'.
                    if (elfPath) {

                        const normalizedPath = elfPath.replace(/\\/g, "/");
                        await this.sendCommand(`-file-exec-and-symbols "${normalizedPath}"`, STARTUP_TIMEOUT_MS);
                        console.log("[GdbMi] Símbolos cargados desde:", normalizedPath);

                    }

                    await this.sendCommand(
                        `-target-select remote ${this.targetHost}:${this.targetPort}`,
                        STARTUP_TIMEOUT_MS
                    );

                    console.log("[GdbMi] Conectado al target remoto (QEMU).");

                    // Si QEMU dejó el CPU pausado esperando al
                    // debugger, esto lo hace seguir. Si ya estaba
                    // corriendo, puede devolver error -- lo ignoramos.
                    await this.sendCommand("-exec-continue", STARTUP_TIMEOUT_MS).catch(() => { });

                    resolve();

                } catch (err) {

                    reject(err);

                }

            }, 2000);

        });

    }

    //------------------------------------------------------
    // Mandar un comando MI y esperar su resultado (^done/^error)
    //------------------------------------------------------

    sendCommand(cmd, timeoutMs = 5000) {

        return new Promise((resolve, reject) => {

            const token = this.tokenCounter++;

            // Si GDB nunca responde a este comando (por ejemplo,
            // porque quedó bloqueado esperando que el target se
            // detenga), no queremos dejar la Promise -- y la entrada
            // en `pending` -- colgada para siempre. Mejor que falle
            // con un error claro después de un rato.
            const timer = setTimeout(() => {

                this.pending.delete(token);
                reject(new Error(`[GdbMi] Timeout esperando respuesta a: ${cmd}`));

            }, timeoutMs);

            this.pending.set(token, {
                resolve: (value) => { clearTimeout(timer); resolve(value); },
                reject: (err) => { clearTimeout(timer); reject(err); }
            });

            if (this.debug) console.log("[GDB CMD]", cmd);
            this.proc.stdin.write(`${token}${cmd}\n`);

        });

    }

    //------------------------------------------------------
    // Procesar la salida de gdb línea por línea
    //------------------------------------------------------

    onData(chunk) {

        this.buffer += chunk;

        let idx;

        while ((idx = this.buffer.indexOf("\n")) !== -1) {

            const line = this.buffer.slice(0, idx).trim();
            this.buffer = this.buffer.slice(idx + 1);

            if (line) this.processLine(line);

        }

    }

    //------------------------------------------------------
    // Interpretar una línea de salida MI. Nos interesan los
    // "result records" ("<token>^done,..." / "<token>^error,...")
    // y los async records "*stopped" / "*running", que son los que
    // nos dicen si el CPU está realmente pausado o no -- eso es
    // distinto del ^done que devuelve -exec-interrupt, que llega
    // casi al instante pero no significa que el target ya paró.
    //------------------------------------------------------

    processLine(line) {

        if (this.debug) console.log("[GDB RESP]", line);

        if (line.startsWith("*stopped")) {

            this.isStopped = true;
            this.stopWaiters.forEach(resolve => resolve());
            this.stopWaiters = [];

            const reasonMatch = line.match(/reason="([^"]*)"/);
            const reason = reasonMatch ? reasonMatch[1] : null;

            // En un target dual-core, cada thread tiene su propio
            // banco de registros -- si no seleccionamos el thread
            // correcto antes de leer $a2/$a3, GDB devuelve los
            // registros de cualquier otro thread que haya quedado
            // "seleccionado" de antes (basura sin relación).
            const threadMatch = line.match(/thread-id="(\d+)"/);
            const threadId = threadMatch ? parseInt(threadMatch[1], 10) : null;

            this.stopListeners.forEach(cb => {
                try { cb({ reason, threadId, raw: line }); } catch (err) { console.error("[GdbMi] onStopped listener:", err); }
            });

            return;

        }

        if (line.startsWith("*running")) {

            this.isStopped = false;
            return;

        }

        const match = line.match(/^(\d+)\^(done|error|running|connected)(,(.*))?$/);

        if (!match) return;

        const token = parseInt(match[1], 10);
        const status = match[2];
        const rest = match[4] || "";

        const p = this.pending.get(token);

        if (!p) return;

        this.pending.delete(token);

        if (status === "error") {
            p.reject(new Error(rest));
        } else {
            p.resolve(rest);
        }

    }

    //------------------------------------------------------
    // Esperar a que el target quede realmente detenido
    // (resuelve enseguida si ya lo está)
    //------------------------------------------------------

    waitForStop(timeoutMs = 2000) {

        if (this.isStopped) return Promise.resolve();

        return new Promise((resolve, reject) => {

            const timer = setTimeout(() => {

                this.stopWaiters = this.stopWaiters.filter(r => r !== onStop);
                reject(new Error("[GdbMi] Timeout esperando que el target se detenga."));

            }, timeoutMs);

            const onStop = () => {
                clearTimeout(timer);
                resolve();
            };

            this.stopWaiters.push(onStop);

        });

    }

    //------------------------------------------------------
    // Pausar el CPU y esperar a que quede efectivamente
    // detenido antes de devolver el control (necesario para
    // poder leer memoria: el gdbstub de QEMU no permite
    // -data-read-memory-bytes mientras el target corre, pese
    // a tener mi-async activado).
    //------------------------------------------------------

    async interruptAndWait(timeoutMs = 2000) {

        if (this.isStopped) return;

        await this.sendCommand("-exec-interrupt --all");
        await this.waitForStop(timeoutMs);

    }

    //------------------------------------------------------
    // Reanudar la ejecución del CPU
    //------------------------------------------------------

    async resume() {

        await this.sendCommand("-exec-continue");

    }

    //------------------------------------------------------
    // Leer bytes de memoria vía "-data-read-memory-bytes"
    //------------------------------------------------------

    async readMemoryBytes(address, length) {

        const addrHex = "0x" + address.toString(16);

        const result = await this.sendCommand(`-data-read-memory-bytes ${addrHex} ${length}`);

        // Formato esperado:
        // memory=[{begin="0x3ff44004",offset="0x0",end="0x3ff44008",contents="aabbccdd"}]
        const match = result.match(/contents="([0-9a-fA-F]+)"/);

        if (!match) {
            throw new Error(`No se pudo parsear la respuesta de memoria: ${result}`);
        }

        const hex = match[1];
        const bytes = [];

        for (let i = 0; i < hex.length; i += 2) {
            bytes.push(parseInt(hex.substr(i, 2), 16));
        }

        return Buffer.from(bytes);

    }

    //------------------------------------------------------
    // Leer un registro de 32 bits (little-endian)
    //------------------------------------------------------

    async readRegister32(address) {

        const buf = await this.readMemoryBytes(address, 4);

        return buf.readUInt32LE(0);

    }

    close() {

        if (this.proc) this.proc.kill();

    }

}

module.exports = GdbMiClient;