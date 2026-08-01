/*
==========================================================
 PitSimulator — ky-008.behavior.js
 Módulo láser KY-008: mismo criterio eléctrico que led.behavior.js
 (isKeyConnectedToHighDriver + isKeyConnectedToGnd), no una señal
 "empujada desde el panel" como los sensores -- este es un ACTUADOR
 que el firmware prende/apaga por GPIO. data-role="ky008-beam" es el
 punto rojo que se enciende.
==========================================================
*/

ComponentBehaviorRegistry.register("ky-008", {

    signal: {

        evaluate(component, engine) {

            const sHigh = engine.isKeyConnectedToHighDriver(`${component.id}:s`);
            const gndOk = engine.isKeyConnectedToGnd(`${component.id}:gnd`);
            const isOn = sHigh && gndOk;

            const beam = component.element?.querySelector('[data-role="ky008-beam"]');
            if (!beam) return;

            if (isOn) {
                beam.setAttribute("fill", "#ff3333");
                beam.style.filter = "drop-shadow(0 0 3px #ff3333)";
            } else {
                beam.setAttribute("fill", "#330000");
                beam.style.filter = "";
            }

        },

    },

    render: {
        initialState(component) {
            const beam = component.element?.querySelector('[data-role="ky008-beam"]');
            if (beam) beam.setAttribute("fill", "#330000");
        },
    },

});
