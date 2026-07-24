/*
==========================================================
 PitSimulator
 Archivo: DragManager.js
 Arrastrar componentes dentro del canvas con el mouse/touch
==========================================================
*/

class DragManager {

    constructor(simulator) {

        this.simulator = simulator;

        // Info del arrastre en curso (null si no hay ninguno)
        this.dragging = null;

        this.bindEvents();

    }

    //------------------------------------------------------
    // Eventos de mouse/touch
    //------------------------------------------------------

    bindEvents() {

        this.simulator.componentLayer.addEventListener("pointerdown", (e) => {

            this.startDrag(e);

        });

        this.simulator.componentLayer.addEventListener("pointermove", (e) => {

            this.updateDrag(e);

        });

        // El "pointerup" se escucha en window por si el mouse
        // se suelta fuera del canvas.
        window.addEventListener("pointerup", (e) => {

            this.endDrag(e);

        });

    }

    //------------------------------------------------------
    // Iniciar arrastre
    //------------------------------------------------------

    startDrag(e) {

        // Bloqueado por completo mientras la simulación está corriendo
        // (igual que WireManager bloquea los cables durante la simulación)
        if (this.simulator.isRunning) return;

        // No arrastrar si el click fue sobre un pin
        // (esos, más adelante, servirán para dibujar cables)
        if (e.target.closest(".pin")) return;

        const group = e.target.closest(".component");

        if (!group) return;

        const id = group.getAttribute("data-id");
        const component = this.simulator.componentManager.get(id);

        if (!component || component.locked) return;

        const point = Utils.getCanvasPoint(this.simulator.componentLayer, e.clientX, e.clientY);

        this.dragging = {
            component,
            pointerId: e.pointerId,
            offsetX: point.x - component.x,
            offsetY: point.y - component.y,
            startX: component.x,
            startY: component.y
        };

        // Capturamos el puntero: así, aunque el mouse se mueva muy
        // rápido y "se salga" del dibujo del componente, seguimos
        // recibiendo sus eventos hasta que se suelte el click.
        try {
            group.setPointerCapture(e.pointerId);
        } catch (err) {
            // Algunos navegadores/casos no lo permiten; no es crítico.
        }

        group.classList.add("dragging");

        this.simulator.canvas.style.cursor = "grabbing";

    }

    //------------------------------------------------------
    // Actualizar posición mientras se arrastra
    //------------------------------------------------------

    updateDrag(e) {

        if (!this.dragging) return;

        const point = Utils.getCanvasPoint(this.simulator.componentLayer, e.clientX, e.clientY);

        // Usar el mismo tamaño de cuadrícula que el selector del toolbar
        // (antes quedaba fijo en 20px sin importar lo que el usuario
        // eligiera ahí, a diferencia de los cables que sí lo respetaban).
        // gridSize === 0 -> "Sin ajuste": movimiento libre, sin snap.
        const gridSize    = this.simulator.gridSize || 20;
        const snapEnabled = !!this.simulator.gridSize;

        const newX = Utils.snapToGrid(point.x - this.dragging.offsetX, gridSize, snapEnabled);
        const newY = Utils.snapToGrid(point.y - this.dragging.offsetY, gridSize, snapEnabled);

        this.dragging.component.setPosition(newX, newY);

        // Si el componente arrastrado está seleccionado,
        // el marco de selección debe moverse con él.
        if (this.simulator.selectionManager) {
            this.simulator.selectionManager.renderHighlight();
        }

        this.simulator.eventBus.emit("component:moved", this.dragging.component);

    }

    //------------------------------------------------------
    // Terminar arrastre
    //------------------------------------------------------

    endDrag(e) {

        if (!this.dragging) return;

        const { component, startX, startY } = this.dragging;
        const endX = component.x;
        const endY = component.y;

        if (component.element) {

            component.element.classList.remove("dragging");

            try {
                component.element.releasePointerCapture(this.dragging.pointerId);
            } catch (err) {
                // Ya se habrá liberado sola en la mayoría de los casos.
            }

        }

        this.simulator.canvas.style.cursor = "default";

        this.simulator.eventBus.emit("component:dragend", component);

        if (startX !== endX || startY !== endY) {

            this.simulator.history.push({
                undo: () => {
                    component.setPosition(startX, startY);
                    this.simulator.eventBus.emit("component:moved", component);
                    this.simulator.selectionManager.renderHighlight();
                },
                redo: () => {
                    component.setPosition(endX, endY);
                    this.simulator.eventBus.emit("component:moved", component);
                    this.simulator.selectionManager.renderHighlight();
                }
            });

        }

        this.dragging = null;

    }

}