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

            // BUG REAL encontrado (arrastre en grupo no movía a los
            // demás seleccionados): este mismo pointerdown también es
            // el que arranca el arrastre (ver DragManager.startDrag(),
            // bindeado al mismo evento). Sin este chequeo, un click SIN
            // Shift sobre un componente que ya era parte de una
            // selección múltiple la colapsaba a "solo este" ACÁ, antes
            // de que DragManager llegara a mirar cuántos había
            // seleccionados -- el grupo nunca llegaba a arrastrarse
            // junto. Si el click cae sobre algo que YA está en una
            // selección de 2+, no tocar nada (se preserva el grupo
            // para el drag) -- exactamente como Figma/Illustrator/etc.
            if (!e.shiftKey && this.selected.length > 1 && this.selected.includes(id)) {
                return;
            }

            this.select(id, e.shiftKey);

        });

        // Click en el fondo del canvas (nada) -> deseleccionar todo
        // (o, con Shift, arrancar un rectángulo de selección múltiple).
        this.simulator.canvas.addEventListener("pointerdown", (e) => {

            // Mientras se está dibujando un cable nuevo, este click fija
            // un codo (WireManager.onCanvasDown) -- no debe deseleccionar,
            // porque eso dispara "selection:changed" y WireManager hace
            // un renderAll() que borra la vista previa del cable en curso.
            if (this.simulator.wireManager?.pendingFrom) return;

            const clickedComponent = e.target.closest(".component");
            const clickedWire      = e.target.closest(".wire-segment, .wire-handle-hit, .wire-seg-handle-hit, .wire-node-hit, .wire-visual, .wire-flow");

            if (clickedComponent || clickedWire) return;

            // Shift + arrastrar sobre el lienzo vacío = selección por
            // rectángulo (varios componentes a la vez, para moverlos
            // juntos con DragManager -- ver el arrastre en grupo ahí).
            // SIN Shift, arrastrar sobre vacío sigue paneando la vista
            // como siempre (ver Simulator.bindPanEvents(), que también
            // se salta el paneo si e.shiftKey) -- shift ya era la
            // convención existente para "sumar a la selección" en el
            // click simple, esto la extiende al arrastre.
            if (e.shiftKey) {
                this._startBoxSelect(e);
                return;
            }

            this.clear();

        });

    }

    //------------------------------------------------------
    // Selección por rectángulo (Shift + arrastrar sobre el lienzo
    // vacío) -- selecciona todos los componentes cuyo cuadro
    // delimitador (sin considerar rotación, aproximación suficiente
    // para "el rectángulo lo toca") intersecta el área arrastrada.
    // Aditivo respecto a lo que ya estaba seleccionado antes de
    // arrancar el arrastre (consistente con Shift+click de siempre).
    //------------------------------------------------------

    _startBoxSelect(e) {

        const startPoint = Utils.getCanvasPoint(this.simulator.componentLayer, e.clientX, e.clientY);
        const preExisting = this.selected.slice();

        const rect = document.createElementNS(Utils.SVG_NS, "rect");
        rect.setAttribute("class", "selection-box");
        rect.setAttribute("x", startPoint.x);
        rect.setAttribute("y", startPoint.y);
        rect.setAttribute("width", 0);
        rect.setAttribute("height", 0);
        this.simulator.selectionLayer.appendChild(rect);

        const onMove = (ev) => {

            const p = Utils.getCanvasPoint(this.simulator.componentLayer, ev.clientX, ev.clientY);

            const x = Math.min(p.x, startPoint.x);
            const y = Math.min(p.y, startPoint.y);
            const w = Math.abs(p.x - startPoint.x);
            const h = Math.abs(p.y - startPoint.y);

            rect.setAttribute("x", x);
            rect.setAttribute("y", y);
            rect.setAttribute("width", w);
            rect.setAttribute("height", h);

            const insideIds = this._componentsInRect(x, y, w, h).map(c => c.id);
            const finalIds  = Array.from(new Set([...preExisting, ...insideIds]));

            this._applySelectionIds(finalIds);

        };

        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            rect.remove();
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);

    }

    //------------------------------------------------------
    // Componentes cuyo cuadro delimitador intersecta el rectángulo
    // (x,y,w,h) dado, en coordenadas de canvas.
    //------------------------------------------------------

    _componentsInRect(x, y, w, h) {

        const right  = x + w;
        const bottom = y + h;

        return this.simulator.componentManager.getAll().filter(component => {

            if (component.locked) return false;

            const cw = component.width  * component.scale;
            const ch = component.height * component.scale;

            return component.x < right && component.x + cw > x &&
                   component.y < bottom && component.y + ch > y;

        });

    }

    //------------------------------------------------------
    // Reemplaza la selección actual por exactamente esta lista de
    // ids -- usado por el rectángulo de selección (se recalcula en
    // cada pointermove, así que no puede usar select()/additive, que
    // solo sabe AGREGAR de a uno).
    //------------------------------------------------------

    _applySelectionIds(ids) {

        this.deselectAll();

        ids.forEach(id => {
            const component = this.simulator.componentManager.get(id);
            if (!component) return;
            this.selected.push(id);
            component.select();
        });

        this.renderHighlight();

        this.simulator.eventBus.emit("selection:changed", this.getSelectedComponents());

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