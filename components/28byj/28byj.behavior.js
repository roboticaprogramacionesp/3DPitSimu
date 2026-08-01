/*
==========================================================
 PitSimulator — 28byj.behavior.js
 Motor paso a paso 28BYJ-48 + driver ULN2003 (4 entradas
 digitales IN1-IN4, sin protocolo propio -- ver 28byj.hal.py).

 CÓMO SE DETECTA ROTACIÓN Y DIRECCIÓN (sin conocer la secuencia de
 pasos exacta que usa el código del usuario):
 En vez de comparar contra una tabla fija de pasos (wave drive,
 full-step, half-step -- cada tutorial usa una distinta, y
 hardcodear una sola rompería con las demás), se trata a las 4
 bobinas como 4 posiciones angulares fijas (0°,90°,180°,270°) y se
 calcula el ángulo RESULTANTE del patrón actual de bobinas
 encendidas (suma vectorial, como un promedio circular). La
 diferencia angular (más corta) entre el resultante actual y el
 anterior da la dirección Y magnitud del paso, sin importar qué
 secuencia específica use el firmware -- funciona igual para wave
 drive, full-step de a 2 bobinas, o half-step de 8 estados.

 FIX real #3 (a pedido: "no funciono como deberia, lo hace muy
 rapido... deberia solo llegar a una posicion"): la primera versión
 aplicaba el ángulo ELÉCTRICO (0-360° por ciclo de 4 bobinas) DIRECTO
 al eje dibujado, sin reducirlo -- con la librería real del usuario
 (stepper.py: HalfStepMotor.maxpos=4096, FullStepMotor.maxpos=2048),
 un solo motor_pasos.step_degrees(90) manda 1024 pasos half-step ×
 45°/paso = 46080° de giro ELÉCTRICO, que se veía como el eje dando
 vueltas como loco en vez de girar 90° y frenar. La relación real
 (grados de EJE por grado ELÉCTRICO) es SIEMPRE 1/512 para este
 motor sea full-step o half-step -- se cancela solo: half-step tiene
 la mitad de grados eléctricos por paso (45° vs 90°) pero el doble
 de pasos por vuelta (4096 vs 2048), así que el cociente da igual.
 Por eso GEAR_RATIO=512 de acá abajo alcanza para los dos modos sin
 necesidad de saber cuál usa el firmware.
==========================================================
*/

// Ver FIX real #3 arriba: grados de EJE = grados ELÉCTRICOS / 512,
// constante para full-step y half-step en el 28BYJ-48 real.
const STEPPER_GEAR_RATIO = 512;

const STEPPER_COIL_ANGLES = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

function _stepperResultantAngle(bits) {
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < 4; i++) {
        if (bits[i]) {
            sumX += Math.cos(STEPPER_COIL_ANGLES[i]);
            sumY += Math.sin(STEPPER_COIL_ANGLES[i]);
        }
    }
    if (sumX === 0 && sumY === 0) return null; // las 4 bobinas apagadas -- reposo
    return Math.atan2(sumY, sumX);
}

function _stepperShaftPivot(mark) {
    // La marca es un <g> (línea + punta circular, ver 28byj.svg) --
    // el pivote es el x1,y1 de la línea interna.
    const line = mark.querySelector("line");
    return {
        cx: parseFloat(line.getAttribute("x1")),
        cy: parseFloat(line.getAttribute("y1")),
    };
}

function _stepperApplyAngle(component) {
    if (!component.element) return;
    const mark = component.element.querySelector('[data-role="stepper-shaft-mark"]');
    if (!mark) return;
    const { cx, cy } = _stepperShaftPivot(mark);
    mark.setAttribute("transform", `rotate(${component.stepperShaftAngle || 0}, ${cx}, ${cy})`);
}

// Anillo "spinner" (punteado, ver 28byj.svg) que GIRA de verdad SOLO
// mientras están llegando pasos nuevos -- a pedido ("algo mas
// llamativo"), reemplaza al primer intento (un simple parpadeo de
// opacidad, poco notorio). Como ahora la aguja roja se mueve MUY
// despacio (ver STEPPER_GEAR_RATIO), este spinner es la señal
// principal de "está trabajando ahora mismo".
const STEPPER_IDLE_MS = 220;
const STEPPER_SPINNER_RPS_MS = 500; // ms por vuelta completa del spinner

function _stepperStartPulse(component) {
    if (component._stepperPulseAnim || !component.element) return;
    const glow = component.element.querySelector('[data-role="stepper-active-glow"]');
    if (!glow) return;

    const cx = glow.getAttribute("cx");
    const cy = glow.getAttribute("cy");
    // Sin esto, un WAAPI "rotate()" sobre un elemento SVG gira
    // alrededor del origen (0,0) del viewBox entero, no del propio
    // centro del anillo -- transform-box:view-box es el default
    // para elementos SVG, así que un transform-origin en las MISMAS
    // unidades del viewBox (que son estas, cx/cy ya están en
    // coordenadas finales/raíz) alcanza sin tocar transform-box.
    glow.style.transformOrigin = `${cx}px ${cy}px`;
    glow.style.opacity = "0.9";

    component._stepperPulseAnim = glow.animate(
        [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
        { duration: STEPPER_SPINNER_RPS_MS, iterations: Infinity, easing: "linear" },
    );
}

function _stepperStopPulse(component) {
    if (component._stepperPulseAnim) {
        component._stepperPulseAnim.cancel();
        component._stepperPulseAnim = null;
    }
    const glow = component.element?.querySelector('[data-role="stepper-active-glow"]');
    if (glow) glow.style.opacity = "0";
}

ComponentBehaviorRegistry.register("28byj", {

    signal: {

        evaluate(component, engine) {

            if (!engine.isComponentPowered(component)) return;

            const bits = [
                engine.isKeyConnectedToHighDriver(`${component.id}:in1`),
                engine.isKeyConnectedToHighDriver(`${component.id}:in2`),
                engine.isKeyConnectedToHighDriver(`${component.id}:in3`),
                engine.isKeyConnectedToHighDriver(`${component.id}:in4`),
            ];

            const angle = _stepperResultantAngle(bits);

            if (angle !== null && typeof component._stepperLastAngle === "number") {
                let delta = angle - component._stepperLastAngle;
                // Camino más corto (evita el salto de 359°->0°).
                while (delta > Math.PI) delta -= 2 * Math.PI;
                while (delta < -Math.PI) delta += 2 * Math.PI;

                const deltaDeg = delta * (180 / Math.PI);
                component.stepperShaftAngle = (component.stepperShaftAngle || 0) + deltaDeg / STEPPER_GEAR_RATIO;
                _stepperApplyAngle(component);

                // "Está girando AHORA" -- se prende con el primer paso
                // y se apaga solo si no llega ningún paso nuevo en
                // STEPPER_IDLE_MS (un step_degrees() real manda cientos
                // de pasos seguidos muy rápido, así que esto queda
                // prendido de corrido durante todo el movimiento y se
                // apaga apenas el firmware termina).
                _stepperStartPulse(component);
                clearTimeout(component._stepperIdleTimer);
                component._stepperIdleTimer = setTimeout(() => _stepperStopPulse(component), STEPPER_IDLE_MS);
            }

            if (angle !== null) component._stepperLastAngle = angle;

            engine.simulator.eventBus.emit("stepper:changed", {
                componentId: component.id,
                bits,
                shaftAngle: component.stepperShaftAngle || 0,
            });

        },

    },

    render: {

        initialState(component) {
            _stepperApplyAngle(component);
        },

    },

    propertyPanel: {

        render(component, panel) {

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "28BYJ-48 + ULN2003";
            panel.content.appendChild(title);

            const coilsLabel = document.createElement("div");
            coilsLabel.style.cssText = "font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            coilsLabel.textContent = "Bobinas (IN1-IN4)";
            panel.content.appendChild(coilsLabel);

            const coilsRow = document.createElement("div");
            coilsRow.id = `stepperCoils_${component.id}`;
            coilsRow.style.cssText = "display:flex; gap:6px; margin-bottom:16px;";
            panel.content.appendChild(coilsRow);

            const angleLabel = document.createElement("div");
            angleLabel.id = `stepperAngle_${component.id}`;
            angleLabel.style.cssText = "font-size:13px; color:#ccc; margin-bottom:16px;";
            panel.content.appendChild(angleLabel);

            // Estado inicial nada más -- la actualización EN VIVO
            // mientras el panel queda abierto vive centralizada en
            // PropertyPanel.js (_updateStepperDisplay(), suscripta UNA
            // sola vez en su constructor a "stepper:changed"), mismo
            // criterio que ya usa _updateL298nDisplay()/"motor:changed"
            // -- suscribirse acá en vez de ahí generaría un listener
            // nuevo cada vez que se abre este panel (nunca se libera).
            panel._renderStepperCoils(coilsRow, [false, false, false, false]);
            panel._renderStepperAngle(angleLabel, component.stepperShaftAngle || 0);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
