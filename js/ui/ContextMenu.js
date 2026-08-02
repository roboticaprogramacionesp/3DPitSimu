/*
==========================================================
 PitSimulator
 Archivo: ContextMenu.js  (js/ui/ContextMenu.js)
 Menú de clic derecho: girar, voltear, bloquear, copiar,
 duplicar, borrar, mostrar nombre, zoom.
 Reemplaza a los botones fijos de Eliminar / Zoom del toolbar
 (ni Wokwi ni Fritzing los muestran como botones permanentes).
==========================================================
*/

class ContextMenu {

    constructor(simulator) {

        this.simulator = simulator;

        // Portapapeles interno (copiar/duplicar)
        this.clipboard = null;

        this.menuEl = null;
        this.submenuEl = null;

        this.bindEvents();

    }

    //------------------------------------------------------
    // Eventos globales
    //------------------------------------------------------

    bindEvents() {

        this.simulator.canvas.addEventListener("contextmenu", (e) => {

            e.preventDefault();

            const componentEl = e.target.closest(".component");

            if (componentEl) {

                const id = componentEl.getAttribute("data-id");
                const component = this.simulator.componentManager.get(id);

                if (component) {

                    if (!this.simulator.selectionManager.selected.includes(id)) {
                        this.simulator.selectionManager.select(id, false);
                    }

                    this.showComponentMenu(component, e.clientX, e.clientY);
                    return;

                }

            }

            this.showCanvasMenu(e.clientX, e.clientY);

        });

        document.addEventListener("pointerdown", (e) => {
            if (this.menuEl && !this.menuEl.contains(e.target) && !(this.submenuEl && this.submenuEl.contains(e.target))) {
                this.close();
            }
        });

        window.addEventListener("keydown", (e) => {
            if (e.key === "Escape") this.close();
        });

        window.addEventListener("blur", () => this.close());
        window.addEventListener("scroll", () => this.close(), true);

        this._bindTouchLongPress();

    }

    //------------------------------------------------------
    // Touch (tablet/celular): no hay clic derecho. Un toque largo
    // (quieto, sin arrastrar) abre el mismo menú que el clic derecho
    // abriría -- mismo patrón que Toolbox._bindTouchDragToAdd() (toque
    // largo para "levantar" un item de la lista).
    //
    // BUG REAL a evitar (visto en la práctica con el mismo patrón en
    // Toolbox.js): DragManager/WireManager/Simulator.bindPanEvents()
    // ya arrancan SU PROPIO arrastre/paneo/dibujo-de-cable en el mismo
    // pointerdown, sin esperar ningún toque largo -- si se deja que
    // sigan "activos" cuando el menú abre, queda un arrastre fantasma
    // a medio hacer (cursor grabbing pegado, pointer capture sin
    // soltar, etc.). Como los tres escuchan "pointerup" en window sin
    // filtrar por pointerId (confirmado leyendo los tres archivos), un
    // solo pointerup sintético alcanza para que los tres limpien su
    // estado ANTES de abrir el menú -- no hace falta tocarlos ni
    // exponer su estado interno (que hoy es privado a cada closure).
    //------------------------------------------------------

    _bindTouchLongPress() {

        const LONG_PRESS_MS = 500;
        const MOVE_CANCEL_PX = 10;

        let timer = null;
        let startX = 0, startY = 0, startPointerId = null;

        const cancelTimer = () => {
            clearTimeout(timer);
            timer = null;
        };

        this.simulator.canvas.addEventListener("pointerdown", (e) => {

            if (e.pointerType !== "touch") return;

            // Sobre un pin el toque es para dibujar un cable nuevo
            // (WireManager) -- no interceptar ese gesto con un menú.
            if (e.target.closest(".pin")) return;

            startX = e.clientX;
            startY = e.clientY;
            startPointerId = e.pointerId;

            timer = setTimeout(() => {

                timer = null;

                window.dispatchEvent(new PointerEvent("pointerup", {
                    clientX: startX, clientY: startY,
                    pointerId: startPointerId, bubbles: true,
                }));

                const target = document.elementFromPoint(startX, startY);
                const componentEl = target?.closest(".component");
                // Incluye los tiradores de codo/tramo (.wire-node-hit,
                // .wire-seg-handle-hit) -- si el toque cae justo sobre
                // uno (lo más probable si el usuario está apuntando a
                // ese codo puntual), no solo sobre la línea del cable.
                const wireEl = target?.closest(".wire-segment, .wire-visual, .wire-node-hit, .wire-seg-handle-hit");

                if (componentEl) {

                    const id = componentEl.getAttribute("data-id");
                    const component = this.simulator.componentManager.get(id);

                    if (component) {
                        if (!this.simulator.selectionManager.selected.includes(id)) {
                            this.simulator.selectionManager.select(id, false);
                        }
                        this.showComponentMenu(component, startX, startY);
                        return;
                    }

                }

                if (wireEl) {
                    const wireId = wireEl.getAttribute("data-wire-id");
                    this.showWireMenu(wireId, startX, startY);
                    return;
                }

                this.showCanvasMenu(startX, startY);

            }, LONG_PRESS_MS);

        });

        this.simulator.canvas.addEventListener("pointermove", (e) => {

            if (e.pointerType !== "touch" || !timer) return;

            if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_CANCEL_PX) {
                cancelTimer();
            }

        });

        this.simulator.canvas.addEventListener("pointerup", cancelTimer);
        this.simulator.canvas.addEventListener("pointercancel", cancelTimer);

    }

    close() {

        if (this.menuEl) { this.menuEl.remove(); this.menuEl = null; }
        if (this.submenuEl) { this.submenuEl.remove(); this.submenuEl = null; }

    }

    //------------------------------------------------------
    // Construcción genérica del menú
    //------------------------------------------------------

    buildMenu(items, x, y) {

        this.close();

        const menu = document.createElement("div");
        menu.className = "context-menu";

        items.forEach(item => {

            if (item === "separator") {
                const sep = document.createElement("div");
                sep.className = "context-menu-separator";
                menu.appendChild(sep);
                return;
            }

            const row = document.createElement("div");
            row.className = "context-menu-item" + (item.disabled ? " disabled" : "");

            const label = document.createElement("span");
            label.textContent = item.label;
            row.appendChild(label);

            if (item.shortcut) {
                const kbd = document.createElement("span");
                kbd.className = "context-menu-shortcut";
                kbd.textContent = item.shortcut;
                row.appendChild(kbd);
            }

            if (item.submenu && !item.disabled) {

                const arrow = document.createElement("span");
                arrow.className = "context-menu-arrow";
                arrow.textContent = "▶";
                row.appendChild(arrow);

                row.addEventListener("mouseenter", () => this.openSubmenu(item.submenu, row));

                // Touch (tablet/celular): no hay "hover" -- sin esto, un
                // submenú (ej. "Girar") nunca se abre, solo con mouse. Un
                // tap hace lo mismo que el mouseenter de arriba.
                row.addEventListener("click", () => this.openSubmenu(item.submenu, row));

            } else if (!item.disabled) {

                row.addEventListener("click", () => {
                    item.action();
                    this.close();
                });

            }

            menu.appendChild(row);

        });

        document.body.appendChild(menu);

        this.positionElement(menu, x, y);

        this.menuEl = menu;

        return menu;

    }

    openSubmenu(items, parentRow) {

        if (this.submenuEl) { this.submenuEl.remove(); this.submenuEl = null; }

        const submenu = document.createElement("div");
        submenu.className = "context-menu context-submenu";

        items.forEach(item => {

            const row = document.createElement("div");
            row.className = "context-menu-item";
            row.textContent = item.label;

            row.addEventListener("click", () => {
                item.action();
                this.close();
            });

            submenu.appendChild(row);

        });

        document.body.appendChild(submenu);

        const parentRect = parentRow.getBoundingClientRect();
        this.positionElement(submenu, parentRect.right - 4, parentRect.top, true);

        this.submenuEl = submenu;

    }

    //------------------------------------------------------
    // Posicionar sin salirse de la pantalla
    //------------------------------------------------------

    positionElement(el, x, y, isSubmenu = false) {

        const rect = el.getBoundingClientRect();

        let left = x;
        let top  = y;

        if (left + rect.width > window.innerWidth) {
            left = isSubmenu ? x - rect.width - 4 : window.innerWidth - rect.width - 8;
        }

        if (top + rect.height > window.innerHeight) {
            top = window.innerHeight - rect.height - 8;
        }

        el.style.left = `${Math.max(4, left)}px`;
        el.style.top  = `${Math.max(4, top)}px`;

    }

    //------------------------------------------------------
    // Menú sobre un componente seleccionado
    //------------------------------------------------------

    showComponentMenu(component, x, y) {

        const isLocked = component.locked;

        const items = [
            {
                label: "Girar",
                submenu: [
                    { label: "90° a la derecha", action: () => this.rotateBy(component, 90) },
                    { label: "90° a la izquierda", action: () => this.rotateBy(component, -90) },
                    { label: "180°", action: () => this.rotateBy(component, 180) },
                ]
            },
            { label: "Voltear horizontal", action: () => this.flip(component) },
            "separator",
            {
                label: "Aumentar y disminuir",
                submenu: [
                    { label: "Acercar (+)", action: () => this.simulator.zoomIn() },
                    { label: "Alejar (−)", action: () => this.simulator.zoomOut() },
                ]
            },
            "separator",
            {
                label: isLocked ? "Desbloquear componente" : "Bloquear componente",
                action: () => this.toggleLock(component)
            },
            {
                label: component.showName ? "Ocultar nombre" : "Mostrar el nombre del componente",
                action: () => this.toggleName(component)
            },
            "separator",
            { label: "Copiar", shortcut: "Ctrl+C", action: () => this.copy(component) },
            { label: "Duplicar", shortcut: "Ctrl+D", action: () => this.duplicate(component) },
            { label: "Borrar", shortcut: "Del", disabled: isLocked, action: () => this.simulator.deleteSelection() },
        ];

        this.buildMenu(items, x, y);

    }

    //------------------------------------------------------
    // Menú en zona vacía del canvas
    //------------------------------------------------------

    showCanvasMenu(x, y) {

        const items = [
            { label: "Acercar (+)", action: () => this.simulator.zoomIn() },
            { label: "Alejar (−)", action: () => this.simulator.zoomOut() },
            "separator",
            {
                label: "Pegar",
                shortcut: "Ctrl+V",
                disabled: !this.clipboard,
                action: () => this.pasteAt(x, y)
            },
        ];

        this.buildMenu(items, x, y);

    }

    //------------------------------------------------------
    // Menú sobre un cable -- equivalente táctil de "doble click sobre
    // el codo para borrarlo" (WireManager.onWireLayerDblClick) y de
    // "Del/Backspace con el cable seleccionado" (Simulator's
    // deleteSelection), ninguno de los dos alcanzable en touch. Mismo
    // criterio de undo/redo que esos dos usan.
    //------------------------------------------------------

    showWireMenu(wireId, x, y) {

        const wireManager = this.simulator.wireManager;
        const wire = wireManager.wires.find(w => w.id === wireId);

        if (!wire) return;

        wireManager.setSelectedWire(wireId);
        wireManager.setSelectedPoint(null);

        // ¿El toque cayó cerca de un codo puntual? Mismo radio de
        // "zona de click" que ya usan los tiradores de codo
        // (.wire-node-hit/.wire-seg-handle-hit, ver WireManager.renderAll).
        const canvasPt = Utils.getCanvasPoint(this.simulator.componentLayer, x, y);
        const HIT_RADIUS = 16;
        let elbowIndex = -1;
        let elbowDist = HIT_RADIUS;

        wire.points.forEach((p, i) => {
            const d = Math.hypot(p.x - canvasPt.x, p.y - canvasPt.y);
            if (d < elbowDist) { elbowDist = d; elbowIndex = i; }
        });

        const items = [];

        if (elbowIndex >= 0) {
            items.push({
                label: "Borrar este codo",
                action: () => {
                    const removedPoint = wire.points[elbowIndex];
                    wire.points.splice(elbowIndex, 1);
                    wireManager.renderAll();
                    this.simulator.history.push({
                        undo: () => { wire.points.splice(elbowIndex, 0, removedPoint); wireManager.renderAll(); },
                        redo: () => { wire.points.splice(elbowIndex, 1); wireManager.renderAll(); }
                    });
                }
            });
            items.push("separator");
        }

        items.push({
            label: "Eliminar cable",
            shortcut: "Del",
            action: () => {
                wireManager.removeWire(wireId);
                wireManager.selectedWire = null;
                this.simulator.eventBus.emit("wire:selected", null);
                this.simulator.history.push({
                    undo: () => {
                        wireManager.wires.push(wire);
                        wireManager.renderAll();
                        this.simulator.eventBus.emit("wire:added", wire);
                    },
                    redo: () => { wireManager.removeWire(wire.id); }
                });
            }
        });

        this.buildMenu(items, x, y);

    }

    //------------------------------------------------------
    // Acciones: rotar / voltear
    //------------------------------------------------------

    rotateBy(component, deltaDeg) {

        const before = component.rotation;
        const after  = ((before + deltaDeg) % 360 + 360) % 360;

        component.setRotation(after);
        this.refresh();

        this.simulator.history.push({
            undo: () => { component.setRotation(before); this.refresh(); },
            redo: () => { component.setRotation(after);  this.refresh(); }
        });

    }

    flip(component) {

        const before = !!component.flipX;
        const after  = !before;

        component.setFlip(after);
        this.refresh();

        this.simulator.history.push({
            undo: () => { component.setFlip(before); this.refresh(); },
            redo: () => { component.setFlip(after);  this.refresh(); }
        });

    }

    refresh() {
        this.simulator.selectionManager.renderHighlight();
        this.simulator.wireManager.renderAll();
    }

    //------------------------------------------------------
    // Bloquear / mostrar nombre
    //------------------------------------------------------

    toggleLock(component) {

        component.locked = !component.locked;

        if (component.element) {
            component.element.classList.toggle("locked", component.locked);
        }

        // Si se bloqueó estando seleccionado, quitamos la manija de rotación
        this.simulator.selectionManager.renderHighlight();

    }

    toggleName(component) {

        if (!component.element) return;

        component.showName = !component.showName;
        component.element.classList.toggle("show-name", component.showName);

    }

    //------------------------------------------------------
    // Copiar / duplicar / pegar
    //------------------------------------------------------

    copy(component) {

        this.clipboard = JSON.parse(JSON.stringify({
            type: component.type,
            name: component.name,
            width: component.width,
            height: component.height,
            rotation: component.rotation,
            scale: component.scale,
            flipX: component.flipX,
            pinShape: component.pinShape,
            pinSize: component.pinSize,
            colorTargets: component.colorTargets,
            svgPath: component.svgPath,
            pins: component.pins,
            properties: component.properties,
        }));

    }

    async duplicate(component) {

        this.copy(component);
        await this.createFromClipboard(component.x + 30, component.y + 30);

    }

    async pasteAt(clientX, clientY) {

        if (!this.clipboard) return;

        const point = Utils.getCanvasPoint(this.simulator.componentLayer, clientX, clientY);

        await this.createFromClipboard(point.x, point.y);

    }

    async createFromClipboard(x, y) {

        if (!this.clipboard) return;

        const data = { ...this.clipboard, id: undefined, x, y };

        const component = new Component(data);

        await this.simulator.addComponent(component);

        this.simulator.selectionManager.select(component.id, false);

        this.simulator.history.push({
            undo: () => this.simulator.removeComponent(component.id),
            redo: () => this.simulator.addComponent(component)
        });

    }

}
