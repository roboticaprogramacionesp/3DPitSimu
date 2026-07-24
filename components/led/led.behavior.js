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

});
