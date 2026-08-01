/*
==========================================================
 PitSimulator — lcd_16x2_i2c.behavior.js
 Copia de components/lcd16x2/lcd16x2.behavior.js.

 BUG REAL encontrado y corregido acá: lcd16x2.behavior.js se
 registraba para "lcd16x2" Y "lcd_16x2_i2c" en un solo archivo,
 asumiendo que alcanzaba con eso -- pero ComponentBehaviorRegistry.
 loadAll() decide qué .behavior.js buscar mirando el "hasBehavior"
 de CADA entrada del manifest, y solo "lcd16x2" lo tenía. Si el
 canvas tiene un LCD I2C SIN ningún LCD paralelo al lado, ese
 archivo nunca se llegaba a pedir -- ningún LCD I2C tenía su fondo/
 texto/backlight funcionando (el firmware mandaba "LCD:" perfecto,
 pero nada en el navegador reaccionaba). Ahora "lcd_16x2_i2c" tiene
 su propio "hasBehavior": true en el manifest y este archivo propio
 -- ver también keypad3x4.behavior.js, mismo bug, mismo fix, mismo
 par (keypad4x4/keypad3x4).

 No se puede compartir el objeto de comportamiento entre los dos
 .js con un simple import: son <script> clásicos (no ES modules),
 cada uno con su propio scope de nivel superior -- por eso es una
 copia (mismo criterio que RC522_CARDS/RC522_REAL_CARDS), no una
 referencia. Si se corrige algo acá, corregir también en
 lcd16x2.behavior.js (y viceversa).
==========================================================
*/

const lcdBehaviorI2c = {

    render: {

        tag(component, graphic, renderer) {

            const bg = Array.from(graphic.querySelectorAll("path")).find(
                (p) => Utils.normalizeHex(p.getAttribute("fill") || "") === "#87ad34",
            );

            if (bg) {
                bg.setAttribute("data-lcd-role", "screen-bg");
            } else {
                console.warn("[lcd_16x2_i2c.behavior] No se encontró el fondo de pantalla del LCD (#87AD34)");
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
                console.warn("[lcd_16x2_i2c.behavior] No se encontró la grilla de puntos del LCD -- no se puede ubicar el overlay de texto");
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
                    `[lcd_16x2_i2c.behavior] Bounding box de la grilla de puntos del LCD (${component.type}) ` +
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

ComponentBehaviorRegistry.register("lcd_16x2_i2c", lcdBehaviorI2c);
