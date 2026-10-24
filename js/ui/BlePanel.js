/*
==========================================================
 PitSimulator — BlePanel.js

 "Teléfono virtual" (ver plan ESP-NOW→WiFi→BLE, última fase, más el
 agregado posterior de HC-06) -- un panel dentro de la propia app,
 con la misma idea que la app "Serial Bluetooth Terminal" (conectar
 a un periférico con UART por Bluetooth y mandar/recibir texto
 plano), pero 100% simulado: no hay Bluetooth real de por medio (una
 pestaña de navegador no tiene con qué emparejarse a un ESP32 real),
 así que este panel se conecta directo al ESP32 SIMULADO que esté
 corriendo en este mismo lienzo -- mismo espíritu que ESP-NOW entre
 dos ESP32.

 Atiende DOS "especies" de dispositivo bajo una sola lista (mismo
 panel, a pedido -- la app real "Serial Bluetooth Terminal" tampoco
 distingue BLE de clásico en su UI, son la misma lista de "a qué me
 puedo conectar"):
   - kind "ble": BLE real (módulo `bluetooth`, Nordic UART Service)
     -- ver _bluetooth_wasm.py y WasmBridge.js (eventos
     "ble:advertising"/"ble:notify", métodos bleConnect()/
     bleDisconnect()/bleWrite()). Aparece apenas el firmware llama
     gap_advertise() con NUS.
   - kind "hc06": Bluetooth CLÁSICO (SPP) vía el componente HC-06 --
     del lado del código del alumno es un machine.UART más (ver
     _uart_bus.hal.py y SignalEngine._resolveHc06Uart/
     _findHc06ByUartTx/sendHc06Text/handleUartTx), sin ningún import
     de `bluetooth` de por medio. No hay "advertise" -- un HC-06 real
     siempre está ahí, emparejado, así que acá "aparece" apenas está
     bien cableado, alimentado, y el firmware construyó su UART sobre
     esos pines (se sondea periódicamente, ver _pollHc06Devices()).

 Cada entrada de _devices se guarda bajo una clave compuesta
 "ble:<esp32Id>" / "hc06:<componentId>" -- un BLE "pertenece" a un
 ESP32 entero (una sola instancia BLE.gap_advertise() por firmware),
 pero puede haber VARIOS HC-06 distintos cableados al mismo o a
 distintos ESP32 (cada uno su propio UART), así que esos se
 identifican por componentId, no por esp32Id.
==========================================================
*/

class BlePanel {

    constructor(simulator) {

        this.simulator = simulator;

        this.open = false;

        // deviceKey ("ble:<esp32Id>" / "hc06:<componentId>") -> { kind, name, esp32Id, componentId }
        this._devices = new Map();

        this._connectedDeviceKey = null;

        this.buildDOM();
        this.bindEvents();
        this.bindBusEvents();
        this._bindDrag();
        this._startHc06Polling();

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
            </div>
        `;

        this.body = document.createElement("div");
        this.body.className = "ble-body";

        const connectRow = document.createElement("div");
        connectRow.className = "ble-connect-row";

        this.deviceSelect = document.createElement("select");
        this.deviceSelect.className = "ble-device-select";
        this.deviceSelect.title = "ESP32 con BLE anunciado (gap_advertise()) o un HC-06 bien cableado";

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

        this.header.addEventListener("click", (e) => {
            if (e.target.closest(".ble-btn, .ble-device-select")) return;
            // Un arrastre real (ver _bindDrag) también dispara "click"
            // al soltar -- no es un toggle, el usuario estaba moviendo
            // el panel, no pidiendo abrirlo/cerrarlo.
            if (this._dragMoved) { this._dragMoved = false; return; }
            this.toggle();
        });

        this.connectBtn.addEventListener("click", () => {
            if (this._connectedDeviceKey) {
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
            this._devices.set(`ble:${esp32Id}`, { kind: "ble", name, esp32Id, componentId: null });
            this._refreshDeviceSelect();
        });

        this.simulator.eventBus.on("ble:notify", ({ esp32Id, data }) => {
            if (this._connectedDeviceKey !== `ble:${esp32Id}`) return;
            this._appendLog("rx", data);
        });

        // Ver SignalEngine.handleUartTx() -- equivalente de "ble:notify"
        // pero para HC-06 (dirección firmware -> navegador por UART).
        this.simulator.eventBus.on("hc06:data", ({ componentId, data }) => {
            if (this._connectedDeviceKey !== `hc06:${componentId}`) return;
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
            let changed = false;
            this._devices.forEach((info, key) => {
                if (info.esp32Id !== componentId && info.componentId !== componentId) return;
                this._devices.delete(key);
                changed = true;
                if (this._connectedDeviceKey === key) this._disconnect();
            });
            if (changed) this._refreshDeviceSelect();
        });

    }

    // HC-06 no tiene ningún evento tipo "gap_advertise()" que avise
    // "ya estoy listo" -- es un UART pasivo, así que se sondea cada
    // 1s (mismo espíritu que el tick de ds3231.behavior.js/gps) para
    // ver qué módulos del lienzo ya están bien cableados, alimentados
    // y con su UART construido del lado del firmware (ver
    // SignalEngine.listReadyHc06Devices()). Corre siempre (no solo
    // con el panel abierto) para que la lista ya esté lista la
    // primera vez que el alumno lo abre.
    _startHc06Polling() {
        setInterval(() => this._pollHc06Devices(), 1000);
    }

    _pollHc06Devices() {

        const ready = this.simulator.signalEngine.listReadyHc06Devices();
        const readyIds = new Set(ready.map((d) => d.componentId));

        let changed = false;

        // Sacar los que ya no están listos (cable removido, se apagó
        // la simulación sin pasar por "simulation:stop", etc.).
        this._devices.forEach((info, key) => {
            if (info.kind !== "hc06") return;
            if (readyIds.has(info.componentId)) return;
            this._devices.delete(key);
            changed = true;
            if (this._connectedDeviceKey === key) this._disconnect();
        });

        ready.forEach(({ componentId, esp32Id, name }) => {
            const key = `hc06:${componentId}`;
            if (this._devices.has(key)) return;
            this._devices.set(key, { kind: "hc06", name, esp32Id, componentId });
            changed = true;
        });

        if (changed) this._refreshDeviceSelect();

    }

    _refreshDeviceSelect() {

        const previous = this.deviceSelect.value;

        this.deviceSelect.innerHTML = "";

        if (this._devices.size === 0) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "(ningún dispositivo Bluetooth disponible todavía)";
            this.deviceSelect.appendChild(opt);
            this.deviceSelect.disabled = true;
            this.connectBtn.disabled = true;
            return;
        }

        this._devices.forEach((info, key) => {
            const opt = document.createElement("option");
            opt.value = key;
            const tag = info.kind === "ble" ? "BLE" : "HC-06";
            opt.textContent = `${info.name} (${tag})`;
            this.deviceSelect.appendChild(opt);
        });

        this.deviceSelect.disabled = !!this._connectedDeviceKey;
        this.connectBtn.disabled = false;

        if (previous && this._devices.has(previous)) {
            this.deviceSelect.value = previous;
        }

    }

    _connect() {

        const key = this.deviceSelect.value;
        if (!key) return;

        const info = this._devices.get(key);
        if (!info) return;

        const bridge = this.simulator.bridges.get(info.esp32Id);
        if (!bridge?.connected) {
            this._appendSystemLine("⚠ Ese ESP32 no está conectado ahora mismo (¿sigue corriendo la simulación?).");
            return;
        }

        // El HC-06 (Bluetooth clásico, sin GATT) no tiene ningún
        // handshake que hacerle al firmware -- "conectar" acá es
        // 100% de este lado (UI), listo para mandar/recibir apenas
        // está cableado y alimentado. BLE sí necesita avisarle al
        // firmware (dispara _IRQ_CENTRAL_CONNECT, ver _bluetooth_wasm.py).
        if (info.kind === "ble") bridge.bleConnect();

        this._connectedDeviceKey = key;
        this.deviceSelect.disabled = true;
        this.connectBtn.textContent = "Desconectar";
        this.input.disabled = false;
        this.sendBtn.disabled = false;

        this.log.innerHTML = "";
        this._appendSystemLine(`Conectado a ${info.name}`);

    }

    _disconnect() {

        if (this._connectedDeviceKey) {
            const info = this._devices.get(this._connectedDeviceKey);
            if (info?.kind === "ble") {
                const bridge = this.simulator.bridges.get(info.esp32Id);
                bridge?.bleDisconnect();
            }
            this._appendSystemLine("Desconectado.");
        }

        this._connectedDeviceKey = null;
        this.connectBtn.textContent = "Conectar";
        this.input.disabled = true;
        this.sendBtn.disabled = true;
        this.deviceSelect.disabled = this._devices.size === 0;

    }

    _send() {

        const text = this.input.value;
        if (!text || !this._connectedDeviceKey) return;

        const info = this._devices.get(this._connectedDeviceKey);
        const bridge = info && this.simulator.bridges.get(info.esp32Id);
        if (!bridge?.connected) {
            this._appendSystemLine("⚠ Se perdió la conexión con el ESP32.");
            this._disconnect();
            return;
        }

        if (info.kind === "ble") {
            bridge.bleWrite(text);
        } else {
            this.simulator.signalEngine.sendHc06Text(info.componentId, text);
        }

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
