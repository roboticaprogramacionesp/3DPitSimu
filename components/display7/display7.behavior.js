/*
==========================================================
 PitSimulator — display7.behavior.js
 Comportamiento de señal del display 7 segmentos, migrado tal
 cual desde SignalEngine.evaluateDisplay7() hacia
 ComponentBehaviorRegistry. Ver
 js/simulator/ComponentBehaviorRegistry.js para el contrato.
==========================================================
*/

ComponentBehaviorRegistry.register("display7", {

    signal: {

        evaluate(component, engine) {

            const isCathode =
                (component.properties?.commonType || "cathode") === "cathode";

            const commonOk = isCathode
                ? engine.isKeyConnectedToGnd(`${component.id}:com1`) ||
                  engine.isKeyConnectedToGnd(`${component.id}:com2`)
                : engine.isKeyConnectedToHighDriver(`${component.id}:com1`) ||
                  engine.isKeyConnectedToHighDriver(`${component.id}:com2`);

            const segmentIds = ["a", "b", "c", "d", "e", "f", "g"];
            const segments = {};

            segmentIds.forEach((id) => {
                segments[id] =
                    commonOk &&
                    (isCathode
                        ? engine.isKeyConnectedToHighDriver(`${component.id}:${id}`)
                        : engine.isKeyConnectedToGnd(`${component.id}:${id}`));
            });

            const dp =
                commonOk &&
                (isCathode
                    ? engine.isKeyConnectedToHighDriver(`${component.id}:dp`)
                    : engine.isKeyConnectedToGnd(`${component.id}:dp`));

            engine.simulator.renderer.applyDisplay7State(component, segments, dp);

        },

    },

});
