/*
==========================================================
 PitSimulator — tm1637.behavior.js
 Comportamiento de render del TM1637, migrado tal cual desde
 Renderer.tagTm1637Elements()/el bloque de estado inicial de
 Renderer.renderComponent() hacia ComponentBehaviorRegistry.
 Renderer.TM1637_DIGIT_MAP/TM1637_COLON_IDS siguen siendo
 statics de Renderer -- se referencian como global.
==========================================================
*/

ComponentBehaviorRegistry.register("tm1637", {

    render: {

        tag(component, graphic) {

            Renderer.TM1637_DIGIT_MAP.forEach((segmentIds, digitIndex) => {
                Object.entries(segmentIds).forEach(([role, originalId]) => {
                    const el = graphic.querySelector(`#${originalId}`);

                    if (!el) {
                        console.warn(
                            `[tm1637.behavior] no se encontró #${originalId} (dígito ${digitIndex}, segmento "${role}")`,
                        );
                        return;
                    }

                    el.setAttribute("data-tm1637-digit", digitIndex);
                    el.setAttribute("data-tm1637-role", role);
                    el.removeAttribute("id");
                    el.style.removeProperty("fill");
                    if (el.hasAttribute("fill")) el.removeAttribute("fill");
                });
            });

            Renderer.TM1637_COLON_IDS.forEach((originalId) => {
                const el = graphic.querySelector(`#${originalId}`);

                if (!el) {
                    console.warn(`[tm1637.behavior] no se encontró #${originalId} (colón)`);
                    return;
                }

                el.setAttribute("data-tm1637-role", "colon");
                el.removeAttribute("id");
                el.style.removeProperty("fill");
                if (el.hasAttribute("fill")) el.removeAttribute("fill");
            });

        },

        initialState(component, renderer) {
            renderer.applyTm1637Segments(component, [0, 0, 0, 0]);
        },

    },

});
