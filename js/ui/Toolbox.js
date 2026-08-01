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

                this.listEl.appendChild(el);

            }

        }

    }

    //------------------------------------------------------
    // Construir una <img> a partir del SVG cacheado del componente,
    // para usar como imagen de arrastre (dataTransfer.setDragImage).
    // Se agrega momentáneamente al DOM (fuera de la vista) porque
    // algunos navegadores lo requieren para poder capturarla.
    //------------------------------------------------------

    _buildDragImage(type) {

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

            const validTypes = this.entries.map(entry => entry.type);

            if (!type || !validTypes.includes(type)) return;

            const point = Utils.getCanvasPoint(
                this.simulator.componentLayer,
                e.clientX,
                e.clientY
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

        });

    }

}