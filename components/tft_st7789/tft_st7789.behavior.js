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

    propertyPanel: {

        // Migrado tal cual desde PropertyPanel._renderTft().
        render(component, panel) {

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "TFT 1.54\" 240x240 (ST7789)";
            panel.content.appendChild(title);

            const note = document.createElement("div");
            note.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;";
            note.textContent = "A diferencia del OLED/LCD, esta pantalla se actualiza en vivo, región por región, en cada primitiva de dibujo (pixel, línea, rect, etc.) -- no hace falta llamar a ningún show(). No tiene esquema de color elegible: el firmware manda el color real (RGB565) de cada pixel.";
            panel.content.appendChild(note);

            const btnClear = document.createElement("button");
            btnClear.className = "property-flip-btn";
            btnClear.style.cssText = "width:100%; margin-bottom:16px;";
            btnClear.textContent = "Poner pantalla en negro";
            btnClear.addEventListener("click", () => {
                panel.simulator.renderer.clearTftScreen(component);
            });
            panel.content.appendChild(btnClear);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
