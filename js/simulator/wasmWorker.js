/*
==========================================================
 PitSimulator — wasmWorker.js

 Corre DENTRO de un Web Worker (ver WasmBridge.js). Carga MicroPython
 WASM (assets/wasm/micropython.mjs + .wasm, compilado con Emscripten
 desde ~/projects/micropython-v1.28/ports/webassembly -- ver plan en
 curso, no está vendorizado en este repo por tamaño, hay que
 regenerarlo con el mismo build que ya se usó en la Fase 0) y ejecuta
 el código del alumno.

 Por qué un Worker y no el hilo principal: mp.runPython() puede
 tardar (ver más abajo), y si fuera el hilo principal, toda la
 página (UI, canvas, clicks) se congelaría durante cualquier script
 del alumno. Adentro de un Worker, solo ESTE hilo se bloquea -- la
 página sigue viva.

 "Interrumpir" (ver WasmBridge.interrupt()) no manda ningún mensaje
 acá -- directamente mata este Worker entero desde afuera
 (Worker.terminate()) y arranca uno nuevo. No hay Ctrl+C real desde
 adentro de un script ya corriendo.

 ACTUALIZADO -- time.sleep() SI le devuelve el control a este mismo
 message loop mientras espera (ver mphalport.c del build de
 micropython.mjs: mp_hal_delay_ms() usa emscripten_sleep(), que
 requiere Asyncify, en vez del busy-wait original). Esto es lo que
 hace posible que un mensaje "processLine" (ver más abajo) llegue y
 se aplique EN VIVO mientras un while True: con sleep() sigue
 corriendo -- confirmado en vivo con clics reales desde el hilo
 principal actualizando un ADC leído dentro de un bucle activo.
 Fuera de esas ventanas de sleep (mientras el bytecode está
 activamente ejecutando, sin ningún sleep de por medio), este mismo
 hilo sigue bloqueado como siempre -- un script sin ningún sleep()
 en su bucle sigue sin poder recibir actualizaciones hasta que
 termine o el usuario lo interrumpa.
==========================================================
*/

let mp = null;
let baseLoaded = false;
let processLineBusy = false;

// BUG REAL reportado (texto con tildes/ñ llegando corrupto -- "DÃ³nde"
// en vez de "Dónde"): el stdout del puerto llega BYTE A BYTE (ver el
// comentario de "stdout" más abajo), y un carácter no-ASCII en UTF-8
// ocupa 2+ bytes -- decodificar cada byte por separado con
// String.fromCharCode() (como hacía esto antes) solo da el resultado
// correcto para ASCII puro; para cualquier otra cosa, cada byte de la
// secuencia multi-byte se interpreta como SU PROPIO carácter Latin-1,
// produciendo la mojibake de arriba. Un TextDecoder("utf-8") en modo
// streaming (decode(chunk, {stream:true})) es el mecanismo estándar
// para esto exacto: junta bytes de una secuencia multi-byte que
// lleguen en llamadas separadas y recién devuelve texto cuando la
// secuencia está completa -- tiene que ser UNA sola instancia
// persistente (no una nueva por byte) para que ese buffering interno
// funcione entre llamadas.
const _stdoutDecoder = new TextDecoder("utf-8");

const BASE_WASM_URL      = new URL("../../components_wasm/_base_wasm.py", import.meta.url);
const I2C_BUS_WASM_URL   = new URL("../../components_wasm/_i2c_bus_wasm.py", import.meta.url);
const KEYPAD_I2C_WASM_URL = new URL("../../components_wasm/_keypad_i2c_wasm.py", import.meta.url);
const ADC_BUS_WASM_URL   = new URL("../../components_wasm/_adc_bus_wasm.py", import.meta.url);
const NEOPIXEL_WASM_URL  = new URL("../../components_wasm/_neopixel_wasm.py", import.meta.url);
const ESPNOW_WASM_URL    = new URL("../../components_wasm/_espnow_wasm.py", import.meta.url);
const REQUESTS_WASM_URL  = new URL("../../components_wasm/_requests_wasm.py", import.meta.url);
const BLUETOOTH_WASM_URL = new URL("../../components_wasm/_bluetooth_wasm.py", import.meta.url);
const LIBS_BUNDLE_URL    = new URL("../../components_wasm/libs/bundle.json", import.meta.url);

// =============================================================
// Librerías de usuario (components_wasm/libs/, copia normalizada de
// C:\Users\p_garcia.ra\OneDrive\Desktop\Micropython\Librerias) -- las
// mismas que ya venían FROZEN en el firmware real de QEMU, pero acá
// el puerto WASM no tiene ningún equivalente: ningún "import X" de
// esta carpeta existía antes de esto, así que cualquier script que
// las usara (np.py, ezFBmarquee, dht, sensores I2C con su propia
// clase, etc.) tiraba "ImportError: no module named 'X'" siempre,
// sin excepción -- confirmado en vivo con un script real de matriz
// NeoPixel + texto con ezFBmarquee.
//
// BUG REAL evitado a propósito (ver components_wasm/libs/np.py.
// original en la carpeta fuente): algunos de estos archivos vienen
// con fin de línea CR SOLO (estilo Mac clásico) en vez de LF -- un
// archivo de 80+ líneas se leía como UNA sola línea gigante. Si
// MicroPython no trata un \r suelto como salto de línea válido (no
// se confirmó, pero tampoco hace falta arriesgarse), esos archivos
// fallarían al compilar. Normalizados a LF una sola vez al copiarlos
// a este repo (ver el script que los generó) -- no en runtime.
//
// Por qué un sistema de archivos virtual en vez del mismo truco de
// fetch+runPython que usan _base_wasm.py/etc: a diferencia de esos
// (un puñado fijo, siempre necesarios), estas son decenas de
// librerías de uso OPCIONAL, cualquier subconjunto de las cuales
// puede hacer falta según lo que el alumno importe -- y varias se
// importan ENTRE SÍ (np.py importa ezFBmarquee Y ezFBfont_4x6_latin_06
// con un "from X import Y" normal, no algo que yo controle). Escribir
// cada una a mano con fetch+exec() requeriría resolver ese árbol de
// dependencias transitivas acá en JS. En cambio, loadMicroPython()
// expone el sistema de archivos real de Emscripten como mp.FS (ver
// ports/webassembly/api.js) -- escribiendo estos archivos ahí y
// agregando esa carpeta a sys.path, el import NATIVO de MicroPython
// resuelve TODO el árbol de dependencias solo, exactamente como lo
// haría con un filesystem real -- sin reinventar nada de eso a mano.
//
// BUG REAL encontrado en vivo (reportado: "clic en Simular se demora
// mucho"): la primera versión de esto pedía manifest.json y DESPUÉS
// las 62 librerías, UNA POR UNA (62 fetch() separados) -- en cada
// click de "Simular" (WasmBridge._spawnWorker() arranca un Worker
// NUEVO cada vez, nunca reusa el anterior), no solo la primera vez.
// 62 ida-y-vuelta HTTP, aunque sean a localhost, se notan. Fix:
// empaquetar las 62 en UN SOLO bundle.json ({nombre: contenido}),
// generado una vez al copiar la carpeta (ver el script que lo generó)
// -- un solo fetch() en vez de 62, mismo resultado final (los mismos
// archivos terminan escritos en /libs).
async function _loadUserLibraries(mp) {

    let bundle;
    try {
        bundle = await (await fetch(LIBS_BUNDLE_URL, { cache: "no-store" })).json();
    } catch (err) {
        console.warn("[wasmWorker] No se pudo cargar el paquete de librerías:", err);
        return;
    }

    mp.FS.mkdir("/libs");

    for (const [name, text] of Object.entries(bundle)) {
        try {
            mp.FS.writeFile(`/libs/${name}.py`, text);
        } catch (err) {
            // Que falte UNA no debería tirar abajo a las demás -- peor
            // es nada que perder las otras 61 por una sola rota.
            console.warn(`[wasmWorker] No se pudo escribir la librería "${name}":`, err);
        }
    }

    // sys.path ya trae algunas entradas por default (ver el propio
    // puerto) -- se agrega /libs al final, nunca se reemplaza nada.
    await mp.runPython("import sys\nif '/libs' not in sys.path:\n    sys.path.append('/libs')\n");

}

self.onmessage = async (e) => {

    const msg = e.data;

    if (msg.type === "init") {

        try {

            const mp_mjs = await import("../../assets/wasm/micropython.mjs");
            mp = await mp_mjs.loadMicroPython({
                // Con linebuffer:false, "data" llega BYTE A BYTE como un
                // Uint8Array de 1 elemento (ver ports/webassembly/api.js,
                // Module.stdout = (c) => stdout(new Uint8Array([c]))) --
                // hay que decodificarlo a texto acá antes de mandarlo:
                // WasmBridge.js espera el stream crudo como STRING (mismo
                // criterio que QemuBridge.js con el WebSocket) para poder
                // acumular+split("\n") y parsear el protocolo. Ver
                // _stdoutDecoder arriba -- stream:true devuelve "" (nada
                // que mandar) mientras un carácter multi-byte está a
                // medio llegar.
                stdout: (data) => {
                    const text = _stdoutDecoder.decode(data, { stream: true });
                    if (text) self.postMessage({ type: "stdout", data: text });
                },
                linebuffer: false,
            });

            // BUG REAL encontrado en vivo (reportado: ImportError sobre
            // un archivo que SÍ estaba en el servidor -- el navegador
            // tenía en caché una versión vieja de uno de estos fetch()
            // de una corrida anterior, de ANTES de que ese archivo
            // existiera/cambiara). Python's http.server no manda
            // Cache-Control, así que el navegador queda libre de
            // cachear estos .py con su propia heurística -- cada vez
            // que se edita alguno de estos archivos (pasó varias veces
            // hoy mismo: ESPNOW/requests/bluetooth), una pestaña ya
            // abierta podía seguir sirviendo la versión vieja de ESTE
            // fetch puntual aunque los demás sí se actualizaran, un
            // estado mezclado difícil de diagnosticar desde afuera.
            // cache:"no-store" fuerza a pedir siempre la red -- ya se
            // vuelve a fetchear TODO esto en cada "▶ Simular" de
            // cualquier forma (Worker nuevo), así que no hay ningún
            // costo real en dejar de cachear.
            const NO_CACHE = { cache: "no-store" };

            const baseCode = await (await fetch(BASE_WASM_URL, NO_CACHE)).text();
            await mp.runPython(baseCode);

            const i2cCode = await (await fetch(I2C_BUS_WASM_URL, NO_CACHE)).text();
            await mp.runPython(i2cCode);

            const keypadI2cCode = await (await fetch(KEYPAD_I2C_WASM_URL, NO_CACHE)).text();
            await mp.runPython(keypadI2cCode);

            const adcCode = await (await fetch(ADC_BUS_WASM_URL, NO_CACHE)).text();
            await mp.runPython(adcCode);

            const neopixelCode = await (await fetch(NEOPIXEL_WASM_URL, NO_CACHE)).text();
            await mp.runPython(neopixelCode);

            // MAC de ESTE ESP32 (ver plan ESP-NOW/Simulator multi-
            // dispositivo) -- inyectada ANTES de correr _espnow_wasm.py
            // para que pueda leerla como global al definir su propia
            // network.WLAN.config('mac'). Viene en el mensaje "init"
            // (ver WasmBridge._spawnWorker()) como hex SIN ":", o
            // "000000000000" si no hay ningún ESP32 (modo "sin placa",
            // ver Simulator.spawnBridgesForAllEsp32()).
            mp.globals.set("_pit_esp32_mac_hex", msg.macHex || "000000000000");
            const espnowCode = await (await fetch(ESPNOW_WASM_URL, NO_CACHE)).text();
            await mp.runPython(espnowCode);

            // "requests"/"urequests" (ver plan ESP-NOW→WiFi→BLE, Fase
            // WiFi) -- depende de register_line_handler() de
            // _base_wasm.py, sin requisito de orden respecto a
            // _espnow_wasm.py más allá de eso.
            const requestsCode = await (await fetch(REQUESTS_WASM_URL, NO_CACHE)).text();
            await mp.runPython(requestsCode);

            // BLE (ver plan ESP-NOW→WiFi→BLE, última fase) -- depende
            // de register_line_handler() de _base_wasm.py y de la MAC
            // ya inyectada arriba, sin más orden que eso.
            const bluetoothCode = await (await fetch(BLUETOOTH_WASM_URL, NO_CACHE)).text();
            await mp.runPython(bluetoothCode);

            await _loadUserLibraries(mp);

            baseLoaded = true;

            self.postMessage({ type: "ready" });

        } catch (err) {
            self.postMessage({ type: "error", data: "\n⚠️ No se pudo cargar MicroPython WASM: " + err + "\n" });
        }

        return;

    }

    if (msg.type === "run") {

        if (!mp || !baseLoaded) {
            self.postMessage({ type: "error", data: "\n⚠️ El intérprete todavía no está listo.\n" });
            self.postMessage({ type: "runDone", runId: msg.runId });
            return;
        }

        try {
            // Snapshot de teclado(s) I2C armado por WasmBridge.js
            // (sendData()) justo antes de postear este mensaje -- ver
            // _keypad_i2c_wasm.py para por qué esto reemplaza al
            // mecanismo genérico I2CR:/I2CW: para este componente en
            // particular. Se aplica SIEMPRE antes de correr (tanto
            // "Ejecutar" como una línea del REPL) para que una tecla
            // apretada justo antes de mandar el código ya esté
            // disponible cuando el script llame a get_key().
            if (typeof msg.keypadSnapshot === "string") {
                mp.globals.set("_pit_keypad_snapshot_src", msg.keypadSnapshot);
                await mp.runPython("_pit_apply_keypad_snapshot(_pit_keypad_snapshot_src)");
            }
            if (msg.replEcho) {
                // Ver _pit_repl_eval en _base_wasm.py -- SOLO para la
                // línea suelta del input de abajo (nunca "▶ Ejecutar"):
                // muestra el repr si "code" es una expresión (como
                // tipear "a" en un REPL real), igual que mp.globals.set
                // + runPython("process_line(...)") ya hace para las
                // líneas de protocolo más abajo -- evita tener que
                // escapar comillas/backslashes a mano interpolando el
                // string directo en el source.
                mp.globals.set("_pit_repl_src", msg.code);
                await mp.runPython("_pit_repl_eval(_pit_repl_src)");
            } else {
                // NO se espera a processLineBusy/ningún lock acá -- este
                // "await" es justamente lo que le permite al event loop
                // de ESTE Worker atender un mensaje "processLine" que
                // llegue mientras este script está en un yield de
                // Asyncify (adentro de un time.sleep()), sin bloquearlo
                // detrás de la corrida completa. Ver el comentario
                // grande de processLineBusy más abajo.
                await mp.runPython(msg.code);
            }
        } catch (err) {
            self.postMessage({ type: "stdout", data: "\n" + String(err) + "\n" });
        }

        // Si esto tarda (ej. un while True: con sleep(), ver el
        // comentario grande al principio del archivo), este mensaje
        // recién sale cuando mp.runPython() finalmente retorna. Si el
        // usuario interrumpe antes (Worker.terminate()), este postMessage
        // nunca llega a mandarse -- no pasa nada, el Worker entero ya
        // no existe para cuando llegaría.
        self.postMessage({ type: "runDone", runId: msg.runId });

        return;

    }

    if (msg.type === "processLine") {

        // Mensaje simulador→firmware (IN:/BH1750:/etc, ver
        // WasmBridge.sendData()) -- se pasa el string por
        // mp.globals.set() (API documentada del puerto) en vez de
        // interpolarlo dentro de una llamada a runPython(): así no
        // hace falta escapar comillas/backslashes a mano, el valor
        // llega tal cual como string de Python.
        //
        // processLineBusy evita que DOS procesLine se pisen entre sí
        // (ej. clics muy seguidos) -- si uno ya está en vuelo, este se
        // descarta en silencio en vez de encolarse (la PRÓXIMA
        // actualización de ese mismo pin/sensor va a llegar enseguida
        // de todas formas, no vale la pena acumular mensajes viejos).
        // A PROPÓSITO no hay ningún guard acá contra el mensaje "run"
        // -- encadenar esto detrás de una corrida en curso (ej. con
        // una promesa compartida) fue el primer intento, y rompía
        // justo lo que se buscaba: con eso, ESTE handler ni arrancaba
        // hasta que la corrida completa (today el while True: con
        // sleep() entero) terminara. Sin ningún lock cruzado, el único
        // mecanismo que decide CUÁNDO puede correr esto es el propio
        // event loop de JS de este Worker -- que de por sí no le da
        // una vuelta a este handler mientras mp.runPython(msg.code)
        // sigue activamente ejecutando bytecode (igual que siempre),
        // pero SÍ se la da durante cualquier yield de Asyncify
        // (adentro de un time.sleep()) -- ahí es exactamente donde
        // esto necesita poder colarse para que un clic se vea reflejado
        // en vivo dentro de un bucle que ya está corriendo.
        if (mp && baseLoaded && !processLineBusy) {
            processLineBusy = true;
            try {
                mp.globals.set("_incoming_line", msg.line);
                await mp.runPython("process_line(_incoming_line)");
            } catch (err) {
                self.postMessage({ type: "stdout", data: "\n" + String(err) + "\n" });
            } finally {
                processLineBusy = false;
            }
        }

        return;

    }

    if (msg.type === "setGlobal") {

        // BUG REAL encontrado en vivo probando WiFi/HTTP (ver
        // _requests_wasm.py/request()): a diferencia de "processLine"
        // de arriba, esto NO llama a mp.runPython() -- mp.globals.set()
        // por sí solo no inicia ningún ccall asyncify-wrapped nuevo
        // (no ejecuta bytecode, solo escribe un valor), así que es
        // seguro llamarlo en CUALQUIER momento, incluso mientras OTRA
        // llamada a mp.runPython() sigue "en vuelo" (suspendida en un
        // time.sleep() propio) -- a diferencia de un SEGUNDO
        // mp.runPython() concurrente, que sí puede chocar con el
        // primero ("RuntimeError: ... We cannot start an async
        // operation when one is already in flight", confirmado en vivo
        // con un bucle de requests.get() -- cada respuesta HTTP llegaba
        // por "processLine" mientras el MISMO script que la esperaba
        // seguía suspendido en su propio sondeo). request() del lado
        // Python directamente consulta este valor en su propio sondeo
        // (ya está despierto cada poll_ms de cualquier forma), así que
        // no hace falta "despertarlo" desde acá con una ejecución nueva.
        if (mp && baseLoaded) {
            try {
                mp.globals.set(msg.key, msg.value);
            } catch (err) {
                self.postMessage({ type: "stdout", data: "\n" + String(err) + "\n" });
            }
        }

        return;

    }

};
