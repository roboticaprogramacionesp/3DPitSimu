/*
==========================================================
 PitSimulator — inmp441.behavior.js
 Panel de propiedades del micrófono INMP441 -- solo muestra el
 estado del micrófono REAL de la PC (ver MicCapture.js/
 inmp441.hal.py), no tiene ningún control -- a diferencia de KY-001
 (slider), acá no hay nada que el alumno deba "setear" a mano: el
 audio sale directo del hardware real.
==========================================================
*/

ComponentBehaviorRegistry.register("inmp441", {

    propertyPanel: {

        render(component, panel) {

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "INMP441 — Micrófono I2S";
            panel.content.appendChild(title);

            const micCapture = panel.simulator.micCapture;
            const active = !!micCapture?.active;

            const badge = document.createElement("div");
            badge.style.cssText = `
                font-size: 14px;
                font-weight: 700;
                text-align: center;
                padding: 10px;
                border-radius: 6px;
                margin-bottom: 12px;
                color: #fff;
                background: ${active ? "#2e7d32" : "#555"};
            `;
            badge.textContent = active
                ? "🎙️ Micrófono activo (audio real de tu PC)"
                : "🎙️ Micrófono inactivo";
            panel.content.appendChild(badge);

            const note = document.createElement("div");
            note.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;";
            note.textContent = active
                ? "Tu código está leyendo I2S en modo RX -- el navegador le está pasando el audio REAL de tu micrófono al firmware simulado."
                : "Se activa solo al correr código que construya I2S(..., mode=I2S.RX, ...) -- ahí el navegador te va a pedir permiso de micrófono (una sola vez por sesión).";
            panel.content.appendChild(note);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
