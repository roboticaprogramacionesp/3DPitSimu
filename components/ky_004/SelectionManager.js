/*
==========================================================
 PitSimulator
 Archivo: SelectionManager.js
 Selección de componentes con click
 (soporta selección múltiple con Shift)
==========================================================
*/

class SelectionManager {

    constructor(simulator) {

        this.simulator = simulator;

        // IDs de los componentes actualmente seleccionados
        this.selected = [];

        this.bindEvents();

    }

    //------------------------------------------------------
    // Eventos de mouse/touch
    //------------------------------------------------------

    bindEvents() {

        // Click sobre un componente -> seleccionarlo
        this.simulator.componentLayer.addEventListener("pointerdown", (e) => {

            const group = e.target.closest(".component");

            if (!group) return;

            const id = group.getAttribute("data-id");

            this.select(id, e.shiftKey);

        });

        // Click en el fondo del canvas (nada) -> deseleccionar todo
        this.simulator.canvas.addEventListener("pointerdown", (e) => {

            const clickedComponent = e.target.closest(".component");

            if (!clickedComponent) {
                this.clear();
            }

        });

    }

    //------------------------------------------------------
    // Seleccionar un componente
    // additive = true -> lo agrega a la selección actual (Shift+click)
    //------------------------------------------------------

    select(id, additive = false) {

        const component = this.simulator.componentManager.get(id);

        if (!component || component.locked) return;

        if (!additive) {

            this.deselectAll();

        }

        if (!this.selected.includes(id)) {

            this.selected.push(id);
            component.select();

        }

        this.renderHighlight();

        this.simulator.eventBus.emit("selection:changed", this.getSelectedComponents());

    }

    //------------------------------------------------------
    // Quitar un componente de la selección
    //------------------------------------------------------

    deselect(id) {

        const component = this.simulator.componentManager.get(id);

        if (component) component.deselect();

        this.selected = this.selected.filter(sid => sid !== id);

        this.renderHighlight();

    }

    //------------------------------------------------------
    // Deseleccionar todo (sin emitir evento, uso interno)
    //------------------------------------------------------

    deselectAll() {

        this.selected.forEach(id => {

            const component = this.simulator.componentManager.get(id);
            if (component) component.deselect();

        });

        this.selected = [];

    }

    //------------------------------------------------------
    // Limpiar selección por completo (uso externo)
    //------------------------------------------------------

    clear() {

        this.deselectAll();

        this.renderHighlight();

        this.simulator.eventBus.emit("selection:changed", []);

    }

    //------------------------------------------------------
    // Igual que clear(), pero sin emitir el evento
    // "selection:changed" -- para cuando otro manager (ej.
    // WireManager) es quien inició el cambio y no queremos
    // que el evento le rebote de vuelta.
    //------------------------------------------------------

    clearSilent() {

        this.deselectAll();

        this.renderHighlight();

    }

    //------------------------------------------------------
    // Obtener los componentes seleccionados (objetos, no ids)
    //------------------------------------------------------

    getSelectedComponents() {

        return this.selected
            .map(id => this.simulator.componentManager.get(id))
            .filter(Boolean);

    }

    //------------------------------------------------------
    // Dibujar el marco punteado alrededor de cada
    // componente seleccionado (en selectionLayer)
    //------------------------------------------------------

    renderHighlight() {

        const layer = this.simulator.selectionLayer;

        layer.innerHTML = "";

        const components = this.getSelectedComponents();

        components.forEach(component => {

            const padding = 4;

            const rect = document.createElementNS(Utils.SVG_NS, "rect");

            rect.setAttribute("class", "selection-outline");

            rect.setAttribute("x", -padding);
            rect.setAttribute("y", -padding);
            rect.setAttribute("width", component.width * component.scale + padding * 2);
            rect.setAttribute("height", component.height * component.scale + padding * 2);
            rect.setAttribute(
                "transform",
                `translate(${component.x},${component.y}) rotate(${component.rotation})`
            );

            layer.appendChild(rect);

        });

    }

}