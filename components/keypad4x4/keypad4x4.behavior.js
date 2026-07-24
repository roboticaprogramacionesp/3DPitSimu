/*
==========================================================
 PitSimulator — keypad4x4.behavior.js
 Comportamiento de señal del teclado matricial por GPIO,
 migrado tal cual desde SignalEngine.evaluateKeypadMatrix() (+
 sus 3 helpers privados, usados solo por este método) hacia
 ComponentBehaviorRegistry.

 Se registra para "keypad4x4" Y "keypad3x4" -- la lógica original
 nunca dependió del tipo concreto (las filas/columnas se derivan de
 los propios pines r#/c# del componente, ver Renderer.isKeypadMatrix
 y el comentario de evaluateKeypadMatrix en el SignalEngine.js
 original), así que un solo archivo cubre ambos. No hace falta un
 components/keypad3x4/keypad3x4.behavior.js aparte: su fetch en
 ComponentBehaviorRegistry.loadAll() va a 404 (tolerado), pero para
 cuando esa carga termina este archivo ya se registró para los dos
 tipos -- Promise.all() espera a AMBOS fetches, sin importar cuál
 falla.

 Si en el futuro "keypad4x4" dejara de existir en manifest.json pero
 "keypad3x4" siguiera, este registro se perdería -- revisar acá si
 eso llegara a pasar.
==========================================================
*/

// Ordena pines tipo "r3"/"c12" por su número, no alfabéticamente
// (alfabético pondría "r10" antes que "r2").
function _keypadMatrixSortedPinIds(component, prefix) {
    return component.pins
        .map((p) => p.id)
        .filter((id) => new RegExp(`^${prefix}\\d+$`).test(id))
        .sort(
            (a, b) =>
                parseInt(a.slice(prefix.length), 10) -
                parseInt(b.slice(prefix.length), 10),
        );
}

// Busca si algún pin del ESP32 conectado a este pin (por cable) está
// manejando un valor AHORA MISMO.
function _keypadMatrixDrivenLevel(component, pinId, engine) {
    const net = engine.getNet(`${component.id}:${pinId}`);
    for (const key of net) {
        if (Object.prototype.hasOwnProperty.call(engine.driverStates, key)) {
            return engine.driverStates[key];
        }
    }
    return null;
}

function _keypadMatrixNotifyRow(component, pinId, value, engine) {
    if (!engine.isComponentPowered(component)) return;

    const esp32 = engine.simulator.componentManager
        .getAll()
        .find((c) => c.type.startsWith("esp32"));
    if (!esp32) return;

    const net = engine.getNet(`${component.id}:${pinId}`);

    for (const key of net) {
        const [cId, pId] = key.split(":");
        if (cId !== esp32.id) continue;
        const match = pId.match(/^io(\d+)$/);
        if (!match) continue;
        const gpioNumber = parseInt(match[1], 10);
        if (engine.simulator.qemuBridge?.connected) {
            engine.simulator.qemuBridge.sendData(`IN:${gpioNumber}:${value}`);
        }
        return;
    }
}

const keypadMatrixBehavior = {

    signal: {

        evaluate(component, engine) {

            const rows = _keypadMatrixSortedPinIds(component, "r");
            const cols = _keypadMatrixSortedPinIds(component, "c");
            const pressed = component.keypadPressed || new Set();

            const colLevel = cols.map((colId) =>
                _keypadMatrixDrivenLevel(component, colId, engine),
            );

            engine._dbg(`[scan] cols=${JSON.stringify(colLevel)} pressedSet=${JSON.stringify([...pressed])}`);

            rows.forEach((rowId, rowIndex) => {
                let rowValue = 1;

                cols.forEach((colId, colIndex) => {
                    if (
                        colLevel[colIndex] === 0 &&
                        pressed.has(`${rowIndex},${colIndex}`)
                    ) {
                        rowValue = 0;
                    }
                });

                if (rowValue === 0) {
                    engine._dbg(`[scan] → Fila r${rowIndex} lee 0 (tecla detectada)`);
                }

                _keypadMatrixNotifyRow(component, rowId, rowValue, engine);
            });

        },

    },

};

ComponentBehaviorRegistry.register(["keypad4x4", "keypad3x4"], keypadMatrixBehavior);
