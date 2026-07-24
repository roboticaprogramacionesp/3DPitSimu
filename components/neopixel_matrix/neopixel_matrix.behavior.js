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

});
