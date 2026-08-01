/*
==========================================================
 PitSimulator — slide_switch.behavior.js
 Interruptor deslizante SPDT (NC/COM/NO): mismo criterio que
 switch.behavior.js (estado fijo entre un clic y el siguiente, no
 momentáneo), pero acá COM siempre queda puenteado a uno de los DOS
 lados en vez de un simple ON/OFF -- ver el bloque nuevo en
 SignalEngine.getNet() (component.spdtPins/component.spdtPosition),
 que generaliza el mismo mecanismo de puente que ya usan los botones
 (pressPins) para este caso de "siempre puenteado a A o a B".

 Al no ser una señal digital que el firmware lea (es continuidad real
 en la línea, como el switch de 2 patitas), no se llama a
 setPressed()/_notifyButtonToFirmware() -- alcanza con evaluateAll()
 para que cualquier componente aguas abajo vea el cambio.
==========================================================
*/

ComponentBehaviorRegistry.register("slide_switch", {

    render: {

        tag(component, graphic, renderer) {

            const hitzone = graphic.querySelector('[data-role="spdt-hitzone"]');
            const lever = graphic.querySelector('[data-role="spdt-lever"]');

            if (!hitzone || !lever) {
                console.warn(`[slide_switch.behavior] Faltan elementos en el SVG de ${component.id}`);
                return;
            }

            const LEVER_X_NC = 7;
            const LEVER_X_NO = 31;

            const applyVisual = () => {
                const onNo = component.spdtPosition === "no";
                lever.setAttribute("x", onNo ? LEVER_X_NO : LEVER_X_NC);
            };

            if (component.spdtPosition !== "nc" && component.spdtPosition !== "no") {
                component.spdtPosition = "nc";
            }
            component.spdtPins = { common: "com", nc: "nc", no: "no" };

            hitzone.addEventListener("pointerdown", (e) => {
                if (component.locked) return;

                // Mismo fix que switch.behavior.js/bindPressButton --
                // sin esto, el hitzone (que cubre casi todo el
                // cuerpo) siempre capturaba el click, sin importar si
                // la simulación estaba corriendo, y no quedaba lugar
                // para seleccionar/arrastrar el componente entero
                // mientras se arma el circuito.
                if (!renderer.simulator.isRunning) return;

                e.stopPropagation();
                e.preventDefault();

                component.spdtPosition = component.spdtPosition === "no" ? "nc" : "no";
                applyVisual();

                renderer.simulator.signalEngine.evaluateAll();
            });

            component._slideSwitchApplyVisual = applyVisual;

        },

        initialState(component) {
            component._slideSwitchApplyVisual?.();
        },

    },

});
