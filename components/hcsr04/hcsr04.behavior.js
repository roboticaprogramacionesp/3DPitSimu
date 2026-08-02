/*
==========================================================
 PitSimulator — hcsr04.behavior.js
 Panel de propiedades del HC-SR04, migrado tal cual desde
 PropertyPanel._renderUltrasonicSensor() hacia
 ComponentBehaviorRegistry. hcsr04 no necesita signal.evaluate
 ni render.tag propios.

 _distToColor()/_distToPct() SIGUEN viviendo en PropertyPanel.js
 -- _updateDistanceDisplay() (llamado por el constructor al
 recibir "distance:changed") también los necesita. Se llaman
 vía "panel".
==========================================================
*/

ComponentBehaviorRegistry.register("hcsr04", {

    signal: {
        // Ver nota "resync" en ComponentBehaviorRegistry.js -- mismo
        // motivo que mpu6050.behavior.js: setDistance() solo se llama
        // desde el slider del panel, nunca automáticamente.
        resync(component, engine) {
            engine.setDistance(component.id, engine.getDistance(component.id));
        },
    },

    propertyPanel: {

        render(component, panel) {

            panel.content.innerHTML = "";

            const cm = panel.simulator.signalEngine.getDistance(component.id);

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "HC-SR04 — Sensor ultrasónico";
            panel.content.appendChild(title);

            const distWrap = document.createElement("div");
            distWrap.style.cssText = "margin-bottom: 16px;";

            const distLabel = document.createElement("label");
            distLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            distLabel.textContent = "Distancia simulada";

            const distDisplay = document.createElement("div");
            distDisplay.id = `distDisplay_${component.id}`;
            distDisplay.style.cssText = `
                font-size: 36px;
                font-weight: 700;
                color: ${panel._distToColor(cm)};
                text-align: center;
                margin: 8px 0;
                font-variant-numeric: tabular-nums;
            `;
            distDisplay.textContent = `${cm.toFixed(1)} cm`;

            const distTrack = document.createElement("div");
            distTrack.style.cssText = `
                width: 100%;
                height: 12px;
                background: linear-gradient(to right, #ff5252, #f2c94c, #2ecc71, #4da3ff);
                border-radius: 6px;
                margin: 8px 0;
                position: relative;
            `;

            const distCursor = document.createElement("div");
            distCursor.id = `distCursor_${component.id}`;
            distCursor.style.cssText = `
                position: absolute;
                top: -4px;
                left: ${panel._distToPct(cm)}%;
                transform: translateX(-50%);
                width: 20px;
                height: 20px;
                background: #fff;
                border: 3px solid ${panel._distToColor(cm)};
                border-radius: 50%;
                transition: left 0.15s;
            `;
            distTrack.appendChild(distCursor);

            const distMinMax = document.createElement("div");
            distMinMax.style.cssText = "display:flex; justify-content:space-between; font-size:11px; color:#666; margin-top:2px;";
            distMinMax.innerHTML = "<span>2 cm</span><span>400 cm</span>";

            const distSlider = document.createElement("input");
            distSlider.type  = "range";
            distSlider.min   = "2";
            distSlider.max   = "400";
            distSlider.step  = "0.5";
            distSlider.value = cm;
            distSlider.style.cssText = "width:100%; margin-top:6px; accent-color:#4da3ff; cursor:pointer;";

            distSlider.addEventListener("input", () => {
                const val = parseFloat(distSlider.value);
                panel._updateDistanceDisplay(val);
                panel.simulator.signalEngine.setDistance(component.id, val);
            });

            distWrap.appendChild(distLabel);
            distWrap.appendChild(distDisplay);
            distWrap.appendChild(distTrack);
            distWrap.appendChild(distMinMax);
            distWrap.appendChild(distSlider);
            panel.content.appendChild(distWrap);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
