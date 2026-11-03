/*
==========================================================
 PitSimulator — yf201.behavior.js
 Panel de propiedades del YF-S201 (sensor de flujo de agua) -- un
 slider de "Caudal simulado (L/min)" que arranca/para un tren de
 pulsos real en SignalEngine._restartYf201Pulse() (fórmula del
 datasheet: F(Hz) = 7.5 × caudal). El código del alumno los cuenta
 con machine.Pin(...).irq(...) directo, como un sensor de pulsos real.
==========================================================
*/

ComponentBehaviorRegistry.register("yf201", {

    signal: {
        // Ver nota "resync" en ComponentBehaviorRegistry.js -- un
        // caudal ya seteado antes de apretar ▶ Simular (ej. viene de
        // un proyecto guardado) tiene que arrancar sus pulsos solo al
        // conectar, sin que el alumno tenga que volver a tocar el
        // slider.
        resync(component, engine) {
            engine.setYf201FlowRate(component, component.properties?.flujo_lmin || 0);
        },
    },

    propertyPanel: {

        render(component, panel) {

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "YF-S201 — Sensor de flujo de agua";
            panel.content.appendChild(title);

            component.properties = component.properties || {};
            const lMin = component.properties.flujo_lmin ?? 0;

            const label = document.createElement("label");
            label.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            label.textContent = "Caudal simulado";
            panel.content.appendChild(label);

            const display = document.createElement("div");
            display.style.cssText = `
                font-size: 32px;
                font-weight: 700;
                color: #4da3ff;
                text-align: center;
                margin: 8px 0;
                font-variant-numeric: tabular-nums;
            `;
            display.textContent = `${lMin.toFixed(1)} L/min`;
            panel.content.appendChild(display);

            const hz = lMin * 7.5;
            const freqNote = document.createElement("div");
            freqNote.style.cssText = "font-size:11px; color:#777; text-align:center; margin-bottom:10px;";
            freqNote.textContent = lMin > 0 ? `≈ ${hz.toFixed(1)} pulsos/s (F = 7.5 × L/min, fórmula real del datasheet)` : "Sin flujo -- el pin de señal se queda en LOW.";
            panel.content.appendChild(freqNote);

            const slider = document.createElement("input");
            slider.type = "range";
            slider.min = "0";
            slider.max = "30"; // rango real del datasheet: 1-30 L/min
            slider.step = "0.5";
            slider.value = lMin;
            slider.style.cssText = "width:100%; margin-top:6px; accent-color:#4da3ff; cursor:pointer;";

            slider.addEventListener("input", () => {
                const val = parseFloat(slider.value);
                display.textContent = `${val.toFixed(1)} L/min`;
                const h = val * 7.5;
                freqNote.textContent = val > 0 ? `≈ ${h.toFixed(1)} pulsos/s (F = 7.5 × L/min, fórmula real del datasheet)` : "Sin flujo -- el pin de señal se queda en LOW.";
                panel.simulator.signalEngine.setYf201FlowRate(component, val);
            });

            panel.content.appendChild(slider);

            const minMax = document.createElement("div");
            minMax.style.cssText = "display:flex; justify-content:space-between; font-size:11px; color:#666; margin-top:2px;";
            minMax.innerHTML = "<span>0 L/min</span><span>30 L/min</span>";
            panel.content.appendChild(minMax);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 16px 0 12px;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
