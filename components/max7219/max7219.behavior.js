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

            const oldWidth = component.width;
            const oldHeight = component.height;

            const newWidth = cols * Renderer.MAX7219_LED_UNIT_SIZE + pad * 2;
            const newHeight = rows * Renderer.MAX7219_LED_UNIT_SIZE + pad * 2;

            if (
                Array.isArray(component.pins) &&
                oldWidth &&
                oldHeight &&
                (newWidth !== oldWidth || newHeight !== oldHeight)
            ) {
                const scaleX = newWidth / oldWidth;
                const scaleY = newHeight / oldHeight;

                component.pins.forEach((pin) => {
                    pin.x = pin.x * scaleX;
                    pin.y = pin.y * scaleY;
                });
            }

            component.width = newWidth;
            component.height = newHeight;

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

            if (component.element) {
                component.element
                    .querySelectorAll(":scope > .pin")
                    .forEach((p) => p.remove());
                renderer.renderPins(component, component.element);

                if (component.selected) {
                    renderer.simulator?.selectionManager?.renderHighlight();
                }
            }

            renderer.clearMax7219Grid(component);

        },

    },

});
