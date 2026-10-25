/*
==========================================================
 PitSimulator — IrRemotePanel.js

 "Control remoto virtual" para el KY-022 (receptor infrarrojo) --
 mismo espíritu que BlePanel.js (simular un periférico inalámbrico
 real sin tener hardware real de por medio), pero MÁS simple: un
 control remoto IR es BROADCAST, no hay "emparejamiento" como en BLE
 -- cualquier receptor en línea de vista lo recibe. Por eso este
 panel no tiene selector de dispositivo ni botón "Conectar": cada
 botón, al tocarlo, le manda su código a TODOS los KY-022 bien
 cableados y alimentados del lienzo (ver
 SignalEngine.broadcastIrCode()).

 Protocolo real: ver components_wasm/_ir_rx_wasm.py (por qué NO se
 simulan los pulsos NEC reales a nivel de microsegundos) y
 SignalEngine.sendIrCode()/_resolveKy022Gpio() (protocolo
 "IRRX:<gpio>:<addr>:<cmd>", navegador -> firmware).

 Códigos: addr fijo en 0, cmd arbitrario por botón (no son los
 códigos NEC reales de ningún control físico puntual -- no hace
 falta que coincidan con un control de verdad, nada acá sale por
 infrarrojo de verdad). Layout de botones igual al control que
 suele venir con el KY-022 (flechas + OK, teclado 0-9, * y #).
==========================================================
*/

class IrRemotePanel {

    // addr fijo (0) -- un solo "control" simulado, no hace falta
    // distinguir fabricante/dispositivo como sí pasa con un NEC real.
    static ADDR = 0;

    static BUTTONS = [
        // fila 1: flechas + OK, en cruz (grid-area via CSS, ver ir-remote-panel.css)
        { label: "▲", cmd: 10, area: "up" },
        { label: "◀", cmd: 12, area: "left" },
        { label: "OK", cmd: 14, area: "ok" },
        { label: "▶", cmd: 13, area: "right" },
        { label: "▼", cmd: 11, area: "down" },
        // teclado numérico + */#
        { label: "1", cmd: 1, area: "k1" },
        { label: "2", cmd: 2, area: "k2" },
        { label: "3", cmd: 3, area: "k3" },
        { label: "4", cmd: 4, area: "k4" },
        { label: "5", cmd: 5, area: "k5" },
        { label: "6", cmd: 6, area: "k6" },
        { label: "7", cmd: 7, area: "k7" },
        { label: "8", cmd: 8, area: "k8" },
        { label: "9", cmd: 9, area: "k9" },
        { label: "*", cmd: 15, area: "kstar" },
        { label: "0", cmd: 0, area: "k0" },
        { label: "#", cmd: 16, area: "khash" },
    ];

    constructor(simulator) {

        this.simulator = simulator;
        this.open = false;

        this.buildDOM();
        this.bindEvents();
        this._bindDrag();

    }

    buildDOM() {

        this.panel = document.createElement("div");
        this.panel.id = "irRemotePanel";
        this.panel.className = "ir-panel ir-closed";

        this.header = document.createElement("div");
        this.header.className = "ir-header";
        this.header.innerHTML = `
            <div class="ir-header-left">
                <span class="ir-icon">📡</span>
                <span class="ir-title">Control remoto virtual (IR)</span>
            </div>
            <button class="ir-btn-close" title="Cerrar">✕</button>
        `;

        this.body = document.createElement("div");
        this.body.className = "ir-body";

        const hint = document.createElement("div");
        hint.className = "ir-hint";
        hint.textContent = "Cada botón le manda su código a todos los KY-022 cableados del lienzo.";
        this.body.appendChild(hint);

        this.grid = document.createElement("div");
        this.grid.className = "ir-grid";

        IrRemotePanel.BUTTONS.forEach(({ label, cmd, area }) => {
            const btn = document.createElement("button");
            btn.className = `ir-key ir-key-${area}`;
            btn.style.gridArea = area;
            btn.textContent = label;
            btn.title = `cmd=${cmd}`;
            btn.addEventListener("click", () => this._press(cmd, btn));
            this.grid.appendChild(btn);
        });

        this.body.appendChild(this.grid);

        this.panel.appendChild(this.header);
        this.panel.appendChild(this.body);

        // Mismo criterio que BlePanel/ReplPanel -- confinado a
        // #workspace, no a <body>.
        const workspace = document.getElementById("workspace") || document.body;
        workspace.appendChild(this.panel);

    }

    bindEvents() {

        document.getElementById("btnIrRemotePanelToggle")?.addEventListener("click", () => this.toggle());

        this.closeBtn = this.header.querySelector(".ir-btn-close");
        this.closeBtn.addEventListener("click", () => this.toggle());

        this.header.addEventListener("click", (e) => {
            if (e.target.closest(".ir-btn-close")) return;
            if (this._dragMoved) { this._dragMoved = false; return; }
            this.toggle();
        });

    }

    _press(cmd, btnEl) {

        this.simulator.signalEngine.broadcastIrCode(IrRemotePanel.ADDR, cmd);

        // Feedback visual chiquito -- mismo criterio que un botón real
        // (se ve "apretado" un instante), para que quede claro que el
        // clic SÍ hizo algo aunque no haya ningún KY-022 todavía.
        btnEl.classList.add("pressed");
        setTimeout(() => btnEl.classList.remove("pressed"), 150);

    }

    toggle() {
        this.open = !this.open;
        this.panel.classList.toggle("ir-closed", !this.open);
    }

    // ====================================================
    // Arrastrar el panel -- mismo mecanismo que BlePanel._bindDrag()
    // (pointer capture + left/top explícito + re-clamp con
    // ResizeObserver).
    // ====================================================

    _bindDrag() {

        const header = this.header;
        const workspaceEl = document.getElementById("workspace") || document.body;

        let dragging = false;
        let startX = 0, startY = 0, startLeft = 0, startTop = 0;

        header.addEventListener("pointerdown", (e) => {

            if (e.target.closest(".ir-btn-close")) return;

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
