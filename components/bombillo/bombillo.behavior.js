/*
==========================================================
 PitSimulator — bombillo.behavior.js
 Foco/bombillo genérico: carga pasiva de 2 terminales SIN polaridad
 (a diferencia del LED) -- prende con que UNO de los dos terminales
 llegue a una fuente de alimentación real y el OTRO llegue a tierra
 real, sin importar cuál es cuál (así es como funciona un foco de
 verdad: no le importa la polaridad).

 Pensado para usarse del otro lado de un relevador (KY-019): el
 relevador puentea COM a NC o a NO según esté energizado o no (ver
 ky-019.behavior.js/SignalEngine.getNet() -- spdtPins/spdtPosition),
 y getNet() ya atraviesa ese puente solo -- así que "¿llega este
 terminal a una fuente real?" (isKeyConnectedToPower/Gnd, ver el
 audit de alimentación) funciona igual sin importar si el foco está
 cableado directo a una fuente o a través del relevador.

 No tiene .hal.py -- es puramente visual, el firmware no se entera
 de esto (un foco real tampoco "avisa" nada por software).
==========================================================
*/

ComponentBehaviorRegistry.register("bombillo", {

    signal: {

        evaluate(component, engine) {

            const p1Power = engine.isKeyConnectedToPower(`${component.id}:p1`);
            const p1Gnd   = engine.isKeyConnectedToGnd(`${component.id}:p1`);
            const p2Power = engine.isKeyConnectedToPower(`${component.id}:p2`);
            const p2Gnd   = engine.isKeyConnectedToGnd(`${component.id}:p2`);

            const isOn = (p1Power && p2Gnd) || (p2Power && p1Gnd);

            component._bombilloOn = isOn;
            component._bombilloApplyVisual?.();

        },

    },

    render: {

        tag(component, graphic) {

            const glass = graphic.querySelector('[data-role="bulb-glass"]');
            const filament = graphic.querySelector('[data-role="bulb-filament"]');

            const applyVisual = () => {
                const on = !!component._bombilloOn;
                if (glass) {
                    glass.style.fill = on ? "#fff3b0" : "#4a4a4a";
                    glass.style.filter = on ? "drop-shadow(0 0 6px #ffe066)" : "none";
                }
                if (filament) {
                    filament.style.stroke = on ? "#ff9800" : "#2a2a2a";
                }
            };

            component._bombilloApplyVisual = applyVisual;

        },

        initialState(component) {
            component._bombilloApplyVisual?.();
        },

    },

    propertyPanel: {

        render(component, panel) {

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "Foco / Bombillo";
            panel.content.appendChild(title);

            const badge = document.createElement("div");
            badge.style.cssText = `
                font-size: 16px;
                font-weight: 700;
                text-align: center;
                padding: 8px;
                border-radius: 6px;
                margin-bottom: 12px;
                color: ${component._bombilloOn ? "#000" : "#fff"};
                background: ${component._bombilloOn ? "#ffe066" : "#555"};
            `;
            badge.textContent = component._bombilloOn ? "ENCENDIDO" : "APAGADO";
            panel.content.appendChild(badge);

            const hint = document.createElement("p");
            hint.style.cssText = "font-size:11px; color:#999; margin-bottom:10px;";
            hint.textContent = "Sin polaridad -- prende con cualquiera de los 2 terminales a alimentación real y el otro a tierra real (ej. a través de COM/NO de un relevador).";
            panel.content.appendChild(hint);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
