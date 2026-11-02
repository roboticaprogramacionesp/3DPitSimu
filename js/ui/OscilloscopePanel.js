/*
==========================================================
 PitSimulator — OscilloscopePanel.js

 Osciloscopio: grafica en vivo, mientras corre la simulación, hasta 4
 canales a la vez -- cada uno, el estado de un GPIO del primer ESP32
 del lienzo. Detecta solo el tipo de señal de cada canal según qué
 haya para ese pin en SignalEngine (en ese orden): ADC (sensor
 analógico -- potenciómetro/joystick/LDR/etc., vía
 SignalEngine.adcStates), PWM (duty %, vía pwmStates), o digital
 (HIGH/LOW, vía driverStates).

 Por qué esta herramienta y no otra: 3DPitBlockly (la app hermana,
 para programar una placa REAL) tiene su propio panel de
 "Herramientas" con un "Lector de pines en vivo" -- pero ESE necesita
 hardware real conectado por USB/WebREPL. Acá no hace falta nada de
 eso: todo el estado ya vive en SignalEngine, así que mostrarlo en
 vivo es puro aprovechamiento de que esto YA es una simulación
 completa -- algo que la app hermana no puede ofrecer sin una placa.

 Alcance, a propósito:
 - Un solo ESP32 (el primero del lienzo) -- sin selector de placa
   para proyectos multi-ESP32.
 - Muestreo por POLLING (no eventos) -- "gpio:changed" sí existe pero
   no hay evento equivalente para PWM/ADC, y mezclar evento+polling
   en el mismo buffer complica el dibujo sin necesidad real para una
   herramienta de aprendizaje (no un osciloscopio de laboratorio --
   no hace falta capturar flancos a microsegundos).
 - adcStates (ver SignalEngine.js) es el ÚLTIMO valor que algún
   sensor analógico empujó al firmware -- si nadie todavía corrió
   código que lo lea, puede no existir ninguna entrada ahí todavía
   aunque el sensor esté bien cableado (recién se llena la primera
   vez que el usuario mueve el control del sensor en el panel de
   propiedades).
==========================================================
*/

class OscilloscopePanel {

    static GPIO_OPTIONS = [
        0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19,
        21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39,
    ];

    static COLORS = ["#4da3ff", "#ffaa00", "#00ff88", "#ff5fa2"];
    static MAX_CHANNELS = OscilloscopePanel.COLORS.length;

    static POLL_MS = 80;
    static MAX_SAMPLES = 150; // ~12s de historia a 80ms por muestra

    constructor(simulator) {

        this.simulator = simulator;
        this.open = false;
        this.running = false;
        this._pollTimer = null;
        this._nextChannelId = 1;
        this.channels = [this._makeChannel()]; // arranca con 1 canal
        this._samples = []; // [{ [channelId]: { mode, value01, raw?, freq? } }]

        this.buildDOM();
        this.bindEvents();
        this._bindDrag();

    }

    _makeChannel() {
        const id = this._nextChannelId++;
        const color = OscilloscopePanel.COLORS[(id - 1) % OscilloscopePanel.COLORS.length];
        return { id, gpio: null, color };
    }

    // ====================================================
    // DOM
    // ====================================================

    buildDOM() {

        this.panel = document.createElement("div");
        this.panel.id = "oscilloscopePanel";
        this.panel.className = "osc-panel osc-closed";

        this.header = document.createElement("div");
        this.header.className = "osc-header";
        this.header.innerHTML = `
            <div class="osc-header-left">
                <span class="osc-icon">📈</span>
                <span class="osc-title">Osciloscopio</span>
            </div>
            <button class="osc-btn-close" title="Cerrar">✕</button>
        `;

        this.body = document.createElement("div");
        this.body.className = "osc-body";

        this.channelsList = document.createElement("div");
        this.channelsList.className = "osc-channels";
        this.body.appendChild(this.channelsList);

        this.addChannelBtn = document.createElement("button");
        this.addChannelBtn.className = "osc-add-channel";
        this.addChannelBtn.textContent = "+ Canal";
        this.addChannelBtn.title = "Agregar otro canal para comparar señales";
        this.body.appendChild(this.addChannelBtn);

        const controls = document.createElement("div");
        controls.className = "osc-controls";

        this.toggleBtn = document.createElement("button");
        this.toggleBtn.className = "osc-btn osc-btn-toggle";
        this.toggleBtn.textContent = "▶";
        this.toggleBtn.title = "Empezar a graficar";
        this.toggleBtn.disabled = true;

        this.clearBtn = document.createElement("button");
        this.clearBtn.className = "osc-btn osc-btn-clear";
        this.clearBtn.textContent = "🗑";
        this.clearBtn.title = "Limpiar el gráfico";

        this.exportBtn = document.createElement("button");
        this.exportBtn.className = "osc-btn osc-btn-export";
        this.exportBtn.textContent = "💾";
        this.exportBtn.title = "Guardar el gráfico como imagen PNG";

        controls.appendChild(this.toggleBtn);
        controls.appendChild(this.clearBtn);
        controls.appendChild(this.exportBtn);
        this.body.appendChild(controls);

        this.canvas = document.createElement("canvas");
        this.canvas.className = "osc-canvas";
        this.canvas.width = 300;
        this.canvas.height = 120;
        this.body.appendChild(this.canvas);
        this._ctx = this.canvas.getContext("2d");

        this.statsBox = document.createElement("div");
        this.statsBox.className = "osc-stats";
        this.body.appendChild(this.statsBox);

        this.panel.appendChild(this.header);
        this.panel.appendChild(this.body);

        const workspace = document.getElementById("workspace") || document.body;
        workspace.appendChild(this.panel);

        this._renderChannelRows();
        this._drawEmpty();

    }

    // Un <select> de GPIO + swatch de color + ✕ por canal -- se
    // vuelve a armar entero cada vez que se agrega/saca un canal (la
    // lista nunca es tan larga, MAX_CHANNELS=4, no vale la pena un
    // diff más fino acá).
    _renderChannelRows() {

        this.channelsList.innerHTML = "";

        this.channels.forEach((ch) => {

            const row = document.createElement("div");
            row.className = "osc-channel-row";

            const swatch = document.createElement("span");
            swatch.className = "osc-channel-color";
            swatch.style.background = ch.color;
            row.appendChild(swatch);

            const select = document.createElement("select");
            select.className = "osc-pin-select";
            select.innerHTML = `<option value="">-- GPIO --</option>` +
                OscilloscopePanel.GPIO_OPTIONS.map((n) => `<option value="${n}">GPIO ${n}</option>`).join("");
            select.value = ch.gpio ?? "";
            select.addEventListener("change", () => {
                ch.gpio = select.value ? parseInt(select.value, 10) : null;
                this._samples = [];
                this._updateToggleAvailability();
                this._draw();
            });
            row.appendChild(select);

            // Sacar el PRIMER canal no tiene sentido si es el único --
            // siempre queda al menos uno.
            if (this.channels.length > 1) {
                const removeBtn = document.createElement("button");
                removeBtn.className = "osc-channel-remove";
                removeBtn.textContent = "✕";
                removeBtn.title = "Sacar este canal";
                removeBtn.addEventListener("click", () => {
                    this.channels = this.channels.filter((c) => c.id !== ch.id);
                    this._samples = [];
                    this._renderChannelRows();
                    this._updateToggleAvailability();
                    this._draw();
                });
                row.appendChild(removeBtn);
            }

            this.channelsList.appendChild(row);

        });

        this.addChannelBtn.disabled = this.channels.length >= OscilloscopePanel.MAX_CHANNELS;

    }

    bindEvents() {

        // El botón que abre/cierra este panel vive en el menú 🧰
        // "Herramientas de simulación" (ver Toolbar.bindSimToolsMenu()),
        // no acá -- ese botón llama a toggle() directo sobre
        // window.oscilloscopePanel.

        this.closeBtn = this.header.querySelector(".osc-btn-close");
        this.closeBtn.addEventListener("click", () => this.toggle());

        this.header.addEventListener("click", (e) => {
            if (e.target.closest(".osc-btn-close")) return;
            if (this._dragMoved) { this._dragMoved = false; return; }
            this.toggle();
        });

        this.addChannelBtn.addEventListener("click", () => {
            if (this.channels.length >= OscilloscopePanel.MAX_CHANNELS) return;
            this.channels.push(this._makeChannel());
            this._renderChannelRows();
        });

        this.toggleBtn.addEventListener("click", () => this._setRunning(!this.running));

        this.clearBtn.addEventListener("click", () => {
            this._samples = [];
            this._draw();
        });

        this.exportBtn.addEventListener("click", () => this._exportPng());

        // Mismo criterio que BlePanel/IrRemotePanel -- al detener la
        // simulación no tiene sentido seguir "graficando" un circuito
        // que ya no está corriendo (todo quedaría congelado en el
        // último valor, pero el polling seguiría corriendo en vano).
        this.simulator.eventBus.on("simulation:stopped", () => this._setRunning(false));

    }

    _updateToggleAvailability() {
        const anyPin = this.channels.some((c) => c.gpio !== null);
        this.toggleBtn.disabled = !anyPin;
        if (!anyPin) this._setRunning(false);
        else if (!this.running) this._setRunning(true);
    }

    // ====================================================
    // Arranque/parada del polling
    // ====================================================

    _setRunning(running) {

        this.running = running && this.channels.some((c) => c.gpio !== null);

        this.toggleBtn.textContent = this.running ? "⏸" : "▶";
        this.toggleBtn.title = this.running ? "Pausar" : "Empezar a graficar";

        clearInterval(this._pollTimer);
        this._pollTimer = null;

        if (this.running) {
            this._pollTimer = setInterval(() => this._sample(), OscilloscopePanel.POLL_MS);
        }

    }

    _resolveEsp32() {
        // Primer ESP32 del lienzo -- mismo criterio/limitación que
        // otras herramientas de esta sesión (IR/micrófono): un
        // selector de placa para multi-ESP32 queda fuera de esta
        // primera versión.
        return this.simulator.componentManager.getAll().find((c) => c.type.startsWith("esp32")) || null;
    }

    // Orden de detección -- ADC primero: un sensor analógico empuja
    // su valor por "ADC:" sin tocar driverStates/pwmStates para nada,
    // así que si hay una entrada reciente ahí, es casi seguro la señal
    // real de ese pin (en la práctica un mismo GPIO se usa para una
    // sola cosa por vez, pero por las dudas se prueba ADC -> PWM ->
    // digital en ese orden).
    _sampleChannel(channel, esp32) {

        if (channel.gpio === null || !esp32) return { mode: "none", value01: 0 };

        const key = `${esp32.id}:io${channel.gpio}`;
        const engine = this.simulator.signalEngine;

        if (key in engine.adcStates) {
            const raw = engine.adcStates[key]; // u16, 0-65535
            const value01 = Math.max(0, Math.min(1, raw / 65535));
            return { mode: "adc", value01, raw, volts: value01 * 3.3 };
        }

        const pwm = engine.pwmStates[key];
        if (pwm) {
            const value01 = Math.max(0, Math.min(1, pwm.duty / 1023));
            return { mode: "pwm", value01, freq: pwm.freq };
        }

        const digital = engine.driverStates[key];
        return { mode: "digital", value01: digital ? 1 : 0 };

    }

    _sample() {

        const esp32 = this._resolveEsp32();
        const sample = {};

        this.channels.forEach((ch) => {
            sample[ch.id] = this._sampleChannel(ch, esp32);
        });

        this._samples.push(sample);
        if (this._samples.length > OscilloscopePanel.MAX_SAMPLES) this._samples.shift();

        this._draw();
        this._updateStats(!esp32);

    }

    // ====================================================
    // Estadísticas por canal (mín/máx + frecuencia para digital/PWM) --
    // sobre la ventana de muestras que hay ahora mismo en el buffer,
    // no un tiempo fijo (el buffer puede no estar lleno todavía).
    // ====================================================

    _updateStats(noEsp32) {

        this.statsBox.innerHTML = "";

        if (noEsp32) {
            const row = document.createElement("div");
            row.className = "osc-stat-row";
            row.textContent = "No hay ningún ESP32 en el lienzo.";
            this.statsBox.appendChild(row);
            return;
        }

        const windowSeconds = (this._samples.length * OscilloscopePanel.POLL_MS) / 1000;

        this.channels.forEach((ch) => {

            if (ch.gpio === null) return;

            const series = this._samples.map((s) => s[ch.id]).filter(Boolean);
            if (series.length === 0) return;

            const last = series[series.length - 1];
            const row = document.createElement("div");
            row.className = "osc-stat-row";

            const dot = document.createElement("span");
            dot.className = "osc-stat-dot";
            dot.style.background = ch.color;
            row.appendChild(dot);

            const text = document.createElement("span");

            if (last.mode === "adc") {
                const volts = series.map((s) => s.volts);
                const min = Math.min(...volts).toFixed(2);
                const max = Math.max(...volts).toFixed(2);
                text.textContent = `GPIO ${ch.gpio} (ADC): ${last.volts.toFixed(2)}V -- rango ${min}V a ${max}V`;
            } else if (last.mode === "pwm") {
                const freqHz = this._countTransitions(series) / Math.max(0.001, windowSeconds);
                text.textContent = `GPIO ${ch.gpio} (PWM): ${(last.value01 * 100).toFixed(0)}% @ ${last.freq} Hz` +
                    (series.length > 3 ? ` -- duty cambia ≈${freqHz.toFixed(1)} veces/s` : "");
            } else if (last.mode === "digital") {
                const freqHz = this._countTransitions(series) / Math.max(0.001, windowSeconds) / 2;
                text.textContent = `GPIO ${ch.gpio}: ${last.value01 ? "HIGH" : "LOW"}` +
                    (series.length > 3 && freqHz > 0.05 ? ` -- parpadea ≈${freqHz.toFixed(2)} Hz` : "");
            } else {
                text.textContent = `GPIO ${ch.gpio}: sin señal (LOW, o todavía sin usar)`;
            }

            row.appendChild(text);
            this.statsBox.appendChild(row);

        });

    }

    // Cantidad de cambios de valor01 dentro de la serie -- un ciclo
    // completo HIGH->LOW->HIGH son 2 transiciones, por eso digital
    // divide /2 arriba para pasar de "transiciones" a "ciclos" (Hz).
    _countTransitions(series) {
        let count = 0;
        for (let i = 1; i < series.length; i++) {
            if (series[i].value01 !== series[i - 1].value01) count++;
        }
        return count;
    }

    // ====================================================
    // Dibujo (canvas 2D, sin librerías -- mismo criterio que el
    // resto del proyecto para gráficos simples, ver Renderer.js)
    // ====================================================

    _drawEmpty() {
        const ctx = this._ctx;
        const { width: w, height: h } = this.canvas;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#12121f";
        ctx.fillRect(0, 0, w, h);
    }

    _draw() {

        const ctx = this._ctx;
        const { width: w, height: h } = this.canvas;
        const pad = 8;

        this._drawEmpty();

        // Grilla de referencia (0% / 50% / 100% de la escala de cada
        // canal -- no un voltaje fijo, cada canal puede estar en una
        // escala distinta: HIGH/LOW, % de duty, o volts de ADC).
        ctx.strokeStyle = "#2d2d4e";
        ctx.lineWidth = 1;
        [0, 0.5, 1].forEach((frac) => {
            const y = pad + (1 - frac) * (h - pad * 2);
            ctx.beginPath();
            ctx.moveTo(pad, y);
            ctx.lineTo(w - pad, y);
            ctx.stroke();
        });

        if (this._samples.length < 2) return;

        const stepX = (w - pad * 2) / (OscilloscopePanel.MAX_SAMPLES - 1);
        const startIdx = OscilloscopePanel.MAX_SAMPLES - this._samples.length;

        this.channels.forEach((ch) => {

            if (ch.gpio === null) return;

            ctx.beginPath();
            ctx.strokeStyle = ch.color;
            ctx.lineWidth = 2;
            ctx.lineJoin = "round";

            let started = false;
            let prevValue01 = null;

            this._samples.forEach((sample, i) => {

                const point = sample[ch.id];
                if (!point) { started = false; return; } // hueco (canal agregado a mitad de camino)

                const x = pad + (startIdx + i) * stepX;
                const y = pad + (1 - point.value01) * (h - pad * 2);

                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    // Escalón (no una rampa suave) -- fiel para
                    // digital/PWM (un cambio real es instantáneo); para
                    // ADC es una aproximación razonable dado el muestreo
                    // cada 80ms, no hace falta una curva suavizada.
                    const prevY = pad + (1 - prevValue01) * (h - pad * 2);
                    ctx.lineTo(x, prevY);
                    ctx.lineTo(x, y);
                }

                prevValue01 = point.value01;

            });

            ctx.stroke();

        });

    }

    _exportPng() {
        const url = this.canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = url;
        a.download = `osciloscopio_${Date.now()}.png`;
        a.click();
    }

    // ====================================================
    // Abrir/cerrar
    // ====================================================

    toggle() {
        this.open = !this.open;
        this.panel.classList.toggle("osc-closed", !this.open);
        if (this.open) this._draw();
    }

    // ====================================================
    // Arrastrar el panel -- mismo mecanismo que IrRemotePanel._bindDrag().
    // ====================================================

    _bindDrag() {

        const header = this.header;
        const workspaceEl = document.getElementById("workspace") || document.body;

        let dragging = false;
        let startX = 0, startY = 0, startLeft = 0, startTop = 0;

        header.addEventListener("pointerdown", (e) => {

            if (e.target.closest(".osc-btn-close")) return;

            dragging = true;
            this._dragMoved = false;

            const panelRect = this.panel.getBoundingClientRect();
            const parentRect = workspaceEl.getBoundingClientRect();

            startX = e.clientX;
            startY = e.clientY;
            startLeft = panelRect.left - parentRect.left;
            startTop  = panelRect.top  - parentRect.top;

            header.setPointerCapture(e.pointerId);
            this.panel.classList.add("dragging");

        });

        header.addEventListener("pointermove", (e) => {

            if (!dragging) return;

            if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) {
                this._dragMoved = true;
            }

            const parentRect = workspaceEl.getBoundingClientRect();

            let newLeft = startLeft + (e.clientX - startX);
            let newTop  = startTop  + (e.clientY - startY);

            const maxLeft = Math.max(4, parentRect.width  - this.panel.offsetWidth  - 4);
            const maxTop  = Math.max(4, parentRect.height - this.panel.offsetHeight - 4);

            newLeft = Utils.clamp(newLeft, 4, maxLeft);
            newTop  = Utils.clamp(newTop,  4, maxTop);

            this.panel.style.left  = `${newLeft}px`;
            this.panel.style.top   = `${newTop}px`;
            this.panel.style.right = "auto";

        });

        header.addEventListener("pointerup", (e) => {
            dragging = false;
            this.panel.classList.remove("dragging");
            try { header.releasePointerCapture(e.pointerId); } catch (err) { /* ya liberado */ }
        });

        const reclamp = () => {

            if (this.panel.style.left === "") return;

            const parentRect = workspaceEl.getBoundingClientRect();
            const maxLeft = Math.max(4, parentRect.width  - this.panel.offsetWidth  - 4);
            const maxTop  = Math.max(4, parentRect.height - this.panel.offsetHeight - 4);

            const curLeft = parseFloat(this.panel.style.left) || 0;
            const curTop  = parseFloat(this.panel.style.top)  || 0;

            this.panel.style.left = `${Utils.clamp(curLeft, 4, maxLeft)}px`;
            this.panel.style.top  = `${Utils.clamp(curTop,  4, maxTop)}px`;

        };

        new ResizeObserver(reclamp).observe(workspaceEl);

    }

}
