/*
==========================================================
 PitSimulator — pir.behavior.js
 Mismo estilo que fc-51.behavior.js/tcrt5000.behavior.js: un solo
 checkbox "Movimiento detectado". A diferencia de esos dos (activos
 en BAJO), el HC-SR501 real es activo en ALTO -- ver
 SignalEngine.setPirDetected(). El LED de detección del propio SVG
 (data-role="pir-detect-led") se enciende en vivo junto con el pin.
==========================================================
*/

function _pirApplyLed(component) {
    const led = component.element?.querySelector('[data-role="pir-detect-led"]');
    if (!led) return;
    const detectado = !!component.properties?.detectado;
    led.setAttribute("fill", detectado ? "#ff3b30" : "#333333");
}

ComponentBehaviorRegistry.register("pir", {

    render: {
        initialState(component, renderer) {
            _pirApplyLed(component);

            if (!component._pirLedSub) {
                component._pirLedSub = true;
                renderer.simulator.eventBus.on("pir:changed", ({ componentId }) => {
                    if (componentId === component.id) _pirApplyLed(component);
                });
            }
        },
    },

    propertyPanel: {

        render(component, panel) {

            if (!component.properties) component.properties = {};
            const p = component.properties;
            if (p.detectado === undefined) p.detectado = false;

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "PIR HC-SR501 Sensor de Movimiento";
            panel.content.appendChild(title);

            const row = document.createElement("label");
            row.style.cssText = "display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; color:#ccc; margin-bottom:14px;";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = !!p.detectado;
            checkbox.style.cssText = "width:16px; height:16px; cursor:pointer;";
            checkbox.addEventListener("change", () => {
                panel.simulator.signalEngine.setPirDetected(component.id, checkbox.checked);
            });

            const text = document.createElement("span");
            text.textContent = "Movimiento detectado (OUT en ALTO)";

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
