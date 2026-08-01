/*
==========================================================
 PitSimulator
 Archivo: AnnotationManager.js
 Notas de colores en el lienzo (info/tip/problema/advertencia) --
 puramente documentales, no participan de la simulación ni del
 netlist. Viven en su propia capa SVG (#annotationLayer, ver
 index.html) arriba de componentes/cables/selección.
==========================================================
*/

class AnnotationManager {

    static COLORS = {
        blue:   { label: "Info",           swatch: "#4da3ff" },
        green:  { label: "Recomendación",  swatch: "#4caf50" },
        red:    { label: "Importante",     swatch: "#e53935" },
        yellow: { label: "Advertencia",    swatch: "#f0c020" },
    };

    static DEFAULT_WIDTH  = 190;
    static DEFAULT_HEIGHT = 134;
    static HEADER_HEIGHT  = 14; // agarradera para arrastrar -- ver por qué hace falta en _renderOne()
    static TEXT_HEIGHT    = 90; // texto por defecto -- ver _textHeight(), el resto de la altura la ocupa la franja de herramientas
    static TOOLBAR_HEIGHT = 30; // franja fija de colores + borrar (DEFAULT_HEIGHT - HEADER_HEIGHT - TEXT_HEIGHT)
    static MIN_WIDTH  = 140; // suficiente para los 4 círculos de color + la "x" de borrar sin que se pisen
    static MIN_HEIGHT = 90;
    static RESIZE_HANDLE_SIZE = 14;

    constructor(simulator) {

        this.simulator = simulator;
        this.annotations = [];

        this._dragging = null;
        this._resizing = null;

        this.bindEvents();

    }

    // Alto real de la franja de texto para una nota dada -- la parte
    // "elástica" del layout: el header y la franja de herramientas
    // siempre miden lo mismo, así que estirar/encoger la nota (ver
    // _applySize) cambia únicamente esto.
    _textHeight(annotation) {
        return Math.max(24, annotation.height - AnnotationManager.HEADER_HEIGHT - AnnotationManager.TOOLBAR_HEIGHT);
    }

    getAll() {
        return this.annotations;
    }

    get(id) {
        return this.annotations.find((a) => a.id === id);
    }

    clear() {
        this.annotations = [];
        if (this.simulator.annotationLayer) this.simulator.annotationLayer.innerHTML = "";
    }

    // ====================================================
    // Alta / baja (deshacibles -- ver HistoryManager)
    // ====================================================

    // Punto de partida: el centro de la parte del lienzo que se ve
    // ahora mismo (mismo criterio que "pegar" un componente centrado
    // en pantalla), así la nota nueva siempre aparece a la vista sin
    // importar cuánto se haya paneado/zoomeado.
    _viewportCenter() {

        const canvas = this.simulator.canvas;
        const rect = canvas.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;

        const point = Utils.getCanvasPoint(this.simulator.componentLayer, rect.left + cx, rect.top + cy);

        return {
            x: point.x - AnnotationManager.DEFAULT_WIDTH / 2,
            y: point.y - AnnotationManager.DEFAULT_HEIGHT / 2,
        };

    }

    addNew(color = "blue") {

        const { x, y } = this._viewportCenter();

        const annotation = {
            id: Utils.generateId("note"),
            x, y,
            width: AnnotationManager.DEFAULT_WIDTH,
            height: AnnotationManager.DEFAULT_HEIGHT,
            color: AnnotationManager.COLORS[color] ? color : "blue",
            text: "",
        };

        this.annotations.push(annotation);
        this._renderOne(annotation);
        this.simulator.eventBus.emit("project:dirty");

        this.simulator.history.push({
            undo: () => this._removeSilently(annotation.id),
            redo: () => { this.annotations.push(annotation); this._renderOne(annotation); },
        });

        return annotation;

    }

    remove(id) {

        const annotation = this.get(id);
        if (!annotation) return;

        this._removeSilently(id);
        this.simulator.eventBus.emit("project:dirty");

        this.simulator.history.push({
            undo: () => { this.annotations.push(annotation); this._renderOne(annotation); },
            redo: () => this._removeSilently(id),
        });

    }

    _removeSilently(id) {
        this.annotations = this.annotations.filter((a) => a.id !== id);
        this.simulator.annotationLayer?.querySelector(`.annotation[data-id="${id}"]`)?.remove();
    }

    // ====================================================
    // Render
    // ====================================================

    renderAll() {
        if (!this.simulator.annotationLayer) return;
        this.simulator.annotationLayer.innerHTML = "";
        this.annotations.forEach((a) => this._renderOne(a));
    }

    _renderOne(annotation) {

        const layer = this.simulator.annotationLayer;
        if (!layer) return;

        layer.querySelector(`.annotation[data-id="${annotation.id}"]`)?.remove();

        const g = document.createElementNS(Utils.SVG_NS, "g");
        g.setAttribute("class", `annotation annotation-${annotation.color}`);
        g.setAttribute("data-id", annotation.id);
        g.setAttribute("transform", `translate(${annotation.x}, ${annotation.y})`);

        const rect = document.createElementNS(Utils.SVG_NS, "rect");
        rect.setAttribute("class", "annotation-rect");
        rect.setAttribute("width", annotation.width);
        rect.setAttribute("height", annotation.height);
        rect.setAttribute("rx", 7);
        g.appendChild(rect);

        // Agarradera para arrastrar: el <div contenteditable> de abajo y
        // la franja de colores/borrar juntos ya cubren TODO el resto del
        // rect (nada de fondo queda expuesto), y ambos cortan su propio
        // pointerdown a propósito (para poder tipear/clickear sin
        // arrancar un arrastre) -- sin esta tira aparte, "arrastrar la
        // nota" sería literalmente imposible: no quedaría ningún punto
        // del rect sin taparse por un hijo interactivo.
        const header = document.createElementNS(Utils.SVG_NS, "rect");
        header.setAttribute("class", "annotation-header");
        header.setAttribute("width", annotation.width);
        header.setAttribute("height", AnnotationManager.HEADER_HEIGHT);
        header.setAttribute("rx", 7);
        g.appendChild(header);
        // El rx redondea las 4 esquinas del header -- pero solo hacen
        // falta las de ARRIBA (las de abajo quedan tapadas por el
        // foreignObject igual, así que no importa que ahí sean rectas).

        const grip = document.createElementNS(Utils.SVG_NS, "text");
        grip.setAttribute("class", "annotation-grip");
        grip.setAttribute("x", annotation.width / 2);
        grip.setAttribute("y", AnnotationManager.HEADER_HEIGHT - 3);
        grip.setAttribute("text-anchor", "middle");
        grip.textContent = "≡";
        g.appendChild(grip);

        const textHeight = this._textHeight(annotation);

        const fo = document.createElementNS(Utils.SVG_NS, "foreignObject");
        fo.setAttribute("x", 0);
        fo.setAttribute("y", AnnotationManager.HEADER_HEIGHT);
        fo.setAttribute("width", annotation.width);
        fo.setAttribute("height", textHeight);

        const div = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
        div.setAttribute("class", "annotation-text");
        div.setAttribute("contenteditable", "true");
        div.setAttribute("spellcheck", "false");
        div.setAttribute("data-placeholder", "Escribí tu nota...");
        div.textContent = annotation.text;

        div.addEventListener("pointerdown", (e) => e.stopPropagation());
        div.addEventListener("input", () => {
            annotation.text = div.textContent;
            this.simulator.eventBus.emit("project:dirty");
        });

        fo.appendChild(div);
        g.appendChild(fo);

        // ---- Franja de herramientas: 4 colores + borrar ----
        const toolbarY = AnnotationManager.HEADER_HEIGHT + textHeight;
        const toolbar = document.createElementNS(Utils.SVG_NS, "g");
        toolbar.setAttribute("class", "annotation-toolbar");
        toolbar.setAttribute("transform", `translate(0, ${toolbarY})`);
        toolbar.addEventListener("pointerdown", (e) => e.stopPropagation());

        Object.keys(AnnotationManager.COLORS).forEach((key, i) => {
            const swatch = document.createElementNS(Utils.SVG_NS, "circle");
            swatch.setAttribute("class", "annotation-swatch");
            swatch.setAttribute("data-color", key);
            swatch.setAttribute("cx", 14 + i * 20);
            swatch.setAttribute("cy", 15);
            swatch.setAttribute("r", 7);
            swatch.setAttribute("fill", AnnotationManager.COLORS[key].swatch);
            if (key === annotation.color) swatch.classList.add("active");
            swatch.addEventListener("click", () => {
                annotation.color = key;
                this._renderOne(annotation);
                this.simulator.eventBus.emit("project:dirty");
            });
            toolbar.appendChild(swatch);
        });

        const del = document.createElementNS(Utils.SVG_NS, "text");
        del.setAttribute("class", "annotation-delete");
        del.setAttribute("x", annotation.width - 10);
        del.setAttribute("y", 20);
        del.setAttribute("text-anchor", "end");
        del.textContent = "✕";
        del.addEventListener("click", () => this.remove(annotation.id));
        toolbar.appendChild(del);

        g.appendChild(toolbar);

        // Agarradera de tamaño -- esquina inferior derecha, encima de
        // todo lo demás (por eso se agrega al final) para poder agarrar
        // el tamaño incluso donde se superpone con la franja de
        // herramientas.
        const handle = document.createElementNS(Utils.SVG_NS, "g");
        handle.setAttribute("class", "annotation-resize-handle");
        handle.setAttribute(
            "transform",
            `translate(${annotation.width - AnnotationManager.RESIZE_HANDLE_SIZE}, ${annotation.height - AnnotationManager.RESIZE_HANDLE_SIZE})`
        );

        const handleHit = document.createElementNS(Utils.SVG_NS, "rect");
        handleHit.setAttribute("class", "annotation-resize-hit");
        handleHit.setAttribute("width", AnnotationManager.RESIZE_HANDLE_SIZE);
        handleHit.setAttribute("height", AnnotationManager.RESIZE_HANDLE_SIZE);
        handleHit.setAttribute("fill", "transparent");
        handle.appendChild(handleHit);

        const handleGrip = document.createElementNS(Utils.SVG_NS, "path");
        handleGrip.setAttribute("class", "annotation-resize-grip");
        handleGrip.setAttribute("d", "M3,13 L13,3 M7,13 L13,7 M11,13 L13,11");
        handle.appendChild(handleGrip);

        g.appendChild(handle);

        layer.appendChild(g);

    }

    // Actualiza solo los atributos que dependen de width/height (sin
    // reconstruir el <g>) -- se usa durante el arrastre de la
    // agarradera para no perder el pointer capture en cada pointermove
    // (a diferencia del cambio de color, que sí puede darse el lujo de
    // re-renderizar entero porque no hay un puntero "capturado" de por
    // medio en ese momento).
    _applySize(annotation) {

        const g = this.simulator.annotationLayer?.querySelector(`.annotation[data-id="${annotation.id}"]`);
        if (!g) return;

        const textHeight = this._textHeight(annotation);
        const toolbarY = AnnotationManager.HEADER_HEIGHT + textHeight;

        g.querySelector(".annotation-rect")?.setAttribute("width", annotation.width);
        g.querySelector(".annotation-rect")?.setAttribute("height", annotation.height);
        g.querySelector(".annotation-header")?.setAttribute("width", annotation.width);
        g.querySelector(".annotation-grip")?.setAttribute("x", annotation.width / 2);

        const fo = g.querySelector("foreignObject");
        fo?.setAttribute("width", annotation.width);
        fo?.setAttribute("height", textHeight);

        g.querySelector(".annotation-toolbar")?.setAttribute("transform", `translate(0, ${toolbarY})`);
        g.querySelector(".annotation-delete")?.setAttribute("x", annotation.width - 10);

        g.querySelector(".annotation-resize-handle")?.setAttribute(
            "transform",
            `translate(${annotation.width - AnnotationManager.RESIZE_HANDLE_SIZE}, ${annotation.height - AnnotationManager.RESIZE_HANDLE_SIZE})`
        );

    }

    // ====================================================
    // Arrastre -- mismo patrón que DragManager (pointer capture +
    // snap a cuadrícula + comando de historial al soltar), pero
    // acotado a la capa de notas, no toca componentes/cables.
    // ====================================================

    bindEvents() {

        const layer = () => this.simulator.annotationLayer;

        // Igual que DragManager: escuchar en el propio canvas (no en
        // document entero) -- pointerup sí va en window, por si el
        // mouse se suelta afuera del lienzo.
        this.simulator.canvas.addEventListener("pointerdown", (e) => {

            const g = e.target.closest?.(".annotation");
            if (!g || !layer()?.contains(g)) return;

            const id = g.getAttribute("data-id");
            const annotation = this.get(id);
            if (!annotation) return;

            // Agarradera de tamaño -- se chequea ANTES que el resguardo
            // de texto/toolbar de abajo, porque la agarradera vive
            // encima de la franja de herramientas a propósito (ver
            // _renderOne) y necesita su propio flujo de arrastre.
            const handle = e.target.closest(".annotation-resize-handle");
            if (handle) {

                const point = Utils.getCanvasPoint(this.simulator.componentLayer, e.clientX, e.clientY);

                this._resizing = {
                    annotation,
                    pointerId: e.pointerId,
                    startPointerX: point.x,
                    startPointerY: point.y,
                    startWidth: annotation.width,
                    startHeight: annotation.height,
                };

                try { handle.setPointerCapture(e.pointerId); } catch (err) { /* no crítico */ }
                g.classList.add("resizing");
                e.stopPropagation();
                return;

            }

            // No arrancar un arrastre si el click fue sobre el texto
            // editable o la franja de herramientas (ya cortan la
            // propagación ellos mismos, esto es un resguardo extra).
            if (e.target.closest(".annotation-text, .annotation-toolbar")) return;

            const point = Utils.getCanvasPoint(this.simulator.componentLayer, e.clientX, e.clientY);

            this._dragging = {
                annotation,
                pointerId: e.pointerId,
                offsetX: point.x - annotation.x,
                offsetY: point.y - annotation.y,
                startX: annotation.x,
                startY: annotation.y,
            };

            try { g.setPointerCapture(e.pointerId); } catch (err) { /* no crítico */ }
            g.classList.add("dragging");

        });

        this.simulator.canvas.addEventListener("pointermove", (e) => {

            if (this._resizing) {

                const point = Utils.getCanvasPoint(this.simulator.componentLayer, e.clientX, e.clientY);

                const newWidth  = Math.max(AnnotationManager.MIN_WIDTH,  this._resizing.startWidth  + (point.x - this._resizing.startPointerX));
                const newHeight = Math.max(AnnotationManager.MIN_HEIGHT, this._resizing.startHeight + (point.y - this._resizing.startPointerY));

                this._resizing.annotation.width = newWidth;
                this._resizing.annotation.height = newHeight;

                this._applySize(this._resizing.annotation);
                return;

            }

            if (!this._dragging) return;

            const point = Utils.getCanvasPoint(this.simulator.componentLayer, e.clientX, e.clientY);

            const gridSize    = this.simulator.gridSize || 20;
            const snapEnabled = !!this.simulator.gridSize;

            const newX = Utils.snapToGrid(point.x - this._dragging.offsetX, gridSize, snapEnabled);
            const newY = Utils.snapToGrid(point.y - this._dragging.offsetY, gridSize, snapEnabled);

            this._dragging.annotation.x = newX;
            this._dragging.annotation.y = newY;

            const g = layer()?.querySelector(`.annotation[data-id="${this._dragging.annotation.id}"]`);
            g?.setAttribute("transform", `translate(${newX}, ${newY})`);

        });

        window.addEventListener("pointerup", (e) => {

            if (this._resizing) {

                const { annotation, startWidth, startHeight, pointerId } = this._resizing;
                const endWidth = annotation.width;
                const endHeight = annotation.height;

                const g = layer()?.querySelector(`.annotation[data-id="${annotation.id}"]`);
                g?.classList.remove("resizing");
                try { g?.querySelector(".annotation-resize-handle")?.releasePointerCapture(pointerId); } catch (err) { /* ya liberado */ }

                if (startWidth !== endWidth || startHeight !== endHeight) {

                    this.simulator.eventBus.emit("project:dirty");

                    this.simulator.history.push({
                        undo: () => {
                            annotation.width = startWidth; annotation.height = startHeight;
                            this._applySize(annotation);
                        },
                        redo: () => {
                            annotation.width = endWidth; annotation.height = endHeight;
                            this._applySize(annotation);
                        },
                    });

                }

                this._resizing = null;
                return;

            }

            if (!this._dragging) return;

            const { annotation, startX, startY, pointerId } = this._dragging;
            const endX = annotation.x;
            const endY = annotation.y;

            const g = layer()?.querySelector(`.annotation[data-id="${annotation.id}"]`);
            g?.classList.remove("dragging");
            try { g?.releasePointerCapture(pointerId); } catch (err) { /* ya liberado */ }

            if (startX !== endX || startY !== endY) {

                this.simulator.eventBus.emit("project:dirty");

                this.simulator.history.push({
                    undo: () => {
                        annotation.x = startX; annotation.y = startY;
                        layer()?.querySelector(`.annotation[data-id="${annotation.id}"]`)
                            ?.setAttribute("transform", `translate(${startX}, ${startY})`);
                    },
                    redo: () => {
                        annotation.x = endX; annotation.y = endY;
                        layer()?.querySelector(`.annotation[data-id="${annotation.id}"]`)
                            ?.setAttribute("transform", `translate(${endX}, ${endY})`);
                    },
                });

            }

            this._dragging = null;

        });

    }

    // ====================================================
    // Persistencia (ver ProjectManager.serialize/deserialize)
    // ====================================================

    serialize() {
        return this.annotations.map((a) => ({ ...a }));
    }

    restore(data) {
        this.clear();
        (data || []).forEach((a) => {
            this.annotations.push({ ...a });
        });
        this.renderAll();
    }

}
