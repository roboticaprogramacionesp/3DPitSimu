/*
==========================================================
 PitSimulator — led.behavior.js
 Comportamiento de señal del LED, migrado tal cual desde
 SignalEngine.evaluateLed() hacia ComponentBehaviorRegistry.
 Ver js/simulator/ComponentBehaviorRegistry.js para el contrato.
==========================================================
*/

ComponentBehaviorRegistry.register("led", {

    signal: {

        evaluate(component, engine) {

            const anodoHigh = engine.isKeyConnectedToHighDriver(`${component.id}:anodo`);
            const catodoGnd = engine.isKeyConnectedToGnd(`${component.id}:catodo`);
            const isOn = anodoHigh && catodoGnd;

            engine.simulator.renderer.applyLedState(component, isOn);

        },

    },

    render: {

        // Migrado tal cual desde Renderer.tagLedElements().
        tag(component, graphic, renderer) {

            graphic.querySelectorAll("[id^='color_']").forEach((el) => {
                el.setAttribute("data-led-role", "body");
                el.setAttribute("data-led-original-id", el.getAttribute("id"));
                el.removeAttribute("id");
            });

        },

        // Migrado tal cual desde el bloque "Estado inicial apagado" de
        // Renderer.renderComponent(). applyLedColor() sigue viviendo en
        // Renderer.js (tiene otros llamadores: applyLedState(), y
        // PropertyPanel.js para la vista previa de color).
        initialState(component, renderer) {
            renderer.applyLedColor(component, false);
        },

    },

});
