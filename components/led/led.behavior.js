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

            const catodoGnd = engine.isKeyConnectedToGnd(`${component.id}:catodo`);
            if (!catodoGnd) {
                engine.simulator.renderer.applyLedState(component, false);
                return;
            }

            const anodoKey = `${component.id}:anodo`;

            // PWM (machine.PWM, ver _base.hal.py) primero -- si el
            // ánodo está en un pin manejado con PWM, el brillo depende
            // del duty cycle, no de un 0/1 digital (isKeyConnectedToHighDriver
            // nunca lo iba a ver: PWM no pasa por driverStates).
            const pwm = engine.getPwmDutyForKey(anodoKey);
            if (pwm) {
                const brightness = Math.max(0, Math.min(1, pwm.duty / 1023));
                engine.simulator.renderer.applyLedBrightness(component, brightness);
                return;
            }

            const anodoHigh = engine.isKeyConnectedToHighDriver(anodoKey);
            engine.simulator.renderer.applyLedState(component, anodoHigh);

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
