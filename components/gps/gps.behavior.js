/*
==========================================================
 PitSimulator — gps.behavior.js
 Módulo GPS NEO-6M (UART): igual criterio que ds3231.behavior.js --
 un setInterval de 1s (limpiado en Renderer.removeComponent, ver el
 comentario ahí) manda periódicamente oraciones NMEA reales (GPRMC +
 GGA, con checksum correcto) construidas a partir de la posición/
 velocidad/curso/satélites elegidos en el panel de propiedades. Ver
 SignalEngine._buildGprmc/_buildGpgga/_notifyGpsToFirmware.

 A diferencia de I2C (se resuelve por dirección), acá el pin "tx" del
 GPS se traza hasta el ESP32 y se cruza contra el PININFO que declaró
 el firmware al construir su UART(id, tx=, rx=) -- si el firmware
 todavía no construyó ningún UART, _notifyGpsToFirmware() no manda
 nada (no hay a qué id mandarle). Ver _uart_bus.hal.py.
==========================================================
*/

const GPS_TICK_MS = 1000;

function _gpsApplyFixLed(component) {
    const led = component.element?.querySelector('[data-role="gps-fix-led"]');
    if (!led) return;
    const fixValid = component.properties?.fixValid !== false;
    led.setAttribute("fill", fixValid ? "#33cc55" : "#661a1a");
}

ComponentBehaviorRegistry.register("gps", {

    signal: {
        // Ver nota "resync" en ComponentBehaviorRegistry.js. El tick de
        // GPS_TICK_MS de más abajo ya se auto-cura solo (1s como mucho de
        // espera, a diferencia del tick de 60s de ds3231), pero igual se
        // agrega el mismo gancho por consistencia -- que el firmware nunca
        // llegue a arrancar sin ninguna oración NMEA todavía, ni un
        // segundo.
        resync(component, engine) {
            engine._notifyGpsToFirmware(component);
        },
    },

    render: {
        initialState(component, renderer) {
            _gpsApplyFixLed(component);

            if (!component._gpsTickInterval) {
                component._gpsTickInterval = setInterval(() => {
                    renderer.simulator.signalEngine._notifyGpsToFirmware(component);
                }, GPS_TICK_MS);
            }

            if (!component._gpsFixLedSub) {
                component._gpsFixLedSub = true;
                renderer.simulator.eventBus.on("gps:changed", ({ componentId }) => {
                    if (componentId === component.id) _gpsApplyFixLed(component);
                });
            }
        },
    },

    propertyPanel: {

        render(component, panel) {

            if (!component.properties) component.properties = {};
            const p = component.properties;
            if (p.lat === undefined) p.lat = 19.4326;
            if (p.lon === undefined) p.lon = -99.1332;
            if (p.altitude === undefined) p.altitude = 2240;
            if (p.speedKnots === undefined) p.speedKnots = 0;
            if (p.course === undefined) p.course = 0;
            if (p.satellites === undefined) p.satellites = 8;
            if (p.fixValid === undefined) p.fixValid = true;

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "GPS NEO-6M";
            panel.content.appendChild(title);

            const makeField = (labelText, value, step, onChange) => {
                const row = document.createElement("div");
                row.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;";

                const lbl = document.createElement("label");
                lbl.textContent = labelText;
                lbl.style.cssText = "font-size:12px; color:#999;";

                const input = document.createElement("input");
                input.type = "number";
                input.step = String(step);
                input.value = value;
                input.style.cssText = "width:110px; background:#222; color:#fff; border:1px solid #444; border-radius:4px; padding:4px 6px; font-size:12px;";

                input.addEventListener("change", () => {
                    const val = parseFloat(input.value);
                    onChange(Number.isFinite(val) ? val : 0);
                });

                row.appendChild(lbl);
                row.appendChild(input);
                panel.content.appendChild(row);
            };

            makeField("Latitud (°, +N/-S)", p.lat, "0.0001", (val) => {
                panel.simulator.signalEngine.setGpsData(component.id, { lat: val });
            });
            makeField("Longitud (°, +E/-W)", p.lon, "0.0001", (val) => {
                panel.simulator.signalEngine.setGpsData(component.id, { lon: val });
            });
            makeField("Altitud (m)", p.altitude, "1", (val) => {
                panel.simulator.signalEngine.setGpsData(component.id, { altitude: val });
            });
            makeField("Velocidad (nudos)", p.speedKnots, "0.1", (val) => {
                panel.simulator.signalEngine.setGpsData(component.id, { speedKnots: val });
            });
            makeField("Rumbo (°)", p.course, "1", (val) => {
                panel.simulator.signalEngine.setGpsData(component.id, { course: val });
            });
            makeField("Satélites", p.satellites, "1", (val) => {
                panel.simulator.signalEngine.setGpsData(component.id, { satellites: Math.round(val) });
            });

            const fixRow = document.createElement("label");
            fixRow.style.cssText = "display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; color:#ccc; margin: 10px 0 14px;";

            const fixCheckbox = document.createElement("input");
            fixCheckbox.type = "checkbox";
            fixCheckbox.checked = !!p.fixValid;
            fixCheckbox.style.cssText = "width:16px; height:16px; cursor:pointer;";
            fixCheckbox.addEventListener("change", () => {
                panel.simulator.signalEngine.setGpsData(component.id, { fixValid: fixCheckbox.checked });
            });

            const fixText = document.createElement("span");
            fixText.textContent = "Fix válido";

            fixRow.appendChild(fixCheckbox);
            fixRow.appendChild(fixText);
            panel.content.appendChild(fixRow);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
