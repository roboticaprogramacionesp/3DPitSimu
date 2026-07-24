/*
==========================================================
 PitSimulator — Toolbar.js
 Barra superior con botones + indicador de simulación
==========================================================
*/

class Toolbar {

    constructor(simulator) {

        this.simulator = simulator;

        this.bindEvents();
        this.bindSimToggle();
        this.bindSimulationEvents();

    }

    //------------------------------------------------------
    // Botón ▶ Simular / ⏹ Detener del toolbar
    //------------------------------------------------------

    bindSimToggle() {

        const btn = document.getElementById("btnSimToggle");
        if (!btn) return;

        btn.addEventListener("click", () => {

            if (this.simulator.isRunning) {
                this.simulator.eventBus.emit("simulation:stop");
                return;
            }

            btn.disabled = true;
            btn.textContent = "⏳ Iniciando...";
            this.simulator.eventBus.emit("simulation:start");

            // Si bridge.js no responde (o QEMU no llega a conectar),
            // no dejamos el botón trabado en "Iniciando..." para siempre.
            setTimeout(() => {
                if (!this.simulator.isRunning) {
                    btn.disabled = false;
                    btn.textContent = "▶ Simular";
                }
            }, 6000);

        });

    }

    bindEvents() {

        this.bindProjectButtons();

        // Supr / Backspace / Ctrl+C / Ctrl+D
        // (Eliminar y Zoom ya no son botones fijos del toolbar --
        //  ni Wokwi ni Fritzing los muestran así -- viven en el
        //  menú de clic derecho y en estos atajos + rueda del mouse)
        window.addEventListener("keydown", (e) => {

            const isTyping = e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA";
            if (isTyping) return;

            if ((e.key === "Delete" || e.key === "Backspace")) {

                const hasWirePoint  = !!this.simulator.wireManager.selectedPoint;
                const hasWire       = !!this.simulator.wireManager.selectedWire;
                const hasComponents = this.simulator.selectionManager.getSelectedComponents().length > 0;

                if (hasWirePoint || hasWire || hasComponents) {
                    e.preventDefault();
                    this.simulator.deleteSelection();
                }

                return;

            }

            if (e.ctrlKey && e.shiftKey && (e.key === "s" || e.key === "S")) {

                e.preventDefault();
                this.saveProjectAsWithFeedback();
                return;

            }

            if (e.ctrlKey && !e.shiftKey && (e.key === "s" || e.key === "S")) {

                e.preventDefault();
                this.saveProjectWithFeedback();
                return;

            }

            if (e.ctrlKey && !e.shiftKey && (e.key === "o" || e.key === "O")) {

                e.preventDefault();
                void this.simulator.projectManager.openProject();
                return;

            }

            if (e.ctrlKey && !e.shiftKey && (e.key === "c" || e.key === "C")) {

                const [component] = this.simulator.selectionManager.getSelectedComponents();
                if (component) {
                    e.preventDefault();
                    this.simulator.contextMenu.copy(component);
                }

                return;

            }

            if (e.ctrlKey && (e.key === "d" || e.key === "D")) {

                const [component] = this.simulator.selectionManager.getSelectedComponents();
                if (component) {
                    e.preventDefault();
                    this.simulator.contextMenu.duplicate(component);
                }

                return;

            }

            if (e.key === "F12") {
                e.preventDefault();
                this.validateCircuit();
                return;
            }

        });

    }

    bindProjectButtons() {

        this.bindProjectDrawer();

        const gridSelect = document.getElementById("gridSelect");

        if (gridSelect) {
            // Inicializar con el valor actual del simulador
            gridSelect.value = String(this.simulator.gridSize || 0);
            // Sincronizar el snap de cables con el estado REAL inicial del
            // grid -- antes esto solo pasaba en el evento "change" de más
            // abajo, así que al cargar la página con "Hoja en blanco"
            // (gridSize=0) el WireManager.snapEnabled se quedaba en su
            // default (true) sin que nada lo corrigiera, produciendo
            // division por cero (NaN) en Utils.snapToGrid.
            this.simulator.wireManager.snapEnabled = !!this.simulator.gridSize;
            gridSelect.addEventListener("change", (e) => {
                const val = parseInt(e.target.value, 10);
                this.simulator.gridSize = isNaN(val) ? 0 : val;
                // Si se elige '0' deshabilitamos el snap globalmente para cables
                this.simulator.wireManager.snapEnabled = !!this.simulator.gridSize;
                this.simulator.applyViewportTransform();
                this.simulator.eventBus.emit("grid:changed", this.simulator.gridSize);
            });
        }

    }

    //------------------------------------------------------
    // Deslizador de Proyecto (junto al logo): Nuevo / Abrir / Guardar
    // (Ctrl+S) / Guardar como (Ctrl+Shift+S) / Validar. Mismo patrón
    // que cualquier editor estándar -- ver ProjectManager.js para el
    // detalle de por qué "Abrir" y "Guardar" ya no distinguen entre
    // localStorage y archivo real (antes había 4 botones para esto,
    // ahora 2: Abrir y Guardar/Guardar como).
    //------------------------------------------------------

    bindProjectDrawer() {

        const toggleBtn = document.getElementById("btnProjectMenu");
        const drawer     = document.getElementById("projectDrawer");

        if (!toggleBtn || !drawer) return;

        const open = () => {
            drawer.classList.remove("hidden");
            toggleBtn.classList.add("active");
        };

        const close = () => {
            drawer.classList.add("hidden");
            toggleBtn.classList.remove("active");
        };

        toggleBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (drawer.classList.contains("hidden")) open();
            else close();
        });

        // Cerrar al clickear afuera (mismo criterio que ContextMenu.close())
        document.addEventListener("pointerdown", (e) => {
            if (drawer.classList.contains("hidden")) return;
            if (drawer.contains(e.target) || toggleBtn.contains(e.target)) return;
            close();
        });

        window.addEventListener("keydown", (e) => {
            if (e.key === "Escape") close();
        });

        document.getElementById("pdNewProject")?.addEventListener("click", async () => {
            close();
            await this.simulator.projectManager.newProject();
        });

        document.getElementById("pdOpenProject")?.addEventListener("click", async () => {
            close();
            await this.simulator.projectManager.openProject();
        });

        document.getElementById("pdSaveProject")?.addEventListener("click", () => {
            close();
            this.saveProjectWithFeedback();
        });

        document.getElementById("pdSaveAsProject")?.addEventListener("click", () => {
            close();
            this.saveProjectAsWithFeedback();
        });

        document.getElementById("pdValidate")?.addEventListener("click", () => {
            close();
            this.validateCircuit();
        });

        this.bindCurrentFileLabel();

    }

    //------------------------------------------------------
    // Nombre del archivo actual + indicador de cambios sin guardar,
    // junto al logo (ver ProjectManager._setCurrentFile/_setDirty).
    //------------------------------------------------------

    bindCurrentFileLabel() {

        const label = document.getElementById("currentFileLabel");
        if (!label) return;

        const render = () => {
            const pm = this.simulator.projectManager;
            label.textContent = (pm.currentFileName || "Sin guardar") + (pm.dirty ? " •" : "");
            label.classList.toggle("dirty", !!pm.dirty);
        };

        this.simulator.eventBus.on("project:file-changed", render);
        this.simulator.eventBus.on("project:dirty-changed", render);
        this.simulator.eventBus.on("project:new", render);

        render();

    }

    //------------------------------------------------------
    // Guardar / Guardar como + feedback visual breve en la barra de
    // estado (así se sienten igual de "instantáneos" que en un
    // editor de texto normal).
    //------------------------------------------------------

    _showSaveFeedback(result) {

        const status = document.getElementById("statusText");
        if (!status || this.simulator.isRunning) return;

        const previousText  = status.textContent;
        const previousColor = status.style.color;

        if (result.cancelled) return;

        status.textContent = result.savedToFile
            ? (result.downloaded ? "⬇ Descargado" : "💾 Guardado")
            : "💾 Guardado en el navegador";
        status.style.color = "#4da3ff";

        clearTimeout(this._saveFeedbackTimeout);
        this._saveFeedbackTimeout = setTimeout(() => {
            status.textContent = previousText;
            status.style.color = previousColor;
        }, 1200);

    }

    async saveProjectWithFeedback() {

        const result = await this.simulator.projectManager.saveProject();
        this._showSaveFeedback(result);

    }

    async saveProjectAsWithFeedback() {

        const result = await this.simulator.projectManager.saveProjectAs();
        this._showSaveFeedback(result);

    }

    validateCircuit() {

        const report = this.simulator.validationEngine.getReport();
        alert(report);

    }

    bindSimulationEvents() {

        // Actualizar el toolbar visualmente cuando cambia el estado
        this.simulator.eventBus.on("simulation:started", () => this.updateUI(true));
        this.simulator.eventBus.on("simulation:stopped", () => this.updateUI(false));

    }

    updateUI(isRunning) {

        const status = document.getElementById("statusText");

        if (status) {

            if (isRunning) {
                status.innerHTML = `<span class="sim-running-dot"></span> Simulación corriendo`;
                status.style.color = "#00ff88";
            } else {
                status.textContent = "Listo";
                status.style.color = "";
            }

        }

        // Botón ▶ Simular / ⏹ Detener
        const btnSim = document.getElementById("btnSimToggle");
        if (btnSim) {
            btnSim.disabled = false;
            btnSim.textContent = isRunning ? "⏹ Detener" : "▶ Simular";
            btnSim.classList.toggle("running", isRunning);
        }

        // Al iniciar, quitamos la manija de rotación / marco de edición
        if (isRunning) {
            this.simulator.selectionManager.renderHighlight();
        }

        // Cursor del canvas: mostrar "no-drop" sobre pines cuando está bloqueado
        const canvas = document.getElementById("simulatorCanvas");
        if (canvas) canvas.classList.toggle("sim-locked", isRunning);

    }

}