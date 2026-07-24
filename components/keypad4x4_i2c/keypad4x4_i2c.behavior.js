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

    propertyPanel: {

        // Migrado tal cual desde PropertyPanel._renderKeypadI2c().
        render(component, panel) {

            panel.content.innerHTML = "";
            component.properties = component.properties || {};

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "Teclado Matricial 4x4 (I2C)";
            panel.content.appendChild(title);

            // A diferencia de OLED/LCD, ACÁ este campo sí es funcional:
            // evaluateKeypadI2c() en SignalEngine.js lee
            // component.properties.address en cada evaluación -- cambiar
            // este valor cambia de verdad a qué dirección responde el
            // simulador (0x20 = default del PCF8574 si no se especifica
            // nada distinto al construir Keypad4x4_I2C(...) en Python).
            panel._appendEditableField("Dirección I2C", component.properties.address ?? "0x20", (val) => {
                component.properties.address = val;
                panel.simulator.signalEngine.evaluateAll();
            });

            const note = document.createElement("div");
            note.style.cssText = "font-size:12px; color:#888; margin: 8px 0 16px; line-height:1.5;";
            note.textContent = "Tiene que coincidir con la dirección que le pasás al construir Keypad4x4_I2C(...) en tu código MicroPython.";
            panel.content.appendChild(note);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
