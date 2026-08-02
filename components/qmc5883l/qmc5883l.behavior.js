/*
==========================================================
 PitSimulator — qmc5883l.behavior.js
 Magnetómetro/brújula QMC5883L: un slider de heading (0-360°) en el
 panel de propiedades, mismo criterio que bh1750.behavior.js (un
 valor elegido a mano en vez de un sensor físico real) -- ver
 SignalEngine.setQmc5883Heading(). La aguja roja del propio SVG
 (data-role="qmc-needle") rota en vivo para que el heading elegido
 sea visible directo en el canvas.
==========================================================
*/

function _qmc5883ApplyNeedle(component) {
    const needle = component.element?.querySelector('[data-role="qmc-needle"]');
    if (!needle) return;
    const heading = component.properties?.heading ?? 0;
    needle.setAttribute("transform", `rotate(${heading}, 26, 35)`);
}

ComponentBehaviorRegistry.register("qmc5883l", {

    signal: {
        // Ver nota "resync" en ComponentBehaviorRegistry.js -- mismo
        // motivo que mpu6050.behavior.js.
        resync(component, engine) {
            engine._notifyQmc5883ToFirmware(component);
        },
    },

    render: {
        initialState(component, renderer) {
            _qmc5883ApplyNeedle(component);

            if (!component._qmc5883NeedleSub) {
                component._qmc5883NeedleSub = true;
                renderer.simulator.eventBus.on("qmc5883l:changed", ({ componentId }) => {
                    if (componentId === component.id) _qmc5883ApplyNeedle(component);
                });
            }
        },
    },

    propertyPanel: {

        render(component, panel) {

            if (!component.properties) component.properties = {};
            const p = component.properties;
            if (p.heading === undefined) p.heading = 0;

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "QMC5883L Magnetómetro/Brújula";
            panel.content.appendChild(title);

            const row = document.createElement("div");
            row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom: 16px;";

            const lbl = document.createElement("span");
            lbl.style.cssText = "font-size:12px; color:#999;";
            lbl.textContent = "🧭";
            row.appendChild(lbl);

            const slider = document.createElement("input");
            slider.type  = "range";
            slider.min   = "0";
            slider.max   = "359";
            slider.step  = "1";
            slider.value = p.heading;
            slider.style.cssText = "flex:1; accent-color:#4da3ff; cursor:pointer;";

            const valueLabel = document.createElement("span");
            valueLabel.style.cssText = "min-width:50px; text-align:right; font-size:12px; color:#ddd; font-variant-numeric:tabular-nums;";
            valueLabel.textContent = `${Number(p.heading).toFixed(0)}°`;

            slider.addEventListener("input", () => {
                const val = parseFloat(slider.value);
                valueLabel.textContent = `${val.toFixed(0)}°`;
                panel.simulator.signalEngine.setQmc5883Heading(component.id, val);
            });

            row.appendChild(slider);
            row.appendChild(valueLabel);
            panel.content.appendChild(row);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
