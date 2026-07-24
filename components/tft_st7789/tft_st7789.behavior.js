/*
==========================================================
 PitSimulator — tft_st7789.behavior.js
 Comportamiento de render del TFT ST7789, migrado tal cual
 desde Renderer.tagTftElements() hacia ComponentBehaviorRegistry.
 drawTftRegion()/clearTftScreen() siguen viviendo en Renderer.js
 -- los llama SignalEngine.applyTftRegion() (protocolo "TFT:" de
 QemuBridge), no el registro de tipos.
==========================================================
*/

ComponentBehaviorRegistry.register("tft_st7789", {

    render: {

        tag(component, graphic, renderer) {

            const screenRect = graphic.querySelector('[data-role="screen"]');

            if (!screenRect) {
                console.warn("[tft_st7789.behavior] No se encontró el rectángulo de pantalla del TFT");
                return;
            }

            const x = parseFloat(screenRect.getAttribute("x")) || 0;
            const y = parseFloat(screenRect.getAttribute("y")) || 0;
            const w = parseFloat(screenRect.getAttribute("width")) || 100;
            const h = parseFloat(screenRect.getAttribute("height")) || 100;

            const screenWidth = component.properties?.screenWidth || 240;
            const screenHeight = component.properties?.screenHeight || 240;

            const fo = document.createElementNS(Utils.SVG_NS, "foreignObject");
            fo.setAttribute("x", x);
            fo.setAttribute("y", y);
            fo.setAttribute("width", w);
            fo.setAttribute("height", h);
            fo.setAttribute("data-tft-role", "screen-wrap");

            const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
            canvas.setAttribute("width", screenWidth);
            canvas.setAttribute("height", screenHeight);
            canvas.setAttribute("data-tft-role", "screen");
            canvas.style.cssText =
                "width:100%; height:100%; image-rendering:pixelated; display:block;";

            fo.appendChild(canvas);
            graphic.appendChild(fo);

            // Pantalla apagada (negra) por defecto, como en un ST7789
            // real recién alimentado, antes de que el firmware llame a init().
            renderer.clearTftScreen(component);

        },

    },

});
