/*
==========================================================
 PitSimulator — ds3231.behavior.js
 RTC DS3231 (I2C): por defecto sigue la hora real de la computadora
 del usuario (tickea sola), pero se puede ajustar desde el panel de
 propiedades con un <input type="datetime-local"> -- el ajuste se
 guarda como un OFFSET relativo a Date.now() (no un valor fijo), así
 que después de ajustarla el reloj simulado sigue corriendo en tiempo
 real desde ese punto, igual que una pila real mantiene el DS3231
 andando. Ver SignalEngine.setDs3231Offset()/_notifyDs3231ToFirmware().

 El setInterval que resincroniza esto hacia el firmware se limpia en
 Renderer.removeComponent (ver el comentario ahí) para no dejar
 timers corriendo contra componentes ya borrados.

 Frecuencia del tick: ds3231.hal.py YA NO necesita un "RTC:" nuevo
 cada segundo para saber la hora -- calcula el paso del tiempo solo
 con time.ticks_ms() entre sincronizaciones (ver _current_epoch()
 ahí). Este tick de acá es solo corrección de deriva para sesiones
 muy largas; el primer valor real llega apenas conecta QEMU (ver
 signal.resync más abajo, y SignalEngine.resyncAllComponents()).
 ANTES mandaba cada 1s sin parar -- BUG REAL (confirmado con SPAM de
 "SyntaxError" sin fin en el REPL): esas líneas "RTC:104:..." solo
 las consume poll_input(), que solo corre mientras hay código
 corriendo -- en cuanto el firmware vuelve al prompt ">>>" (nada
 ejecutando), cada "RTC:" que llegaba se interpretaba como si el
 usuario la hubiera tecleado. Ver la nota grande en ds3231.hal.py.
==========================================================
*/

const DS3231_TICK_MS = 60000;

function _ds3231FormatLocal(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return (
        date.getFullYear() +
        "-" + pad(date.getMonth() + 1) +
        "-" + pad(date.getDate()) +
        "T" + pad(date.getHours()) +
        ":" + pad(date.getMinutes()) +
        ":" + pad(date.getSeconds())
    );
}

ComponentBehaviorRegistry.register("ds3231", {

    signal: {
        // Sincronizar apenas conecta/reconecta QEMU (ver la nota
        // "resync" en ComponentBehaviorRegistry.js) -- sin esto, el
        // firmware arrancaría con _DS_DEFAULT_EPOCH (2025-01-01) hasta
        // el próximo tick de deriva (hasta 60s de espera).
        resync(component, engine) {
            engine._notifyDs3231ToFirmware(component);
        },
    },

    render: {
        initialState(component, renderer) {
            if (component._ds3231TickInterval) return;

            component._ds3231TickInterval = setInterval(() => {
                renderer.simulator.signalEngine._notifyDs3231ToFirmware(component);
            }, DS3231_TICK_MS);
        },
    },

    propertyPanel: {

        render(component, panel) {

            if (!component.properties) component.properties = {};
            const p = component.properties;

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "DS3231 Reloj de Tiempo Real";
            panel.content.appendChild(title);

            const hint = document.createElement("p");
            hint.style.cssText = "font-size:11px; color:#999; margin-bottom:10px;";
            hint.textContent = "Por defecto sigue la hora real de esta computadora. Ajustala acá si tu proyecto necesita otra fecha/hora -- va a seguir corriendo sola desde ese punto.";
            panel.content.appendChild(hint);

            const row = document.createElement("div");
            row.style.cssText = "display:flex; flex-direction:column; gap:6px; margin-bottom: 16px;";

            const input = document.createElement("input");
            input.type = "datetime-local";
            input.step = "1";
            input.style.cssText = "background:#222; color:#fff; border:1px solid #444; border-radius:4px; padding:6px; font-size:12px;";
            input.value = _ds3231FormatLocal(new Date(Date.now() + (p.rtcOffsetMs || 0)));

            input.addEventListener("change", () => {
                if (!input.value) return;
                const chosen = new Date(input.value);
                if (isNaN(chosen.getTime())) return;
                const offsetMs = chosen.getTime() - Date.now();
                panel.simulator.signalEngine.setDs3231Offset(component.id, offsetMs);
            });

            const resetBtn = document.createElement("button");
            resetBtn.textContent = "Usar hora real de la computadora";
            resetBtn.style.cssText = "background:#333; color:#ddd; border:1px solid #444; border-radius:4px; padding:6px; font-size:11px; cursor:pointer;";
            resetBtn.addEventListener("click", () => {
                panel.simulator.signalEngine.setDs3231Offset(component.id, 0);
                input.value = _ds3231FormatLocal(new Date());
            });

            row.appendChild(input);
            row.appendChild(resetBtn);
            panel.content.appendChild(row);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
