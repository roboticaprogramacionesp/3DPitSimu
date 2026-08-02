/*
==========================================================
 PitSimulator — ky_001.behavior.js
 Panel de propiedades del sensor de temperatura, migrado tal
 cual desde PropertyPanel._renderTempSensor() hacia
 ComponentBehaviorRegistry.

 Se registra para "ky_001" Y "dht11" -- mismo criterio que
 components/keypad4x4/keypad4x4.behavior.js y
 components/lcd16x2/lcd16x2.behavior.js (ver esos comentarios):
 la lógica original ya distinguía internamente con
 `component.type === "dht11"` (isDHT), no con dos métodos
 separados, así que un solo archivo cubre ambos tipos. No hace
 falta un components/dht11/dht11.behavior.js aparte.

 _updateTempDisplay()/_updateHumidityDisplay()/_tempToColor()/
 _celsiusToPct() SIGUEN viviendo en PropertyPanel.js -- el
 constructor los llama directo al recibir "temp:changed"/
 "humidity:changed" (valores en vivo mandados por el firmware).
 Se llaman vía "panel".
==========================================================
*/

const tempSensorBehavior = {

    signal: {
        // Ver nota "resync" en ComponentBehaviorRegistry.js -- setTemperature()/
        // setHumidity() solo se llaman desde los sliders del panel, nunca
        // automáticamente. setTemperature() ya reenvía la humedad actual
        // junto con la temperatura (ver el comentario en
        // SignalEngine._notifyTempToFirmware), así que alcanza con un
        // solo llamado acá.
        resync(component, engine) {
            engine.setTemperature(component.id, engine.getTemperature(component.id));
        },
    },

    propertyPanel: {

        render(component, panel) {

            const celsius  = panel.simulator.signalEngine.getTemperature(component.id);
            const humidity = panel.simulator.signalEngine.getHumidity?.(component.id) ?? 50.0;
            const isDHT    = component.type === "dht11";

            panel.content.innerHTML = "";

            const title = document.createElement("div");
            title.style.cssText = `
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 1px;
                text-transform: uppercase;
                color: #4da3ff;
                margin-bottom: 14px;
                padding-bottom: 8px;
                border-bottom: 1px solid #333;
            `;
            title.textContent = isDHT
                ? "DHT11 — Temperatura y Humedad"
                : "Dallas DS18B20 — Sensor de temperatura";
            panel.content.appendChild(title);

            const barWrap = document.createElement("div");
            barWrap.style.cssText = "margin-bottom: 16px;";

            const barLabel = document.createElement("label");
            barLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            barLabel.textContent = "Temperatura simulada";

            const tempDisplay = document.createElement("div");
            tempDisplay.id = `tempDisplay_${component.id}`;
            tempDisplay.style.cssText = `
                font-size: 36px;
                font-weight: 700;
                color: ${panel._tempToColor(celsius)};
                text-align: center;
                margin: 8px 0;
                font-variant-numeric: tabular-nums;
                transition: color 0.3s;
            `;
            // DHT11 real solo tiene resolución de °C ENTEROS (limitación
            // real del sensor, no un atajo de la simulación --
            // dht11.hal.py ya trunca con int(self._temp) para reflejar
            // eso, ver _DHT11.temperature() ahí). Mostrar acá "15.5°C"
            // con un decimal que el firmware JAMÁS va a ver en su
            // print() es lo que generaba la confusión reportada
            // ("mando 15.5, el print me da 15"). DS18B20 (ky_001) sí
            // tiene resolución fraccionaria real, así que mantiene el
            // decimal.
            // Math.trunc(), no Math.round(): dht11.hal.py usa int(),
            // que trunca hacia cero (int(15.9) == 15), no redondea
            // (round(15.9) == 16) -- si acá redondeáramos, "15.9°C"
            // se vería como "16°C" en el panel pero el print() del
            // firmware seguiría diciendo 15.
            tempDisplay.textContent = isDHT ? `${Math.trunc(celsius)}°C` : `${celsius.toFixed(1)}°C`;

            const barTrack = document.createElement("div");
            barTrack.style.cssText = `
                width: 100%;
                height: 12px;
                background: linear-gradient(to right, #4da3ff, #2ecc71, #f2c94c, #ff5252);
                border-radius: 6px;
                margin: 8px 0;
                position: relative;
            `;

            const barCursor = document.createElement("div");
            barCursor.id = `tempCursor_${component.id}`;
            const pct = panel._celsiusToPct(celsius);
            barCursor.style.cssText = `
                position: absolute;
                top: -4px;
                left: ${pct}%;
                transform: translateX(-50%);
                width: 20px;
                height: 20px;
                background: #fff;
                border: 3px solid ${panel._tempToColor(celsius)};
                border-radius: 50%;
                transition: left 0.15s, border-color 0.3s;
            `;
            barTrack.appendChild(barCursor);

            const barMinMax = document.createElement("div");
            barMinMax.style.cssText = "display:flex; justify-content:space-between; font-size:11px; color:#666; margin-top:2px;";
            barMinMax.innerHTML = "<span>−55°C</span><span>+125°C</span>";

            const slider = document.createElement("input");
            slider.type  = "range";
            slider.min   = "-55";
            slider.max   = "125";
            // Mismo motivo que el display de arriba: DHT11 no tiene
            // resolución fraccionaria real, así que el slider tampoco
            // debería dejar elegir "15.5" para después mostrar "15" en
            // el print() del firmware.
            slider.step  = isDHT ? "1" : "0.5";
            slider.value = isDHT ? Math.trunc(celsius) : celsius;
            slider.style.cssText = `
                width: 100%;
                margin-top: 6px;
                accent-color: #4da3ff;
                cursor: pointer;
            `;

            slider.addEventListener("input", () => {
                const val = isDHT ? Math.trunc(parseFloat(slider.value)) : parseFloat(slider.value);
                panel._updateTempDisplay(val);
                panel.simulator.signalEngine.setTemperature(component.id, val);
            });

            barWrap.appendChild(barLabel);
            barWrap.appendChild(tempDisplay);
            barWrap.appendChild(barTrack);
            barWrap.appendChild(barMinMax);
            barWrap.appendChild(slider);

            panel.content.appendChild(barWrap);

            if (isDHT) {

                const humWrap = document.createElement("div");
                humWrap.style.cssText = "margin-bottom: 16px;";

                const humLabel = document.createElement("label");
                humLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
                humLabel.textContent = "Humedad simulada";

                const humDisplay = document.createElement("div");
                humDisplay.id = `humDisplay_${component.id}`;
                humDisplay.style.cssText = `
                    font-size: 36px;
                    font-weight: 700;
                    color: #4da3ff;
                    text-align: center;
                    margin: 8px 0;
                    font-variant-numeric: tabular-nums;
                `;
                humDisplay.textContent = `${humidity.toFixed(0)}%`;

                const humTrack = document.createElement("div");
                humTrack.style.cssText = `
                    width: 100%;
                    height: 12px;
                    background: linear-gradient(to right, #e6f3ff, #4da3ff, #0040aa);
                    border-radius: 6px;
                    margin: 8px 0;
                    position: relative;
                `;

                const humCursor = document.createElement("div");
                humCursor.id = `humCursor_${component.id}`;
                const humPct = humidity;
                humCursor.style.cssText = `
                    position: absolute;
                    top: -4px;
                    left: ${humPct}%;
                    transform: translateX(-50%);
                    width: 20px;
                    height: 20px;
                    background: #fff;
                    border: 3px solid #4da3ff;
                    border-radius: 50%;
                    transition: left 0.15s;
                `;
                humTrack.appendChild(humCursor);

                const humMinMax = document.createElement("div");
                humMinMax.style.cssText = "display:flex; justify-content:space-between; font-size:11px; color:#666; margin-top:2px;";
                humMinMax.innerHTML = "<span>0%</span><span>100%</span>";

                const humSlider = document.createElement("input");
                humSlider.type  = "range";
                humSlider.min   = "0";
                humSlider.max   = "100";
                humSlider.step  = "1";
                humSlider.value = humidity;
                humSlider.style.cssText = "width:100%; margin-top:6px; accent-color:#4da3ff; cursor:pointer;";

                humSlider.addEventListener("input", () => {
                    const val = parseFloat(humSlider.value);
                    panel._updateHumidityDisplay(val);
                    panel.simulator.signalEngine.setHumidity(component.id, val);
                });

                humWrap.appendChild(humLabel);
                humWrap.appendChild(humDisplay);
                humWrap.appendChild(humTrack);
                humWrap.appendChild(humMinMax);
                humWrap.appendChild(humSlider);
                panel.content.appendChild(humWrap);

            } else {

                // KY-001: mostrar dirección OneWire
                const addrWrap = document.createElement("div");
                addrWrap.style.cssText = "margin-bottom: 16px;";

                const addrLabel = document.createElement("label");
                addrLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:4px; letter-spacing:.03em;";
                addrLabel.textContent = "Device Address";

                const addrValue = document.createElement("div");
                addrValue.style.cssText = "font-size:13px; color:#4da3ff; font-family:monospace; letter-spacing:1px;";
                addrValue.textContent = component.properties?.address || "28 01 02 03 04 05 06 (default)";

                addrWrap.appendChild(addrLabel);
                addrWrap.appendChild(addrValue);
                panel.content.appendChild(addrWrap);

            }

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

};

ComponentBehaviorRegistry.register(["ky_001", "dht11"], tempSensorBehavior);
