/*
==========================================================
 PitSimulator — BlePanel.js

 "Teléfono virtual" BLE (ver plan ESP-NOW→WiFi→BLE, última fase) --
 un panel dentro de la propia app, con la misma idea que la app
 "Serial Bluetooth Terminal" (conectar a un periférico BLE con UART
 por Nordic UART Service y mandar/recibir texto plano), pero 100%
 simulado: no hay Bluetooth real de por medio (una pestaña de
 navegador no tiene con qué emparejarse a un ESP32 real), así que
 este panel se conecta directo al ESP32 SIMULADO que esté corriendo
 en este mismo lienzo -- mismo espíritu que ESP-NOW entre dos ESP32.

 Protocolo real: ver _bluetooth_wasm.py (BLE.gap_advertise()/
 gatts_notify() del lado Python) y WasmBridge.js (eventos
 "ble:advertising"/"ble:notify", y los métodos bleConnect()/
 bleDisconnect()/bleWrite() que este panel llama).
==========================================================
*/

class BlePanel {

    constructor(simulator) {

        this.simulator = simulator;

        this.open = false;

        // esp32Id -> { name } -- dispositivos que llamaron
        // gap_advertise() con el Nordic UART Service reconocido (ver
        // _bluetooth_wasm.py) desde el último "▶ Simular".
        this._devices = new Map();

        this._connectedEsp32Id = null;

        this.buildDOM();
        this.bindEvents();
        this.bindBusEvents();
        this._bindDrag();

    }

    buildDOM() {

        this.panel = document.createElement("div");
        this.panel.id = "blePanel";
        this.panel.className = "ble-panel ble-closed";

        this.header = document.createElement("div");
        this.header.className = "ble-header";
        this.header.innerHTML = `
            <div class="ble-header-left">
                <span class="ble-icon">📱</span>
                <span class="ble-title">Serial Bluetooth Terminal (simulado)</span>
                <span id="bleStatus" class="ble-status">🔴 Desconectado</span>
            </div>
            <div class="ble-header-right">
                <button class="ble-btn ble-btn-toggle" id="bleBtnToggle">▲</button>
            </div>
        `;

        this.body = document.createElement("div");
        this.body.className = "ble-body";

        const connectRow = document.createElement("div");
        connectRow.className = "ble-connect-row";

        this.deviceSelect = document.createElement("select");
        this.deviceSelect.className = "ble-device-select";
        this.deviceSelect.title = "ESP32 con un servicio UART BLE anunciado (gap_advertise())";

        this.connectBtn = document.createElement("button");
        this.connectBtn.className = "ble-btn ble-btn-connect";
        this.connectBtn.textContent = "Conectar";

        connectRow.appendChild(this.deviceSelect);
        connectRow.appendChild(this.connectBtn);

        this.log = document.createElement("div");
        this.log.className = "ble-log";
        this._appendEmptyLogHint();

        const inputRow = document.createElement("div");
        inputRow.className = "ble-input-row";

        this.input = document.createElement("input");
        this.input.type = "text";
        this.input.className = "ble-input";
        this.input.placeholder = "Escribí un mensaje para mandarle al ESP32...";
        this.input.disabled = true;
        this.input.setAttribute("autocomplete", "off");
        this.input.setAttribute("spellcheck", "false");

        this.sendBtn = document.createElement("button");
        this.sendBtn.className = "ble-btn ble-btn-send";
        this.sendBtn.textContent = "Enviar";
        this.sendBtn.disabled = true;

        inputRow.appendChild(this.input);
        inputRow.appendChild(this.sendBtn);

        this.body.appendChild(connectRow);
        this.body.appendChild(this.log);
        this.body.appendChild(inputRow);

        this.panel.appendChild(this.header);
        this.panel.appendChild(this.body);

        // Mismo criterio que ReplPanel -- confinado a #workspace, no a
        // <body>, para no taparse con el toolbox/panel de propiedades.
        const workspace = document.getElementById("workspace") || document.body;
        workspace.appendChild(this.panel);

    }

    bindEvents() {

        document.getElementById("btnBlePanelToggle")?.addEventListener("click", () => this.toggle());
        this.header.querySelector("#bleBtnToggle").addEventListener("click", () => this.toggle());

        this.header.addEventListener("click", (e) => {
            if (e.target.closest(".ble-btn, .ble-device-select")) return;
            // Un arrastre real (ver _bindDrag) también dispara "click"
            // al soltar -- no es un toggle, el usuario estaba moviendo
            // el panel, no pidiendo abrirlo/cerrarlo.
            if (this._dragMoved) { this._dragMoved = false; return; }
            this.toggle();
        });

        this.connectBtn.addEventListener("click", () => {
            if (this._connectedEsp32Id) {
                this._disconnect();
            } else {
                this._connect();
            }
        });

        this.sendBtn.addEventListener("click", () => this._send());
        this.input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this._send();
        });

    }

    bindBusEvents() {

        this.simulator.eventBus.on("ble:advertising", ({ esp32Id, name }) => {
            this._devices.set(esp32Id, { name });
            this._refreshDeviceSelect();
        });

        this.simulator.eventBus.on("ble:notify", ({ esp32Id, data }) => {
            if (esp32Id !== this._connectedEsp32Id) return;
            this._appendLog("rx", data);
        });

        // "▶ Simular"/"⏹ Detener" -- estado limpio en cada corrida
        // nueva (mismo criterio que ReplPanel con sus sesiones por
        // dispositivo): los handles/anuncios de la corrida anterior ya
        // no existen del lado Python, no tiene sentido arrastrarlos acá.
        this.simulator.eventBus.on("simulation:start", () => {
            this._devices.clear();
            this._refreshDeviceSelect();
        });
        this.simulator.eventBus.on("simulation:stop", () => this._disconnect());

        this.simulator.eventBus.on("component:removed", ({ componentId }) => {
            if (!this._devices.has(componentId)) return;
            this._devices.delete(componentId);
            if (this._connectedEsp32Id === componentId) this._disconnect();
            this._refreshDeviceSelect();
        });

    }

    _refreshDeviceSelect() {

        const previous = this.deviceSelect.value;

        this.deviceSelect.innerHTML = "";

        if (this._devices.size === 0) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "(ningún ESP32 está anunciando BLE todavía)";
            this.deviceSelect.appendChild(opt);
            this.deviceSelect.disabled = true;
            this.connectBtn.disabled = true;
            return;
        }

        this._devices.forEach((info, esp32Id) => {
            const opt = document.createElement("option");
            opt.value = esp32Id;
            opt.textContent = `${info.name} (${esp32Id})`;
            this.deviceSelect.appendChild(opt);
        });

        this.deviceSelect.disabled = !!this._connectedEsp32Id;
        this.connectBtn.disabled = false;

        if (previous && this._devices.has(previous)) {
            this.deviceSelect.value = previous;
        }

    }

    _connect() {

        const esp32Id = this.deviceSelect.value;
        if (!esp32Id) return;

        const bridge = this.simulator.bridges.get(esp32Id);
        if (!bridge?.connected) {
            this._appendSystemLine("⚠ Ese ESP32 no está conectado ahora mismo (¿sigue corriendo la simulación?).");
            return;
        }

        bridge.bleConnect();

        this._connectedEsp32Id = esp32Id;
        this.deviceSelect.disabled = true;
        this.connectBtn.textContent = "Desconectar";
        this.input.disabled = false;
        this.sendBtn.disabled = false;

        const status = document.getElementById("bleStatus");
        status.textContent = `✅ Conectado a ${this._devices.get(esp32Id)?.name || esp32Id}`;
        status.style.color = "#00ff88";

        this.log.innerHTML = "";
        this._appendSystemLine(`Conectado a ${this._devices.get(esp32Id)?.name || esp32Id}`);

    }

    _disconnect() {

        if (this._connectedEsp32Id) {
            const bridge = this.simulator.bridges.get(this._connectedEsp32Id);
            bridge?.bleDisconnect();
            this._appendSystemLine("Desconectado.");
        }

        this._connectedEsp32Id = null;
        this.connectBtn.textContent = "Conectar";
        this.input.disabled = true;
        this.sendBtn.disabled = true;
        this.deviceSelect.disabled = this._devices.size === 0;

        const status = document.getElementById("bleStatus");
        status.textContent = "🔴 Desconectado";
        status.style.color = "#666";

    }

    _send() {

        const text = this.input.value;
        if (!text || !this._connectedEsp32Id) return;

        const bridge = this.simulator.bridges.get(this._connectedEsp32Id);
        if (!bridge?.connected) {
            this._appendSystemLine("⚠ Se perdió la conexión con el ESP32.");
            this._disconnect();
            return;
        }

        bridge.bleWrite(text);
        this._appendLog("tx", text);
        this.input.value = "";

    }

    _appendEmptyLogHint() {
        this.log.innerHTML = '<div class="ble-log-empty">Elegí un dispositivo y tocá "Conectar" para empezar.</div>';
    }

    _appendSystemLine(text) {
        const div = document.createElement("div");
        div.className = "ble-log-system";
        div.textContent = text;
        this.log.appendChild(div);
        this.log.scrollTop = this.log.scrollHeight;
    }

    _appendLog(direction, text) {
        const row = document.createElement("div");
        row.className = `ble-log-row ble-log-${direction}`;

        const bubble = document.createElement("div");
        bubble.className = "ble-log-bubble";
        bubble.textContent = text;

        row.appendChild(bubble);
        this.log.appendChild(row);
        this.log.scrollTop = this.log.scrollHeight;
    }

    toggle() {
        this.open = !this.open;
        this.panel.classList.toggle("ble-closed", !this.open);
        this.header.querySelector("#bleBtnToggle").textContent = this.open ? "▼" : "▲";
    }

    // ====================================================
    // Arrastrar el panel libremente por el lienzo, agarrando desde la
    // cabecera -- mismo mecanismo que TutorialManager._bindDrag()
    // (pointer capture + left/top explícito + re-clamp con
    // ResizeObserver), reusado tal cual porque ahí ya se encontró y
    // resolvió el mismo bug que acá hay que evitar desde el principio:
    // un left/top fijo calculado una sola vez puede terminar fuera de
    // #workspace si éste cambia de tamaño después (ventana, o el
    // panel de propiedades expandiéndose/colapsándose).
    // ====================================================

    _bindDrag() {

        const header = this.header;
        const workspaceEl = document.getElementById("workspace") || document.body;

        let dragging = false;
        let startX = 0, startY = 0, startLeft = 0, startTop = 0;

        header.addEventListener("pointerdown", (e) => {

            if (e.target.closest(".ble-btn, .ble-device-select")) return;

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
