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
