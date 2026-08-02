/*
==========================================================
 PitSimulator
 Archivo: Toolbox.js
 Panel izquierdo: lista de componentes disponibles,
 arrastrables hacia el canvas. Soporta manifest.json
 como array simple ["led_red", ...] o como objeto con
 categorías { "components": [{ type, name, category }] }
==========================================================
*/

class Toolbox {

    constructor(simulator) {

        this.simulator = simulator;

        this.listEl = document.getElementById("componentList");

        // Entradas del manifest: [{ type, name, category }]
        this.entries = [];

        // Definiciones cacheadas por tipo
        this.definitions = {};

        // svgData cacheado por tipo (para poder armar la imagen de
        // arrastre sin tener que re-cargar el .svg en cada dragstart)
        this.svgCache = {};

        this.init();

    }

    //------------------------------------------------------
    // Cargar el manifiesto y armar la lista
    //------------------------------------------------------

    async init() {

        const raw = await Utils.loadJSON("components/manifest.json") || [];

        // Soportar ambos formatos:
        // Formato A (legacy): ["led_red", "led_green", ...]
        // Formato B (nuevo):  { "components": [{ type, name, category }, ...] }
        if (Array.isArray(raw)) {
            this.entries = raw.map(type => ({ type, name: type, category: "General" }));
        } else if (raw.components && Array.isArray(raw.components)) {
            // "hidden": true -- componente que sigue existiendo (json/svg/
            // hal.py intactos, se puede seguir cargando con createFromDefinition
            // si algún proyecto viejo lo usaba) pero no aparece en la lista
            // para arrastrar -- ej. bmp180 mientras se prioriza bmp280.
            this.entries = raw.components.filter(entry => !entry.hidden);
        } else {
            this.entries = [];
        }

        await this.renderList();

        this.bindDropZone();

    }

    //------------------------------------------------------
    // Dibujar las tarjetas del panel izquierdo
    //------------------------------------------------------

    async renderList() {

        this.listEl.innerHTML = "";

        // Agrupar por categoría
        const categories = {};

        for (const entry of this.entries) {

            const cat = entry.category || "General";

            if (!categories[cat]) categories[cat] = [];

            // Cargar la definición JSON del componente para obtener
            // el nombre real (puede diferir del que está en el manifest)
            const definition = await Utils.loadJSON(
                `components/${entry.type}/${entry.type}.json`
            );

            this.definitions[entry.type] = definition;

            const displayName = definition?.name || entry.name || entry.type;

            categories[cat].push({ ...entry, displayName });

        }

        // Renderizar por categoría
        for (const [category, items] of Object.entries(categories)) {

            // Encabezado de categoría
            const catHeader = document.createElement("div");
            catHeader.className = "toolbox-category";
            catHeader.textContent = category;
            this.listEl.appendChild(catHeader);

            // Items de la categoría
            for (const item of items) {

                const el = document.createElement("div");
                el.className = "toolbox-item";
                el.dataset.type = item.type;
                el.setAttribute("draggable", "true");
                el.title = item.displayName; // nombre solo como tooltip

                const thumb = document.createElement("div");
                thumb.className = "toolbox-thumb";
                thumb.textContent = "…";

                el.appendChild(thumb);

                this.loadThumbnail(item, thumb);

                el.addEventListener("dragstart", (e) => {

                    e.dataTransfer.setData("text/plain", item.type);
                    e.dataTransfer.effectAllowed = "copy";
                    el.classList.add("dragging");

                    // Imagen de arrastre personalizada: el navegador genera
                    // automáticamente una a partir del elemento arrastrado,
                    // pero con SVGs inline complejos esa captura suele salir
                    // rota/negra en varios navegadores. Usamos en su lugar
                    // una <img> real con el mismo SVG como data-URI.
                    const dragImg = this._buildDragImage(item.type);
                    if (dragImg) {
                        e.dataTransfer.setDragImage(dragImg, 32, 32);
                    }

                });

                el.addEventListener("dragend", () => {
                    el.classList.remove("dragging");
                });

                // Clic (sin arrastrar) -- a pedido, ver de qué se
                // trata un componente antes de arrastrarlo al lienzo.
                // window.propertyPanel en vez de un campo propio: se
                // resuelve recién acá, al momento del clic (para
                // entonces app.js ya terminó de inicializar todo),
                // así Toolbox.js no necesita que PropertyPanel exista
                // todavía en el momento en que ESTE método corre (el
                // orden real de creación en app.js es Toolbox antes
                // que PropertyPanel).
                el.addEventListener("click", () => {
                    this.simulator.selectionManager.clear();
                    window.propertyPanel?.showPreview(this.definitions[item.type], item.type);
                });

                // Touch (tablet/celular): el Drag&Drop nativo de HTML5 de
                // arriba (dragstart/dragend) NUNCA dispara con touch --
                // ningún navegador lo soporta, en ningún celular/tablet
                // (confirmado en la práctica, no es un detalle de este
                // proyecto). Mouse/lápiz siguen usando el D&D nativo de
                // arriba sin tocar nada; esto es un camino aparte, que
                // solo se activa para e.pointerType === "touch".
                this._bindTouchDragToAdd(el, item.type);

                this.listEl.appendChild(el);

            }

        }

    }

    //------------------------------------------------------
    // Construir una <img> a partir del SVG cacheado del componente --
    // la usan dos casos distintos:
    //  - dragstart (D&D nativo, mouse/lápiz): dataTransfer.setDragImage()
    //    necesita el <img> momentáneamente en el DOM para poder
    //    capturarla; attachAndAutoRemove=true (default) la agrega fuera
    //    de la vista y la saca sola apenas el navegador la captura.
    //  - _bindTouchDragToAdd (touch): el "fantasma" que sigue al dedo
    //    tiene que persistir y moverse durante todo el arrastre --
    //    attachAndAutoRemove=false devuelve el <img> SIN agregarlo ni
    //    programar su borrado, el llamador controla su ciclo de vida.
    //------------------------------------------------------

    _buildDragImage(type, attachAndAutoRemove = true) {

        const svgData = this.svgCache[type];
        if (!svgData) return null;

        const { inner, viewBox } = svgData;
        const size = 64;

        const svgMarkup =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
            `viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}">` +
            `<rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="#1e1f22"/>` +
            inner +
            `</svg>`;

        const img = new Image(size, size);
        img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgMarkup)));

        if (!attachAndAutoRemove) return img;

        img.style.position = "fixed";
        img.style.top  = "-9999px";
        img.style.left = "-9999px";

        document.body.appendChild(img);

        // Ya no hace falta una vez que el navegador tomó la captura
        // para el drag (ocurre de forma síncrona en dragstart)
        setTimeout(() => img.remove(), 0);

        return img;

    }

    //------------------------------------------------------
    // Cargar y dibujar la miniatura real del componente
    // (usa el mismo cache de SVGs que el Renderer)
    //------------------------------------------------------

    async loadThumbnail(item, container) {

        const definition = this.definitions[item.type];

        const svgPath = definition?.svgPath
            || definition?.svg
            || `components/${item.type}/${item.type}.svg`;

        const svgData = await this.simulator.renderer.loadSVG(svgPath);

        if (!svgData) {
            container.textContent = "🔧";
            return;
        }

        this.svgCache[item.type] = svgData;

        const { inner, viewBox } = svgData;

        container.innerHTML = `
            <svg viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"
                 preserveAspectRatio="xMidYMid meet">
                ${inner}
            </svg>
        `;

    }

    //------------------------------------------------------
    // Drop zone: soltar sobre el canvas crea el componente
    //------------------------------------------------------

    bindDropZone() {

        const workspace = document.getElementById("workspace");

        workspace.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        });

        workspace.addEventListener("drop", async (e) => {

            e.preventDefault();

            const type = e.dataTransfer.getData("text/plain");

            await this._addComponentAt(type, e.clientX, e.clientY);

        });

    }

    //------------------------------------------------------
    // Agregar un componente en las coordenadas de pantalla dadas
    // (centrado ahí) -- comun al drop de mouse/D&D nativo de arriba y
    // al touch-drag de abajo, para no duplicar esta lógica en los dos.
    //------------------------------------------------------

    async _addComponentAt(type, clientX, clientY) {

        // Mismo candado que ya bloquea mover componentes (DragManager)
        // y editar cables (WireManager.locked) mientras la simulación
        // está corriendo -- agregar un componente NUEVO al circuito en
        // pleno "Simular" no tiene sentido (QEMU ya arrancó con el
        // circuito de ese momento) y antes no estaba bloqueado.
        if (this.simulator.isRunning) {

            const status = document.getElementById("statusText");
            if (status) {

                const previousText  = status.textContent;
                const previousColor = status.style.color;

                status.textContent = "⚠ Detené la simulación para agregar componentes.";
                status.style.color = "#ff5252";

                clearTimeout(this._simRunningAddTimeout);
                this._simRunningAddTimeout = setTimeout(() => {
                    status.textContent = previousText;
                    status.style.color = previousColor;
                }, 4000);

            }

            return null;

        }

        const validTypes = this.entries.map(entry => entry.type);

        if (!type || !validTypes.includes(type)) return null;

        const point = Utils.getCanvasPoint(
            this.simulator.componentLayer,
            clientX,
            clientY
        );

        const definition = this.definitions[type];
        const width  = definition?.width  || 50;
        const height = definition?.height || 50;

        const x = Utils.snapToGrid(point.x - width  / 2);
        const y = Utils.snapToGrid(point.y - height / 2);

        const component = await this.simulator.addComponentByType(type, { x, y });

        if (component) {
            this.simulator.history.push({
                undo: () => this.simulator.removeComponent(component.id),
                redo: () => this.simulator.addComponent(component)
            });
        }

        return component;

    }

    //------------------------------------------------------
    // Touch: arrastrar un item de la lista al canvas para agregarlo
    // (equivalente al Drag&Drop nativo de arriba, que no dispara con
    // touch en NINGÚN navegador). Toque largo para "levantar" el item,
    // a propósito: #toolbox tiene overflow:auto (la lista scrollea en
    // pantallas chicas) -- mismo patrón que reordenar íconos en un
    // celular.
    //
    // BUG REAL encontrado probando esto en la práctica: .toolbox-item
    // necesita touch-action:none (ver simulator.css) para que el toque
    // largo funcione en absoluto -- con touch-action:auto (el default),
    // el navegador decide en el PRIMER movimiento real si el gesto es
    // scroll nativo y cancela el puntero (pointercancel) sin importar
    // que el timer de JS ya hubiera "ganado" el gesto; esa decisión se
    // toma en base al CSS vigente al EMPEZAR el toque, no se puede
    // revertir a mitad de camino. Pero eso significa que el scroll
    // nativo de la lista queda inutilizado -- por eso, mientras el
    // toque largo todavía no se cumplió, cualquier movimiento se
    // interpreta como intento de scrollear y se hace a mano (mover
    // #toolbox.scrollTop/scrollLeft el mismo delta que el dedo).
    //------------------------------------------------------

    _bindTouchDragToAdd(el, type) {

        const LONG_PRESS_MS = 350;
        const MOVE_CANCEL_PX = 10;

        const toolboxEl = document.getElementById("toolbox");

        let pressTimer = null;
        let startX = 0, startY = 0;
        let lastX = 0, lastY = 0;
        let ghost = null;
        let dragging = false;
        let scrolling = false;
        let pointerId = null;

        const cancelPress = () => {
            clearTimeout(pressTimer);
            pressTimer = null;
        };

        const cleanup = () => {
            cancelPress();
            if (ghost) { ghost.remove(); ghost = null; }
            el.classList.remove("dragging");
            dragging = false;
            scrolling = false;
            if (pointerId !== null) {
                try { el.releasePointerCapture(pointerId); } catch (err) { }
            }
            pointerId = null;
        };

        const moveGhost = (x, y) => {
            if (!ghost) return;
            ghost.style.left = `${x - 32}px`;
            ghost.style.top  = `${y - 32}px`;
        };

        el.addEventListener("pointerdown", (e) => {

            if (e.pointerType !== "touch") return;

            startX = lastX = e.clientX;
            startY = lastY = e.clientY;
            pointerId = e.pointerId;

            try { el.setPointerCapture(pointerId); } catch (err) { }

            pressTimer = setTimeout(() => {

                dragging = true;
                pressTimer = null;

                ghost = this._buildDragImage(type, false);
                if (ghost) {
                    ghost.style.position = "fixed";
                    ghost.style.zIndex = "9999";
                    ghost.style.pointerEvents = "none";
                    ghost.style.opacity = "0.85";
                    ghost.style.filter = "drop-shadow(0 2px 6px rgba(0,0,0,0.5))";
                    document.body.appendChild(ghost);
                    moveGhost(startX, startY);
                }

                el.classList.add("dragging");

            }, LONG_PRESS_MS);

        });

        el.addEventListener("pointermove", (e) => {

            if (e.pointerType !== "touch" || pointerId === null) return;

            if (dragging) {
                moveGhost(e.clientX, e.clientY);
                return;
            }

            const dx = e.clientX - lastX, dy = e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;

            if (!scrolling) {
                const total = Math.hypot(e.clientX - startX, e.clientY - startY);
                if (total <= MOVE_CANCEL_PX) return; // podría ser el inicio de un toque largo quieto
                scrolling = true;
                cancelPress();
            }

            if (toolboxEl) toolboxEl.scrollTop -= dy;

        });

        el.addEventListener("pointerup", async (e) => {

            if (e.pointerType !== "touch") return;

            const wasDragging = dragging;
            const dropX = e.clientX, dropY = e.clientY;

            cleanup();

            if (!wasDragging) return;

            const workspace = document.getElementById("workspace");
            const wsBox = workspace.getBoundingClientRect();
            const overCanvas =
                dropX >= wsBox.left && dropX <= wsBox.right &&
                dropY >= wsBox.top  && dropY <= wsBox.bottom;

            if (overCanvas) {
                await this._addComponentAt(type, dropX, dropY);
            }

        });

        el.addEventListener("pointercancel", cleanup);

    }

}