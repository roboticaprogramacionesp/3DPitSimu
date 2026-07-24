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

};

ComponentBehaviorRegistry.register(["lcd16x2", "lcd_16x2_i2c"], lcdBehavior);
