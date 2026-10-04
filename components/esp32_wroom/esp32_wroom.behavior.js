/*
==========================================================
 PitSimulator — esp32_wroom.behavior.js
 Genera la MAC simulada de este ESP32 (necesaria para direccionar
 ESP-NOW entre placas -- ver plan multi-ESP32/ESP-NOW, Fase 0) y
 permite editarla a mano desde el panel de propiedades (Fase 4).
 No tiene render.tag ni signal.evaluate propios: todo el resto del
 comportamiento de este tipo sigue viviendo en SignalEngine.js/
 WasmBridge.js como siempre (buscado por "esp32" prefix, no por este
 behavior).
==========================================================
*/

const ESP32_MAC_RE = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;

function _esp32GenerateMac(simulator, excludeComponentId) {
    const used = new Set(
        simulator.componentManager
            .getAll()
            .filter((c) => c.type.startsWith("esp32") && c.id !== excludeComponentId)
            .map((c) => c.properties?.macAddress)
            .filter(Boolean)
    );

    let mac;
    do {
        const bytes = Array.from({ length: 6 }, () =>
            Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
        );
        mac = bytes.join(":").toUpperCase();
    } while (used.has(mac));

    return mac;
}

ComponentBehaviorRegistry.register("esp32_wroom", {

    render: {
        initialState(component, renderer) {
            if (!component.properties) component.properties = {};

            if (!component.properties.macAddress) {
                component.properties.macAddress = _esp32GenerateMac(renderer.simulator, component.id);
            }
        },
    },

    propertyPanel: {

        render(component, panel) {

            if (!component.properties) component.properties = {};
            const p = component.properties;

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "ESP32 WeMos D1";
            panel.content.appendChild(title);

            // Editable a mano (ej. para que coincida con una MAC real
            // que el alumno ya tenga anotada de un ESP32 físico) --
            // validada contra el mismo formato que genera
            // _esp32GenerateMac() ("AA:BB:CC:DD:EE:FF"), sin la cual
            // _hex_to_bytes() en _espnow_wasm.py reventaría al bootear
            // (ValueError sobre un string que no es hex válido/de 12
            // caracteres). Un valor inválido se descarta en silencio,
            // revirtiendo el input al último valor válido.
            const macInput = panel._appendEditableField("MAC (ESP-NOW)", p.macAddress || "", (val) => {
                const normalized = val.trim().toUpperCase();
                if (!ESP32_MAC_RE.test(normalized)) {
                    macInput.value = p.macAddress || "";
                    return;
                }
                p.macAddress = normalized;
                macInput.value = normalized;
            });

            const note = document.createElement("p");
            note.style.cssText = "font-size:11px; color:#888; margin: 4px 0 14px; line-height:1.4;";
            note.textContent = "Cambiar la MAC no tiene efecto hasta la próxima vez que arranque la simulación (▶ Simular) -- el Worker de este ESP32 bootea con la MAC que tenía en ese momento.";
            panel.content.appendChild(note);

            panel._renderCommonProperties(component);

        },

    },

});
