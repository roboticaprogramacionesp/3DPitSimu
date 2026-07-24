/*
==========================================================
 PitSimulator — l298n.behavior.js
 Comportamiento de señal del puente H L298N, migrado tal cual
 desde SignalEngine.evaluateL298n() hacia
 ComponentBehaviorRegistry.

 A diferencia de otros tipos migrados, los helpers
 _findMotorOnOutputs()/_computeL298nMotorState() y el método
 getL298nState() SIGUEN viviendo en SignalEngine.js -- no se
 movieron acá porque getL298nState() tiene un llamador externo
 real (PropertyPanel.js, para pintar el estado inicial del panel
 de propiedades sin disparar el evento "motor:changed"). Este
 behavior los llama de vuelta vía "engine".
==========================================================
*/

ComponentBehaviorRegistry.register("l298n", {

    signal: {

        evaluate(component, engine) {

            if (!engine.isComponentPowered(component)) {
                const off = { state: "deshabilitado", enabled: false, in_a: false, in_b: false };

                const motorAComponent = engine._findMotorOnOutputs(component, "out1", "out2");
                if (motorAComponent) engine.simulator.renderer.applyMotorState(motorAComponent, off);

                const motorBComponent = engine._findMotorOnOutputs(component, "out3", "out4");
                if (motorBComponent) engine.simulator.renderer.applyMotorState(motorBComponent, off);

                engine.simulator.eventBus.emit("motor:changed", {
                    componentId: component.id,
                    motorA: off,
                    motorB: off,
                });
                return;
            }

            const motorA = engine._computeL298nMotorState(
                component,
                "in1",
                "in2",
                "ena",
                "jumperEnaInstalled",
            );
            const motorB = engine._computeL298nMotorState(
                component,
                "in3",
                "in4",
                "enb",
                "jumperEnbInstalled",
            );

            const motorAComponent = engine._findMotorOnOutputs(component, "out1", "out2");
            if (motorAComponent)
                engine.simulator.renderer.applyMotorState(motorAComponent, motorA);

            const motorBComponent = engine._findMotorOnOutputs(component, "out3", "out4");
            if (motorBComponent)
                engine.simulator.renderer.applyMotorState(motorBComponent, motorB);

            engine.simulator.eventBus.emit("motor:changed", {
                componentId: component.id,
                motorA,
                motorB,
            });

        },

    },

});
