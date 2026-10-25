/*
==========================================================
 PitSimulator — l9110.behavior.js
 Comportamiento de señal del L9110S (puente H doble, más simple que
 el L298N): sin pines ENA/ENB separados -- cada motor se maneja con
 sus 2 pines IA/IB directo (PWM en uno + el otro en LOW = adelante o
 atrás con velocidad; ambos en HIGH = freno; ambos en LOW = libre),
 mismo patrón IA/IB que ya usan los tutoriales típicos de MicroPython
 para este chip.

 Reusa engine._findMotorsOnOutputs() tal cual (vive en SignalEngine.js,
 genérico -- no depende de nada específico del L298N) y el mismo shape
 de estado {state, enabled, in_a, in_b, speed} que ya consume
 Renderer.applyMotorState(), así que un motor cableado a este
 componente se ve y comporta igual que uno cableado a un L298N. El
 helper que APLICA ese estado a cada motor encontrado (ver
 _l9110ApplyMotorStateToAll más abajo) SÍ es una copia local propia,
 no la de l298n.behavior.js -- ver el comentario ahí mismo.
==========================================================
*/

// Copia local de _applyMotorStateToAll (ver l298n.behavior.js) -- NO
// se reusa la de ahí porque cada *.behavior.js se carga como <script>
// clásico por separado (ComponentBehaviorRegistry los inyecta por
// tipo, solo si ese tipo está en el lienzo): si solo hay un L9110 sin
// ningún L298N, esa función global de l298n.behavior.js ni existiría.
// Misma lógica tal cual (invierte "adelante"/"atrás" si el motor
// quedó cableado al revés respecto a outPinA/outPinB).
function _l9110ApplyMotorStateToAll(engine, motors, motorState) {
    motors.forEach(({ component, reversed }) => {
        let state = motorState;
        if (reversed && (motorState.state === "adelante" || motorState.state === "atrás")) {
            state = {
                ...motorState,
                state: motorState.state === "adelante" ? "atrás" : "adelante",
            };
        }
        engine.simulator.renderer.applyMotorState(component, state);
    });
}

function _computeL9110MotorState(engine, component, iaPin, ibPin) {

    const iaKey = `${component.id}:${iaPin}`;
    const ibKey = `${component.id}:${ibPin}`;

    // PWM real (machine.PWM) en IA/IB -- patrón más común en los
    // tutoriales (duty = velocidad). isKeyConnectedToHighDriver NUNCA
    // ve esto (PWM no pasa por driverStates, mismo motivo documentado
    // en l298n.behavior.js/_computeL298nMotorState) -- se chequea PWM
    // primero y, si no hay, se cae a digital HIGH/LOW (velocidad fija,
    // código más simple con Pin.value() en vez de PWM).
    const pwmA = engine.getPwmDutyForKey(iaKey);
    const pwmB = engine.getPwmDutyForKey(ibKey);

    const speedA = pwmA ? Math.max(0, Math.min(1, pwmA.duty / 1023)) : (engine.isKeyConnectedToHighDriver(iaKey) ? 1 : 0);
    const speedB = pwmB ? Math.max(0, Math.min(1, pwmB.duty / 1023)) : (engine.isKeyConnectedToHighDriver(ibKey) ? 1 : 0);

    const activeA = speedA > 0;
    const activeB = speedB > 0;

    let state = "detenido";
    let speed = 0;

    if (activeA && !activeB) {
        state = "adelante";
        speed = speedA;
    } else if (!activeA && activeB) {
        state = "atrás";
        speed = speedB;
    } else if (activeA && activeB) {
        // Ambos pines activos a la vez -- freno (mismo criterio que
        // IN1+IN2 ambos en HIGH en el L298N).
        state = "freno";
        speed = 1;
    }

    return { state, enabled: activeA || activeB, in_a: activeA, in_b: activeB, speed };

}

ComponentBehaviorRegistry.register("l9110", {

    signal: {

        evaluate(component, engine) {

            if (!engine.isComponentPowered(component)) {
                const off = { state: "deshabilitado", enabled: false, in_a: false, in_b: false };

                _l9110ApplyMotorStateToAll(engine, engine._findMotorsOnOutputs(component, "out_a1", "out_a2"), off);
                _l9110ApplyMotorStateToAll(engine, engine._findMotorsOnOutputs(component, "out_b1", "out_b2"), off);

                engine.simulator.eventBus.emit("motor:changed", {
                    componentId: component.id,
                    motorA: off,
                    motorB: off,
                });
                return;
            }

            const motorA = _computeL9110MotorState(engine, component, "a_ia", "a_ib");
            const motorB = _computeL9110MotorState(engine, component, "b_ia", "b_ib");

            _l9110ApplyMotorStateToAll(engine, engine._findMotorsOnOutputs(component, "out_a1", "out_a2"), motorA);
            _l9110ApplyMotorStateToAll(engine, engine._findMotorsOnOutputs(component, "out_b1", "out_b2"), motorB);

            engine.simulator.eventBus.emit("motor:changed", {
                componentId: component.id,
                motorA,
                motorB,
            });

        },

    },

    propertyPanel: {

        render(component, panel) {

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "L9110S — Puente H Doble";
            panel.content.appendChild(title);

            const motorA = _computeL9110MotorState(panel.simulator.signalEngine, component, "a_ia", "a_ib");
            const motorB = _computeL9110MotorState(panel.simulator.signalEngine, component, "b_ia", "b_ib");

            [["A", motorA], ["B", motorB]].forEach(([label, motorState]) => {
                const wrap = document.createElement("div");
                wrap.style.cssText = "margin-bottom: 12px; background:#1e1f22; border:1px solid #333; border-radius:8px; padding:12px;";

                const wrapTitle = document.createElement("div");
                wrapTitle.style.cssText = "font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
                wrapTitle.textContent = `Motor ${label}`;
                wrap.appendChild(wrapTitle);

                const badge = document.createElement("div");
                badge.style.cssText = `
                    font-size: 20px;
                    font-weight: 700;
                    text-align: center;
                    padding: 8px;
                    border-radius: 6px;
                    color: #fff;
                    background: ${panel._l298nStateColor(motorState.state)};
                `;
                badge.textContent = panel._l298nStateLabel(motorState.state);
                wrap.appendChild(badge);

                panel.content.appendChild(wrap);
            });

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
