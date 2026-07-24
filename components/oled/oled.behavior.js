/*
==========================================================
 PitSimulator — oled.behavior.js
 Comportamiento de render del OLED, migrado tal cual desde
 Renderer.tagOledElements() hacia ComponentBehaviorRegistry.
 drawOledFramebuffer()/clearOledScreen() siguen viviendo en
 Renderer.js -- los llama SignalEngine.applyOledFramebuffer()
 (protocolo "OLED:" de QemuBridge), no el registro de tipos.
==========================================================
*/

ComponentBehaviorRegistry.register("oled", {

    render: {

        tag(component, graphic, renderer) {

            const screenRect = Array.from(graphic.querySelectorAll("rect")).find(
                (r) => Utils.normalizeHex(r.getAttribute("fill") || "") === "#2e2d30",
            );

            if (!screenRect) {
                console.warn("[oled.behavior] No se encontró el rectángulo de pantalla del OLED");
                return;
            }

            const x = parseFloat(screenRect.getAttribute("x")) || 0;
            const y = parseFloat(screenRect.getAttribute("y")) || 0;
            const w = parseFloat(screenRect.getAttribute("width")) || 100;
            const h = parseFloat(screenRect.getAttribute("height")) || 100;

            const screenWidth = component.properties?.screenWidth || 128;
            const screenHeight = component.properties?.screenHeight || 64;

            const fo = document.createElementNS(Utils.SVG_NS, "foreignObject");
            fo.setAttribute("x", x);
            fo.setAttribute("y", y);
            fo.setAttribute("width", w);
            fo.setAttribute("height", h);
            fo.setAttribute("data-oled-role", "screen-wrap");

            const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
            canvas.setAttribute("width", screenWidth);
            canvas.setAttribute("height", screenHeight);
            canvas.setAttribute("data-oled-role", "screen");
            canvas.style.cssText =
                "width:100%; height:100%; image-rendering:pixelated; display:block;";

            fo.appendChild(canvas);
            graphic.appendChild(fo);

            // Pantalla apagada por defecto
            renderer.clearOledScreen(component);

        },

    },

});
