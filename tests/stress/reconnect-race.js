// ==========================================================
// PitSimulator - tests/stress/reconnect-race.js
//
// Ver tests/stress/README.md para qué es esto, cuándo correrlo y qué
// NO cubre. Resumen: simula un usuario clickeando "Simular"/"Detener"
// muy rápido y repetido contra un bridge QEMU real (no un mock), y
// revisa que eso no corrompa bytes, no tire abajo QEMU, ni dispare
// repasteos de HAL innecesarios -- el escenario real que reveló los
// bugs arreglados el 2026-10-01 (rawStdinWrite() en server.js,
// _probeWarmBoot() con reintento en ReplPanel.js).
//
// Uso: node tests/stress/reconnect-race.js
// (arranca y apaga su propio server.js + QEMU + GDB solo)
// ==========================================================

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const WebSocket = require(path.join(__dirname, "..", "..", "server", "node_modules", "ws"));

const REPO_ROOT = path.join(__dirname, "..", "..");
const SERVER_DIR = path.join(REPO_ROOT, "server");
const VENDOR_DIR = path.join(REPO_ROOT, "desktop", "vendor");

const QEMU_BIN = path.join(VENDOR_DIR, "qemu-xtensa", "bin", "qemu-system-xtensa.exe");
const GDB_BIN = path.join(VENDOR_DIR, "xtensa-esp-elf-gdb", "bin", "xtensa-esp32-elf-gdb.exe");
const NODE_BIN = path.join(VENDOR_DIR, "nodejs", "node.exe");
const MP_ELF = path.join(SERVER_DIR, "micropython.elf");

const WS_PORT = 8787;
const WS_URL = `ws://127.0.0.1:${WS_PORT}`;

// Cuántos ciclos de "click rápido" simular, y qué tan rápido.
const CYCLES = 25;
const CYCLE_GAP_MS = 30;
const STOP_DELAY_MS = 150;  // cuándo se manda el Ctrl+C de "Detener" dentro de cada ciclo

function log(msg) {
    console.log(`[stress] ${msg}`);
}

function checkPrereqs() {
    const missing = [QEMU_BIN, GDB_BIN, MP_ELF].filter((p) => !fs.existsSync(p));
    if (missing.length) {
        console.error("[stress] Faltan archivos necesarios -- esta prueba necesita el proyecto compilado/vendorizado:");
        missing.forEach((p) => console.error(`  - ${p}`));
        process.exit(2);
    }
}

async function ensurePortFree() {
    // Chequeo liviano: intentamos abrir un socket cliente al puerto --
    // si conecta, algo ya está escuchando ahí (probablemente la app de
    // escritorio abierta, u otra corrida de esta prueba que quedó
    // colgada). No lo matamos nosotros (a diferencia de
    // bridge_core._ensure_port_free en la app real) -- mejor avisar
    // claro y dejar que quien corre la prueba decida, es mucho más
    // fácil de diagnosticar que confundir una ejecución MANUAL de esta
    // prueba con pisar algo que el usuario tenía abierto a propósito.
    const net = require("net");
    return new Promise((resolve) => {
        const sock = net.createConnection({ host: "127.0.0.1", port: WS_PORT }, () => {
            sock.destroy();
            console.error(
                `[stress] El puerto ${WS_PORT} ya está ocupado -- cerrá 3DPitSimu/3DPitSimu-Puente ` +
                "(o cualquier otra corrida de esta prueba) antes de volver a intentar."
            );
            process.exit(2);
        });
        sock.on("error", () => resolve()); // nadie escuchando -- libre, seguimos
    });
}

function startBridge() {
    const nodeBin = fs.existsSync(NODE_BIN) ? NODE_BIN : "node";
    const proc = spawn(nodeBin, ["server.js"], {
        cwd: SERVER_DIR,
        env: { ...process.env, QEMU_BIN, GDB_BIN, MP_ELF },
    });

    const state = {
        crashed: false,
        crashReason: null,
        corruptedProbe: false,
        pasteCount: 0,
        fullOutput: [],
        // Se pone en true ANTES de matar el proceso a propósito al
        // final de la prueba (ver stopBridge()) -- sin esto, el
        // taskkill de la limpieza normal dispara el handler "exit" de
        // más abajo con un código no-cero (termination forzada en
        // Windows), que se contaba como un crash real aunque la
        // prueba ya hubiera terminado bien.
        shuttingDown: false,
    };

    const onLine = (line) => {
        state.fullOutput.push(line);

        if (/Guru Meditation|Proceso termin[oó]|Error fatal/i.test(line)) {
            state.crashed = true;
            state.crashReason = state.crashReason || line.trim();
        }

        if (/paste mode/.test(line)) {
            state.pasteCount++;
        }

        // Sondeo corrompido: aparece "_PIT_WARM" pero NO como parte de
        // un mensaje bien formado -- ej. sin el "_" final antes de
        // ("1" o directo cortado. Heurística simple y suficiente: si
        // aparece "_PIT_WARM" en una línea de ECO (no en la respuesta
        // limpia "_PIT_WARM_0"/"_PIT_WARM_1" sola), y esa línea NO
        // contiene el texto completo del sondeo, algo se perdió en el
        // camino.
        if (line.includes("_PIT_WARM") && !/^_PIT_WARM_[01]\s*$/.test(line.trim())) {
            const expected = 'print("_PIT_WARM_" + ("1" if "_pit_state" in __import__("sys").modules else "0"))';
            if (line.includes("_PIT_WARM") && !line.includes(expected) && /print\(/.test(line) === false && /_PIT_WARM_[01]/.test(line) === false) {
                // la línea tiene un fragmento de _PIT_WARM que no es ni
                // el comando completo ni una respuesta limpia -> sospechoso
                state.corruptedProbe = true;
            }
        }

    };

    let buf = "";
    proc.stdout.on("data", (chunk) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop();
        lines.forEach(onLine);
    });
    proc.stderr.on("data", (chunk) => {
        chunk.toString().split("\n").forEach((l) => { if (l.trim()) onLine(l); });
    });

    proc.on("exit", (code) => {
        if (state.shuttingDown) return; // cierre a propósito, ver stopBridge()
        if (code !== 0 && code !== null) {
            state.crashed = true;
            state.crashReason = state.crashReason || `server.js terminó con código ${code}`;
        }
    });

    return { proc, state };
}

function stopBridge(proc, state) {
    return new Promise((resolve) => {
        if (state) state.shuttingDown = true;
        if (!proc || proc.exitCode !== null) { resolve(); return; }
        // Mismo criterio que bridge_core.stop_bridge(): taskkill /T se
        // lleva puestos a los hijos (QEMU/GDB), necesario en Windows
        // porque matar solo el proceso de Node no los termina.
        const { spawn: spawnSync } = require("child_process");
        const killer = spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"]);
        killer.on("close", () => setTimeout(resolve, 500));
        killer.on("error", () => setTimeout(resolve, 500));
    });
}

function waitForListening(timeoutMs) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tryOnce = () => {
            const ws = new WebSocket(WS_URL, { headers: { Origin: "http://localhost" } });
            ws.on("open", () => { ws.close(); resolve(); });
            ws.on("error", () => {
                if (Date.now() - start > timeoutMs) {
                    reject(new Error(`El bridge no empezó a escuchar en ${WS_URL} tras ${timeoutMs}ms`));
                } else {
                    setTimeout(tryOnce, 300);
                }
            });
        };
        tryOnce();
    });
}

function connectOnce() {
    return new Promise((resolve) => {
        const ws = new WebSocket(WS_URL, { headers: { Origin: "http://localhost" } });

        ws.on("open", () => {
            ws.send("\x03"); // Ctrl+C, igual que _probeWarmBoot()
            setTimeout(() => {
                ws.send('print("_PIT_WARM_" + ("1" if "_pit_state" in __import__("sys").modules else "0"))\r\n');
            }, 50);
        });

        ws.on("error", () => resolve());

        setTimeout(() => {
            try { ws.send("\x03"); } catch (e) {} // Ctrl+C de "Detener"
            setTimeout(() => { try { ws.close(); } catch (e) {} resolve(); }, 60);
        }, STOP_DELAY_MS);
    });
}

async function runStress() {
    for (let i = 1; i <= CYCLES; i++) {
        await connectOnce();
        await new Promise((r) => setTimeout(r, CYCLE_GAP_MS));
    }
}

async function main() {

    checkPrereqs();
    await ensurePortFree();

    log(`Arrancando bridge (QEMU real) para la prueba...`);
    const { proc, state } = startBridge();

    try {

        await waitForListening(20000);
        log("Bridge listo -- esperando a que GDB termine de adjuntarse...");
        await new Promise((r) => setTimeout(r, 6000)); // margen real de adjunte de GDB

        log(`Disparando ${CYCLES} ciclos de conectar+Ctrl+C+desconectar, cada ~${CYCLE_GAP_MS}ms...`);
        await runStress();

        log("Ráfaga terminada -- esperando 2s a que asiente...");
        await new Promise((r) => setTimeout(r, 2000));

    } catch (err) {

        state.crashed = true;
        state.crashReason = err.message;

    }

    await stopBridge(proc, state);

    console.log("");
    console.log("================ RESULTADO ================");
    console.log(`Ciclos ejecutados:          ${CYCLES}`);
    console.log(`QEMU/bridge sigue vivo:     ${state.crashed ? "NO -- " + state.crashReason : "sí"}`);
    console.log(`Sondeo corrompido visto:    ${state.corruptedProbe ? "SÍ (ver detalle arriba)" : "no"}`);
    console.log(`Repasteos de HAL disparados: ${state.pasteCount} (se espera 0 o 1 -- el boot inicial puede necesitar uno)`);

    const failed = state.crashed || state.corruptedProbe || state.pasteCount > 1;

    if (failed) {
        console.log("RESULTADO: FALLÓ");
        process.exit(1);
    } else {
        console.log("RESULTADO: OK");
        process.exit(0);
    }

}

main();
