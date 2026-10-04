/*
==========================================================
 PitSimulator — wasmWorker.js

 Corre DENTRO de un Web Worker (ver WasmBridge.js). Carga MicroPython
 WASM (assets/wasm/micropython.mjs + .wasm, compilado con Emscripten
 desde ~/projects/micropython-v1.28/ports/webassembly -- ver plan en
 curso, no está vendorizado en este repo por tamaño, hay que
 regenerarlo con el mismo build que ya se usó en la Fase 0) y ejecuta
 el código del alumno.

 Por qué un Worker y no el hilo principal: mp.runPython() es
 SINCRÓNICO y bloquea por completo el hilo que lo llama mientras
 corre -- si fuera el hilo principal, toda la página (UI, canvas,
 clicks) se congelaría durante cualquier script del alumno. Adentro
 de un Worker, solo ESTE hilo se bloquea -- la página sigue viva.

 "Interrumpir" (ver WasmBridge.interrupt()) no manda ningún mensaje
 acá -- directamente mata este Worker entero desde afuera
 (Worker.terminate()) y arranca uno nuevo. Confirmado en la Fase 0
 que no hay forma de interrumpir un script YA corriendo desde
 adentro (time.sleep() nunca le devuelve el control a este mismo
 message loop mientras espera).
==========================================================
*/

let mp = null;
let baseLoaded = false;

const BASE_WASM_URL      = new URL("../../components_wasm/_base_wasm.py", import.meta.url);
const I2C_BUS_WASM_URL   = new URL("../../components_wasm/_i2c_bus_wasm.py", import.meta.url);
const KEYPAD_I2C_WASM_URL = new URL("../../components_wasm/_keypad_i2c_wasm.py", import.meta.url);
const ADC_BUS_WASM_URL   = new URL("../../components_wasm/_adc_bus_wasm.py", import.meta.url);
const NEOPIXEL_WASM_URL  = new URL("../../components_wasm/_neopixel_wasm.py", import.meta.url);
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
        bundle = await (await fetch(LIBS_BUNDLE_URL)).json();
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
    mp.runPython("import sys\nif '/libs' not in sys.path:\n    sys.path.append('/libs')\n");

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
                // acumular+split("\n") y parsear el protocolo.
                stdout: (data) => self.postMessage({ type: "stdout", data: String.fromCharCode(data[0]) }),
                linebuffer: false,
            });

            const baseCode = await (await fetch(BASE_WASM_URL)).text();
            mp.runPython(baseCode);

            const i2cCode = await (await fetch(I2C_BUS_WASM_URL)).text();
            mp.runPython(i2cCode);

            const keypadI2cCode = await (await fetch(KEYPAD_I2C_WASM_URL)).text();
            mp.runPython(keypadI2cCode);

            const adcCode = await (await fetch(ADC_BUS_WASM_URL)).text();
            mp.runPython(adcCode);

            const neopixelCode = await (await fetch(NEOPIXEL_WASM_URL)).text();
            mp.runPython(neopixelCode);

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
                mp.runPython("_pit_apply_keypad_snapshot(_pit_keypad_snapshot_src)");
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
                mp.runPython("_pit_repl_eval(_pit_repl_src)");
            } else {
                mp.runPython(msg.code);
            }
        } catch (err) {
            self.postMessage({ type: "stdout", data: "\n" + String(err) + "\n" });
        }

        // Si esto tarda (o nunca vuelve -- ej. un while True: con
        // time.sleep(), ver LIMITACIÓN CONOCIDA arriba), este mensaje
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
        if (mp && baseLoaded) {
            try {
                mp.globals.set("_incoming_line", msg.line);
                mp.runPython("process_line(_incoming_line)");
            } catch (err) {
                self.postMessage({ type: "stdout", data: "\n" + String(err) + "\n" });
            }
        }

        return;

    }

};
