/*
==========================================================
 PitSimulator — ky-009.behavior.js
 LED RGB SMD (cátodo común): 3 canales digitales/PWM (r/g/b) + un
 pin común a GND ("com"). Cada canal soporta tanto digital simple
 (Pin.on()/off(), vía driverStates -- ver isKeyConnectedToHighDriver)
 como PWM real (machine.PWM/duty, vía ky-009.hal.py + engine.pwmStates
 -- mismo mecanismo que ya usa buzzer.behavior.js para leer su pin
 "s", solo que acá hay 3 pines en vez de 1 y el resultado es un color
 combinado en vez de un tono).
==========================================================
*/

// Duty de 10 bits (0-1023), igual escala que machine.PWM real de
// MicroPython -- ver ky-009.hal.py. Nombres con prefijo "_ky009_"
// porque .behavior.js se cargan como <script> clásicos (no módulos)
// que comparten un mismo scope global -- ky-016.behavior.js duplica
// esta misma lógica con su propio prefijo "_ky016_" para no chocar.
const _KY009_PWM_MAX_DUTY = 1023;

function _ky009_channelBrightness(component, engine, pinId) {
    const key = `${component.id}:${pinId}`;
    const net = engine.getNet(key);

    for (const netKey of net) {
        const pwm = engine.pwmStates[netKey];
        if (pwm) {
            return Math.max(0, Math.min(1, pwm.duty / _KY009_PWM_MAX_DUTY));
        }
    }

    // Sin PWM activo en ese canal: digital simple (Pin.on()/off()).
    return engine.isKeyConnectedToHighDriver(key) ? 1 : 0;
}

function _ky009_evaluate(component, engine) {
    const lens = component.element?.querySelector('[data-role="rgbled-lens"]');
    if (!lens) return;

    // Sin el común a GND, ningún canal puede cerrar el circuito --
    // mismo criterio que led.behavior.js (catodoGnd), pero acá se
    // aplica a los 3 canales de una.
    const comGnd = engine.isKeyConnectedToGnd(`${component.id}:com`);

    const r = comGnd ? _ky009_channelBrightness(component, engine, "r") : 0;
    const g = comGnd ? _ky009_channelBrightness(component, engine, "g") : 0;
    const b = comGnd ? _ky009_channelBrightness(component, engine, "b") : 0;

    if (r === 0 && g === 0 && b === 0) {
        lens.setAttribute("fill", "#1a1a1a");
        lens.style.filter = "";
    } else {
        const R = Math.round(r * 255);
        const G = Math.round(g * 255);
        const B = Math.round(b * 255);
        lens.setAttribute("fill", `rgb(${R},${G},${B})`);
        lens.style.filter = `drop-shadow(0 0 4px rgb(${R},${G},${B}))`;
    }
}

ComponentBehaviorRegistry.register("ky-009", {

    signal: {
        evaluate: _ky009_evaluate,
    },

    render: {
        initialState(component) {
            const lens = component.element?.querySelector('[data-role="rgbled-lens"]');
            if (lens) lens.setAttribute("fill", "#1a1a1a");
        },
    },

});
