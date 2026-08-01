/*
==========================================================
 PitSimulator — switch.behavior.js
 Interruptor de palanca ON/OFF -- a diferencia de un botón
 momentáneo (bindPressButton, pointerdown/pointerup), este
 queda FIJO en el estado que quedó tras el último clic.

 Reusa el mismo mecanismo de "puente" que ya usa
 SignalEngine.getNet() para botones momentáneos
 (component.pressed && component.pressPins bridgea sus dos
 pines mientras pressed sea true) -- por eso term1/term2 están
 declarados como pressPins en switch.json, sin tocar el motor
 de nets para nada. La diferencia real está acá: en vez de
 pointerdown=true/pointerup=false (SignalEngine.setPressed,
 que además le avisa al firmware "IN:<gpio>:1" como si fuera
 un botón eléctrico), un click alterna component.pressed una
 sola vez y lo deja así -- sin llamar a setPressed()/
 _notifyButtonToFirmware(), porque este interruptor no es una
 señal digital que el firmware lea: es continuidad real (o no)
 en la línea de alimentación donde esté cableado (ej. entre una
 batería y el +12V del L298N). Alcanza con re-evaluar todo
 (evaluateAll) para que isComponentPowered()/isKeyConnectedToPower()
 de cualquier componente aguas abajo vean el cambio.
==========================================================
*/

ComponentBehaviorRegistry.register("switch", {

    render: {

        tag(component, graphic, renderer) {

            const hitzone = graphic.querySelector('[data-role="switch-hitzone"]');
            const lever = graphic.querySelector('[data-role="switch-lever"]');
            const indicator = graphic.querySelector('[data-role="switch-indicator"]');

            if (!hitzone || !lever || !indicator) {
                console.warn(`[switch.behavior] Faltan elementos en el SVG de ${component.id}`);
                return;
            }

            const applyVisual = () => {
                const closed = !!component.pressed;
                lever.setAttribute("x", closed ? "21" : "7");
                indicator.setAttribute("fill", closed ? "#33cc55" : "#cc3333");
            };

            hitzone.addEventListener("pointerdown", (e) => {
                if (component.locked) return;

                // FIX real (a pedido: "necesito mover ese interruptor,
                // ya no puedo moverlo porque detecta el clic"): mismo
                // criterio que Renderer.bindPressButton (ver el
                // comentario grande ahí) -- antes esto capturaba
                // SIEMPRE el click acá, sin importar si la simulación
                // estaba corriendo, y como el hitzone cubre toda la
                // palanca, nunca quedaba un lugar libre para
                // seleccionar/arrastrar el componente entero.
                // DragManager ya se bloquea solo mientras isRunning,
                // así que acá se aplica lo complementario: si la
                // simulación NO está corriendo, todavía estás
                // ARMANDO el circuito -- no hacer nada (dejar que el
                // evento siga hacia DragManager como cualquier otro
                // punto del componente). Prender/apagar el
                // interruptor de verdad solo tiene sentido una vez
                // que hay firmware corriendo del otro lado.
                if (!renderer.simulator.isRunning) return;

                e.stopPropagation();
                e.preventDefault();

                component.pressed = !component.pressed;
                applyVisual();

                // NO usar SignalEngine.setPressed() acá -- ver el
                // comentario grande arriba: eso manda "IN:" al
                // firmware como si esto fuera un botón digital, y
                // este interruptor es continuidad de alimentación,
                // no una señal que el firmware lea.
                renderer.simulator.signalEngine.evaluateAll();
            });

            // Guardamos applyVisual para que initialState (abajo)
            // pueda reusarlo sin duplicar la lógica.
            component._switchApplyVisual = applyVisual;

        },

        initialState(component) {
            component._switchApplyVisual?.();
        },

    },

});
