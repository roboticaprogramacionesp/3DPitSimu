/*
==========================================================
 PitSimulator — max7219.behavior.js
 Comportamiento de render de la matriz MAX7219, migrado tal
 cual desde Renderer.tagMax7219Elements() hacia
 ComponentBehaviorRegistry.

 Igual criterio que neopixel_matrix.behavior.js:
 Renderer.tagMax7219Elements() sigue existiendo como wrapper
 delgado (llamadores externos: PropertyPanel.js y el propio
 drawMax7219Framebuffer() de Renderer.js). Renderer.MAX7219_LED_UNIT_SIZE
 sigue siendo un static de Renderer -- se referencia como global.
==========================================================
*/

ComponentBehaviorRegistry.register("max7219", {

    render: {

        usesCodeGraphic: true,

        tag(component, graphic, renderer) {

            const cols = component.properties?.cols || 8;
            const rows = component.properties?.rows || 8;

            component.properties.cols = cols;
            component.properties.rows = rows;

            graphic.innerHTML = "";

            const pad = 8;

            const newWidth = cols * Renderer.MAX7219_LED_UNIT_SIZE + pad * 2;
            const newHeight = rows * Renderer.MAX7219_LED_UNIT_SIZE + pad * 2;

            component.width = newWidth;
            component.height = newHeight;

            // Pines en columna vertical sobre el borde IZQUIERDO, de
            // abajo hacia arriba -- a pedido: "pon los pines de lado
            // izquierdo de abajo hacia arriba esto para evitar que al
            // cambiar de 8x8 a 16x8 o 32x8 los pines se muevan". Los 3
            // presets del panel (8x8/16x8/32x8) SOLO cambian `cols`,
            // `rows` siempre queda en 8 -- antes los pines vivían abajo
            // repartidos a lo ANCHO (proporcional a newWidth), así que
            // cambiar de preset los corría de lugar cada vez. Puestos
            // acá, en x=0 fijo y con y repartido en función de newHeight
            // (que no cambia entre presets), quedan en la MISMA posición
            // pase lo que pase con `cols`.
            const PIN_ORDER = ["vcc", "gnd", "din", "cs", "clk", "dout"];
            const pinMarginY = 16;
            const usableH = Math.max(0, newHeight - pinMarginY * 2);
            const pinStep = PIN_ORDER.length > 1 ? usableH / (PIN_ORDER.length - 1) : 0;
            PIN_ORDER.forEach((id, i) => {
                const pin = component.pins.find((p) => p.id === id);
                if (!pin) return;
                pin.x = 0;
                pin.y = newHeight - pinMarginY - i * pinStep;
            });

            // Etiquetas horneadas directo en el propio dibujo (mismo
            // criterio que qmc5883l.svg/gps.svg) -- a la izquierda de
            // cada pin, ya que los 6 quedan alineados sobre x=0 (borde
            // izquierdo). Se arman ahora (mismas coordenadas que recién
            // se calcularon) pero se agregan al gráfico DESPUÉS del
            // bisel/canvas más abajo, para quedar dibujadas encima.
            const labelTexts = { vcc: "VCC", gnd: "GND", din: "DIN", cs: "CS", clk: "CLK", dout: "DOUT" };
            const pinLabelDefs = PIN_ORDER.map((id, i) => ({
                id,
                text: labelTexts[id],
                y: newHeight - pinMarginY - i * pinStep,
            }));

            const bezel = document.createElementNS(Utils.SVG_NS, "rect");
            bezel.setAttribute("data-max-role", "bezel");
            bezel.setAttribute("x", 0);
            bezel.setAttribute("y", 0);
            bezel.setAttribute("width", component.width);
            bezel.setAttribute("height", component.height);
            bezel.setAttribute("rx", 4);
            bezel.setAttribute("ry", 4);
            bezel.setAttribute("fill", "#111");
            bezel.setAttribute("stroke", "#000");
            bezel.setAttribute("stroke-width", "1");
            graphic.appendChild(bezel);

            const fo = document.createElementNS(Utils.SVG_NS, "foreignObject");
            fo.setAttribute("data-max-role", "grid-wrap");
            fo.setAttribute("x", pad);
            fo.setAttribute("y", pad);
            fo.setAttribute("width", Math.max(1, component.width - pad * 2));
            fo.setAttribute("height", Math.max(1, component.height - pad * 2));

            const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
            canvas.setAttribute("data-max-role", "grid");
            canvas.style.cssText = "width:100%; height:100%; display:block;";

            const CELL_PX = Renderer.MAX7219_LED_UNIT_SIZE;
            canvas.width = cols * CELL_PX;
            canvas.height = rows * CELL_PX;

            fo.appendChild(canvas);
            graphic.appendChild(fo);

            const LABEL_GAP = 8;
            pinLabelDefs.forEach(({ text, y }) => {
                const label = document.createElementNS(Utils.SVG_NS, "text");
                label.setAttribute("x", -LABEL_GAP);
                label.setAttribute("y", y);
                label.setAttribute("text-anchor", "end");
                label.setAttribute("dominant-baseline", "middle");
                label.setAttribute("fill", "#ffffff");
                label.setAttribute("font-family", "DroidSans, sans-serif");
                label.setAttribute("font-size", "9");
                label.setAttribute("font-weight", "bold");
                label.textContent = text;
                graphic.appendChild(label);
            });

            if (component.element) {
                component.element
                    .querySelectorAll(":scope > .pin")
                    .forEach((p) => p.remove());
                renderer.renderPins(component, component.element);

                if (component.selected) {
                    renderer.simulator?.selectionManager?.renderHighlight();
                }

                renderer.simulator?.wireManager?.renderAll();
            }

            renderer.clearMax7219Grid(component);

        },

    },

    propertyPanel: {

        // Migrado tal cual desde PropertyPanel._renderMax7219().
        render(component, panel) {

            panel.content.innerHTML = "";

            component.properties = component.properties || {};
            if (!component.properties.cols)  component.properties.cols  = 8;
            if (!component.properties.rows)  component.properties.rows = 8;
            if (!component.properties.shape) component.properties.shape = "circle";
            if (!component.properties.color) component.properties.color = "#ff2222";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "Matriz MAX7219";
            panel.content.appendChild(title);

            const label = document.createElement("label");
            label.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            label.textContent = "Tamaño de la matriz";
            panel.content.appendChild(label);

            const rebuildGrid = () => {
                const graphic = component.element?.querySelector(".component-graphic");
                if (graphic) panel.simulator.renderer.tagMax7219Elements(component, graphic);
            };

            const sizePresets = [
                { cols: 8,  rows: 8, text: "8 x 8"  },
                { cols: 16, rows: 8, text: "8 x 16" },
                { cols: 32, rows: 8, text: "8 x 32" },
            ];

            const sizeGroup = document.createElement("div");
            sizeGroup.style.cssText = "display:flex; gap:8px; margin-bottom:16px;";

            sizePresets.forEach(({ cols, rows, text }) => {

                const btn = document.createElement("button");
                btn.className = "property-flip-btn";
                btn.style.cssText = "flex:1; padding:8px 10px;";
                if (component.properties.cols === cols && component.properties.rows === rows) {
                    btn.classList.add("active");
                }
                btn.textContent = text;

                btn.addEventListener("click", () => {

                    if (component.properties.cols === cols && component.properties.rows === rows) return;
                    component.properties.cols = cols;
                    component.properties.rows = rows;

                    rebuildGrid();

                    ComponentBehaviorRegistry.get(component.type).propertyPanel.render(component, panel); // re-pintar para reflejar el botón activo

                });

                sizeGroup.appendChild(btn);

            });

            panel.content.appendChild(sizeGroup);

            const shapeLabel = document.createElement("label");
            shapeLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            shapeLabel.textContent = "Forma del LED";
            panel.content.appendChild(shapeLabel);

            const shapes = [
                { value: "circle", text: "Círculo"  },
                { value: "square", text: "Cuadrado" },
            ];

            const shapeGroup = document.createElement("div");
            shapeGroup.style.cssText = "display:flex; gap:8px; margin-bottom:16px;";

            const repaintCurrentFrame = () => {
                if (component.lastMax7219Frame) {
                    const { bytes, width, height } = component.lastMax7219Frame;
                    panel.simulator.renderer.drawMax7219Framebuffer(component, bytes, width, height);
                } else {
                    panel.simulator.renderer.clearMax7219Grid(component);
                }
            };

            shapes.forEach(({ value, text }) => {

                const btn = document.createElement("button");
                btn.className = "property-flip-btn";
                btn.style.cssText = "flex:1; padding:8px 10px;";
                if (component.properties.shape === value) btn.classList.add("active");
                btn.textContent = text;

                btn.addEventListener("click", () => {

                    if (component.properties.shape === value) return;
                    component.properties.shape = value;

                    repaintCurrentFrame();

                    ComponentBehaviorRegistry.get(component.type).propertyPanel.render(component, panel); // re-pintar para reflejar el botón activo

                });

                shapeGroup.appendChild(btn);

            });

            panel.content.appendChild(shapeGroup);

            const colorLabel = document.createElement("label");
            colorLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            colorLabel.textContent = "Color del LED";
            panel.content.appendChild(colorLabel);

            const colors = [
                { value: "#ff2222", text: "Rojo"    },
                { value: "#00e676", text: "Verde"   },
                { value: "#2979ff", text: "Azul"    },
                { value: "#ffea00", text: "Amarillo"},
            ];

            const colorGroup = document.createElement("div");
            colorGroup.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:16px;";

            colors.forEach(({ value, text }) => {

                const btn = document.createElement("button");
                btn.className = "property-flip-btn";
                btn.style.cssText = "display:flex; align-items:center; gap:8px; justify-content:flex-start; padding:8px 10px;";
                if (component.properties.color === value) btn.classList.add("active");

                const dot = document.createElement("span");
                dot.style.cssText = `width:14px; height:14px; border-radius:50%; flex:none; background:${value}; border:1px solid rgba(255,255,255,0.25);`;
                btn.appendChild(dot);

                const span = document.createElement("span");
                span.textContent = text;
                btn.appendChild(span);

                btn.addEventListener("click", () => {

                    if (component.properties.color === value) return;
                    component.properties.color = value;

                    repaintCurrentFrame();

                    ComponentBehaviorRegistry.get(component.type).propertyPanel.render(component, panel); // re-pintar para reflejar el botón activo

                });

                colorGroup.appendChild(btn);

            });

            panel.content.appendChild(colorGroup);

            const note = document.createElement("div");
            note.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;";
            note.textContent = "El tamaño real de la matriz lo define tu código MicroPython (Max7219(width, height, spi, cs)) -- estos valores son solo para que el panel se vea igual mientras probás. Si el firmware manda un frame de otro tamaño, el panel se reacomoda solo.";
            panel.content.appendChild(note);

            const sep2 = document.createElement("div");
            sep2.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep2);

            panel._renderCommonProperties(component);

        },

    },

});
