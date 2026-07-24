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

            const bezel = document.createElementNS(Utils.SVG_NS, "rect");
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

            const CELL_PX = 24;
            canvas.width = cols * CELL_PX;
            canvas.height = rows * CELL_PX;

            fo.appendChild(canvas);
            graphic.appendChild(fo);

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
