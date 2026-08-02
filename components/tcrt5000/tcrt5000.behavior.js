/*
==========================================================
 PitSimulator — tcrt5000.behavior.js
 Mismo estilo que fc-51.behavior.js: un solo checkbox "Objeto
 detectado", que manda el pin Do en BAJO (activo) o ALTO (reposo) --
 ver SignalEngine.setTcrt5000Detected(). No necesita signal.evaluate
 ni render.tag propios, es puramente digital.
==========================================================
*/

ComponentBehaviorRegistry.register("tcrt5000", {

    signal: {
        // Ver nota "resync" en ComponentBehaviorRegistry.js -- mismo
        // motivo que fc-51.behavior.js.
        resync(component, engine) {
            const detectado = !!component.properties?.detectado;
            engine._notifyDigitalToFirmware(component, "do", detectado ? 0 : 1);
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
            title.textContent = "TCRT5000 Sensor IR (Línea/Obstáculo)";
            panel.content.appendChild(title);

            const row = document.createElement("label");
            row.style.cssText = "display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; color:#ccc; margin-bottom:14px;";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = !!p.detectado;
            checkbox.style.cssText = "width:16px; height:16px; cursor:pointer;";
            checkbox.addEventListener("change", () => {
                panel.simulator.signalEngine.setTcrt5000Detected(component.id, checkbox.checked);
            });

            const text = document.createElement("span");
            text.textContent = "Objeto/línea detectado (Do en BAJO)";

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
