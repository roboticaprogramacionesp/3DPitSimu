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

    render: {

        // Migrado tal cual desde Renderer.tagDisplay7Elements().
        // Renderer.DISPLAY7_SEGMENT_MAP sigue siendo un static de
        // Renderer -- se referencia como global, igual que en el resto
        // del proyecto (ej. SignalEngine.js ya hace lo mismo con
        // Renderer.isLed()).
        tag(component, graphic, renderer) {

            Object.entries(Renderer.DISPLAY7_SEGMENT_MAP).forEach(
                ([originalId, role]) => {
                    const el = graphic.querySelector(`#${originalId}`);

                    if (!el) {
                        console.warn(
                            `[display7.behavior] no se encontró #${originalId} (segmento "${role}")`,
                        );
                        return;
                    }

                    el.setAttribute("data-display7-role", role);
                    el.setAttribute("data-display7-original-id", originalId);
                    el.removeAttribute("id");
                    el.style.removeProperty("fill");
                },
            );

        },

        // Migrado tal cual desde el bloque "Estado inicial del display 7
        // segmentos" de Renderer.renderComponent().
        initialState(component, renderer) {
            renderer.applyDisplay7State(
                component,
                { a: false, b: false, c: false, d: false, e: false, f: false, g: false },
                false,
            );
        },

    },

});
