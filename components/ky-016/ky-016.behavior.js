/*
==========================================================
 PitSimulator — ky-016.behavior.js
 LED RGB de orificio pasante (cátodo común): idéntica lógica
 eléctrica a ky-009.behavior.js (mismo pinout r/g/b/com) -- ver ese
 archivo para el detalle. Se duplica acá con prefijo propio
 ("_ky016_") en vez de compartir código porque los .behavior.js se
 cargan como <script> clásicos (no módulos) en un mismo scope global,
 y dos archivos con el mismo nombre de función/const chocarían si
 ambos componentes conviven en el mismo circuito.

 FIX real (a pedido: "usemos el id led_rgb, es el encapsulado del
 led -- no uses esa ellipse, es solo un círculo de abajo"): antes se
 pintaba SOLO ellipse5467 (un disco de fondo dentro del grupo), que
 en el orden de dibujo del SVG queda TAPADO por los polígonos grises
 opacos (las patillas/reflector, dibujados encima) -- el resultado
 visible era un anillo de color asomando detrás de las patillas, no
 "el LED entero prendido". Ahora se recolorean TODOS los elementos
 con relleno propio dentro de #led_rgb (el domo completo real del
 LED), preservando la opacidad propia de cada capa -- así se ve como
 un domo iluminado de verdad, no un círculo suelto.
==========================================================
*/

const _KY016_PWM_MAX_DUTY = 1023;

function _ky016_channelBrightness(component, engine, pinId) {
    const key = `${component.id}:${pinId}`;
    const net = engine.getNet(key);

    for (const netKey of net) {
        const pwm = engine.pwmStates[netKey];
        if (pwm) {
            return Math.max(0, Math.min(1, pwm.duty / _KY016_PWM_MAX_DUTY));
        }
    }

    return engine.isKeyConnectedToHighDriver(key) ? 1 : 0;
}

function _ky016_getLedParts(component) {
    if (component._ky016LedParts) return component._ky016LedParts;

    const group = component.element?.querySelector('#led_rgb');
    if (!group) return null;

    // Cachear el fill ORIGINAL de cada capa (atributo o style, ver
    // la nota sobre inline style vs setAttribute) antes de tocar
    // nada, para poder restaurarlo exacto cuando el LED se apaga.
    const parts = Array.from(group.querySelectorAll('path, ellipse, polygon')).map((el) => ({
        el,
        originalFill: el.style.fill || el.getAttribute('fill') || null,
    }));

    component._ky016LedParts = { group, parts };
    return component._ky016LedParts;
}

function _ky016_evaluate(component, engine) {
    const ledData = _ky016_getLedParts(component);
    if (!ledData) return;

    const comGnd = engine.isKeyConnectedToGnd(`${component.id}:com`);

    const r = comGnd ? _ky016_channelBrightness(component, engine, "r") : 0;
    const g = comGnd ? _ky016_channelBrightness(component, engine, "g") : 0;
    const b = comGnd ? _ky016_channelBrightness(component, engine, "b") : 0;

    if (r === 0 && g === 0 && b === 0) {
        ledData.parts.forEach(({ el, originalFill }) => {
            el.style.fill = originalFill || "";
        });
        ledData.group.style.filter = "";
    } else {
        const R = Math.round(r * 255);
        const G = Math.round(g * 255);
        const B = Math.round(b * 255);
        const color = `rgb(${R},${G},${B})`;
        ledData.parts.forEach(({ el }) => {
            el.style.fill = color;
        });
        ledData.group.style.filter = `drop-shadow(0 0 4px ${color})`;
    }
}

ComponentBehaviorRegistry.register("ky-016", {

    signal: {
        evaluate: _ky016_evaluate,
    },

    render: {
        initialState(component) {
            // Nada que hacer acá: los fills originales de #led_rgb ya
            // vienen correctos desde el propio SVG -- solo hace falta
            // evaluar (arriba) cuando el circuito realmente prenda un
            // canal.
        },
    },

});
