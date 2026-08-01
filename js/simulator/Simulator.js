/*
==========================================================
 PitSimulator
 Archivo: Simulator.js
 Núcleo del motor
==========================================================
*/

class Simulator {

    constructor() {

        if (window?.location?.search?.includes("debug=1")) {
            console.log("Creando PitSimulator...");
        }

        // ==========================
        // Version
        // ==========================

        this.version = "0.1";

        // ==========================
        // Canvas
        // ==========================

        this.canvas = null;

        this.gridLayer = null;
        this.wireLayer = null;
        this.componentLayer = null;
        this.selectionLayer = null;
        this.annotationLayer = null;

        // ==========================
        // Componentes
        // ==========================

        this.componentManager = null;

        // ==========================
        // Render
        // ==========================

        this.renderer = null;

        // ==========================
        // Eventos
        // ==========================

        this.eventBus = null;

        // ==========================
        // Selección y arrastre
        // ==========================

        this.selectionManager = null;
        this.dragManager = null;

        // ==========================
        // Cables
        // ==========================

        this.wireManager = null;

        this.isRunning = false;

        // ==========================
        // Señales (netlist + estado de pines)
        // ==========================

        this.signalEngine = null;

        // ==========================
        // Zoom
        // ==========================

        this.zoom = 1;

        // ==========================
        // Offset (Pan)
        // ==========================

        this.offsetX = 0;
        this.offsetY = 0;

        // Tamaño de la cuadrícula en px (0 = desactivada)
        this.gridSize = 0;

    }

    /*
    ======================================================
    Inicialización
    ======================================================
    */

    async start() {

        if (window?.location?.search?.includes("debug=1")) {
            console.log("Inicializando...");
        }

        this.loadDOM();
        this.applyViewportTransform();

        this.createGrid();

        this.initializeManagers();

        // Restaurar el proyecto guardado (si lo hay) ANTES de decidir
        // si hace falta la ESP32 default de más abajo -- ver el
        // comentario grande en ProjectManager.loadFromLocalStorage()
        // sobre la condición de carrera real que esto arregla (la
        // versión vieja no esperaba este restore, así que la ESP32
        // default se sumaba a la que ya traía el proyecto guardado).
        const restoredProject = await this.projectManager.loadFromLocalStorage();

        // ------------------------------------------
        // ESP32: el que el QemuBridge va a buscar
        // automáticamente por su type "esp32_wroom" --
        // único componente presente al abrir el programa
        // (antes también traía un LED de prueba de más,
        // a pedido se sacó: un lienzo en blanco con solo
        // la placa es el punto de partida real de cualquier
        // circuito, no algo ya armado a medias). Solo si NO había
        // nada guardado para restaurar -- si no, esto se sumaba a
        // la ESP32 que ya traía el proyecto restaurado.
        // ------------------------------------------

        if (!restoredProject) {
            await this.componentManager.createFromDefinition("esp32_wroom", {
                x: 400,
                y: 150
            });
        }

        await this.render();

        // Centrada en el lienzo visible, sin importar el tamaño de
        // ventana -- mismo mecanismo que ya usa "Nuevo proyecto"/abrir
        // un proyecto (ver ProjectManager), así que si el usuario
        // resetea el zoom/pan después, la ESP32 vuelve a quedar igual
        // de centrada que en este primer arranque.
        this.centerViewOnComponents();

        if (window?.location?.search?.includes("debug=1")) {
            console.log("PitSimulator listo.");
            console.log(this.componentManager.getAll());
        }

    }


    /*
    ======================================================
    Obtener elementos del DOM
    ======================================================
    */

    loadDOM() {

        this.canvas = document.getElementById("simulatorCanvas");

        this.gridLayer = document.getElementById("gridLayer");

        this.wireLayer = document.getElementById("wireLayer");

        this.componentLayer = document.getElementById("componentLayer");

        this.selectionLayer = document.getElementById("selectionLayer");

        this.annotationLayer = document.getElementById("annotationLayer");

        this.viewport = document.getElementById("viewport");

        this.workspace = document.getElementById("workspace");

        // Bloqueamos el arrastre nativo del navegador (ej: seleccionar y
        // arrastrar texto de un <text> del SVG) para que nunca choque
        // con nuestro propio sistema de drag (DragManager/WireManager)
        // ni con el drop del Toolbox.
        this.canvas.addEventListener("dragstart", (e) => e.preventDefault());

        // Paneo: arrastrar sobre una zona VACÍA del canvas (no un
        // componente, pin o cable) desplaza la vista. No requiere
        // ningún botón/modo, igual que en Wokwi.
        this.bindPanEvents();

        // Zoom con la rueda del mouse, centrado en el cursor
        this.bindZoomEvents();

    }

    bindPanEvents() {

        let panStart = null;

        this.canvas.addEventListener("pointerdown", (e) => {

            // NOTA: ".wire-handle-hit" / ".wire-seg-handle-hit" son los
            // círculos de "zona de click" que agrega WireManager (antes se
            // llamaban ".wire-handle"/".wire-seg-handle", pero esas clases
            // ya no las usa ningún elemento real). Si esta lista no incluye
            // el nombre de clase actual, un click ahí NO se reconoce como
            // "interactivo" y el paneo del canvas arranca al mismo tiempo
            // que WireManager intenta arrastrar el punto -- se pelean por
            // el mismo pointermove y el cable "se mueve solo con el lienzo".
            const onInteractive = e.target.closest(".component, .pin, .wire-segment, .wire-handle-hit, .wire-seg-handle-hit, .wire-node-hit, .wire-visual, .wire-flow, .annotation");

            if (onInteractive) return;

            // Si se está dibujando un cable nuevo, este click fija un
            // codo (ver WireManager.onCanvasDown) -- no debe panear.
            if (this.wireManager?.pendingFrom) return;

            // Shift + arrastrar sobre vacío es selección por rectángulo
            // (ver SelectionManager._startBoxSelect) -- no panear al
            // mismo tiempo, si no ambos gestos se pelean por el mismo
            // pointermove.
            if (e.shiftKey) return;

            panStart = {
                x: e.clientX,
                y: e.clientY,
                offsetX: this.offsetX,
                offsetY: this.offsetY
            };

            try {
                this.canvas.setPointerCapture(e.pointerId);
            } catch (err) { }

            this.canvas.style.cursor = "grabbing";

        });

        this.canvas.addEventListener("pointermove", (e) => {

            if (!panStart) return;

            this.offsetX = panStart.offsetX + (e.clientX - panStart.x);
            this.offsetY = panStart.offsetY + (e.clientY - panStart.y);

            this.applyViewportTransform();

        });

        window.addEventListener("pointerup", () => {

            if (!panStart) return;

            panStart = null;

            this.canvas.style.cursor = "default";

        });

    }

    bindZoomEvents() {

        this.canvas.addEventListener("wheel", (e) => {

            e.preventDefault();

            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;

            this.zoomAt(e.clientX, e.clientY, factor);

        }, { passive: false });

    }

    /*
    ======================================================
    Crear cuadrícula
    ======================================================
    */

    createGrid() {

        if (window?.location?.search?.includes("debug=1")) {
            console.log("Creando cuadrícula...");
        }

        // Más adelante aquí se dibujará una cuadrícula SVG.
        // Por ahora usamos únicamente el CSS.

    }

    /*
    ======================================================
    Inicializar módulos
    ======================================================
    */

    initializeManagers() {

        if (window?.location?.search?.includes("debug=1")) {
            console.log("Inicializando módulos...");
        }

        this.eventBus = new EventBus();

        this.componentManager = new ComponentManager(this);

        this.renderer = new Renderer(this);

        this.selectionManager = new SelectionManager(this);

        this.dragManager = new DragManager(this);

        this.wireManager = new WireManager(this);

        this.signalEngine = new SignalEngine(this);

        this.history = new HistoryManager(this);

        this.annotationManager = new AnnotationManager(this);

        this.contextMenu = new ContextMenu(this);

        this.projectManager = new ProjectManager(this);

        this.validationEngine = new ValidationEngine(this);

    }

    /*
    ======================================================
    Dibujar escena
    ======================================================
    */

    async render() {

        if (window?.location?.search?.includes("debug=1")) {
            console.log("Render...");
        }

        await this.renderer.renderAll();

    }

    /*
    ======================================================
    Zoom
    ======================================================
    */

    setZoom(zoom) {

        this.zoom = Utils.clamp(zoom, 0.25, 4);

        this.applyViewportTransform();

    }

    //------------------------------------------------------
    // Zoom manteniendo fijo el punto de pantalla (clientX,clientY)
    // bajo el cursor -- así el zoom "apunta" hacia donde miras,
    // en vez de siempre hacia la esquina del canvas.
    //------------------------------------------------------

    zoomAt(clientX, clientY, factor) {

        const rect = this.canvas.getBoundingClientRect();

        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;

        const oldZoom = this.zoom;
        const newZoom = Utils.clamp(oldZoom * factor, 0.25, 4);

        if (newZoom === oldZoom) return;

        // Punto del circuito que está justo bajo el cursor ahora mismo
        const localX = (mouseX - this.offsetX) / oldZoom;
        const localY = (mouseY - this.offsetY) / oldZoom;

        this.zoom = newZoom;

        // Recalculamos el offset para que ese mismo punto siga
        // quedando exactamente bajo el cursor con el nuevo zoom.
        this.offsetX = mouseX - newZoom * localX;
        this.offsetY = mouseY - newZoom * localY;

        this.applyViewportTransform();

    }

    zoomIn() {

        const rect = this.canvas.getBoundingClientRect();
        this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);

    }

    zoomOut() {

        const rect = this.canvas.getBoundingClientRect();
        this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.2);

    }

    /*
    ======================================================
    Paneo (desplazar la vista)
    ======================================================
    */

    pan(dx, dy) {

        this.offsetX += dx;
        this.offsetY += dy;

        this.applyViewportTransform();

    }

    /*
    ======================================================
    Aplicar zoom/paneo actuales al SVG y a la cuadrícula CSS
    ======================================================
    */

    applyViewportTransform() {

        this.viewport.setAttribute(
            "transform",
            `translate(${this.offsetX},${this.offsetY}) scale(${this.zoom})`
        );

        if (this.workspace) {

            const size = (this.gridSize || 0) * this.zoom;

            this.workspace.style.backgroundImage = (this.gridSize ? "" : "none");
            this.workspace.style.backgroundSize = (this.gridSize ? `${size}px ${size}px` : "none");
            this.workspace.style.backgroundPosition = `${this.offsetX}px ${this.offsetY}px`;

        }

    }

    /*
    ======================================================
    Centrar/ajustar la vista sobre los componentes actuales.

    Por qué existe: offsetX/offsetY (pan) NO se guarda en el
    archivo del proyecto (ver ProjectManager.serialize()) --
    solo las coordenadas x/y ABSOLUTAS de cada componente. Si el
    usuario armó su circuito después de panear la vista (offset
    ya no era 0,0 en ese momento), al reabrir el archivo el pan
    vuelve a arrancar en 0,0 pero los componentes siguen en sus
    coordenadas absolutas de siempre -- resultado: el circuito
    aparece desplazado (ej. "se ve abajo") en vez de centrado.
    Se llama después de ProjectManager.deserialize() y también
    al crear un proyecto nuevo (ahí no hay componentes, así que
    simplemente resetea zoom/pan a los valores por defecto).
    ======================================================
    */

    centerViewOnComponents(padding = 60) {

        const components = this.componentManager.getAll();

        if (components.length === 0) {

            this.zoom = 1;
            this.offsetX = 0;
            this.offsetY = 0;
            this.applyViewportTransform();
            return;

        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const c of components) {
            minX = Math.min(minX, c.x);
            minY = Math.min(minY, c.y);
            maxX = Math.max(maxX, c.x + c.width);
            maxY = Math.max(maxY, c.y + c.height);
        }

        const contentWidth = Math.max(1, maxX - minX);
        const contentHeight = Math.max(1, maxY - minY);
        const contentCenterX = minX + contentWidth / 2;
        const contentCenterY = minY + contentHeight / 2;

        const rect = this.canvas.getBoundingClientRect();
        const viewportWidth = rect.width || 1;
        const viewportHeight = rect.height || 1;

        // Zoom que hace entrar todo el contenido con margen -- nunca
        // agranda de más un circuito chico (tope en 1: no queremos
        // que un solo LED termine ocupando toda la pantalla), y
        // respeta el mismo rango que ya usan setZoom()/zoomAt()
        // (0.25-4).
        const fitZoom = Math.min(
            (viewportWidth - padding * 2) / contentWidth,
            (viewportHeight - padding * 2) / contentHeight,
            1
        );

        this.zoom = Utils.clamp(fitZoom, 0.25, 4);

        this.offsetX = viewportWidth / 2 - contentCenterX * this.zoom;
        this.offsetY = viewportHeight / 2 - contentCenterY * this.zoom;

        this.applyViewportTransform();

    }

    /*
    ======================================================
    Borrar la selección actual (componente(s) o codo de cable)
    ======================================================
    */

    deleteSelection() {

        // Prioridad 1: si hay un codo de cable seleccionado, borramos solo eso.
        const selectedPoint = this.wireManager.selectedPoint;

        if (selectedPoint) {

            const wire = this.wireManager.wires.find(w => w.id === selectedPoint.wireId);

            if (wire) {

                const pointIndex = selectedPoint.pointIndex;
                const removedPoint = wire.points[pointIndex];

                wire.points.splice(pointIndex, 1);

                this.history.push({
                    undo: () => { wire.points.splice(pointIndex, 0, removedPoint); this.wireManager.renderAll(); },
                    redo: () => { wire.points.splice(pointIndex, 1); this.wireManager.renderAll(); }
                });

            }

            this.wireManager.selectedPoint = null;
            this.wireManager.renderAll();

            return;

        }

        // Prioridad 2: si hay un cable completo seleccionado, lo borramos.
        if (this.wireManager.selectedWire) {

            const wireId = this.wireManager.selectedWire;
            const wire   = this.wireManager.wires.find(w => w.id === wireId);

            this.wireManager.removeWire(wireId);
            this.wireManager.selectedWire = null;
            this.eventBus.emit("wire:selected", null);

            if (wire) {

                this.history.push({
                    undo: () => {
                        this.wireManager.wires.push(wire);
                        this.wireManager.renderAll();
                        this.eventBus.emit("wire:added", wire);
                    },
                    redo: () => {
                        this.wireManager.removeWire(wire.id);
                    }
                });

            }

            return;

        }

        // Si no, borramos los componentes seleccionados (y sus cables)
        const selectedComponents = this.selectionManager.getSelectedComponents();

        if (selectedComponents.length === 0) return;

        const removed = selectedComponents.slice();
        const removedIds = new Set(removed.map(c => c.id));

        // Capturar los cables conectados a CUALQUIERA de los
        // componentes que se van a borrar -- removeComponent()
        // (vía WireManager.removeWiresForComponent) los descarta en
        // silencio, así que sin esto el undo revivía el componente
        // pero lo dejaba completamente desconectado.
        const removedWires = this.wireManager.wires.filter(w =>
            removedIds.has(w.from.componentId) || removedIds.has(w.to.componentId)
        );

        selectedComponents.forEach(component => this.removeComponent(component.id));

        this.selectionManager.clear();

        this.history.push({
            undo: () => {
                removed.forEach(component => this.addComponent(component));
                removedWires.forEach(wire => this.wireManager.wires.push(wire));
                this.wireManager.ensureUniqueWireIds();
                this.wireManager.renderAll();
            },
            redo: () => { removed.forEach(component => this.removeComponent(component.id)); }
        });

    }

    /*
    ======================================================
    Agregar componente (ya construido) y dibujarlo
    ======================================================
    */

    async addComponent(component) {

        this.componentManager.add(component);

        await this.renderer.renderComponent(component);

        return component;

    }

    /*
    ======================================================
    Agregar componente desde su definición JSON
    (atajo para: crear + dibujar en un solo paso)
    ======================================================
    */

    async addComponentByType(type, overrides = {}) {

        const component = await this.componentManager.createFromDefinition(type, overrides);

        if (!component) return null;

        await this.renderer.renderComponent(component);

        return component;

    }

    /*
    ======================================================
    Eliminar componente
    ======================================================
    */

    removeComponent(id) {

        const component = this.componentManager.get(id);

        if (!component) return;

        this.wireManager.removeWiresForComponent(id);

        this.renderer.removeComponent(component);

        this.componentManager.remove(id);

    }

    /*
    ======================================================
    Buscar componente
    ======================================================
    */

    getComponent(id) {
        return this.componentManager.get(id);
    }

     startSimulation() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.eventBus.emit("simulation:started");
    }
 
    stopSimulation() {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.signalEngine.reset();
        this.eventBus.emit("simulation:stopped");
    }
 
    toggleSimulation() {
        if (this.isRunning) this.stopSimulation();
        else this.startSimulation();
    }

}