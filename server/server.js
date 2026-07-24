/*
==========================================================
 PitSimulator - Puente QEMU
 Archivo: server.js

 1. Lanza QEMU (qemu-system-xtensa, fork de Espressif) con
    tu firmware .bin ya "flasheado" en la imagen.
 2. Lanza un xtensa-esp-elf-gdb real (el mismo que instala
    ESP-IDF) en modo --interpreter=mi2, y lo conecta al
    puerto GDB que expone QEMU con "-s". Le delegamos a GDB
    todo el manejo fino del protocolo (mucho más robusto que
    reimplementarlo a mano, sobre todo en un target dual-core
    como el ESP32).
 3. Hace polling de los registros GPIO_OUT_REG / GPIO_ENABLE_REG
    a través de GDB. Cuando detecta que un pin configurado
    como salida cambió de HIGH/LOW, lo transmite por WebSocket
    como { gpio: <numero>, value: true|false }

 IMPORTANTE -- direcciones de registro sin verificar en tu
 versión exacta de ESP-IDF/QEMU: confírmalas contra
 soc/gpio_reg.h antes de confiar en esto a ciegas. Las que
 uso aquí son las estándar documentadas en el Technical
 Reference Manual del ESP32:

   GPIO_OUT_REG     = 0x3FF44004  (nivel de salida, GPIO0-31)
   GPIO_ENABLE_REG  = 0x3FF44020  (1 = pin configurado como salida)
==========================================================
*/

const { spawn } = require("child_process");
const fs = require("fs");
const WebSocket = require("ws");
const GdbMiClient = require("./gdbMiClient");

// ============================================
// Configuración
// ============================================

const CONFIG = {

    qemuBinary: process.env.QEMU_BIN || "qemu-system-xtensa",
    flashImage: process.env.FLASH_IMAGE || "./flash_image.bin",

    // Ruta al xtensa-esp-elf-gdb.exe que ya instalaste con ESP-IDF
    // (lo viste en el log: "Installing xtensa-esp-elf-gdb@16.3_...").
    // Ejemplo típico en Windows:
    // C:\Espressif\tools\xtensa-esp-elf-gdb\16.3_20250913\xtensa-esp-elf-gdb\bin\xtensa-esp-elf-gdb.exe
    gdbBinary: process.env.GDB_BIN || "xtensa-esp-elf-gdb",

    gdbHost: "127.0.0.1",
    gdbPort: 1234,

    wsPort: 8787,

    pollIntervalMs: 50,

    // Apagado por default: esta consola la comparte QEMU con su
    // REPL serie (stdio:"inherit"), así que loguear cada ciclo de
    // polling tapa el ">>>" de MicroPython. Activar con VERBOSE=1
    // solo si necesitás depurar el bridge en sí.
    verbose: !!process.env.VERBOSE,

    // Modo diagnóstico: en vez de arrancar el polling normal de
    // GPIO, carga los símbolos del firmware y pone un breakpoint
    // en gpio_set_level() para confirmar si el firmware realmente
    // llega a tocar el registro GPIO real. Se activa con:
    //   $env:DEBUG_BREAKPOINT = "1"
    //   $env:MP_ELF = "C:/ruta/a/micropython.elf"
    debugBreakpoint: !!process.env.DEBUG_BREAKPOINT,
    mpElfPath: process.env.MP_ELF || null,

    // NUEVO: además del breakpoint de GPIO ya probado, arma (solo
    // en modo LOG, sin tocar el canvas todavía) uno o dos
    // breakpoints más sobre funciones REALES del port de
    // MicroPython para I2C -- primer paso hacia el registro
    // genérico de hooks GDB (ver conversación de diseño).
    // Activar con:
    //   $env:PROBE_I2C = "1"
    probeI2c: !!process.env.PROBE_I2C,

    // NUEVO: mismo mecanismo de prueba, ahora para ADC -- candidatos
    // reales del port de MicroPython (ports/esp32/machine_adc.c):
    // madcblock_read_helper (read_u16) y madcblock_read_uv_helper
    // (read_uv, calibrado de fábrica). Activar con:
    //   $env:PROBE_ADC = "1"
    probeAdc: !!process.env.PROBE_ADC,

    // Direcciones del ESP32 (verificar contra soc/gpio_reg.h)
    GPIO_OUT_REG: 0x3FF44004,
    GPIO_ENABLE_REG: 0x3FF44020,

    // Registro de diagnóstico -- NO es GPIO real, es el strap mode
    // de boot. Debería leer 0x12 (coincide con "boot:0x12" que ya
    // vimos en la consola serie). Si esto también da 0, el problema
    // es de lectura de memoria en general, no de OUT/ENABLE en
    // particular.
    GPIO_STRAP_REG: 0x3FF44038,

    // ESP-IDF moderno (v5) suele escribir el nivel de un pin usando
    // los registros "set/clear atómico" en vez de escribir directo
    // sobre GPIO_OUT_REG/GPIO_ENABLE_REG (para evitar race entre
    // los dos cores). En hardware real esto igual se refleja al
    // leer OUT_REG/ENABLE_REG -- pero si QEMU no emula ese alias
    // correctamente, hay que mirar estos registros para ver la
    // escritura real.
    GPIO_OUT_W1TS_REG: 0x3FF44008,
    GPIO_OUT_W1TC_REG: 0x3FF4400C,
    GPIO_ENABLE_W1TS_REG: 0x3FF44024,
    GPIO_ENABLE_W1TC_REG: 0x3FF44028,

};

// ============================================
// 1. Lanzar QEMU
// ============================================

// Referencia global al proceso de QEMU, para que el handler de
// mensajes del WebSocket (más abajo) pueda escribirle al REPL sin
// tener que pasarla como parámetro por todos lados.
let qemuProc = null;

function startQemu(wss) {

    const args = [
        "-nographic",
        "-machine", "esp32",
        "-drive", `file=${CONFIG.flashImage},if=mtd,format=raw`,
        "-s" // habilita el servidor GDB en tcp:1234, sin pausar el CPU (sin -S)
    ];

    console.log("[QEMU] Lanzando:", CONFIG.qemuBinary, args.join(" "));

    // ANTES: stdio:"inherit" conectaba el REPL de MicroPython
    // directo a la terminal donde corre "node server.js". Por eso
    // escribir ahí funcionaba -- pero Node (y por lo tanto el
    // WebSocket) no tenía ningún acceso a esa entrada/salida, así
    // que el navegador no podía ni mandar texto al REPL ni ver su
    // respuesta.
    //
    // AHORA: con "pipe" en los tres canales, Node lee/escribe el
    // REPL programáticamente. Reenviamos la salida tanto a la
    // terminal (para no perder la experiencia actual) como al
    // WebSocket (para que la página web también la vea), y
    // reenviamos la entrada tanto desde la terminal como desde el
    // navegador hacia el stdin real de QEMU.
    // Con ciertas combinaciones de gdb/qemu, QEMU manda de más
    // registros (incluidos privilegiados) en el paquete 'g' del
    // protocolo remoto, y GDB los rechaza con:
    //   "Remote 'g' packet reply is too long (expected N bytes, got M bytes)"
    // Esta variable le dice a QEMU que solo mande los registros NO
    // privilegiados. Se puede desactivar seteando
    // QEMU_XTENSA_CORE_REGS_ONLY=0 en el entorno ANTES de correr
    // "node server.js", por si en otra compu con otra versión de
    // gdb/qemu no hace falta (o llegara a hacer falta el set
    // completo de registros para algo). Por default queda activada.
    const qemuEnv = { ...process.env };
    if (qemuEnv.QEMU_XTENSA_CORE_REGS_ONLY === undefined) {
        qemuEnv.QEMU_XTENSA_CORE_REGS_ONLY = "1";
    }

    const proc = spawn(CONFIG.qemuBinary, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: qemuEnv
    });

    qemuProc = proc;

    proc.stdout.on("data", (chunk) => {
        process.stdout.write(chunk);            // se sigue viendo en la terminal
        broadcastRaw(wss, chunk.toString());     // y ahora también en el navegador
    });

    proc.stderr.on("data", (chunk) => {
        process.stderr.write(chunk);
    });

    // Lo que escribas en la terminal de "node server.js" se sigue
    // mandando al REPL, igual que pasaba antes con stdio:"inherit".
    // Throttled igual que el WS (ver writeToQemuThrottled), por si
    // pegás algo largo directo en esta terminal.
    process.stdin.on("data", (chunk) => {
        writeToQemuThrottled(chunk);
    });

    proc.on("error", (err) => {

        console.error(`[QEMU] No se pudo lanzar "${CONFIG.qemuBinary}":`, err.message);
        console.error("[QEMU] Verificá que la ruta en QEMU_BIN sea correcta, o que 'qemu-system-xtensa' esté en el PATH.");
        process.exit(1);

    });

    proc.on("exit", (code) => {

        console.log(`[QEMU] Proceso terminó con código ${code}`);
        process.exit(code || 0);

    });

    return proc;

}

// ============================================
// 2. Servidor WebSocket hacia el navegador
// ============================================

// La UART emulada de QEMU (y el REPL de MicroPython leyendo de
// ella) NO tiene control de flujo real: si le escribimos de una
// sola vez un buffer grande (ej. el navegador pegando un .py
// entero en paste mode), QEMU puede perder bytes en el medio
// porque MicroPython no llega a leerlos tan rápido como Node se
// los tira al pipe de stdin. Eso es lo que causaba los
// IndentationError / código con pedazos faltantes al pegar
// archivos largos -- no era un error real en el .py, era un
// error de transmisión silencioso.
//
// Solución: en vez de un solo qemuProc.stdin.write(data) con todo
// el buffer, lo partimos en trozos chicos y los escribimos con
// una pausa entre uno y otro, para que MicroPython tenga tiempo
// de drenar su lado antes de que llegue el próximo trozo.

// OJO -- bajado de nuevo a valores conservadores (256/2ms venía de
// antes, corrupción real confirmada): desde que ReplPanel.js empezó
// a envolver cada .hal.py de componente en un exec(a2b_base64("..."))
// para aislar fallas entre componentes (ver _wrapHalForIsolation), el
// payload que viaja acá cambió de forma -- pasó de muchas líneas
// CORTAS (el código fuente normal, con un "\n" cada pocas decenas de
// bytes, que le da a MicroPython un punto natural para drenar el
// buffer) a UNA sola línea de base64 de varios KB sin ningún salto
// de línea interno. Con 256 bytes/2ms confirmado en la práctica: la
// transmisión se corrompe a mitad de esa línea larga (bytes
// perdidos, sin ningún error visible salvo un SyntaxError río abajo
// que ni el propio try/except de aislamiento puede atajar, porque el
// wrapper en sí también viaja por el mismo canal sin garantías). Ver
// el comentario grande más arriba sobre por qué la UART de QEMU no
// tiene control de flujo real -- esto es el mismo problema,
// simplemente más visible ahora que hay líneas mucho más largas sin
// puntos de pausa naturales. Costo de esto: "Ejecutar" tarda más la
// primera vez que se cargan los HAL de una sesión de QEMU (se cachean
// después, ver _halSentToFirmware) -- vale la pena a cambio de que
// el código realmente llegue completo.
// SEGUNDA vuelta de este mismo ajuste -- 48/10ms (intento anterior)
// ya CONTUVO la falla (el try/except de aislamiento sobrevivió
// entero y capturó un HAL_ERROR limpio en vez de que la corrupción
// tirara abajo TODO el paste), pero confirmado en la práctica que
// todavía se pierden bytes sueltos dentro del base64 (el .decode()
// UTF-8 fallaba con UnicodeError -- corrupción parcial, no total).
// Bajado bastante más para dar más margen real. Si esto tampoco
// alcanza, el próximo paso ya no es "bajar el número" sino agregar
// una verificación de integridad (largo/checksum) del lado del
// wrapper para poder DETECTAR corrupción con certeza en vez de
// inferirla de un traceback -- ver la nota en
// ReplPanel._wrapHalForIsolation() si se llega a ese punto.
const SEND_CHUNK_SIZE = 16;     // antes: 48 (256, y 32 antes de eso) // bytes por trozo
const SEND_CHUNK_DELAY_MS = 20; // antes: 10 (2, y 8 antes de eso) // pausa entre trozos

// ============================================
// Stripper de comentarios/líneas vacías para pegados de
// código fuente (los _*.hal.py, principalmente).
//
// Los .hal.py tienen MUCHO más comentario que código real (son
// explicaciones largas de por qué existe cada cosa) -- ese texto
// no le sirve para nada al REPL de MicroPython, así que lo
// sacamos ANTES de mandarlo, reduciendo el payload real que viaja
// por la UART throttled.
//
// Solo quitamos líneas que son comentario COMPLETO (empiezan con
// "#" después de espacios) o líneas vacías -- nunca tocamos un
// "#" que aparezca en medio de una línea de código real (ej.
// dentro de un string), para no arriesgarnos a romper nada por una
// heurística de más.
// ============================================

function stripPySource(source) {

    return source
        .split("\n")
        .filter((line) => {
            const trimmed = line.trim();
            return trimmed !== "" && !trimmed.startsWith("#");
        })
        .join("\n");

}

// Heurística para decidir SI conviene aplicar el stripper: un
// pegado de archivo completo (.hal.py, o el código del usuario)
// siempre trae varios saltos de línea. Un keystroke suelto o un
// comando corto tipeado interactivamente en el REPL (ej. lo que
// manda el navegador tecla por tecla) no los tiene -- así evitamos
// tocar esos mensajes cortos, donde partir mal un caracter podría
// romper la interactividad normal del REPL.
const BULK_SOURCE_MIN_NEWLINES = 3;

function looksLikeBulkSource(text) {
    const newlineCount = (text.match(/\n/g) || []).length;
    return newlineCount >= BULK_SOURCE_MIN_NEWLINES;
}

// Cola global (no por-conexión): si dos pegados llegaran casi
// juntos (ej. navegador + terminal a la vez), esto evita que sus
// trozos se intercalen entre sí en el stdin de QEMU.
let sendQueue = Promise.resolve();

function writeToQemuThrottled(data) {

    let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

    // Si esto pinta ser un pegado de archivo completo (varios saltos
    // de línea), sacamos comentarios y líneas vacías antes de
    // mandarlo. Comandos cortos tipeados a mano quedan intactos.
    const asText = buf.toString("utf8");
    if (looksLikeBulkSource(asText)) {

        const stripped = stripPySource(asText);

        if (CONFIG.verbose) {
            console.log(`[Throttle] Stripped ${asText.length} -> ${stripped.length} bytes.`);
        }

        buf = Buffer.from(stripped, "utf8");

    }

    sendQueue = sendQueue.then(() => new Promise((resolve) => {

        let offset = 0;

        function writeNextChunk() {

            if (!qemuProc || !qemuProc.stdin.writable || offset >= buf.length) {
                resolve();
                return;
            }

            const chunk = buf.subarray(offset, offset + SEND_CHUNK_SIZE);
            offset += SEND_CHUNK_SIZE;

            qemuProc.stdin.write(chunk);

            setTimeout(writeNextChunk, SEND_CHUNK_DELAY_MS);

        }

        writeNextChunk();

    }));

    return sendQueue;

}

// ============================================
// Seguridad del WebSocket -- LEER ANTES DE TOCAR
//
// Este bridge le da a cualquiera que se conecte acceso de escritura
// directo al stdin de QEMU -- es decir, ejecución de código real
// dentro de la VM (el REPL de MicroPython). Sin las dos protecciones
// de abajo, esto era un RCE no autenticado:
//
//   1. new WebSocket.Server({ port }) SIN "host" escucha en TODAS las
//      interfaces de red (0.0.0.0), no solo en esta máquina -- así que
//      cualquier otro dispositivo en la misma red (Wi-Fi compartida,
//      etc.) podía conectarse directo a ws://<tu-ip>:8787.
//   2. Un WebSocket normal NO respeta same-origin policy como fetch()/
//      XHR -- CUALQUIER pestaña abierta en el navegador (de cualquier
//      sitio, no solo esta app) puede hacer "new WebSocket('ws://
//      localhost:8787')" desde su propio JS y listo, conectada. Esto
//      es la misma clase de bug que "localhost RCE via browser" que
//      afectó a Jupyter/otras herramientas de desarrollo -- sin
//      chequear el header Origin, ninguna cantidad de "total confío
//      en mi red local" alcanza.
//
// Fix: host:"127.0.0.1" (nunca alcanzable desde otra máquina) +
// verifyClient rechazando cualquier Origin que no sea localhost/
// 127.0.0.1 (bloquea el ataque de "pestaña maliciosa" de arriba).
// ============================================

const ALLOWED_ORIGIN_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isAllowedOrigin(origin) {

    // Sin header Origin -- no confiamos por default (ej. herramientas
    // de línea de comandos sin browser de por medio también quedan
    // afuera; si hace falta ese caso, hay que sumarlo a propósito, no
    // aceptar "sin origin" como comodín).
    if (!origin) return false;

    try {
        return ALLOWED_ORIGIN_HOSTNAMES.has(new URL(origin).hostname);
    } catch {
        return false;
    }

}

function startWebSocketServer() {

    const wss = new WebSocket.Server({
        port: CONFIG.wsPort,
        host: "127.0.0.1", // ver comentario de seguridad arriba -- NUNCA quitar esto
        verifyClient: (info, callback) => {

            const ok = isAllowedOrigin(info.origin);

            if (!ok) {
                console.warn(`[WS] Conexión rechazada -- Origin no permitido: "${info.origin}"`);
            }

            callback(ok, 403, "Origin no permitido");

        },
    });

    console.log(`[WS] Escuchando en ws://127.0.0.1:${CONFIG.wsPort} (solo localhost, Origin validado)`);

    wss.on("connection", (ws) => {

        console.log("[WS] PitSimulator conectado.");

        // Todo lo que el navegador manda (lo que tipeás en el REPL de
        // la página, o mensajes IN:/TEMP:/DIST: que inyecta el
        // simulador) se reenvía al stdin real de QEMU, PERO ahora
        // throttled (ver writeToQemuThrottled arriba) para no perder
        // bytes en pegados grandes.
        ws.on("message", (data) => {
            writeToQemuThrottled(data);
        });

        ws.on("close", () => console.log("[WS] PitSimulator desconectado."));

    });

    return wss;

}

// ============================================
// 3. Polling de GPIO -> WebSocket
// ============================================

async function pollGpioLoop(gdb, wss) {

    // Último estado conocido de cada pin (0-31), para
    // solo emitir cuando algo realmente cambió.
    let lastState = new Array(32).fill(null);

    // IMPORTANTE: no usamos setInterval acá. Cada ciclo hace
    // interrupt -> leer -> resume, y ese ida-y-vuelta con GDB
    // puede tardar más que CONFIG.pollIntervalMs. Con setInterval,
    // el siguiente tick arrancaba antes de que el anterior
    // terminara el -exec-continue, pisando el estado y
    // produciendo "Cannot execute this command while the target
    // is running". Con este loop, el siguiente ciclo solo se
    // programa (con setTimeout) una vez que el anterior terminó
    // por completo -- nunca hay dos ciclos en simultáneo.

    let stopped = false;

    async function tick() {

        try {

            // El gdbstub de QEMU no permite leer memoria mientras
            // el target está corriendo (aunque mi-async esté
            // activado) -- hay que pausar, leer, y reanudar en
            // cada ciclo. Esto agrega latencia (uno o dos ida-y-
            // vuelta de GDB por poll) pero es la única forma
            // confiable de leer los registros GPIO en este stub.
            await gdb.interruptAndWait();

            const outReg = await gdb.readRegister32(CONFIG.GPIO_OUT_REG);
            const enableReg = await gdb.readRegister32(CONFIG.GPIO_ENABLE_REG);
            const strapReg = await gdb.readRegister32(CONFIG.GPIO_STRAP_REG);

            await gdb.resume();

            if (CONFIG.verbose) {
                console.log("OUT =", outReg.toString(16));
                console.log("ENABLE =", enableReg.toString(16));
                console.log("STRAP (diagnóstico) =", strapReg.toString(16));
            }

            for (let gpio = 0; gpio < 32; gpio++) {

                const isOutput = !!((enableReg >> gpio) & 1);

                if (!isOutput) continue;

                const value = !!((outReg >> gpio) & 1);

                if (lastState[gpio] === value) continue;

                lastState[gpio] = value;

                broadcastRaw(wss, `GPIO:${gpio}:${value ? 1 : 0}\n`);

                console.log(`[GPIO] GPIO${gpio} -> ${value ? "HIGH" : "LOW"}`);
            }

        } catch (err) {

            console.error("[Poll]", err);

            // Si el error ocurrió después de pausar el CPU (por
            // ejemplo, falló la lectura de memoria) pero antes de
            // reanudarlo, el target se queda congelado para
            // siempre y todos los polls siguientes van a fallar
            // igual. Intentamos reanudar igual, sin propagar un
            // segundo error si esto también falla.
            if (gdb.isStopped) {

                await gdb.resume().catch(() => { });

            }

        }

        if (!stopped) {

            setTimeout(tick, CONFIG.pollIntervalMs);

        }

    }

    tick();

    return {
        stop: () => { stopped = true; }
    };

}

function broadcast(wss, message) {

    const payload = JSON.stringify(message);

    wss.clients.forEach((client) => {

        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }

    });

}

// NUEVO: manda texto plano tal cual, sin envolver en JSON. Lo usamos
// para la salida cruda del REPL (stdout de QEMU) y para las líneas
// "GPIO:<n>:<0|1>" y "OLED:...", que es el formato que QemuBridge.js
// (del lado del navegador) realmente sabe parsear -- broadcast()
// mandaba JSON, que QemuBridge.js ignoraba en silencio.
function broadcastRaw(wss, text) {

    wss.clients.forEach((client) => {

        if (client.readyState === WebSocket.OPEN) {
            client.send(text);
        }

    });

}

// ============================================
// 3-bis. Bridge basado en eventos (reemplaza al
// polling de GPIO_OUT_REG/GPIO_ENABLE_REG).
//
// Confirmado con el diagnóstico previo: en esta build
// de QEMU (esp_develop_9.2.2_20250817), escribir
// GPIO_OUT_W1TS_REG/GPIO_ENABLE_W1TS_REG NUNCA se
// propaga a GPIO_OUT_REG/GPIO_ENABLE_REG -- confirmado
// a nivel de una sola instrucción, con la dirección y
// el valor de escritura verificados directamente desde
// los registros de CPU ($a9 = base correcta 0x3ff44000,
// $a8 = máscara correcta del bit). Es un hueco real del
// modelo de periférico GPIO en este QEMU, no un bug del
// firmware ni de este bridge -- así que pollear esos
// registros NUNCA va a detectar los cambios de pin acá.
//
// En vez de leer el efecto (el registro de hardware),
// leemos la causa: ponemos un breakpoint justo después
// de "entry" en gpio_set_level() -- ahí $a2/$a3 son
// exactamente los argumentos de la llamada (gpio_num,
// level), sin ambigüedad de ventana de registros, porque
// "entry" ya rotó la ventana para esta función. Cada vez
// que el firmware llama a gpio_set_level(), emitimos el
// cambio directo por WebSocket, sin depender de que QEMU
// emule bien el registro de salida.
// ============================================

// Ubica la primera instrucción REAL después del prólogo "entry" de
// una función -- mismo patrón que ya usaba el probe de I2C (y
// gpio_set_level más abajo), factorizado acá para no triplicarlo
// ahora que sumamos el probe de ADC.
async function findPostEntryAddress(gdb, funcName) {

    const disasm = await gdb.sendCommand(`-data-disassemble -s ${funcName} -e "${funcName}+24" -- 0`);
    const addrMatches = [...disasm.matchAll(/address="(0x[0-9a-fA-F]+)"/g)];
    const instMatches = [...disasm.matchAll(/inst="([^"]*)"/g)];

    if (!instMatches[0] || !/^entry\b/i.test(instMatches[0][1].replace(/\\t/g, " "))) {
        throw new Error(`"${funcName}" no tiene la forma esperada de función Xtensa (¿no existe en este build?).`);
    }

    for (let i = 0; i < addrMatches.length; i++) {
        const isEntry = instMatches[i] && /^entry\b/i.test(instMatches[i][1].replace(/\\t/g, " "));
        if (!isEntry) return addrMatches[i][1];
    }

    throw new Error(`No se encontró instrucción posterior a 'entry' en "${funcName}".`);

}

// Fuerza el retorno temprano de la función detenida en el
// breakpoint actual, con "value" como resultado -- usado para
// ADC (ver ADC-probe), donde dejar correr el cuerpo real crashea
// QEMU. Si la función cayó inlineada dentro de su llamador (DWARF
// arma un frame "virtual" para ella, pero el frame FÍSICO real es
// el de la función que la contiene), GDB rechaza el "return" ahí
// con "Can not force return from an inlined function".
//
// Puede haber MÁS DE UN nivel de inlining apilado (confirmado: un
// solo salto de frame no alcanzó acá) -- en vez de asumir cuántos
// niveles hacen falta, probamos frame por frame, subiendo de a
// uno, hasta encontrar el primero que sea un frame físico real
// (o hasta agotar maxFrame, en cuyo caso el problema es más
// profundo y hace falta cambiar de estrategia -- ver la nota en
// el catch de más abajo).
async function forceReturn(gdb, value, maxFrame = 6) {

    let lastErr = null;

    for (let frame = 0; frame <= maxFrame; frame++) {

        try {

            if (frame > 0) {
                await gdb.sendCommand(`-stack-select-frame ${frame}`);
            }

            await gdb.sendCommand(`-interpreter-exec console "return ${value}"`);

            if (frame > 0) {
                console.warn(`[Bridge] "return" tuvo éxito recién en el frame físico #${frame} (los anteriores estaban inlineados).`);
            }

            return;

        } catch (err) {

            lastErr = err;
            if (!/inlined/i.test(err.message || "")) throw err;

        }

    }

    throw new Error(
        `No se pudo forzar el retorno en ningún frame hasta #${maxFrame} -- ` +
        `todos reportados como inlineados. Hace falta apuntar el breakpoint a una ` +
        `función de más arriba que no pueda estar inlineada (ver mp_machine_adc_read_uv). ` +
        `Último error: ${lastErr ? lastErr.message : "?"}`
    );

}

async function runGpioEventBridge(gdb, wss, elfPath) {

    console.log(`[Bridge] Cargando símbolos desde: ${elfPath}`);

    await gdb.interruptAndWait();

    const normalizedPath = elfPath.replace(/\\/g, "/");

    // "set confirm off": necesario para poder usar el comando "return"
    // más abajo (forzar retorno temprano de madcblock_*_helper sin
    // dejar correr el cuerpo real, que crashea QEMU -- ver ADC-probe).
    // Sin esto, GDB pregunta interactivamente "Make func return now?
    // (y or n)" y se queda esperando una respuesta que nunca llega
    // por este canal automatizado.
    await gdb.sendCommand('-interpreter-exec console "set confirm off"').catch(() => {});

    try {

        await gdb.sendCommand(`-file-exec-and-symbols "${normalizedPath}"`);

    } catch (err) {

        throw new Error(
            `No se pudieron cargar los símbolos desde "${elfPath}": ${err.message}. ` +
            "Verificá que sea un .elf válido y que se haya compilado con símbolos de debug " +
            "(sin 'strip')."
        );

    }

    // Mismo truco que en el diagnóstico: esta build de
    // xtensa-esp-elf-gdb no salta el prólogo de Xtensa sola, así
    // que desensamblamos para encontrar la primera instrucción
    // después de "entry" (que es siempre la primera del cuerpo de
    // la función) y ponemos el breakpoint ahí.
    const disasm = await gdb.sendCommand('-data-disassemble -s gpio_set_level -e "gpio_set_level+24" -- 0');

    const addrMatches = [...disasm.matchAll(/address="(0x[0-9a-fA-F]+)"/g)];
    const instMatches = [...disasm.matchAll(/inst="([^"]*)"/g)];

    // Control de cordura contra desajustes de build: cualquier
    // función Xtensa con ABI de ventanas TIENE que empezar con
    // "entry" -- sin excepciones. Si lo que hay en la dirección que
    // el .elf dice que es "gpio_set_level" no es eso, la explicación
    // más probable no es un bug nuevo, es que este .elf no es el
    // mismo build que generó el flash_image.bin que está corriendo
    // en QEMU -- la tabla de símbolos del .elf sigue siendo válida
    // como texto, pero las direcciones ya no corresponden al binario
    // real en memoria. Preferimos fallar acá con un mensaje claro
    // antes que seguir adelante leyendo argumentos de instrucciones
    // que no son las que creemos que son.
    if (!instMatches[0] || !/^entry\b/i.test(instMatches[0][1].replace(/\\t/g, " "))) {

        throw new Error(
            "La primera instrucción en la dirección de gpio_set_level() no es 'entry' " +
            `(vino: "${instMatches[0] ? instMatches[0][1] : "nada"}"). ` +
            "Esto normalmente significa que MP_ELF no es el mismo build exacto que generó " +
            "el flash_image.bin que está corriendo en QEMU -- volvé a compilar y usar el " +
            ".elf que corresponde a este binario, no confíes en las direcciones si esto pasa."
        );

    }

    let breakpointAddr = null;

    for (let i = 0; i < addrMatches.length; i++) {

        const isEntry = instMatches[i] && /^entry\b/i.test(instMatches[i][1].replace(/\\t/g, " "));

        if (!isEntry) {
            breakpointAddr = addrMatches[i][1];
            break;
        }

    }

    if (!breakpointAddr) {
        throw new Error("No se pudo identificar la instrucción posterior a 'entry' en gpio_set_level().");
    }

    await gdb.sendCommand(`-break-insert *${breakpointAddr}`);

    console.log(`[Bridge] Breakpoint listo en gpio_set_level()+prólogo (${breakpointAddr}).`);
    console.log("[Bridge] Los cambios de GPIO se van a emitir apenas el firmware llame a esta función.");

    // ============================================
    // PROBE_I2C: primer paso hacia el registro genérico de hooks.
    // Probamos si estas funciones REALES del port de MicroPython
    // existen en este .elf exacto (pueden variar según versión):
    //   - machine_hw_i2c_transfer      -> I2C por hardware (machine.I2C)
    //   - mp_machine_soft_i2c_transfer -> I2C por software / bit-bang
    //     (machine.SoftI2C) -- OJO: esta en realidad togglea pines
    //     comunes, así que puede que YA se vea reflejada por el
    //     breakpoint de gpio_set_level() de arriba, sin hacer falta
    //     nada nuevo. La dejamos igual como diagnóstico para
    //     confirmarlo con datos reales en vez de asumir.
    // Por ahora esto SOLO loguea en la terminal -- todavía no reenvía
    // nada a SignalEngine/canvas. El objetivo de esta fase es
    // confirmar qué nombre de función existe y qué argumentos trae
    // antes de construir el resto de la tubería.
    // ============================================

    const i2cBreakpoints = {}; // { "0x....": "nombreDeLaFuncion" }

    if (CONFIG.probeI2c) {

        for (const candidate of ["machine_hw_i2c_transfer", "mp_machine_soft_i2c_transfer"]) {

            try {

                const i2cDisasm = await gdb.sendCommand(`-data-disassemble -s ${candidate} -e "${candidate}+24" -- 0`);
                const i2cAddrMatches = [...i2cDisasm.matchAll(/address="(0x[0-9a-fA-F]+)"/g)];
                const i2cInstMatches = [...i2cDisasm.matchAll(/inst="([^"]*)"/g)];

                if (!i2cInstMatches[0] || !/^entry\b/i.test(i2cInstMatches[0][1].replace(/\\t/g, " "))) {
                    console.warn(`[I2C-probe] "${candidate}" no tiene la forma esperada de función Xtensa (¿no existe en este build?) -- se omite.`);
                    continue;
                }

                let i2cAddr = null;
                for (let i = 0; i < i2cAddrMatches.length; i++) {
                    const isEntry = i2cInstMatches[i] && /^entry\b/i.test(i2cInstMatches[i][1].replace(/\\t/g, " "));
                    if (!isEntry) { i2cAddr = i2cAddrMatches[i][1]; break; }
                }

                if (!i2cAddr) {
                    console.warn(`[I2C-probe] No se pudo ubicar la instrucción posterior a 'entry' en "${candidate}" -- se omite.`);
                    continue;
                }

                await gdb.sendCommand(`-break-insert *${i2cAddr}`);
                i2cBreakpoints[i2cAddr.toLowerCase()] = candidate;
                console.log(`[I2C-probe] Breakpoint armado en "${candidate}" (${i2cAddr}).`);

            } catch (err) {

                console.warn(`[I2C-probe] "${candidate}" no encontrado en los símbolos de este .elf -- se omite (${err.message}).`);

            }

        }

        if (Object.keys(i2cBreakpoints).length === 0) {
            console.warn("[I2C-probe] Ningún candidato de I2C se pudo armar -- revisá si tu build usa otros nombres de función (ver nm/objdump del .elf).");
        }

    }

    // ============================================
    // PROBE_ADC: mismo método que PROBE_I2C.
    //
    // IMPORTANTE (confirmado con datos reales): madcblock_read_uv_helper
    // y madcblock_read_helper resultaron estar TOTALMENTE inlineadas --
    // ni subiendo hasta 6 frames GDB encontró un frame físico real
    // para forzar el retorno. Probablemente el compilador las infló
    // en TODOS sus sitios de llamada y nunca dejó una copia
    // independiente en memoria.
    //
    // Por eso ahora probamos PRIMERO las funciones de más alto nivel
    // que MicroPython invoca a través de un puntero guardado en la
    // tabla de métodos de ADC (read_uv/read_u16) -- esas SÍ tienen
    // que existir como símbolos reales, porque su dirección queda
    // tomada como dato para esa tabla (el compilador no puede
    // eliminar una función cuya dirección se usa en otro lado). Los
    // nombres de bajo nivel quedan al final, solo por si acaso.
    //
    // Además, volcamos "info functions adc" para VER la lista
    // completa de símbolos candidatos en este .elf en vez de seguir
    // adivinando nombres a ciegas -- revisá esta salida si ninguno
    // de los candidatos de abajo resuelve.
    // ============================================

    const adcBreakpoints = {}; // { "0x....": "nombreDeLaFuncion" }

    if (CONFIG.probeAdc) {

        try {

            const symbolDump = await gdb.sendCommand('-interpreter-exec console "info functions adc"');
            console.log("[ADC-probe] Símbolos que matchean \"adc\" en este .elf (revisar si los candidatos de abajo fallan):");
            console.log(symbolDump);

        } catch (err) {

            console.warn("[ADC-probe] No se pudo volcar la lista de símbolos:", err.message);

        }

        const ADC_CANDIDATES = [
            "mp_machine_adc_read_uv",
            "mp_machine_adc_read_u16",
            "machine_adc_read_uv",
            "machine_adc_read_u16",
            "madcblock_read_uv_helper",
            "madcblock_read_helper",
        ];

        for (const candidate of ADC_CANDIDATES) {

            try {

                const adcAddr = await findPostEntryAddress(gdb, candidate);
                await gdb.sendCommand(`-break-insert *${adcAddr}`);
                adcBreakpoints[adcAddr.toLowerCase()] = candidate;
                console.log(`[ADC-probe] Breakpoint armado en "${candidate}" (${adcAddr}).`);

            } catch (err) {

                console.warn(`[ADC-probe] "${candidate}" no encontrado en los símbolos de este .elf -- se omite (${err.message}).`);

            }

        }

        if (Object.keys(adcBreakpoints).length === 0) {
            console.warn("[ADC-probe] Ningún candidato de ADC se pudo armar -- revisá si tu build usa otros nombres de función (ver nm/objdump del .elf).");
        }

    }

    // Último estado conocido de cada pin, para solo emitir cuando
    // algo realmente cambió (mismo criterio que tenía pollGpioLoop).
    let lastState = new Array(32).fill(null);

    // Último hilo seleccionado -- evita repetir "-thread-select"
    // cuando el firmware sigue en el mismo hilo que la vez anterior
    // (caso normal: un teclado matricial escaneando en un solo loop
    // nunca cambia de hilo entre un toggle y el siguiente). Cada
    // "-thread-select" es OTRO viaje de ida y vuelta completo por el
    // protocolo GDB/MI mientras la VM entera sigue parada -- saltarlo
    // cuando no hace falta recorta ese tiempo sin cambiar nada del
    // comportamiento quPin(es solo un control de si SELECT ya estaba
    // en ese hilo, no afecta qué hilo termina seleccionado).
    let lastThreadId = null;

    gdb.onStopped(async (info) => {

        if (info.reason !== "breakpoint-hit") return;

        try {

            if (info.threadId && info.threadId !== lastThreadId) {
                await gdb.sendCommand(`-thread-select ${info.threadId}`);
                lastThreadId = info.threadId;
            }

            // ¿Este hit es uno de los breakpoints de prueba de I2C
            // (PROBE_I2C=1), no el de gpio_set_level()? Se distinguen
            // por $pc -- mismo criterio que ya usa
            // runGpioBreakpointDiagnostic para separar el breakpoint
            // de entrada del breakpoint del "store site". Si es I2C,
            // solo logueamos argumentos crudos y NO seguimos al
            // camino de GPIO (que asume ciegamente $a2/$a3 como
            // gpio_num/level -- serían basura acá).
            if (Object.keys(i2cBreakpoints).length > 0) {

                const pcRaw  = await gdb.sendCommand('-data-evaluate-expression "$pc"');
                const pcHex  = (pcRaw.match(/0x[0-9a-fA-F]+/) || [null])[0];
                const i2cFn  = pcHex ? i2cBreakpoints[pcHex.toLowerCase()] : null;

                if (i2cFn) {

                    // ABI Xtensa con ventanas, ya rotada por "entry":
                    // a2=self_in, a3=addr, a4=n, a5=bufs, a6=flags
                    // -- mismo layout para machine_hw_i2c_transfer y
                    // mp_machine_soft_i2c_transfer (ver extmod/machine_i2c.c
                    // y ports/esp32/machine_i2c.c del repo de MicroPython).
                    const addrRaw  = await gdb.sendCommand('-data-evaluate-expression "$a3"');
                    const nRaw     = await gdb.sendCommand('-data-evaluate-expression "$a4"');
                    const flagsRaw = await gdb.sendCommand('-data-evaluate-expression "$a6"');

                    const addrMatch  = addrRaw.match(/-?\d+/);
                    const nMatch     = nRaw.match(/-?\d+/);
                    const flagsMatch = flagsRaw.match(/-?\d+/);

                    const i2cAddrDec = addrMatch  ? parseInt(addrMatch[0], 10)  : null;
                    const n          = nMatch     ? parseInt(nMatch[0], 10)     : null;
                    const flags      = flagsMatch ? parseInt(flagsMatch[0], 10) : null;

                    console.log(
                        `[I2C-probe] ${i2cFn}() -> addr=0x${i2cAddrDec !== null ? i2cAddrDec.toString(16) : "?"} ` +
                        `n=${n} flags=${flags} (bit0=READ, bit1=STOP -- ver MP_MACHINE_I2C_FLAG_*)`
                    );

                    return; // resuelto -- el "finally" de más abajo igual reanuda QEMU

                }

            }

            // Mismo criterio que arriba, ahora para los breakpoints de
            // prueba de ADC (PROBE_ADC=1).
            if (Object.keys(adcBreakpoints).length > 0) {

                const pcRaw = await gdb.sendCommand('-data-evaluate-expression "$pc"');
                const pcHex = (pcRaw.match(/0x[0-9a-fA-F]+/) || [null])[0];
                const adcFn = pcHex ? adcBreakpoints[pcHex.toLowerCase()] : null;

                if (adcFn) {

                    // ABI Xtensa con ventanas, rotada por "entry":
                    // a2=block_ptr, a3=channel_id, a4=atten -- según
                    // la firma real de madcblock_read_uv_helper(self->block,
                    // self->channel_id, atten) en ports/esp32/machine_adc.c.
                    // Todavía no sabemos qué hay en a2 (puntero, no un
                    // número útil para loguear) -- channel_id y atten sí.
                    const channelRaw = await gdb.sendCommand('-data-evaluate-expression "$a3"');
                    const attenRaw   = await gdb.sendCommand('-data-evaluate-expression "$a4"');

                    const channelMatch = channelRaw.match(/-?\d+/);
                    const attenMatch   = attenRaw.match(/-?\d+/);

                    const channel = channelMatch ? parseInt(channelMatch[0], 10) : null;
                    const atten   = attenMatch   ? parseInt(attenMatch[0], 10)   : null;

                    // ============================================
                    // A diferencia de GPIO/I2C, acá NO podemos dejar
                    // que el cuerpo real de la función siga
                    // corriendo -- confirmado con datos reales: el
                    // periférico de ADC de este QEMU crashea la VM
                    // entera ("Cache disabled but cached memory
                    // region accessed") apenas el driver real de
                    // ESP-IDF intenta leer. En vez de resumir
                    // normalmente, forzamos que la función retorne
                    // ACÁ MISMO con un valor inventado, usando el
                    // comando "return" de GDB (aborta el frame
                    // actual, nunca llega a ejecutar el resto del
                    // cuerpo real).
                    //
                    // Por ahora el valor es un placeholder fijo
                    // (prueba de que el mecanismo evita el crash) --
                    // todavía no está conectado a SignalEngine/canvas.
                    // read_uv() espera microvolts; read_u16() espera
                    // 0-65535 -- usamos criterios distintos según cuál
                    // de las dos funciones se llamó.
                    const fakeValue = /uv/i.test(adcFn)
                        ? 1650000  // 1.65V en µV -- mitad de escala típica
                        : 32768;   // mitad de escala de 16 bits

                    console.log(`[ADC-probe] ${adcFn}() -> channel=${channel} atten=${atten} -- forzando retorno=${fakeValue} (evita el crash real)`);

                    await forceReturn(gdb, fakeValue);

                    return; // resuelto -- el "finally" de más abajo reanuda QEMU YA en el frame del llamador

                }

            }

            // BUGFIX de rendimiento: antes esto eran DOS comandos
            // GDB/MI secuenciales (uno por cada registro), cada uno
            // un viaje de ida y vuelta completo mientras la VM entera
            // está detenida por el breakpoint -- para un escaneo de
            // teclado matricial (2 toggles por columna x 4 columnas
            // = 8 breakpoints por ciclo) eso son 16 idas y vueltas
            // solo para leer argumentos, sin contar thread-select ni
            // resume. Ahora se combinan $a2 y $a3 en una ÚNICA
            // expresión ("$a2*65536+$a3") evaluada en un solo comando
            // -- gpio_num siempre cabe en 16 bits (0-39 en la
            // práctica) y level es 0/1, así que no hay riesgo de que
            // se mezclen los dos valores al desempaquetar.
            const combinedRaw = await gdb.sendCommand('-data-evaluate-expression "$a2*65536+$a3"');

            const combinedMatch = combinedRaw.match(/-?\d+/);
            const combined = combinedMatch ? parseInt(combinedMatch[0], 10) : NaN;

            const gpio = Number.isNaN(combined) ? NaN : Math.floor(combined / 65536);
            const level = Number.isNaN(combined) ? NaN : (combined - gpio * 65536);

            if (!Number.isNaN(gpio) && !Number.isNaN(level) && gpio >= 0 && gpio < 32) {

                const value = !!level;

                if (lastState[gpio] !== value) {

                    lastState[gpio] = value;
                    broadcastRaw(wss, `GPIO:${gpio}:${value ? 1 : 0}\n`);
                    console.log(`[GPIO] GPIO${gpio} -> ${value ? "HIGH" : "LOW"}`);

                }

            } else if (CONFIG.verbose) {

                console.log(`[Bridge] gpio_set_level() llamado con argumentos no numéricos (combinado="${combinedRaw}")`);

            }

        } catch (err) {

            console.error("[Bridge] Error en el dispatcher de breakpoints:", err.message);

        } finally {

            await gdb.resume().catch(() => {});

        }

    });

    await gdb.resume();

    return {
        // No hace falta un loop propio -- todo pasa por el
        // callback de onStopped -- pero devolvemos la misma forma
        // que pollGpioLoop por si el llamador espera poder pararlo.
        stop: () => {}
    };

}

// ============================================
// Diagnóstico: ¿el firmware realmente llama a
// gpio_set_level()? Carga símbolos + breakpoint y
// reporta cada llamada, sin tocar el polling normal.
// ============================================

async function runGpioBreakpointDiagnostic(gdb, elfPath) {

    console.log(`[Diag] Cargando símbolos desde: ${elfPath}`);

    // Para cargar símbolos y poner breakpoints, el target tiene
    // que estar detenido.
    await gdb.interruptAndWait();

    const normalizedPath = elfPath.replace(/\\/g, "/");

    try {

        await gdb.sendCommand(`-file-exec-and-symbols "${normalizedPath}"`);

    } catch (err) {

        console.error("[Diag] No se pudieron cargar los símbolos:", err.message);
        console.error("[Diag] Verificá que MP_ELF apunte al .elf correcto.");
        await gdb.resume().catch(() => {});
        return;

    }

    let breakpointAddr = null;

    try {

        // GDB no está saltando el prólogo de Xtensa automáticamente
        // (el breakpoint por nombre cae en la dirección CRUDA de la
        // función, antes de que se ejecute "entry" y rote la
        // ventana de registros -- ahí a2/a3 todavía son del
        // LLAMADOR, no los argumentos que está por recibir esta
        // función). Desensamblamos para saltar manualmente la
        // instrucción "entry" y poner el breakpoint justo después.
        const disasm = await gdb.sendCommand('-data-disassemble -s gpio_set_level -e "gpio_set_level+24" -- 0');

        // Buscamos la primera línea que NO sea la instrucción
        // "entry" (esa es siempre la primera, offset 0) y tomamos
        // su dirección.
        const addrMatches = [...disasm.matchAll(/address="(0x[0-9a-fA-F]+)"/g)];
        const instMatches = [...disasm.matchAll(/inst="([^"]*)"/g)];

        let targetAddr = null;

        for (let i = 0; i < addrMatches.length; i++) {

            const isEntry = instMatches[i] && /^entry\b/i.test(instMatches[i][1]);

            if (!isEntry) {
                targetAddr = addrMatches[i][1];
                break;
            }

        }

        if (!targetAddr) {
            throw new Error("No se pudo identificar la instrucción posterior a 'entry' en el desensamblado.");
        }

        breakpointAddr = targetAddr;

        console.log(`[Diag] Prólogo saltado manualmente -- breakpoint real en ${breakpointAddr} (no en la entrada cruda).`);

        await gdb.sendCommand(`-break-insert *${breakpointAddr}`);

    } catch (err) {

        console.error("[Diag] No se pudo poner el breakpoint post-prólogo:", err.message);
        console.error("[Diag] Fallback: poniendo el breakpoint por nombre (puede leer argumentos mal).");

        try {
            await gdb.sendCommand("-break-insert gpio_set_level");
        } catch (err2) {
            console.error("[Diag] Tampoco se pudo con el fallback:", err2.message);
            await gdb.resume().catch(() => {});
            return;
        }

    }

    // Prueba definitiva, independiente de argumentos/ventanas de
    // registros: un watchpoint de hardware que para el CPU en el
    // instante exacto de CUALQUIER escritura a GPIO_OUT_REG, y nos
    // reporta el valor viejo/nuevo directamente. Si esto nunca se
    // dispara pese a llamar led.on() muchas veces, confirma que la
    // CPU jamás emite una escritura a esa dirección -- ni siquiera
    // a nivel de instrucción.
    // Además de GPIO_OUT_REG "clásico", vigilamos también los
    // registros atómicos set/clear -- si ESP-IDF v5 escribe el
    // nivel del pin ahí en vez de en OUT_REG directo (que es lo
    // usual en hardware real para evitar race entre cores), el
    // watchpoint de OUT_REG solo nunca se va a disparar aunque el
    // firmware SÍ esté escribiendo GPIO correctamente.
    const watchTargets = [
        { addr: CONFIG.GPIO_OUT_REG, label: "GPIO_OUT_REG" },
        { addr: CONFIG.GPIO_OUT_W1TS_REG, label: "GPIO_OUT_W1TS_REG" },
        { addr: CONFIG.GPIO_OUT_W1TC_REG, label: "GPIO_OUT_W1TC_REG" },
        { addr: CONFIG.GPIO_ENABLE_REG, label: "GPIO_ENABLE_REG" },
        { addr: CONFIG.GPIO_ENABLE_W1TS_REG, label: "GPIO_ENABLE_W1TS_REG" },
        { addr: CONFIG.GPIO_ENABLE_W1TC_REG, label: "GPIO_ENABLE_W1TC_REG" },
    ];

    for (const { addr, label } of watchTargets) {

        try {

            await gdb.sendCommand(`-break-watch "*(unsigned int*)${addr}"`);
            console.log(`[Diag] Watchpoint puesto en *${label}.`);

        } catch (err) {

            console.error(`[Diag] No se pudo poner el watchpoint en ${label}:`, err.message);

        }

    }

    // -break-watch devuelve ^done tanto si QEMU realmente soporta
    // watchpoints de hardware como si el gdbstub simplemente no
    // los rechazó -- no es garantía de que el trap vaya a
    // dispararse de verdad. -break-list nos muestra la tabla real
    // de GDB: si dice "hw watchpoint" confía en que la CPU lo va a
    // vigilar en hardware; si dice apenas "watchpoint" a secas, GDB
    // cayó a simularlo con single-step (funciona pero es lentísimo
    // y lo notarías); y si no aparece un tipo claro para ninguno,
    // es señal de que el gdbstub de QEMU para xtensa no está
    // implementando el paquete de watchpoints en absoluto acá.
    try {

        const breakList = await gdb.sendCommand("-break-list");
        console.log("[Diag] Tabla de breakpoints/watchpoints real de GDB:");
        console.log(breakList);

    } catch (err) {

        console.error("[Diag] No se pudo obtener -break-list:", err.message);

    }

    console.log("[Diag] Breakpoint listo en gpio_set_level(). Reanudando target.");
    console.log("[Diag] Ahora probá led.on() / led.off() en el REPL de MicroPython.");

    let hitCount = 0;
    let awaitingFinish = false;

    // Fase 2 del diagnóstico: una vez que desensamblamos la función
    // (en el primer hit del breakpoint de entrada) y encontramos la
    // instrucción de store real, ponemos un breakpoint ahí mismo.
    // A diferencia del breakpoint de entrada (que cae ANTES de que
    // se calcule la dirección real), acá el store todavía no se
    // ejecutó -- así que podemos leer los registros que arman la
    // dirección (base + offset) en el momento exacto, antes de que
    // pase nada, y comparar contra lo que asumíamos en CONFIG.
    let storeSiteAddr = null;
    let storeBaseReg = null;
    let storeValueReg = null;
    let storeOffset = null;
    let storeSiteArmed = false;
    let awaitingStoreSiteStep = false;

    gdb.onStopped(async (info) => {

        if (info.reason === "watchpoint-trigger") {

            console.log("[Diag] *** WATCHPOINT: se escribió GPIO_OUT_REG ***");
            console.log("[Diag]   ", info.raw);

            await gdb.resume().catch(() => {});
            return;

        }

        // Este callback se dispara con CUALQUIER *stopped. Los
        // distinguimos con flags: awaitingStoreSiteStep (paso único
        // justo después del store real), awaitingFinish (dump final
        // post-retorno), o si no, asumimos que es un breakpoint-hit
        // (entrada de la función, o el breakpoint en el store site).

        if (awaitingStoreSiteStep) {

            awaitingStoreSiteStep = false;

            try {

                const targetAddr = storeSiteAddr.__targetAddrDecimal;

                console.log(`[Diag]   Paso ejecutado. Leyendo memoria en la dirección real calculada (0x${targetAddr.toString(16)})...`);

                const targetVal = await gdb.readRegister32(targetAddr);
                console.log(`[Diag]   *(0x${targetAddr.toString(16)}) [offset ${storeOffset} desde la base] = 0x${targetVal.toString(16)}`);

                // Si la base resultó ser 0x3ff44000 (la base real del
                // periférico GPIO), leemos también el offset +4, que
                // según el Technical Reference Manual es GPIO_OUT_REG
                // -- así vemos si escribir el registro atómico (W1TS,
                // offset +8) tuvo el efecto secundario de mover el
                // bit a OUT_REG, o si QEMU no emula ese efecto.
                const outRegGuess = targetAddr - storeOffset + 4;
                const outRegVal = await gdb.readRegister32(outRegGuess);
                console.log(`[Diag]   *(0x${outRegGuess.toString(16)}) [asumiendo layout estándar, offset +4 = OUT_REG] = 0x${outRegVal.toString(16)}`);
                console.log(`[Diag]   Bit 2 ahí = ${(outRegVal >> 2) & 1} (esperado: 1 si la propagación W1TS -> OUT_REG existe en este QEMU)`);

            } catch (err) {

                console.error("[Diag]   Error leyendo memoria post-store:", err.message);

            }

            await gdb.resume().catch(() => {});
            return;

        }

        if (awaitingFinish) {

            awaitingFinish = false;

            console.log("[Diag]   gpio_set_level() terminó -- leyendo GPIO_OUT_REG ahora mismo...");

            try {

                const outReg = await gdb.readRegister32(CONFIG.GPIO_OUT_REG);
                const enableReg = await gdb.readRegister32(CONFIG.GPIO_ENABLE_REG);
                const outW1ts = await gdb.readRegister32(CONFIG.GPIO_OUT_W1TS_REG);
                const outW1tc = await gdb.readRegister32(CONFIG.GPIO_OUT_W1TC_REG);
                const enableW1ts = await gdb.readRegister32(CONFIG.GPIO_ENABLE_W1TS_REG);
                const enableW1tc = await gdb.readRegister32(CONFIG.GPIO_ENABLE_W1TC_REG);
                const strapReg = await gdb.readRegister32(CONFIG.GPIO_STRAP_REG);

                console.log(`[Diag]   OUT              = 0x${outReg.toString(16)}`);
                console.log(`[Diag]   ENABLE           = 0x${enableReg.toString(16)}`);
                console.log(`[Diag]   OUT_W1TS         = 0x${outW1ts.toString(16)}`);
                console.log(`[Diag]   OUT_W1TC         = 0x${outW1tc.toString(16)}`);
                console.log(`[Diag]   ENABLE_W1TS      = 0x${enableW1ts.toString(16)}`);
                console.log(`[Diag]   ENABLE_W1TC      = 0x${enableW1tc.toString(16)}`);
                console.log(`[Diag]   STRAP (control)  = 0x${strapReg.toString(16)} (esperado: 0x12, es el boot:0x12 de la consola serie)`);
                console.log(`[Diag]   Bit 2 de OUT = ${(outReg >> 2) & 1} (esperado: 1 si led.on() escribió de verdad)`);

            } catch (err) {

                console.error("[Diag] Error leyendo registros post-finish:", err.message);

            }

            await gdb.resume().catch(() => {});
            return;

        }

        if (info.reason !== "breakpoint-hit") return;

        try {

            if (info.threadId) {
                await gdb.sendCommand(`-thread-select ${info.threadId}`);
            }

            const pc = await gdb.sendCommand('-data-evaluate-expression "$pc"');

            // ¿Este hit es el breakpoint del store site (fase 2), y
            // no el de entrada a la función? Lo distinguimos por
            // dirección, ya que ambos breakpoints reportan la misma
            // reason="breakpoint-hit".
            if (storeSiteAddr && pc.includes(storeSiteAddr.hex)) {

                console.log(`[Diag]   *** Llegamos a la instrucción de store real (${storeSiteAddr.hex}) ***`);

                const baseVal = await gdb.sendCommand(`-data-evaluate-expression "$${storeBaseReg}"`);
                const valueVal = await gdb.sendCommand(`-data-evaluate-expression "$${storeValueReg}"`);

                const baseMatch = baseVal.match(/-?\d+/);
                const valueMatch = valueVal.match(/-?\d+/);

                const baseDecimal = baseMatch ? (parseInt(baseMatch[0], 10) >>> 0) : null;
                const valueDecimal = valueMatch ? (parseInt(valueMatch[0], 10) >>> 0) : null;

                console.log(`[Diag]   $${storeBaseReg} (base) = 0x${baseDecimal !== null ? baseDecimal.toString(16) : "?"}`);
                console.log(`[Diag]   $${storeValueReg} (valor a escribir) = 0x${valueDecimal !== null ? valueDecimal.toString(16) : "?"}`);

                if (baseDecimal !== null) {

                    const targetAddr = baseDecimal + storeOffset;
                    console.log(`[Diag]   Dirección real de escritura = base + ${storeOffset} = 0x${targetAddr.toString(16)}`);

                    if (baseDecimal !== 0x3ff44000) {
                        console.log(`[Diag]   *** OJO: la base NO es 0x3ff44000 como asumíamos -- las direcciones de CONFIG están mal para este build. ***`);
                    }

                    storeSiteAddr.__targetAddrDecimal = targetAddr;

                }

                awaitingStoreSiteStep = true;
                await gdb.sendCommand("-exec-step-instruction");

                return;

            }

            hitCount++;

            console.log(`[Diag] *** gpio_set_level() fue llamado (#${hitCount}) ***`, `(thread ${info.threadId})`);
            console.log(`[Diag]   $pc = ${pc}`);

            // Solo hace falta desensamblar y armar el breakpoint del
            // store site una vez -- a partir del segundo hit ya lo
            // tenemos listo y vamos derecho a resumir.
            if (!storeSiteArmed) {

                storeSiteArmed = true;

                try {

                    const fullDisasm = await gdb.sendCommand(
                        '-data-disassemble -s gpio_set_level -e "gpio_set_level+120" -- 0'
                    );

                    // OJO: el campo inst="..." de GDB/MI trae el
                    // separador de operandos como la secuencia de
                    // texto literal "\t" (barra invertida + letra t,
                    // al estilo de un string en C escapado) -- NO es
                    // un carácter tab de verdad. Si no lo
                    // desescapamos acá, cualquier regex que busque
                    // "\s+" después del mnemónico nunca matchea nada.
                    const instLines = [...fullDisasm.matchAll(/address="(0x[0-9a-fA-F]+)"[^}]*?inst="([^"]*)"/g)]
                        .map(([, addr, inst]) => [null, addr, inst.replace(/\\t/g, " ")]);

                    console.log("[Diag]   Desensamblado completo de gpio_set_level (buscando s32i/l32r):");

                    for (const [, addr, inst] of instLines) {
                        if (/\b(s32i|l32r)\b/i.test(inst)) {
                            console.log(`[Diag]     ${addr}:  ${inst}   <-- relevante`);
                        } else if (CONFIG.verbose) {
                            console.log(`[Diag]     ${addr}:  ${inst}`);
                        }
                    }

                    // Buscamos el store real: descartamos los que
                    // usan a1 (puntero de pila, guardan argumentos)
                    // o a10 (lo vimos usado como pila auxiliar en el
                    // camino de log de error) como base -- el que
                    // queda debería ser el que escribe al periférico.
                    for (const [, addr, inst] of instLines) {

                        const m = inst.match(/s32i(?:\.n)?\s+a(\d+),\s*a(\d+),\s*(\d+)/i);

                        if (!m) continue;

                        const [, valReg, baseReg, offset] = m;

                        if (baseReg === "1" || baseReg === "10") continue;

                        storeSiteAddr = { hex: addr };
                        storeBaseReg = `a${baseReg}`;
                        storeValueReg = `a${valReg}`;
                        storeOffset = parseInt(offset, 10);

                        console.log(`[Diag]   Store real identificado en ${addr}: s32i a${valReg}, a${baseReg}, ${offset}`);

                        await gdb.sendCommand(`-break-insert *${addr}`);
                        console.log(`[Diag]   Breakpoint puesto en el store site (${addr}).`);

                        break;

                    }

                    if (!storeSiteAddr) {
                        console.error("[Diag]   No se identificó un store claro al periférico -- seguimos solo con -exec-finish.");
                    }

                } catch (err) {

                    console.error("[Diag]   No se pudo desensamblar/armar el store site:", err.message);

                }

            }

            // Reanudamos sin -exec-finish: si el store site quedó
            // armado, el próximo *stopped va a ser ESE breakpoint
            // (más preciso). Si no, dejamos -exec-finish como
            // respaldo para al menos ver el estado post-retorno.
            if (storeSiteAddr) {

                await gdb.resume();

            } else {

                awaitingFinish = true;
                await gdb.sendCommand("-exec-finish");

            }

        } catch (err) {

            console.error("[Diag] Error en el manejo del breakpoint:", err.message);
            awaitingFinish = false;
            awaitingStoreSiteStep = false;
            await gdb.resume().catch(() => {});

        }

    });

    await gdb.resume();

}

// ============================================
// Arranque
// ============================================

async function main() {

    // Fallar rápido y claro ACÁ, antes de gastar tiempo levantando
    // QEMU y GDB, si el .elf no existe en el disco -- mejor esto
    // que descubrirlo recién cuando -file-exec-and-symbols falle
    // adentro de runGpioEventBridge, varios segundos después.
    if (CONFIG.mpElfPath && !fs.existsSync(CONFIG.mpElfPath)) {

        console.error(`[Bridge] MP_ELF apunta a un archivo que no existe: ${CONFIG.mpElfPath}`);
        console.error("[Bridge] Verificá la ruta -- rutas con espacios en PowerShell necesitan comillas.");
        process.exit(1);

    }

    // Antes esto arrancaba en el orden inverso. Ahora startQemu()
    // necesita "wss" para poder transmitir la salida del REPL al
    // navegador apenas la produce, así que el WebSocket server tiene
    // que existir primero (aunque todavía no haya clientes
    // conectados -- eso no importa, wss.clients simplemente estará
    // vacío hasta que el navegador se conecte).
    const wss = startWebSocketServer();

    startQemu(wss);

    // Le damos un momento a QEMU para levantar el servidor GDB
    // antes de intentar conectarnos.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const gdb = new GdbMiClient(CONFIG.gdbBinary, CONFIG.gdbHost, CONFIG.gdbPort, {
        debug: !!process.env.GDB_DEBUG
    });

    // Le pasamos CONFIG.mpElfPath (puede ser null) para que, si está
    // seteado MP_ELF, gdb cargue los símbolos ANTES de conectarse al
    // remoto -- ver el comentario en GdbMiClient.start() sobre por
    // qué esto evita el error de "Remote 'g' packet reply".
    await gdb.start(CONFIG.mpElfPath);

    if (CONFIG.debugBreakpoint) {

        if (!CONFIG.mpElfPath) {

            console.error("[Diag] DEBUG_BREAKPOINT está activo pero falta MP_ELF (ruta al .elf).");
            process.exit(1);

        }

        await runGpioBreakpointDiagnostic(gdb, CONFIG.mpElfPath);

        // En modo diagnóstico NO arrancamos el bridge normal --
        // solo queremos ver si el breakpoint se dispara.

    } else if (CONFIG.mpElfPath) {

        // Confirmado con el diagnóstico: pollear GPIO_OUT_REG /
        // GPIO_ENABLE_REG no funciona en esta build de QEMU (la
        // escritura a los registros atómicos W1TS nunca se
        // propaga). Con el .elf disponible, usamos el bridge
        // basado en eventos en su lugar.
        await runGpioEventBridge(gdb, wss, CONFIG.mpElfPath);

    } else {

        console.warn("[Bridge] MP_ELF no está seteado -- usando el polling de GPIO_OUT_REG/GPIO_ENABLE_REG.");
        console.warn("[Bridge] OJO: en la build de QEMU esp_develop_9.2.2_20250817 este polling NO detecta cambios reales");
        console.warn("[Bridge] (confirmado: la escritura a los registros W1TS nunca se refleja en OUT_REG/ENABLE_REG).");
        console.warn("[Bridge] Seteá MP_ELF a la ruta de tu micropython.elf para usar el bridge basado en eventos.");

        pollGpioLoop(gdb, wss);

    }

}

main().catch((err) => {

    console.error("[Bridge] Error fatal:", err);
    process.exit(1);

});