/*
==========================================================
 PitSimulator — ky-011.behavior.js
 LED bicolor (cátodo común): idéntica lógica eléctrica que
 ky-009.behavior.js/ky-016.behavior.js (PWM o digital simple por
 canal, ver esos archivos para el detalle), pero con solo 2 canales
 (R/G) en vez de 3 -- prefijo propio ("_ky011_") por el mismo motivo
 que ky-016 (los .behavior.js comparten scope global).

 Visual: en vez de un óvalo propio agregado (ver la lección de
 ky-016 sobre "no uses una ellipse suelta, usá el domo real"), acá se
 recolorean TODOS los elementos "color_*" dentro de #led -- el domo
 real del asset Fritzing (keyes_ky-011). Esos elementos ya vienen con
 fill dentro de su propio style="...", así que hay que pisar
 el.style.fill (no setAttribute("fill",...), que quedaría tapado por
 el style inline -- ver la misma lección de ky-016).
==========================================================
*/

const _KY011_PWM_MAX_DUTY = 1023;

function _ky011_channelBrightness(component, engine, pinId) {
    const key = `${component.id}:${pinId}`;
    const net = engine.getNet(key);

    for (const netKey of net) {
        const pwm = engine.pwmStates[netKey];
        if (pwm) {
            return Math.max(0, Math.min(1, pwm.duty / _KY011_PWM_MAX_DUTY));
        }
    }

    return engine.isKeyConnectedToHighDriver(key) ? 1 : 0;
}

function _ky011_getLedParts(component) {
    if (component._ky011LedParts) return component._ky011LedParts;

    const parts = Array.from(
        component.element?.querySelectorAll('#led [id^="color_"]') || []
    ).map((el) => ({
        el,
        originalFill: el.style.fill || el.getAttribute('fill') || null,
    }));

    component._ky011LedParts = parts;
    return parts;
}

function _ky011_evaluate(component, engine) {
    const parts = _ky011_getLedParts(component);
    if (!parts.length) return;

    const comGnd = engine.isKeyConnectedToGnd(`${component.id}:com`);

    const r = comGnd ? _ky011_channelBrightness(component, engine, "r") : 0;
    const g = comGnd ? _ky011_channelBrightness(component, engine, "g") : 0;

    if (r === 0 && g === 0) {
        parts.forEach(({ el, originalFill }) => {
            el.style.fill = originalFill || "";
        });
    } else {
        const R = Math.round(r * 255);
        const G = Math.round(g * 255);
        const color = `rgb(${R},${G},0)`;
        parts.forEach(({ el }) => {
            el.style.fill = color;
        });
    }
}

ComponentBehaviorRegistry.register("ky-011", {

    signal: {
        evaluate: _ky011_evaluate,
    },

});
