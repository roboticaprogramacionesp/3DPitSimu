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

const BASE_WASM_URL    = new URL("../../components_wasm/_base_wasm.py", import.meta.url);
const I2C_BUS_WASM_URL = new URL("../../components_wasm/_i2c_bus_wasm.py", import.meta.url);

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
            return;
        }

        try {
            mp.runPython(msg.code);
        } catch (err) {
            self.postMessage({ type: "stdout", data: "\n" + String(err) + "\n" });
        }

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
