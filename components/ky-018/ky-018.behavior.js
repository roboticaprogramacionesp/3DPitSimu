/*
==========================================================
 PitSimulator — ky-018.behavior.js
 Fotorresistor (LDR) KY-018: sensor "empujado desde el panel", mismo
 criterio que bh1750.behavior.js (slider en el panel de propiedades),
 pero saliendo por ADC (pin "s") en vez de I2C -- ver
 SignalEngine.setKy018LightLevel().
==========================================================
*/

ComponentBehaviorRegistry.register("ky-018", {

    signal: {
        // Ver nota "resync" en ComponentBehaviorRegistry.js -- mismo
        // motivo que mpu6050.behavior.js. A diferencia de pot_rotary/
        // pot_slider (arrastre en el canvas, sin properties), acá el
        // nivel de luz SÍ vive en component.properties.luz (slider del
        // panel), así que también sobrevive a un proyecto recién cargado.
        resync(component, engine) {
            const luz = component.properties?.luz ?? 50;
            engine.setKy018LightLevel(component, luz / 100);
        },
    },

    propertyPanel: {

        render(component, panel) {

            if (!component.properties) component.properties = {};
            const p = component.properties;
            if (p.luz === undefined) p.luz = 50;

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "KY-018 Fotorresistor (LDR)";
            panel.content.appendChild(title);

            const row = document.createElement("div");
            row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom: 16px;";

            const lbl = document.createElement("span");
            lbl.style.cssText = "font-size:12px; color:#999;";
            lbl.textContent = "☀";
            row.appendChild(lbl);

            const slider = document.createElement("input");
            slider.type  = "range";
            slider.min   = "0";
            slider.max   = "100";
            slider.step  = "1";
            slider.value = p.luz;
            slider.style.cssText = "flex:1; accent-color:#4da3ff; cursor:pointer;";

            const valueLabel = document.createElement("span");
            valueLabel.style.cssText = "min-width:50px; text-align:right; font-size:12px; color:#ddd; font-variant-numeric:tabular-nums;";
            valueLabel.textContent = `${Number(p.luz).toFixed(0)}%`;

            slider.addEventListener("input", () => {
                const val = parseFloat(slider.value);
                p.luz = val;
                valueLabel.textContent = `${val.toFixed(0)}%`;
                panel.simulator.signalEngine.setKy018LightLevel(component, val / 100);
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
