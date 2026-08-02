/*
==========================================================
 PitSimulator — fc-51.behavior.js
 Panel de propiedades del FC-51 (sensor infrarrojo de obstáculos):
 un solo checkbox "Objeto detectado", que manda el pin OUT en BAJO
 (activo) o ALTO (reposo) -- ver SignalEngine.setFc51Detected(). No
 necesita signal.evaluate ni render.tag propios, es puramente
 digital y no hay ningún framebuffer/valor continuo que dibujar.
==========================================================
*/

ComponentBehaviorRegistry.register("fc-51", {

    signal: {
        // Ver nota "resync" en ComponentBehaviorRegistry.js -- mismo
        // motivo que mpu6050.behavior.js: el checkbox "Objeto detectado"
        // solo manda el pin cuando cambia, nunca solo.
        resync(component, engine) {
            const detectado = !!component.properties?.detectado;
            engine._notifyDigitalToFirmware(component, "out", detectado ? 0 : 1);
        },
    },

    propertyPanel: {

        render(component, panel) {

            if (!component.properties) component.properties = {};
            const p = component.properties;
            if (p.detectado === undefined) p.detectado = false;

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "FC-51 Sensor IR de Obstáculos";
            panel.content.appendChild(title);

            const row = document.createElement("label");
            row.style.cssText = "display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; color:#ccc; margin-bottom:14px;";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = !!p.detectado;
            checkbox.style.cssText = "width:16px; height:16px; cursor:pointer;";
            checkbox.addEventListener("change", () => {
                panel.simulator.signalEngine.setFc51Detected(component.id, checkbox.checked);
            });

            const text = document.createElement("span");
            text.textContent = "Objeto detectado (OUT en BAJO)";

            row.appendChild(checkbox);
            row.appendChild(text);
            panel.content.appendChild(row);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
