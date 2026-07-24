/*
==========================================================
 PitSimulator — keypad4x4_i2c.behavior.js
 Comportamiento de señal del teclado matricial por I2C (PCF8574),
 migrado tal cual desde SignalEngine.evaluateKeypadI2c() (+ su
 helper privado _getKeypadI2cAddress, usado solo por este método)
 hacia ComponentBehaviorRegistry.
==========================================================
*/

function _keypadI2cAddress(component) {
    const raw = component.properties?.address;
    if (raw === undefined || raw === null || raw === "") return 0x20;
    const parsed =
        typeof raw === "string"
            ? parseInt(raw, raw.trim().toLowerCase().startsWith("0x") ? 16 : 10)
            : raw;
    return Number.isFinite(parsed) ? parsed : 0x20;
}

ComponentBehaviorRegistry.register("keypad4x4_i2c", {

    signal: {

        evaluate(component, engine) {

            const address = _keypadI2cAddress(component);

            if (!engine.isFullyConnected(component, "i2c")) return;

            // 0xFF = reposo (nadie escribió nada todavía, todas las
            // filas "altas" -- mismo default que trae readfrom() en
            // keypad4x4_i2c_hal.py).
            const outputByte =
                engine.i2cOutputBytes[address] !== undefined
                    ? engine.i2cOutputBytes[address]
                    : 0xff;

            const pressed = component.keypadPressed || new Set();

            let readByte = outputByte;

            for (let row = 0; row < 4; row++) {
                const rowIsLow = ((outputByte >> row) & 1) === 0;
                if (!rowIsLow) continue;

                for (let col = 0; col < 4; col++) {
                    if (pressed.has(`${row},${col}`)) {
                        readByte &= ~(1 << (4 + col));
                    }
                }
            }

            readByte &= 0xff;

            if (engine.simulator.qemuBridge?.connected) {
                engine.simulator.qemuBridge.sendData(`I2CR:${address}:${readByte}`);
            }

        },

    },

});
