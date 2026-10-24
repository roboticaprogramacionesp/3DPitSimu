/*
==========================================================
 PitSimulator — esp32_s3.behavior.js
 Igual que esp32_wroom.behavior.js (ver ese archivo para el
 porqué completo): genera la MAC simulada de esta placa
 (ESP-NOW) y permite editarla a mano desde el panel de
 propiedades. El "esp32_s3_" en el type (empieza con "esp32",
 ver Component.startsWith("esp32") usado en todo el resto del
 simulador -- WasmBridge, EspNowBus, ComponentManager,
 ValidationEngine) ya alcanza para que esta placa reciba el
 mismo trato que cualquier otro ESP32 en todo lo demás (spawnea
 su propio Worker, aparece en el selector multi-dispositivo,
 queda exenta del warning "no está conectado a nada", etc.) --
 este archivo SOLO cubre lo que es específico de "esp32_wroom"
 por registrarse con ese nombre exacto (la MAC + su propio
 panel de propiedades).
==========================================================
*/

const ESP32_S3_MAC_RE = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;

function _esp32S3GenerateMac(simulator, excludeComponentId) {
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

ComponentBehaviorRegistry.register("esp32_s3", {

    render: {
        initialState(component, renderer) {
            if (!component.properties) component.properties = {};

            if (!component.properties.macAddress) {
                component.properties.macAddress = _esp32S3GenerateMac(renderer.simulator, component.id);
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
            title.textContent = "ESP32-S3-Uno";
            panel.content.appendChild(title);

            const macInput = panel._appendEditableField("MAC (ESP-NOW)", p.macAddress || "", (val) => {
                const normalized = val.trim().toUpperCase();
                if (!ESP32_S3_MAC_RE.test(normalized)) {
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
