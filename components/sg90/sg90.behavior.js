/*
==========================================================
 PitSimulator — sg90.behavior.js
 Comportamiento de render del servo SG90, migrado tal cual
 desde Renderer.tagServoElements()/el bloque de ángulo inicial
 de Renderer.renderComponent() hacia ComponentBehaviorRegistry.
==========================================================
*/

ComponentBehaviorRegistry.register("sg90", {

    render: {

        tag(component, graphic, renderer) {

            const shaft = graphic.querySelector("#eje");
            if (!shaft) {
                console.warn("[sg90.behavior] No se encontró #eje en el SVG del servo");
                return;
            }

            shaft.setAttribute("data-servo-role", "shaft");
            shaft.setAttribute("data-servo-original-id", "eje");
            shaft.removeAttribute("id");

        },

        // setServoAngle() sigue viviendo en Renderer.js -- tiene otros
        // llamadores (SignalEngine.js, para el ángulo en vivo mandado
        // por el firmware).
        initialState(component, renderer) {
            renderer.setServoAngle(component, component.properties?.angle ?? 90);
        },

    },

    propertyPanel: {

        // Migrado tal cual desde PropertyPanel._renderServo(). Los
        // helpers _updateServoDisplay()/_angleToPct() SIGUEN viviendo en
        // PropertyPanel.js -- el constructor los llama directo al
        // recibir el evento "servo:changed" (ángulo cambiado en vivo por
        // el firmware), así que no se pueden mover acá. Se llaman vía
        // "panel".
        render(component, panel) {

            panel.content.innerHTML = "";

            const angle = component.properties?.angle ?? panel.simulator.signalEngine.getServoAngle(component.id);

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "Servo SG90";
            panel.content.appendChild(title);

            const angleWrap = document.createElement("div");
            angleWrap.style.cssText = "margin-bottom: 16px;";

            const angleLabel = document.createElement("label");
            angleLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            angleLabel.textContent = "Ángulo del eje";

            const angleDisplay = document.createElement("div");
            angleDisplay.id = `servoDisplay_${component.id}`;
            angleDisplay.style.cssText = `
                font-size: 36px;
                font-weight: 700;
                color: #4da3ff;
                text-align: center;
                margin: 8px 0;
                font-variant-numeric: tabular-nums;
            `;
            angleDisplay.textContent = `${Math.round(angle)}°`;

            const angleTrack = document.createElement("div");
            angleTrack.style.cssText = `
                width: 100%;
                height: 12px;
                background: linear-gradient(to right, #ff5252, #f2c94c, #2ecc71, #4da3ff);
                border-radius: 6px;
                margin: 8px 0;
                position: relative;
            `;

            const angleCursor = document.createElement("div");
            angleCursor.id = `servoCursor_${component.id}`;
            angleCursor.style.cssText = `
                position: absolute;
                top: -4px;
                left: ${panel._angleToPct(angle)}%;
                transform: translateX(-50%);
                width: 20px;
                height: 20px;
                background: #fff;
                border: 3px solid #4da3ff;
                border-radius: 50%;
                transition: left 0.15s;
            `;
            angleTrack.appendChild(angleCursor);

            const angleMinMax = document.createElement("div");
            angleMinMax.style.cssText = "display:flex; justify-content:space-between; font-size:11px; color:#666; margin-top:2px;";
            angleMinMax.innerHTML = "<span>0°</span><span>180°</span>";

            const angleSlider = document.createElement("input");
            angleSlider.type  = "range";
            angleSlider.min   = "0";
            angleSlider.max   = "180";
            angleSlider.step  = "1";
            angleSlider.value = angle;
            angleSlider.style.cssText = "width:100%; margin-top:6px; accent-color:#4da3ff; cursor:pointer;";

            angleSlider.addEventListener("input", () => {
                const val = parseFloat(angleSlider.value);
                panel._updateServoDisplay(val);
                panel.simulator.signalEngine.setServoAngle(component.id, val);
            });

            angleWrap.appendChild(angleLabel);
            angleWrap.appendChild(angleDisplay);
            angleWrap.appendChild(angleTrack);
            angleWrap.appendChild(angleMinMax);
            angleWrap.appendChild(angleSlider);
            panel.content.appendChild(angleWrap);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
