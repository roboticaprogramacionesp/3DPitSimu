/*
==========================================================
 PitSimulator — ky-019.behavior.js
 Módulo relevador KY-019 (5V, 1 canal): "S" es una entrada digital
 común y corriente -- NADA de protocolo propio, el _base.hal.py
 genérico ya cubre Pin(x, Pin.OUT) del lado firmware, así que este
 componente no tiene .hal.py.

 El lado NC/COM/NO es un interruptor SPDT mecánico, igual criterio
 que slide_switch.behavior.js (ver ese archivo y el bloque
 spdtPins/spdtPosition en SignalEngine.getNet()) -- la diferencia acá
 es que la posición NO la cambia un click del usuario, la decide
 evaluate() según el estado real de la señal "S".

 activeLow=true por default: el KY-019 real (Keyes) enciende el
 relevador con la señal en BAJO (transistor + pull-up invierten la
 lógica) -- confirmado en la documentación del módulo real. Se puede
 desmarcar desde el panel de propiedades si el módulo del usuario
 fuera la variante no invertida.

 Requiere alimentación real (VCC/GND cableados, ver
 isComponentPowered) para energizarse -- sin 5V/GND, "S" puede
 tickear pero el relevador no se mueve, igual que en la vida real.
==========================================================
*/

ComponentBehaviorRegistry.register("ky-019", {

    signal: {

        evaluate(component, engine) {

            component.spdtPins = { common: "com", nc: "nc", no: "no" };
            if (component.spdtPosition !== "nc" && component.spdtPosition !== "no") {
                component.spdtPosition = "nc";
            }

            const powered = engine.isComponentPowered(component);
            const signalHigh = engine.isKeyConnectedToHighDriver(`${component.id}:s`);
            const activeLow = component.properties?.activeLow !== false;
            const energized = powered && (activeLow ? !signalHigh : signalHigh);

            const changed = (component.spdtPosition === "no") !== energized;
            component.spdtPosition = energized ? "no" : "nc";
            component._ky019Energized = energized;
            component._ky019ApplyVisual?.();

            // Si cambió, algo aguas abajo (lo que esté cableado a
            // COM/NC/NO) puede depender de este puente -- mismo
            // criterio que slide_switch.behavior.js, para que se
            // refleje YA, no en el próximo evento de GPIO que llegue
            // por otra razón.
            if (changed) engine.evaluateAll();

        },

    },

    render: {

        tag(component, graphic) {

            const led = graphic.querySelector("#led-0603");

            const applyVisual = () => {
                if (!led) return;
                led.style.opacity = component._ky019Energized ? "1" : "0.25";
            };

            component._ky019ApplyVisual = applyVisual;

        },

        initialState(component) {
            component._ky019ApplyVisual?.();
        },

    },

    propertyPanel: {

        render(component, panel) {

            panel.content.innerHTML = "";
            component.properties = component.properties || {};
            if (typeof component.properties.activeLow !== "boolean") {
                component.properties.activeLow = true;
            }

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "KY-019 Módulo Relevador";
            panel.content.appendChild(title);

            const badge = document.createElement("div");
            badge.style.cssText = `
                font-size: 16px;
                font-weight: 700;
                text-align: center;
                padding: 8px;
                border-radius: 6px;
                margin-bottom: 12px;
                color: #fff;
                background: ${component._ky019Energized ? "#2ecc71" : "#555"};
            `;
            badge.textContent = component._ky019Energized ? "ENERGIZADO (COM-NO)" : "REPOSO (COM-NC)";
            panel.content.appendChild(badge);

            const hint = document.createElement("p");
            hint.style.cssText = "font-size:11px; color:#999; margin-bottom:10px;";
            hint.textContent = "El KY-019 real activa el relevador con la señal en BAJO. Desmarcá esto solo si tu módulo es la variante no invertida.";
            panel.content.appendChild(hint);

            const row = document.createElement("label");
            row.style.cssText = "display:flex; align-items:center; gap:8px; font-size:13px; color:#ccc; cursor:pointer; margin-bottom:14px;";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = component.properties.activeLow;
            checkbox.addEventListener("change", () => {
                component.properties.activeLow = checkbox.checked;
                panel.simulator.signalEngine.evaluateAll();
                panel.show(component); // refrescar la insignia YA, no recién en el próximo evaluate externo
            });

            const text = document.createElement("span");
            text.textContent = "Activo en BAJO (comportamiento real del KY-019)";

            row.appendChild(checkbox);
            row.appendChild(text);
            panel.content.appendChild(row);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
