/*
==========================================================
 PitSimulator — bmp180.behavior.js
 Panel de propiedades del BMP180 (presión + temperatura, I2C):
 2 sliders (temperatura, presión), mismo patrón que
 mpu6050.behavior.js/bh1750.behavior.js. No necesita signal.evaluate
 ni render.tag propios -- se resuelve por dirección I2C fija (0x77)
 directo en SignalEngine (setBmp180/_notifyBmp180ToFirmware).
==========================================================
*/

function _bmp180Slider(component, panel, key, label, unit, min, max, step, decimals) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:12px;";

    const lbl = document.createElement("span");
    lbl.style.cssText = "width:70px; font-size:12px; color:#999;";
    lbl.textContent = label;
    row.appendChild(lbl);

    const slider = document.createElement("input");
    slider.type  = "range";
    slider.min   = String(min);
    slider.max   = String(max);
    slider.step  = String(step);
    slider.value = component.properties[key];
    slider.style.cssText = "flex:1; accent-color:#4da3ff; cursor:pointer;";

    const valueLabel = document.createElement("span");
    valueLabel.style.cssText = "min-width:80px; text-align:right; font-size:12px; color:#ddd; font-variant-numeric:tabular-nums;";
    valueLabel.textContent = `${Number(component.properties[key]).toFixed(decimals)} ${unit}`;

    slider.addEventListener("input", () => {
        const val = parseFloat(slider.value);
        valueLabel.textContent = `${val.toFixed(decimals)} ${unit}`;
        panel.simulator.signalEngine.setBmp180(component.id, key, val);
    });

    row.appendChild(slider);
    row.appendChild(valueLabel);
    return row;
}

ComponentBehaviorRegistry.register("bmp180", {

    signal: {
        // Ver nota "resync" en ComponentBehaviorRegistry.js -- mismo
        // motivo que mpu6050.behavior.js.
        resync(component, engine) {
            engine._notifyBmp180ToFirmware(component);
        },
    },

    propertyPanel: {

        render(component, panel) {

            if (!component.properties) component.properties = {};
            const p = component.properties;
            if (p.temperature === undefined) p.temperature = 22.0;
            if (p.pressure === undefined) p.pressure = 101325.0;

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "BMP180 Presión + Temperatura";
            panel.content.appendChild(title);

            // Rango real del datasheet (-40..85°C, 300..1100 hPa) --
            // ver el comentario grande en bmp180.hal.py sobre por qué
            // no conviene pasarse de 110000 Pa.
            panel.content.appendChild(
                _bmp180Slider(component, panel, "temperature", "🌡 Temp:", "°C", -40, 85, 0.5, 1),
            );
            panel.content.appendChild(
                _bmp180Slider(component, panel, "pressure", "⏲ Presión:", "Pa", 30000, 110000, 100, 0),
            );

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            const note = document.createElement("div");
            note.style.cssText = "font-size:11px; color:#888; margin-bottom:12px;";
            note.textContent = "Dirección I2C fija: 0x77";
            panel.content.appendChild(note);

            panel._renderCommonProperties(component);

        },

    },

});
