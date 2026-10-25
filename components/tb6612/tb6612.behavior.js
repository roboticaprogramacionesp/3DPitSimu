/*
==========================================================
 PitSimulator — tb6612.behavior.js
 Comportamiento de señal del TB6612FNG: a diferencia del L298N (ENA/
 ENB por motor) y del L9110 (sin pin de habilitación en absoluto),
 este chip tiene UN SOLO pin STBY que habilita/deshabilita el CHIP
 ENTERO (los dos motores a la vez) -- con pulldown interno real (si
 STBY queda sin cablear, el chip arranca deshabilitado, no al revés).
 Cada motor después se maneja con su propio par de dirección
 (AIN1/AIN2 o BIN1/BIN2) + su propio PWM de velocidad (PWMA/PWMB) --
 mismo patrón que ENA+IN1+IN2 del L298N, pero sin jumper (este
 breakout no trae ninguno en el pinout real).

 Mismo shape de estado {state, enabled, in_a, in_b, speed} que
 Renderer.applyMotorState() ya consume (ver l298n.behavior.js/
 l9110.behavior.js) -- misma copia local del helper que aplica el
 estado a cada motor encontrado, por el mismo motivo documentado en
 l9110.behavior.js (cada *.behavior.js es su propio <script>, no hay
 nada compartido entre ellos aparte de lo que vive en SignalEngine.js).
==========================================================
*/

function _tb6612ApplyMotorStateToAll(engine, motors, motorState) {
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

function _computeTb6612MotorState(engine, component, stbyActive, pwmPin, in1Pin, in2Pin) {

    if (!stbyActive) {
        return { state: "deshabilitado", enabled: false, in_a: false, in_b: false, speed: 0 };
    }

    const in1Key = `${component.id}:${in1Pin}`;
    const in2Key = `${component.id}:${in2Pin}`;
    const pwmKey = `${component.id}:${pwmPin}`;

    const a = engine.isKeyConnectedToHighDriver(in1Key);
    const b = engine.isKeyConnectedToHighDriver(in2Key);

    const pwm = engine.getPwmDutyForKey(pwmKey);
    const speed = pwm ? Math.max(0, Math.min(1, pwm.duty / 1023)) : (engine.isKeyConnectedToHighDriver(pwmKey) ? 1 : 0);

    let state = "detenido";

    if (a && !b) state = "adelante";
    else if (!a && b) state = "atrás";
    else if (a && b) state = "freno";

    return {
        state,
        enabled: state !== "detenido",
        in_a: a,
        in_b: b,
        speed: state === "freno" ? 1 : speed,
    };

}

ComponentBehaviorRegistry.register("tb6612", {

    signal: {

        evaluate(component, engine) {

            if (!engine.isComponentPowered(component)) {
                const off = { state: "deshabilitado", enabled: false, in_a: false, in_b: false, speed: 0 };

                _tb6612ApplyMotorStateToAll(engine, engine._findMotorsOnOutputs(component, "ao1", "ao2"), off);
                _tb6612ApplyMotorStateToAll(engine, engine._findMotorsOnOutputs(component, "bo1", "bo2"), off);

                engine.simulator.eventBus.emit("motor:changed", { componentId: component.id, motorA: off, motorB: off });
                return;
            }

            // Pulldown real: STBY sin cablear = chip deshabilitado,
            // NO lo contrario -- ver nota grande arriba.
            const stbyActive = engine.isKeyConnectedToHighDriver(`${component.id}:stby`);

            const motorA = _computeTb6612MotorState(engine, component, stbyActive, "pwma", "ain1", "ain2");
            const motorB = _computeTb6612MotorState(engine, component, stbyActive, "pwmb", "bin1", "bin2");

            _tb6612ApplyMotorStateToAll(engine, engine._findMotorsOnOutputs(component, "ao1", "ao2"), motorA);
            _tb6612ApplyMotorStateToAll(engine, engine._findMotorsOnOutputs(component, "bo1", "bo2"), motorB);

            engine.simulator.eventBus.emit("motor:changed", { componentId: component.id, motorA, motorB });

        },

    },

    propertyPanel: {

        render(component, panel) {

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "TB6612FNG — Puente H Doble";
            panel.content.appendChild(title);

            const engine = panel.simulator.signalEngine;
            const stbyActive = engine.isKeyConnectedToHighDriver(`${component.id}:stby`);
            const motorA = _computeTb6612MotorState(engine, component, stbyActive, "pwma", "ain1", "ain2");
            const motorB = _computeTb6612MotorState(engine, component, stbyActive, "pwmb", "bin1", "bin2");

            if (!stbyActive) {
                const hint = document.createElement("p");
                hint.style.cssText = "font-size:11px; color:#e0c040; margin-bottom:10px;";
                hint.textContent = "⚠ STBY no está en HIGH (tiene pulldown interno) -- los dos motores quedan deshabilitados hasta que lo cablees y lo pongas en alto.";
                panel.content.appendChild(hint);
            }

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
