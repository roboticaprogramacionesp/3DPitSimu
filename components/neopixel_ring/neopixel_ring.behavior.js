/*
==========================================================
 PitSimulator — neopixel_ring.behavior.js
 Comportamiento de render del anillo de NeoPixel -- mismo patrón que
 neopixel_matrix.behavior.js (bisel + LEDs dibujados enteros por
 código en un <canvas>, ver render.tag), pero acá en círculo en vez
 de grilla rectangular (ver Renderer.drawNeopixelRingFrame). La
 cantidad de píxeles (1-256, default 8) se elige desde el panel de
 propiedades, igual que Columnas/Filas en la matriz.
==========================================================
*/

ComponentBehaviorRegistry.register("neopixel_ring", {

    render: {

        usesCodeGraphic: true,

        tag(component, graphic, renderer) {

            const count = Math.max(1, Math.min(256, Math.round(component.properties?.count) || 8));
            component.properties = component.properties || {};
            component.properties.count = count;

            graphic.innerHTML = "";

            // El tamaño del LED es FIJO (ver Renderer._neopixelRingGeometry)
            // -- a pedido, última vuelta: "los cuadros se van reduciendo
            // a medida que vamos agregando mas y asi no deberia... has
            // que el circulo cresca tomando en cuenta que los cuadros
            // siempre deben tener la misma medida". Antes se elegía
            // ringD primero (con una fórmula de raíz cuadrada, con
            // techo) y los LEDs se achicaban si no entraban ahí; ahora
            // es al revés, pura geometría de circunferencia: el radio
            // que necesitan n LEDs de tamaño fijo (con margen cómodo
            // entre ellos) DEFINE el anillo, y de ahí sale ringD -- sin
            // techo artificial, así que nunca hay que ceder tamaño de
            // LED para "que entren todos".
            const { ringRadius, ledHalf } = Renderer._neopixelRingGeometry(count);
            const outerR = ringRadius + ledHalf * 2.6;
            const innerR = Math.max(ledHalf * 1.2, ringRadius - ledHalf * 2.6);
            const ringD = outerR * 2;

            // Sin tab: los pines van EMBEBIDOS en el propio aro (ver
            // más abajo), así que la caja del componente es el círculo
            // en sí, sin alto extra reservado para patitas colgando.
            const w = ringD;
            const h = ringD;

            component.width = w;
            component.height = h;

            const bezelCx = w / 2;
            const bezelCy = h / 2;

            // Anillo HUECO de verdad (a pedido: "haz un círculo
            // hueco"), no un disco sólido -- un <path> con 2 círculos
            // y fill-rule evenodd deja el centro genuinamente
            // transparente (se ve el fondo del workspace a través),
            // igual que un anillo de NeoPixel real (PCB con un
            // agujero en el medio).

            const bezel = document.createElementNS(Utils.SVG_NS, "path");
            bezel.setAttribute("data-neo-role", "ring-bezel");
            bezel.setAttribute("fill-rule", "evenodd");
            bezel.setAttribute("fill", "#1a5c2e");
            bezel.setAttribute("stroke", "#0e3a1c");
            bezel.setAttribute("stroke-width", "2");
            bezel.setAttribute(
                "d",
                `M ${bezelCx - outerR},${bezelCy} a ${outerR},${outerR} 0 1 0 ${outerR * 2},0 a ${outerR},${outerR} 0 1 0 ${-outerR * 2},0 Z ` +
                `M ${bezelCx - innerR},${bezelCy} a ${innerR},${innerR} 0 1 0 ${innerR * 2},0 a ${innerR},${innerR} 0 1 0 ${-innerR * 2},0 Z`
            );
            graphic.appendChild(bezel);

            const fo = document.createElementNS(Utils.SVG_NS, "foreignObject");
            fo.setAttribute("data-neo-role", "ring-wrap");
            fo.setAttribute("x", 0);
            fo.setAttribute("y", 0);
            fo.setAttribute("width", ringD);
            fo.setAttribute("height", ringD);

            const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
            canvas.setAttribute("data-neo-role", "ring");
            canvas.style.cssText = "width:100%; height:100%; display:block; pointer-events:none;";
            // Resolución nativa = 2x el tamaño mostrado (ringD), no un
            // 400x400 fijo -- a pedido: "deben ser del mismo tamaño los
            // cuadrados, mira como se ve en wokwi". Con 400 fijo, el
            // navegador reescalaba ese raster con un factor DISTINTO
            // según el conteo (para count=8/ringD=200 achicaba a la
            // mitad, para count=54/ringD≈520 lo agrandaba ~1.3x...), y
            // ese reescalado de imagen no es uniforme sub-píxel a
            // píxel -- cada LED cae en una posición fraccionaria
            // distinta de la grilla de reescalado, así que el
            // anti-aliasing de sus bordes salía más grueso/fino según
            // dónde cayera, y se veían "de distinto tamaño" aunque
            // ledHalf sea EXACTAMENTE igual para todos. Con un factor
            // de escala fijo (siempre x2, sea cual sea ringD), el
            // downscale es consistente para cualquier tamaño de anillo.
            const canvasRes = Math.max(64, Math.round(ringD * 2));
            canvas.width = canvasRes;
            canvas.height = canvasRes;

            fo.appendChild(canvas);
            graphic.appendChild(fo);

            // Pines VCC/DIN/GND EMBEBIDOS de verdad en el propio aro de
            // PCB -- a pedido explícito: "los pines de vcc, gnd y señal
            // deben estar siempre sobre el circulo... casi en ningun
            // momento esta directo al circulo". Antes colgaban de un tab
            // por debajo del anillo; ahora se ubican DENTRO de la banda
            // verde del aro, sobre el arco inferior, igual que los
            // footprints de soldadura reales de un anillo NeoPixel/Wokwi.
            //
            // Radio: pegados al borde EXTERNO de la banda (no al medio,
            // ver "midR" viejo) -- a pedido de una vuelta más: "baja los
            // pines" -- con radio=midR quedaban a la MISMA altura que los
            // LEDs (ringRadius ≈ midR) y se veían mezclados/tapados por
            // ellos. Pegados al outerR quedan más abajo/afuera, bien
            // diferenciados de los LEDs y sobre el borde visible del aro.
            //
            // Separación angular: en vez de un ángulo FIJO (que a radios
            // grandes se traduce en muchísima distancia física entre
            // pines), se calcula para mantener una separación de ARCO
            // constante (~16px) sin importar qué tan grande sea el
            // anillo -- a pedido: "trata de que siempre este cercas".
            const bandThickness = Math.max(1, outerR - innerR);
            const pinR = outerR - Math.min(6, bandThickness * 0.3);
            const DESIRED_PIN_ARC = 16;
            const pinAngleGap = Math.min(0.35, DESIRED_PIN_ARC / pinR);
            const pinDefs = [
                { id: "vcc", angle: Math.PI / 2 - pinAngleGap },
                { id: "din", angle: Math.PI / 2 },
                { id: "gnd", angle: Math.PI / 2 + pinAngleGap },
            ];
            pinDefs.forEach(({ id, angle }) => {
                const pin = component.pins.find((p) => p.id === id);
                if (!pin) return;
                pin.x = bezelCx + pinR * Math.cos(angle);
                pin.y = bezelCy + pinR * Math.sin(angle);
            });

            // Etiquetas VCC/DIN/GND horneadas directo en el propio
            // dibujo (mismo criterio que qmc5883l.svg/gps.svg: texto
            // real, parte del gráfico -- no un overlay aparte armado
            // por Renderer.renderPins()). Un poco más afuera de cada
            // pin, sobre el mismo radio, con halo oscuro para que se
            // lea igual de bien sobre la banda verde del aro.
            const LABEL_GAP = 9;
            const labelTexts = { vcc: "VCC", din: "DIN", gnd: "GND" };
            pinDefs.forEach(({ id, angle }) => {
                const lx = bezelCx + (pinR + LABEL_GAP) * Math.cos(angle);
                const ly = bezelCy + (pinR + LABEL_GAP) * Math.sin(angle);
                const label = document.createElementNS(Utils.SVG_NS, "text");
                label.setAttribute("x", lx);
                label.setAttribute("y", ly);
                label.setAttribute("text-anchor", "middle");
                label.setAttribute("dominant-baseline", "hanging");
                label.setAttribute("fill", "#ffffff");
                label.setAttribute("font-family", "DroidSans, sans-serif");
                // Chico a propósito: a count bajo (pinAngleGap acotado
                // por DESIRED_PIN_ARC=16, ver más arriba) los 3 pines
                // quedan angularmente cerca -- con 9px "GND"/"DIN" se
                // llegaban a tocar entre sí.
                label.setAttribute("font-size", "7");
                label.setAttribute("font-weight", "bold");
                label.setAttribute("stroke", "#0e3a1c");
                label.setAttribute("stroke-width", "2");
                label.setAttribute("paint-order", "stroke fill");
                label.textContent = labelTexts[id];
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

                // Mismo motivo que en neopixel_matrix.behavior.js: un
                // cambio de tamaño no dispara ninguno de los eventos que
                // WireManager escucha para redibujar, así que sin este
                // empujón los cables quedaban apuntando a la posición
                // VIEJA del pin mientras el anillo crecía/achicaba.
                renderer.simulator?.wireManager?.renderAll();
            }

            // Pintado inicial DIRECTO sobre este <canvas> recién creado
            // (no via renderer.clearNeopixelRing(component), que busca
            // el canvas a través de component.element -- todavía null
            // acá: Renderer.renderComponent() llama a tag() ANTES de
            // component.setElement(), así que ese camino se quedaba sin
            // hacer nada en el primer render y el anillo aparecía vacío
            // -- a pedido: "pinta los 8 píxeles por defecto").
            renderer._paintNeopixelRingCanvas(canvas, new Uint8Array(count * 3), count);

        },

    },

    propertyPanel: {

        render(component, panel) {

            panel.content.innerHTML = "";

            component.properties = component.properties || {};
            if (!component.properties.count) component.properties.count = 8;

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "Anillo de NeoPixel";
            panel.content.appendChild(title);

            const label = document.createElement("label");
            label.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            label.textContent = "Píxeles";
            panel.content.appendChild(label);

            const row = document.createElement("div");
            row.style.cssText = "margin-bottom:16px;";

            row.appendChild(panel._makeNumberField("Píxeles", component.properties.count, (val) => {
                const count = Math.max(1, Math.min(256, Math.round(val) || 1));
                component.properties.count = count;

                const graphic = component.element?.querySelector(".component-graphic");
                if (graphic) panel.simulator.renderer.tagNeopixelRingElements(component, graphic);
            }));

            panel.content.appendChild(row);

            const note = document.createElement("div");
            note.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;";
            note.textContent = "La cantidad real la define tu código MicroPython (neopixel.NeoPixel(pin, n)) -- este valor es solo para que el panel se vea igual mientras probás. Si el firmware manda un frame de otro tamaño, el panel se reacomoda solo.";
            panel.content.appendChild(note);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
