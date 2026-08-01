/*
==========================================================
 PitSimulator — tcs34725.behavior.js
 Sensor de color TCS34725 (I2C): un <input type="color"> en el panel
 de propiedades reemplaza la idea de "detectar un objeto de color en
 el mundo real" -- mismo criterio que bh1750.behavior.js (un slider
 en vez de un sensor físico de luz), pero acá el valor es un color
 completo en vez de un solo número. Ver SignalEngine.setTcs34725Color().

 render.tag/initialState pintan el swatch visual del propio SVG
 (data-role="tcs-color-swatch") para que el color elegido sea visible
 directo en el canvas, no solo en el panel.
==========================================================
*/

function _tcs34725ApplySwatch(component) {
    const swatch = component.element?.querySelector('[data-role="tcs-color-swatch"]');
    if (!swatch) return;
    const color = component.properties?.color || "#808080";
    swatch.setAttribute("fill", color);
}

ComponentBehaviorRegistry.register("tcs34725", {

    render: {
        initialState(component, renderer) {
            _tcs34725ApplySwatch(component);

            // Suscripción única por componente: así el swatch se
            // actualiza sin importar POR DÓNDE haya llegado el
            // cambio de color (el picker del panel, o cualquier otro
            // llamador futuro de setTcs34725Color) -- antes solo se
            // pintaba desde el propio listener "input" del picker.
            if (!component._tcs34725SwatchSub) {
                component._tcs34725SwatchSub = true;
                renderer.simulator.eventBus.on("tcs34725:changed", ({ componentId }) => {
                    if (componentId === component.id) _tcs34725ApplySwatch(component);
                });
            }
        },
    },

    propertyPanel: {

        render(component, panel) {

            if (!component.properties) component.properties = {};
            const p = component.properties;
            if (p.color === undefined) p.color = "#ff8000";

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "TCS34725 Sensor de Color";
            panel.content.appendChild(title);

            const row = document.createElement("div");
            row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom: 16px;";

            const lbl = document.createElement("span");
            lbl.style.cssText = "font-size:12px; color:#999;";
            lbl.textContent = "Color detectado";
            row.appendChild(lbl);

            const picker = document.createElement("input");
            picker.type = "color";
            picker.value = p.color;
            picker.style.cssText = "flex:0 0 auto; width:48px; height:28px; border:none; background:none; cursor:pointer;";

            picker.addEventListener("input", () => {
                // El swatch se actualiza solo, vía el listener de
                // "tcs34725:changed" armado en render.initialState.
                panel.simulator.signalEngine.setTcs34725Color(component.id, picker.value);
            });

            row.appendChild(picker);
            panel.content.appendChild(row);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
