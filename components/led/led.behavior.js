/*
==========================================================
 PitSimulator — led.behavior.js
 Comportamiento de señal del LED, migrado tal cual desde
 SignalEngine.evaluateLed() hacia ComponentBehaviorRegistry.
 Ver js/simulator/ComponentBehaviorRegistry.js para el contrato.
==========================================================
*/

// Compartido con resistencia.behavior.js (cada .behavior.js carga
// como un <script> independiente, solo si ese tipo de componente
// está en el lienzo -- mismo motivo por el que l9110.behavior.js ya
// duplica su propia copia de _l9110ApplyMotorStateToAll en vez de
// compartir con l298n.behavior.js). Pinta el resultado de
// SignalEngine.computeLedCurrent() -- ver ese método para la cuenta
// completa y por qué hacía falta (la resistencia nunca limitó
// corriente de verdad en la simulación, era puramente decorativa).
function _renderLedCurrentInfo(result, panel) {

    const wrap = document.createElement("div");
    wrap.style.cssText = "margin: 4px 0 14px; padding: 10px 12px; border-radius: 8px; font-size: 12px; line-height: 1.5;";

    if (!result) {
        wrap.style.cssText += "background:#242424; color:#888; border:1px solid #333;";
        wrap.textContent = "⚡ Sin fuente de voltaje reconocida -- cableá el ánodo (directo o a través de una resistencia) a un GPIO o a un pin de alimentación para calcular la corriente.";
        panel.content.appendChild(wrap);
        return;
    }

    wrap.style.cssText += result.safe
        ? "background:#1a3a1a; border:1px solid #2d5a2d; color:#8fd98f;"
        : "background:#3a1a1a; border:1px solid #5a2d2d; color:#ff8a80;";

    const title = document.createElement("div");
    title.style.cssText = "font-weight:700; margin-bottom:4px;";
    title.textContent = result.safe ? "✅ Corriente estimada: segura" : "⚠️ Corriente estimada: PELIGROSA";
    wrap.appendChild(title);

    const detail = document.createElement("div");
    if (result.currentMa === Infinity) {
        detail.textContent = `Fuente: ${result.sourceDescription}. ${result.note}`;
    } else {
        detail.textContent = `${result.currentMa.toFixed(1)} mA (máx. recomendado: ${result.ratedMa} mA) -- Fuente: ${result.sourceDescription}` +
            (result.resistorOhms ? `, resistencia ${result.resistorOhms} Ω` : ", SIN resistencia") +
            (result.note ? `. ${result.note}` : ".");
    }
    wrap.appendChild(detail);

    panel.content.appendChild(wrap);

}

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

    propertyPanel: {

        render(component, panel) {

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "LED";
            panel.content.appendChild(title);

            component.properties = component.properties || {};
            if (component.properties.voltaje_directo === undefined) component.properties.voltaje_directo = 2.0;
            if (component.properties.corriente_ma === undefined) component.properties.corriente_ma = 20;

            const result = panel.simulator.signalEngine.computeLedCurrent(component);
            _renderLedCurrentInfo(result, panel);

            const row = document.createElement("div");
            row.className = "property-row";
            row.appendChild(panel._makeNumberField("Voltaje directo (V)", component.properties.voltaje_directo, (val) => {
                component.properties.voltaje_directo = Math.max(0.1, val || 2.0);
            }));
            row.appendChild(panel._makeNumberField("Corriente máx. (mA)", component.properties.corriente_ma, (val) => {
                component.properties.corriente_ma = Math.max(1, val || 20);
            }));
            panel.content.appendChild(row);

            const hint = document.createElement("div");
            hint.style.cssText = "font-size:11px; color:#888; margin: 6px 0 14px; line-height:1.5;";
            hint.textContent = "Valores típicos de un LED 5mm real -- cambialos si el tuyo es distinto (ej. un LED de alta luminosidad puede pedir 20-30mA).";
            panel.content.appendChild(hint);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
