/*
==========================================================
 PitSimulator — pot_rotary.behavior.js
 Potenciómetro rotativo de un solo eje, recortado a ~300° de
 carrera mecánica real (con un "tope" de 60° abajo, igual que un
 potenciómetro real), SIN resorte de centrado: el valor queda
 donde lo dejaste al soltar, igual que pot_slider.

 Arrastre por ÁNGULO ABSOLUTO (a pedido: "que siga al mouse mientras
 lo arrastro dentro de mismo circulo" -- el usuario quiere clickear y
 girar DENTRO de la perilla, no tener que arrastrar afuera del
 componente). Ojo, esto YA se había probado antes y se cambió a un
 arrastre relativo (lineal, arriba/abajo) por dos problemas reales:
   1) Si el click inicial no caía justo donde apunta la marca, la
      perilla "saltaba" de golpe a esa dirección en el primer
      pointermove.
   2) atan2 es inestable cerca del pivote: un arrastre real que pasa
      cerca del centro amplifica cualquier temblor del mouse en
      saltos de ángulo enormes.
 El punto (1) en realidad es el comportamiento CORRECTO y esperado
 para un dial circular (clickear en cualquier punto de la perilla
 "apunta" hacia ahí, igual que un selector de hora circular o un
 volumen tipo perilla) -- el arrastre relativo lo evitaba pero a
 costa de sentirse "desconectado" del mouse, que es justo lo que el
 usuario reportó ahora. El punto (2) sí es un bug real y se resuelve
 con una zona muerta chica alrededor del pivote (MIN_RADIUS): si el
 mouse cae ahí adentro simplemente se ignora ese evento (se mantiene
 el último ángulo válido) en vez de calcular un atan2 con un radio
 casi cero.

 Convención: 0° = perilla apuntando hacia arriba (12 en punto),
 positivo = sentido horario. Rango útil: -150°..+150° (300° de
 carrera), con el hueco de 60° centrado abajo representando el tope
 mecánico que un potenciómetro real tiene y un encoder no.
==========================================================
*/

// El pivote de rotación siempre fue el CENTRO VISUAL de la perilla
// (cx=25, cy=23 en pot_rotary.svg), no necesariamente el centro de
// la zona de click -- antes coincidían porque el hitzone era un
// <circle> centrado ahí mismo. Ahora que el hitzone es un <rect>
// más grande (ver el fix grande en el .svg), su propio centro
// geométrico YA NO es necesariamente el de la perilla si algún día
// se lo agranda de forma asimétrica -- por eso el pivote se calcula
// leyendo el elemento data-role="pot-indicator" (que sí sigue
// centrado en la perilla real vía su atributo rotate() actual) en
// vez de derivarlo del hitzone. Concretamente: se usa el x1/y1 de la
// línea del indicador, que es el propio pivote de su rotate().
function _potPivot(indicator) {
    const line = indicator.querySelector("line");
    if (line) {
        return { cx: parseFloat(line.getAttribute("x1")), cy: parseFloat(line.getAttribute("y1")) };
    }
    // Respaldo: centro geométrico del hitzone (rect o circle).
    return null;
}

// BUG real encontrado (a pedido: "el limite debe ser en digamos ahi
// donde empieza es como 205 y el final como 315", o sea el hueco
// mecánico se veía en el lugar equivocado): el <line> del indicador
// en pot_rotary.svg, SIN rotar, no apunta hacia arriba -- apunta
// hacia abajo-izquierda (x1=25,y1=23 -> x2=19,y2=30). Como
// rotate(angle) rota esa dirección NATIVA, no "arriba", el hueco de
// 300°/-150°..+150° terminaba centrado arriba-derecha en vez de
// abajo, aunque el código (y su propio comentario) siempre asumió
// "0°=arriba". Este offset mide el ángulo real de reposo del <line>
// (en el mismo sistema 0=arriba/horario+ que usa el resto del
// archivo) y lo resta antes de rotar, así "angle" SIEMPRE representa
// la dirección visual real sin importar hacia dónde apunte el <line>
// dibujado en el .svg.
function _potBaseOffset(indicator, cx, cy) {
    const line = indicator.querySelector("line");
    if (!line) return 0;
    const tipX = parseFloat(line.getAttribute("x2"));
    const tipY = parseFloat(line.getAttribute("y2"));
    return Math.atan2(tipX - cx, -(tipY - cy)) * (180 / Math.PI);
}

const POT_MIN_ANGLE = -150;
const POT_MAX_ANGLE = 150;

ComponentBehaviorRegistry.register("pot_rotary", {

    render: {

        tag(component, graphic, renderer) {

            const hitzone = graphic.querySelector('[data-role="pot-hitzone"]');
            const indicator = graphic.querySelector('[data-role="pot-indicator"]');

            if (!hitzone || !indicator) {
                console.warn(`[pot_rotary.behavior] Faltan elementos en el SVG de ${component.id}`);
                return;
            }

            const pivot = _potPivot(indicator) || { cx: 25, cy: 23 };
            const cx = pivot.cx;
            const cy = pivot.cy;
            const baseOffset = _potBaseOffset(indicator, cx, cy);

            const MIN_ANGLE = POT_MIN_ANGLE;
            const MAX_ANGLE = POT_MAX_ANGLE;

            // Arranca en el tope MÍNIMO (marca roja izquierda), no en
            // el centro -- a pedido: "ahorita esta empezando en el
            // centro pero los limites deben ser en las lineas
            // mostradas de rojo". Un pot recién colocado en el
            // circuito arranca "en cero" (0%), no a mitad de camino.
            if (typeof component.potRotaryAngle !== "number") {
                component.potRotaryAngle = MIN_ANGLE;
            }

            const applyAngle = (angle) => {
                indicator.setAttribute("transform", `rotate(${angle - baseOffset}, ${cx}, ${cy})`);
            };

            const angleToN01 = (angle) => (angle - MIN_ANGLE) / (MAX_ANGLE - MIN_ANGLE);

            applyAngle(component.potRotaryAngle);

            // Radio (en unidades locales del SVG) alrededor del
            // pivote donde NO se recalcula el ángulo -- ver comentario
            // grande arriba del archivo. La perilla visible tiene
            // radio 15-16, así que 4 unidades es una zona chica
            // (menos de 1/3 del radio) que casi nunca se nota en un
            // arrastre real, pero alcanza para eliminar el ruido de
            // atan2 cerca del centro.
            const MIN_RADIUS = 4;

            let dragging = false;

            const toLocalPoint = (e) => {
                const svg = hitzone.ownerSVGElement;
                const pt = svg.createSVGPoint();
                pt.x = e.clientX;
                pt.y = e.clientY;
                const ctm = hitzone.getScreenCTM();
                if (!ctm) return { x: cx, y: cy };
                return pt.matrixTransform(ctm.inverse());
            };

            // Compartido entre pointerdown y pointermove: clickear
            // debe "apuntar" de una, no hace falta mover el mouse
            // primero (mismo criterio que un selector de hora
            // circular).
            const updateFromPointer = (e) => {
                const p = toLocalPoint(e);
                const dx = p.x - cx;
                const dy = p.y - cy;

                if (Math.hypot(dx, dy) < MIN_RADIUS) return;

                // 0° = arriba, horario positivo.
                let angle = Math.atan2(dx, -dy) * (180 / Math.PI);

                if (angle > MAX_ANGLE) angle = MAX_ANGLE;
                if (angle < MIN_ANGLE) angle = MIN_ANGLE;

                component.potRotaryAngle = angle;
                applyAngle(angle);

                renderer.simulator.signalEngine.setPotRotaryValue(component, angleToN01(angle));
            };

            const start = (e) => {
                if (component.locked) return;
                // Mismo fix que bindSlider/bindJoystick -- sin esto el
                // pointerdown se filtra hacia DragManager y arrastra
                // todo el componente en vez de solo la perilla.
                e.stopPropagation();
                e.preventDefault();
                dragging = true;
                updateFromPointer(e);
                try {
                    hitzone.setPointerCapture(e.pointerId);
                } catch (err) {}
            };

            const move = (e) => {
                if (!dragging || component.locked) return;
                e.stopPropagation();
                updateFromPointer(e);
            };

            const end = (e) => {
                if (!dragging) return;
                e.stopPropagation();
                dragging = false;
                // SIN resorte -- se queda donde quedó, igual que
                // pot_slider.
                try {
                    hitzone.releasePointerCapture(e.pointerId);
                } catch (err) {}
            };

            hitzone.addEventListener("pointerdown", start);
            hitzone.addEventListener("pointermove", move);
            hitzone.addEventListener("pointerup", end);
            hitzone.addEventListener("pointercancel", end);

        },

        initialState(component) {
            const indicator = component.element?.querySelector('[data-role="pot-indicator"]');
            if (!indicator) return;

            const pivot = _potPivot(indicator) || { cx: 25, cy: 23 };
            const cx = pivot.cx;
            const cy = pivot.cy;
            const baseOffset = _potBaseOffset(indicator, cx, cy);
            const angle = typeof component.potRotaryAngle === "number" ? component.potRotaryAngle : POT_MIN_ANGLE;

            indicator.setAttribute("transform", `rotate(${angle - baseOffset}, ${cx}, ${cy})`);
        },

    },

});
