/*
==========================================================
 PitSimulator — neopixel_matrix.behavior.js
 Comportamiento de render de la matriz NeoPixel, migrado tal
 cual desde Renderer.tagNeopixelElements() hacia
 ComponentBehaviorRegistry.

 A diferencia de la mayoría de los tipos migrados,
 Renderer.tagNeopixelElements() SIGUE existiendo en Renderer.js
 como wrapper delgado -- tiene llamadores externos directos
 (PropertyPanel.js al cambiar rows/cols, y el propio
 drawNeopixelFrame() de Renderer.js cuando detecta un cambio de
 tamaño) que lo invocan por nombre.
 clearNeopixelGrid()/drawNeopixelFrame() siguen viviendo en
 Renderer.js -- se llaman vía "renderer".
==========================================================
*/

ComponentBehaviorRegistry.register("neopixel_matrix", {

    render: {

        usesCodeGraphic: true,

        tag(component, graphic, renderer) {

            const cols = component.properties?.cols || 8;
            const rows = component.properties?.rows || 8;

            component.properties.cols = cols;
            component.properties.rows = rows;

            graphic.innerHTML = ""; // por si se está re-armando (cambio de tamaño)

            const pad = 8;
            const CELL_PX = 24; // resolución nativa del <canvas> (nitidez), NO el tamaño físico -- ver _matrixDisplaySize.

            // El tamaño físico del componente CRECE con cols/rows (a
            // pedido: "cuando lo hago mas grande no crece entonces no se
            // vera bien"), pero SUB-lineal (raíz cuadrada), no 1:1 con
            // CELL_PX -- a pedido explícito de una segunda vuelta: "el
            // tamaño al agregar otra fila es mucho, deberia crecer
            // solamente un poco no tanto". 24px por celda 1:1 hacía que
            // una 32x32 fuera ~4x más ancha que la 8x8 default (784px);
            // con raíz cuadrada el mismo salto queda en ~2x (400px) --
            // sigue creciendo, pero no se dispara. BASE_DIM=8 hace que el
            // tamaño para 8x8 (el default del .json) no cambie ni un
            // píxel respecto a antes.
            const BASE_DIM = 8;
            const _matrixDisplaySize = (n) => CELL_PX * Math.sqrt(BASE_DIM * n);

            const newWidth = _matrixDisplaySize(cols) + pad * 2;
            const newHeight = _matrixDisplaySize(rows) + pad * 2;

            component.width = newWidth;
            component.height = newHeight;

            // Pines VCC/DIN/GND en un cluster CHICO y FIJO pegado al
            // centro del borde inferior -- a pedido: "los pines estan
            // muy separados cuando deberian estar mas juntos". Antes se
            // reescalaban proporcionalmente al ancho (estilo max7219),
            // lo que los mantenía esparcidos de punta a punta del
            // módulo sin importar el tamaño; acá van con un offset FIJO
            // desde el centro (no proporcional), así quedan juntos
            // incluso en una matriz grande -- mismo criterio que ya usa
            // neopixel_ring.behavior.js para su propio tab de pines.
            const centerX = newWidth / 2;
            const pinGap = 20;
            const vccPin = component.pins.find((p) => p.id === "vcc");
            const dinPin = component.pins.find((p) => p.id === "din");
            const gndPin = component.pins.find((p) => p.id === "gnd");
            if (vccPin) { vccPin.x = centerX - pinGap; vccPin.y = newHeight; }
            if (dinPin) { dinPin.x = centerX;          dinPin.y = newHeight; }
            if (gndPin) { gndPin.x = centerX + pinGap; gndPin.y = newHeight; }

            const bezel = document.createElementNS(Utils.SVG_NS, "rect");
            // (etiquetas VCC/DIN/GND horneadas más abajo, después del
            // bisel/canvas, para quedar dibujadas por encima)
            bezel.setAttribute("data-neo-role", "bezel");
            bezel.setAttribute("x", 0);
            bezel.setAttribute("y", 0);
            bezel.setAttribute("width", component.width);
            bezel.setAttribute("height", component.height);
            bezel.setAttribute("rx", 6);
            bezel.setAttribute("ry", 6);
            bezel.setAttribute("fill", "#1a1a1a");
            bezel.setAttribute("stroke", "#000");
            bezel.setAttribute("stroke-width", "1");
            graphic.appendChild(bezel);

            const fo = document.createElementNS(Utils.SVG_NS, "foreignObject");
            fo.setAttribute("data-neo-role", "grid-wrap");
            fo.setAttribute("x", pad);
            fo.setAttribute("y", pad);
            fo.setAttribute("width", Math.max(1, component.width - pad * 2));
            fo.setAttribute("height", Math.max(1, component.height - pad * 2));

            const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
            canvas.setAttribute("data-neo-role", "grid");
            canvas.style.cssText = "width:100%; height:100%; display:block;";

            canvas.width = cols * CELL_PX;
            canvas.height = rows * CELL_PX;

            fo.appendChild(canvas);
            graphic.appendChild(fo);

            // Etiquetas VCC/DIN/GND horneadas directo en el propio
            // dibujo (mismo criterio que qmc5883l.svg/gps.svg) --
            // debajo de cada pin, sobre el borde inferior del bisel.
            const labelY = newHeight + 10;
            [["VCC", centerX - pinGap], ["DIN", centerX], ["GND", centerX + pinGap]].forEach(([text, lx]) => {
                const label = document.createElementNS(Utils.SVG_NS, "text");
                label.setAttribute("x", lx);
                label.setAttribute("y", labelY);
                label.setAttribute("text-anchor", "middle");
                label.setAttribute("dominant-baseline", "hanging");
                label.setAttribute("fill", "#ffffff");
                label.setAttribute("font-family", "DroidSans, sans-serif");
                label.setAttribute("font-size", "9");
                label.setAttribute("font-weight", "bold");
                graphic.appendChild(label);
                label.textContent = text;
            });

            if (component.element) {
                component.element
                    .querySelectorAll(":scope > .pin")
                    .forEach((p) => p.remove());
                renderer.renderPins(component, component.element);

                if (component.selected) {
                    renderer.simulator?.selectionManager?.renderHighlight();
                }

                // Los cables ya conectados leen la posición del pin en
                // vivo (Component.getPinPosition), pero WireManager solo
                // vuelve a dibujar las líneas ante eventos puntuales (mover
                // un componente, etc.) -- un cambio de Columnas/Filas no
                // dispara ninguno de esos, así que sin este empujón los
                // cables se quedaban apuntando a la posición VIEJA del pin
                // mientras el módulo crecía/achicaba.
                renderer.simulator?.wireManager?.renderAll();
            }

            renderer.clearNeopixelGrid(component);

        },

    },

    propertyPanel: {

        // Migrado tal cual desde PropertyPanel._renderNeopixelMatrix().
        render(component, panel) {

            panel.content.innerHTML = "";

            component.properties = component.properties || {};
            if (!component.properties.cols)  component.properties.cols  = 8;
            if (!component.properties.rows)  component.properties.rows = 8;
            if (!component.properties.shape) component.properties.shape = "square";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "Matriz de NeoPixel";
            panel.content.appendChild(title);

            const label = document.createElement("label");
            label.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            label.textContent = "Tamaño de la matriz";
            panel.content.appendChild(label);

            const sizeRow = document.createElement("div");
            sizeRow.style.cssText = "display:flex; gap:8px; margin-bottom:16px;";

            const rebuildGrid = () => {
                const graphic = component.element?.querySelector(".component-graphic");
                if (graphic) panel.simulator.renderer.tagNeopixelElements(component, graphic);
            };

            sizeRow.appendChild(panel._makeNumberField("Columnas", component.properties.cols, (val) => {
                const cols = Math.max(1, Math.min(64, Math.round(val) || 1));
                component.properties.cols = cols;
                rebuildGrid();
            }));

            sizeRow.appendChild(panel._makeNumberField("Filas", component.properties.rows, (val) => {
                const rows = Math.max(1, Math.min(64, Math.round(val) || 1));
                component.properties.rows = rows;
                rebuildGrid();
            }));

            panel.content.appendChild(sizeRow);

            const shapeLabel = document.createElement("label");
            shapeLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            shapeLabel.textContent = "Forma del LED";
            panel.content.appendChild(shapeLabel);

            const shapes = [
                { value: "square", text: "Cuadrado" },
                { value: "circle", text: "Círculo" },
            ];

            const shapeGroup = document.createElement("div");
            shapeGroup.style.cssText = "display:flex; gap:8px; margin-bottom:16px;";

            shapes.forEach(({ value, text }) => {

                const btn = document.createElement("button");
                btn.className = "property-flip-btn";
                btn.style.cssText = "flex:1; padding:8px 10px;";
                if (component.properties.shape === value) btn.classList.add("active");
                btn.textContent = text;

                btn.addEventListener("click", () => {

                    if (component.properties.shape === value) return;
                    component.properties.shape = value;

                    // Repintar con el último frame que tengamos (si el
                    // firmware ya mandó algo) para que el cambio de forma
                    // se note al toque, sin esperar al próximo .show().
                    if (component.lastNeopixelFrame) {
                        const { rgbBytes, width, height } = component.lastNeopixelFrame;
                        panel.simulator.renderer.drawNeopixelFrame(component, rgbBytes, width, height);
                    } else {
                        panel.simulator.renderer.clearNeopixelGrid(component);
                    }

                    ComponentBehaviorRegistry.get(component.type).propertyPanel.render(component, panel); // re-pintar para reflejar el botón activo

                });

                shapeGroup.appendChild(btn);

            });

            panel.content.appendChild(shapeGroup);

            const note = document.createElement("div");
            note.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;";
            note.textContent = "El tamaño real de la matriz lo define tu código MicroPython (NeoMatrix(pin, width, height, ...)) -- estos valores son solo para que el panel se vea igual mientras probás. Si el firmware manda un frame de otro tamaño, el panel se reacomoda solo.";
            panel.content.appendChild(note);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
