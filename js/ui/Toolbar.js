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

            if (e.ctrlKey && !e.shiftKey && (e.key === "s" || e.key === "S")) {

                e.preventDefault();
                this.saveProjectWithFeedback();
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
    // Deslizador de Proyecto (junto al logo): Nuevo / Guardar
    // (Ctrl+S) / Recargar + Abrir/Guardar como archivo + Validar
    // (estos últimos vivían como botones fijos del toolbar, ahora
    // agrupados acá para no saturar la barra).
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

        document.getElementById("pdSaveProject")?.addEventListener("click", () => {
            close();
            this.saveProjectWithFeedback();
        });

        document.getElementById("pdOpenProject")?.addEventListener("click", async () => {
            close();
            await this.simulator.projectManager.openProject();
        });

        document.getElementById("pdExportFile")?.addEventListener("click", () => {
            close();
            this.exportProject();
        });

        document.getElementById("pdImportFile")?.addEventListener("click", () => {
            close();
            this.importProject();
        });

        document.getElementById("pdValidate")?.addEventListener("click", () => {
            close();
            this.validateCircuit();
        });

    }

    //------------------------------------------------------
    // Guardar + feedback visual breve en la barra de estado
    // (así Ctrl+S y el botón "Guardar" del drawer se sienten
    // igual de "instantáneos" que en un editor de texto normal)
    //------------------------------------------------------

    async saveProjectWithFeedback() {

        this.simulator.projectManager.saveToLocalStorage();

        // Si había un archivo vinculado ANTES de este guardado, y ya
        // no lo hay después de saveToLinkedFile(), es porque se acaba
        // de perder el vínculo (permiso revocado, archivo movido/borrado,
        // etc. -- ver ProjectManager.saveToLinkedFile). Avisamos con un
        // alert la primera vez que pasa, para que quede claro que hay
        // que volver a "Guardar como archivo..." -- si no, el usuario
        // sigue presionando Ctrl+S pensando que el archivo en disco se
        // actualiza, cuando en realidad solo se está guardando en el
        // navegador (localStorage).
        const hadLinkedFile = !!this.simulator.projectManager.fileHandle;

        // Si ya se vinculó un archivo (con "Guardar como archivo..."),
        // este mismo guardado también lo sobreescribe -- sin volver a
        // preguntar dónde. En navegadores sin soporte (Firefox, Safari)
        // o si todavía no se eligió ningún archivo, esto no hace nada.
        const savedToFile = await this.simulator.projectManager.saveToLinkedFile();

        if (hadLinkedFile && !savedToFile) {
            alert(
                "⚠️ Se perdió el vínculo con el archivo (permiso revocado, o el archivo se movió/borró).\n\n" +
                "El proyecto se guardó igual en este navegador, pero para volver a actualizar el archivo en disco " +
                "usá \"Guardar como archivo...\" de nuevo."
            );
        }

        const status = document.getElementById("statusText");
        if (!status || this.simulator.isRunning) return;

        const previousText  = status.textContent;
        const previousColor = status.style.color;

        status.textContent = savedToFile ? "💾 Guardado en el archivo" : "💾 Guardado";
        status.style.color = "#4da3ff";

        clearTimeout(this._saveFeedbackTimeout);
        this._saveFeedbackTimeout = setTimeout(() => {
            status.textContent = previousText;
            status.style.color = previousColor;
        }, 1200);

    }

    validateCircuit() {

        const report = this.simulator.validationEngine.getReport();
        alert(report);

    }

    exportProject() {

        this.simulator.projectManager.exportJSON();

    }

    importProject() {

        void this.simulator.projectManager.importJSON();

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