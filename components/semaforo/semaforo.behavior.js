/*
==========================================================
 PitSimulator — semaforo.behavior.js
 Comportamiento de señal del semáforo, migrado tal cual desde
 SignalEngine.evaluateSemaforo() hacia ComponentBehaviorRegistry.
 Ver js/simulator/ComponentBehaviorRegistry.js para el contrato.
==========================================================
*/

ComponentBehaviorRegistry.register("semaforo", {

    signal: {

        evaluate(component, engine) {

            const gndOk =
                engine.isComponentPowered(component) &&
                engine.isKeyConnectedToGnd(`${component.id}:gnd`);

            const lights = {
                r: gndOk && engine.isKeyConnectedToHighDriver(`${component.id}:r`),
                y: gndOk && engine.isKeyConnectedToHighDriver(`${component.id}:y`),
                g: gndOk && engine.isKeyConnectedToHighDriver(`${component.id}:g`),
            };

            engine.simulator.renderer.applySemaforoState(component, lights);

        },

    },

});
