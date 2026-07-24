/*
==========================================================
 PitSimulator — buzzer.behavior.js
 Comportamiento de señal del buzzer, migrado tal cual desde
 SignalEngine.evaluateBuzzer() hacia ComponentBehaviorRegistry.
 Ver js/simulator/ComponentBehaviorRegistry.js para el contrato.
==========================================================
*/

ComponentBehaviorRegistry.register("buzzer", {

    signal: {

        evaluate(component, engine) {

            const net = engine.getNet(`${component.id}:s`);

            let active = null;
            for (const key of net) {
                if (engine.pwmStates[key]) {
                    active = engine.pwmStates[key];
                    break;
                }
            }

            // Sin VCC/GND cableados, el buzzer no debe sonar aunque el
            // firmware siga mandando PWM por el pin de señal.
            if (active && !engine.isComponentPowered(component)) {
                active = null;
            }

            if (active) {
                engine.simulator.renderer.playBuzzerTone(component, active.freq);
            } else {
                engine.simulator.renderer.stopBuzzerTone(component);
            }

        },

    },

});
