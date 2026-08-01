/*
==========================================================
 PitSimulator — bh1750.behavior.js
 Panel de propiedades del BH1750 (sensor de luz ambiental, I2C):
 un slider de lux (0-65535, escala típica del sensor real) + la
 dirección I2C, mismo patrón que mpu6050.behavior.js. No necesita
 signal.evaluate ni render.tag propios -- se resuelve por dirección
 I2C directo en SignalEngine (setBh1750Lux/_notifyBh1750ToFirmware).
==========================================================
*/

ComponentBehaviorRegistry.register("bh1750", {

    propertyPanel: {

        render(component, panel) {

            if (!component.properties) component.properties = {};
            const p = component.properties;
            if (p.lux === undefined) p.lux = 200.0;

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "BH1750 Sensor de Luz";
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
            slider.max   = "20000";
            slider.step  = "10";
            slider.value = p.lux;
            slider.style.cssText = "flex:1; accent-color:#4da3ff; cursor:pointer;";

            const valueLabel = document.createElement("span");
            valueLabel.style.cssText = "min-width:70px; text-align:right; font-size:12px; color:#ddd; font-variant-numeric:tabular-nums;";
            valueLabel.textContent = `${Number(p.lux).toFixed(0)} lx`;

            slider.addEventListener("input", () => {
                const val = parseFloat(slider.value);
                valueLabel.textContent = `${val.toFixed(0)} lx`;
                panel.simulator.signalEngine.setBh1750Lux(component.id, val);
            });

            row.appendChild(slider);
            row.appendChild(valueLabel);
            panel.content.appendChild(row);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            // Dirección I2C -- mismo patrón que mpu6050.behavior.js
            panel._appendEditableField("Dirección I2C", p.i2cAddress ?? "0x23", (val) => {
                p.i2cAddress = val;
                panel.simulator.signalEngine._notifyBh1750ToFirmware(component);
            });

            panel._renderCommonProperties(component);

        },

    },

});
