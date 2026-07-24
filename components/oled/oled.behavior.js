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

    propertyPanel: {

        // Migrado tal cual desde PropertyPanel._renderOled().
        render(component, panel) {

            panel.content.innerHTML = "";

            component.properties = component.properties || {};
            if (!component.properties.colorScheme) component.properties.colorScheme = "blue";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "OLED I2C";
            panel.content.appendChild(title);

            const label = document.createElement("label");
            label.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            label.textContent = "Color de pantalla";
            panel.content.appendChild(label);

            const schemes = [
                { value: "blue",        text: "Azul",           swatch: "rgb(127,217,255)" },
                { value: "white",       text: "Blanca",         swatch: "rgb(235,235,235)" },
                { value: "yellow",      text: "Amarilla",       swatch: "rgb(255,209,64)" },
                { value: "blue_yellow", text: "Azul + Amarilla", swatch: "linear-gradient(to bottom, rgb(255,209,64) 0%, rgb(255,209,64) 25%, rgb(127,217,255) 25%, rgb(127,217,255) 100%)" },
            ];

            const group = document.createElement("div");
            group.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:16px;";

            schemes.forEach(({ value, text, swatch }) => {

                const btn = document.createElement("button");
                btn.className = "property-flip-btn";
                btn.style.cssText = "display:flex; align-items:center; gap:8px; justify-content:flex-start; padding:8px 10px;";
                if (component.properties.colorScheme === value) btn.classList.add("active");

                const dot = document.createElement("span");
                dot.style.cssText = `width:14px; height:14px; border-radius:50%; flex:none; background:${swatch}; border:1px solid rgba(255,255,255,0.25);`;
                btn.appendChild(dot);

                const span = document.createElement("span");
                span.textContent = text;
                btn.appendChild(span);

                btn.addEventListener("click", () => {

                    if (component.properties.colorScheme === value) return;
                    component.properties.colorScheme = value;

                    // No tenemos guardado el último framebuffer acá, así
                    // que no podemos "repintar" el contenido -- limpiamos
                    // con el nuevo color de fondo (el próximo dibujo del
                    // firmware ya sale con el esquema nuevo) en vez de
                    // dejar la pantalla con los colores viejos hasta el
                    // próximo oled.show().
                    panel.simulator.renderer.clearOledScreen(component);

                    ComponentBehaviorRegistry.get(component.type).propertyPanel.render(component, panel); // re-pintar para reflejar el botón activo

                });

                group.appendChild(btn);

            });

            panel.content.appendChild(group);

            const note = document.createElement("div");
            note.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;";
            note.textContent = "\"Azul + Amarilla\" imita las pantallas SSD1306 físicas de dos colores: la franja de arriba sale amarilla y el resto celeste, sin importar qué dibuje el firmware ahí.";
            panel.content.appendChild(note);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            // OJO: a diferencia del teclado I2C, este campo es solo de
            // REFERENCIA -- SignalEngine.js asume un único OLED en el
            // canvas y lo busca por tipo, no por dirección (ver
            // applyOledFramebuffer). Cambiarlo acá no cambia a qué
            // responde el simulador; sirve para anotar qué dirección le
            // pasás vos al construir tu objeto SSD1306 en Python.
            panel._appendEditableField("Dirección I2C", component.properties.i2cAddress ?? "0x3C", (val) => {
                component.properties.i2cAddress = val;
            });

            panel._renderCommonProperties(component);

        },

    },

});
