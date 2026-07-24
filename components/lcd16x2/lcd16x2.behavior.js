/*
==========================================================
 PitSimulator — lcd16x2.behavior.js
 Comportamiento de render del LCD 16x2 (con o sin backpack
 I2C), migrado tal cual desde Renderer.tagLcdElements() hacia
 ComponentBehaviorRegistry.

 Se registra para "lcd16x2" Y "lcd_16x2_i2c" -- mismo criterio
 que components/keypad4x4/keypad4x4.behavior.js (ver el
 comentario ahí): la lógica original nunca dependió del tipo
 concreto (Renderer.isLcd() ya trataba ambos igual), así que un
 solo archivo cubre los dos. No hace falta un
 components/lcd_16x2_i2c/lcd_16x2_i2c.behavior.js aparte: su
 fetch en ComponentBehaviorRegistry.loadAll() va a 404
 (tolerado), pero este archivo ya se registró para ambos tipos
 para cuando esa carga termina.

 Los statics Renderer.LCD_CHAR_COLS/LCD_CHAR_ROWS y los métodos
 applyLcdColorScheme()/_getLocalTransformUpTo()/_applyMatrix()
 siguen viviendo en Renderer.js -- se llaman vía "renderer".
==========================================================
*/

const lcdBehavior = {

    render: {

        tag(component, graphic, renderer) {

            const bg = Array.from(graphic.querySelectorAll("path")).find(
                (p) => Utils.normalizeHex(p.getAttribute("fill") || "") === "#87ad34",
            );

            if (bg) {
                bg.setAttribute("data-lcd-role", "screen-bg");
            } else {
                console.warn("[lcd16x2.behavior] No se encontró el fondo de pantalla del LCD (#87AD34)");
            }

            const dots = [];
            graphic.querySelectorAll("polygon[fill]").forEach((poly) => {
                if (Utils.normalizeHex(poly.getAttribute("fill")) === "#1a1a1a") {
                    poly.setAttribute("data-lcd-role", "dot");
                    dots.push(poly);
                }
            });

            renderer.applyLcdColorScheme(component);

            if (dots.length === 0) {
                console.warn("[lcd16x2.behavior] No se encontró la grilla de puntos del LCD -- no se puede ubicar el overlay de texto");
                return;
            }

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            dots.forEach((poly) => {
                const m = renderer._getLocalTransformUpTo(poly, graphic);

                const points = (poly.getAttribute("points") || "").trim().split(/\s+/);
                points.forEach((pair) => {
                    const [rawX, rawY] = pair.split(",").map(Number);
                    if (Number.isNaN(rawX) || Number.isNaN(rawY)) return;
                    const { x: px, y: py } = renderer._applyMatrix(m, rawX, rawY);
                    if (px < minX) minX = px;
                    if (px > maxX) maxX = px;
                    if (py < minY) minY = py;
                    if (py > maxY) maxY = py;
                });
            });

            const boxWidth = maxX - minX;
            const boxHeight = maxY - minY;

            const fo = document.createElementNS(Utils.SVG_NS, "foreignObject");
            fo.setAttribute("data-lcd-role", "text-wrap");
            fo.setAttribute("x", minX);
            fo.setAttribute("y", minY);
            fo.setAttribute("width", boxWidth);
            fo.setAttribute("height", boxHeight);

            const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
            canvas.setAttribute("data-lcd-role", "screen-canvas");

            if (!(boxWidth > 0) || !(boxHeight > 0)) {
                console.warn(
                    `[lcd16x2.behavior] Bounding box de la grilla de puntos del LCD (${component.type}) ` +
                    `salió raro (boxWidth=${boxWidth}, boxHeight=${boxHeight}) -- usando proporción ideal como respaldo.`,
                );
            }

            const numLines = component.properties?.numLines || 2;
            const numColumns = component.properties?.numColumns || 16;

            const DOT_PX = 6;
            const targetWidthPx = numColumns * (Renderer.LCD_CHAR_COLS + 1) * DOT_PX;

            const aspect =
                boxHeight > 0
                    ? boxWidth / boxHeight
                    : (numColumns * (Renderer.LCD_CHAR_COLS + 1)) /
                      (numLines * (Renderer.LCD_CHAR_ROWS + 2));

            canvas.width = Math.max(1, Math.round(targetWidthPx));
            canvas.height = Math.max(1, Math.round(targetWidthPx / aspect));
            canvas.style.width = "100%";
            canvas.style.height = "100%";
            canvas.style.display = "block";

            fo.appendChild(canvas);
            graphic.appendChild(fo);

        },

    },

    propertyPanel: {

        // Migrado tal cual desde PropertyPanel._renderLcd().
        render(component, panel) {

            panel.content.innerHTML = "";

            component.properties = component.properties || {};
            if (!component.properties.colorScheme) component.properties.colorScheme = "yellow_green";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = component.type === "lcd_16x2_i2c" ? "LCD 16x2 I2C" : "LCD 16x2";
            panel.content.appendChild(title);

            const label = document.createElement("label");
            label.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            label.textContent = "Color de pantalla";
            panel.content.appendChild(label);

            const schemes = [
                { value: "yellow_green", text: "Verde / amarilla", swatch: "rgb(135,173,52)" },
                { value: "blue",         text: "Azul",              swatch: "rgb(43,78,168)" },
            ];

            const group = document.createElement("div");
            group.style.cssText = "display:flex; flex-direction:column; gap:8px; margin-bottom:16px;";

            schemes.forEach(({ value, text, swatch }) => {

                const btn = document.createElement("button");
                btn.className = "property-flip-btn";
                btn.style.cssText = "display:flex; align-items:center; gap:8px; justify-content:flex-start; padding:8px 10px;";
                if (component.properties.colorScheme === value) btn.classList.add("active");

                const dot = document.createElement("span");
                dot.style.cssText = `width:14px; height:14px; border-radius:3px; flex:none; background:${swatch}; border:1px solid rgba(255,255,255,0.25);`;
                btn.appendChild(dot);

                const span = document.createElement("span");
                span.textContent = text;
                btn.appendChild(span);

                btn.addEventListener("click", () => {

                    if (component.properties.colorScheme === value) return;
                    component.properties.colorScheme = value;

                    panel.simulator.renderer.applyLcdColorScheme(component);

                    ComponentBehaviorRegistry.get(component.type).propertyPanel.render(component, panel); // re-pintar para reflejar el botón activo

                });

                group.appendChild(btn);

            });

            panel.content.appendChild(group);

            const note = document.createElement("div");
            note.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;";
            note.textContent = "Este LCD todavía no muestra el texto real que manda el firmware (eso falta implementar, igual que el framebuffer del OLED) -- por ahora el color es solo estético.";
            panel.content.appendChild(note);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            // Mismo criterio que el OLED: campo de REFERENCIA, no
            // funcional -- SignalEngine.js asume un único LCD I2C en el
            // canvas (busca por tipo, no por dirección). Solo aparece
            // para la variante I2C -- la paralela (lcd16x2) no tiene
            // dirección de ningún tipo.
            if (component.type === "lcd_16x2_i2c") {
                panel._appendEditableField("Dirección I2C", component.properties.i2cAddress ?? "0x27", (val) => {
                    component.properties.i2cAddress = val;
                });
            }

            panel._renderCommonProperties(component);

        },

    },

};

ComponentBehaviorRegistry.register(["lcd16x2", "lcd_16x2_i2c"], lcdBehavior);
