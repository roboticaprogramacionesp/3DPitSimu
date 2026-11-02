/*
==========================================================
 PitSimulator — OscilloscopePanel.js

 Osciloscopio simple: grafica en vivo, mientras corre la simulación,
 el estado de UN pin GPIO del primer ESP32 del lienzo -- digital
 (HIGH/LOW) o PWM (duty %), detectado automáticamente según qué haya
 en SignalEngine.pwmStates/driverStates para ese pin en cada muestra.

 Por qué esta herramienta y no otra: 3DPitBlockly (la app hermana,
 para programar una placa REAL) tiene su propio panel de
 "Herramientas" con un "Lector de pines en vivo" -- pero ESE necesita
 hardware real conectado por USB/WebREPL. Acá no hace falta nada de
 eso: todo el estado ya vive en SignalEngine, así que mostrarlo en
 vivo es puro aprovechamiento de que esto YA es una simulación
 completa -- algo que la app hermana no puede ofrecer sin una placa.

 Alcance de esta primera versión -- a propósito NO incluye ADC
 (potenciómetro/joystick/LDR/etc.): esos valores no viven en un dict
 centralizado tipo driverStates/pwmStates, cada componente analógico
 guarda el suyo por separado (joystickState, potRotaryState, etc. en
 SignalEngine.js) y solo se empuja al firmware bajo pedido -- sumarlo
 bien (sin leer directo propiedades internas de cada tipo de
 componente a mano) es un trabajo aparte, no la primera versión de
 esta herramienta.

 Muestreo por POLLING (no eventos) a propósito: "gpio:changed" sí
 existe (ver WasmBridge._applyGpioChange()) pero no hay ningún evento
 equivalente para PWM -- mezclar un camino por evento (GPIO) con uno
 por polling (PWM) en el mismo buffer de muestras complica el dibujo
 sin necesidad real (esto es una herramienta de aprendizaje, no un
 osciloscopio de laboratorio -- no hace falta capturar flancos a
 microsegundos).
==========================================================
*/

class OscilloscopePanel {

    static GPIO_OPTIONS = [
        0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19,
        21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39,
    ];

    static POLL_MS = 80;
    static MAX_SAMPLES = 150; // ~12s de historia a 80ms por muestra

    constructor(simulator) {

        this.simulator = simulator;
        this.open = false;
        this.running = false;
        this._pollTimer = null;
        this._samples = []; // [{ mode: "digital"|"pwm"|"none", value01 }]

        this.buildDOM();
        this.bindEvents();
        this._bindDrag();

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

        const controls = document.createElement("div");
        controls.className = "osc-controls";

        this.pinSelect = document.createElement("select");
        this.pinSelect.className = "osc-pin-select";
        this.pinSelect.innerHTML = `<option value="">-- elegí un GPIO --</option>` +
            OscilloscopePanel.GPIO_OPTIONS.map((n) => `<option value="${n}">GPIO ${n}</option>`).join("");

        this.toggleBtn = document.createElement("button");
        this.toggleBtn.className = "osc-btn osc-btn-toggle";
        this.toggleBtn.textContent = "▶";
        this.toggleBtn.title = "Empezar a graficar";
        this.toggleBtn.disabled = true;

        this.clearBtn = document.createElement("button");
        this.clearBtn.className = "osc-btn osc-btn-clear";
        this.clearBtn.textContent = "🗑";
        this.clearBtn.title = "Limpiar el gráfico";

        controls.appendChild(this.pinSelect);
        controls.appendChild(this.toggleBtn);
        controls.appendChild(this.clearBtn);
        this.body.appendChild(controls);

        this.canvas = document.createElement("canvas");
        this.canvas.className = "osc-canvas";
        this.canvas.width = 300;
        this.canvas.height = 120;
        this.body.appendChild(this.canvas);
        this._ctx = this.canvas.getContext("2d");

        this.readout = document.createElement("div");
        this.readout.className = "osc-readout";
        this.readout.textContent = "Elegí un GPIO para empezar.";
        this.body.appendChild(this.readout);

        this.panel.appendChild(this.header);
        this.panel.appendChild(this.body);

        const workspace = document.getElementById("workspace") || document.body;
        workspace.appendChild(this.panel);

        this._drawEmpty();

    }

    bindEvents() {

        document.getElementById("btnOscilloscopePanelToggle")?.addEventListener("click", () => this.toggle());

        this.closeBtn = this.header.querySelector(".osc-btn-close");
        this.closeBtn.addEventListener("click", () => this.toggle());

        this.header.addEventListener("click", (e) => {
            if (e.target.closest(".osc-btn-close")) return;
            if (this._dragMoved) { this._dragMoved = false; return; }
            this.toggle();
        });

        this.pinSelect.addEventListener("change", () => {
            this._samples = [];
            this.toggleBtn.disabled = !this.pinSelect.value;
            if (this.pinSelect.value && !this.running) this._setRunning(true);
            this._draw();
        });

        this.toggleBtn.addEventListener("click", () => this._setRunning(!this.running));

        this.clearBtn.addEventListener("click", () => {
            this._samples = [];
            this._draw();
        });

        // Mismo criterio que BlePanel/IrRemotePanel -- al detener la
        // simulación no tiene sentido seguir "graficando" un circuito
        // que ya no está corriendo (todo quedaría congelado en el
        // último valor, pero el polling seguiría corriendo en vano).
        this.simulator.eventBus.on("simulation:stopped", () => this._setRunning(false));

    }

    // ====================================================
    // Arranque/parada del polling
    // ====================================================

    _setRunning(running) {

        this.running = running && !!this.pinSelect.value;

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

    _sample() {

        const gpio = parseInt(this.pinSelect.value, 10);
        if (Number.isNaN(gpio)) return;

        const esp32 = this._resolveEsp32();
        if (!esp32) {
            this._pushSample({ mode: "none", value01: 0 });
            this.readout.textContent = "No hay ningún ESP32 en el lienzo.";
            return;
        }

        const key = `${esp32.id}:io${gpio}`;
        const engine = this.simulator.signalEngine;

        const pwm = engine.pwmStates[key];
        if (pwm) {
            const pct = Math.max(0, Math.min(1, pwm.duty / 1023));
            this._pushSample({ mode: "pwm", value01: pct });
            this.readout.textContent = `GPIO ${gpio}: PWM ${(pct * 100).toFixed(0)}% @ ${pwm.freq} Hz`;
            return;
        }

        const digital = engine.driverStates[key];
        this._pushSample({ mode: "digital", value01: digital ? 1 : 0 });
        this.readout.textContent = `GPIO ${gpio}: ${digital ? "HIGH" : "LOW"}`;

    }

    _pushSample(sample) {
        this._samples.push(sample);
        if (this._samples.length > OscilloscopePanel.MAX_SAMPLES) this._samples.shift();
        this._draw();
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

        // Grilla HIGH/LOW de referencia
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

        ctx.beginPath();
        ctx.strokeStyle = "#4da3ff";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";

        this._samples.forEach((s, i) => {
            const x = pad + (startIdx + i) * stepX;
            const y = pad + (1 - s.value01) * (h - pad * 2);
            if (i === 0) ctx.moveTo(x, y);
            else {
                // Escalón (no una rampa suave) -- un cambio de GPIO es
                // instantáneo de verdad, no gradual.
                const prevY = pad + (1 - this._samples[i - 1].value01) * (h - pad * 2);
                ctx.lineTo(x, prevY);
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

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
