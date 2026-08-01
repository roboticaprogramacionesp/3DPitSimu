/*
==========================================================
 PitSimulator — resistencia.behavior.js
 Componente pasivo de 2 terminales: sus bandas de color se
 recalculan a partir de component.properties.ohms (código de
 colores IEC 60062, 4 bandas -- 2 dígitos significativos +
 multiplicador; la banda dorada de tolerancia ±5% del SVG queda
 fija, no se simula tolerancia real).

 Eléctricamente NO se simula la caída de tensión/límite de
 corriente real (ver resistencia.hal.py) -- sus dos terminales
 quedan siempre puenteados entre sí vía
 SignalEngine.getNet()/component.alwaysBridgePins, así que un
 LED cableado "a través" de una resistencia sigue prendiendo con
 normalidad, solo que ahora hay una resistencia dibujada en el
 medio del cableado.
==========================================================
*/

ComponentBehaviorRegistry.register("resistencia", {

    // Serie E12 abreviada -- los valores más comunes para limitar
    // corriente en un GPIO de ESP32 (LED, botón con pull-down, etc.).
    PRESETS: [220, 330, 470, 1000, 2200, 4700, 10000, 100000, 1000000],

    // Código de colores IEC 60062: mismo índice = mismo dígito Y misma
    // potencia de 10 para la banda de multiplicador.
    BAND_COLORS: [
        "#1a1a1a", // 0 negro
        "#8a3d06", // 1 marrón
        "#e0342a", // 2 rojo
        "#f5821f", // 3 naranja
        "#ffe135", // 4 amarillo
        "#00a33d", // 5 verde
        "#2f6fed", // 6 azul
        "#8c30c9", // 7 violeta
        "#8c8c8c", // 8 gris
        "#ffffff", // 9 blanco
    ],

    formatOhms(ohms) {
        if (ohms >= 1000000 && ohms % 1000 === 0) {
            return `${parseFloat((ohms / 1000000).toFixed(2))} MΩ`;
        }
        if (ohms >= 1000) {
            return `${parseFloat((ohms / 1000).toFixed(2))} kΩ`;
        }
        return `${ohms} Ω`;
    },

    // Reduce el valor a 2 dígitos significativos + potencia de 10 --
    // exacto para los PRESETS de arriba, aproximado (redondeo) para
    // cualquier valor personalizado que no caiga justo en esa grilla.
    bandsForOhms(ohms) {
        let value = Math.max(1, Math.round(ohms));
        let exponent = 0;
        while (value >= 100) {
            value = Math.round(value / 10);
            exponent++;
        }
        while (value < 10) {
            value *= 10;
            exponent--;
        }
        // Este simulador no dibuja bandas doradas/plateadas de
        // multiplicador (x0.1/x0.01) -- no son valores típicos para
        // limitar corriente en un GPIO, así que se recorta a 0.
        exponent = Math.max(0, Math.min(9, exponent));
        return { d1: Math.floor(value / 10), d2: value % 10, mult: exponent };
    },

    applyBands(component) {
        const graphic = component.element?.querySelector(".component-graphic");
        if (!graphic) return;

        const b1 = graphic.querySelector('[data-role="resistor-band1"]');
        const b2 = graphic.querySelector('[data-role="resistor-band2"]');
        const bm = graphic.querySelector('[data-role="resistor-mult"]');
        if (!b1 || !b2 || !bm) return;

        const ohms = component.properties?.ohms ?? 220;
        const { d1, d2, mult } = this.bandsForOhms(ohms);

        b1.setAttribute("fill", this.BAND_COLORS[d1]);
        b2.setAttribute("fill", this.BAND_COLORS[d2]);
        bm.setAttribute("fill", this.BAND_COLORS[mult]);
    },

    render: {

        tag(component, graphic) {
            // Los 3 <rect>/<path> de banda ya traen id propio en el SVG
            // (band_1_st/band_2_nd/band_rd_multiplier) -- se remapean a
            // data-role y se les saca el id para no arrastrar el mismo
            // problema que ya se resolvió en sg90.behavior.js: con 2+
            // resistencias en el canvas, esos ids quedarían duplicados
            // en el documento.
            const b1 = graphic.querySelector("#band_1_st");
            const b2 = graphic.querySelector("#band_2_nd");
            const bm = graphic.querySelector("#band_rd_multiplier");

            b1?.setAttribute("data-role", "resistor-band1");
            b2?.setAttribute("data-role", "resistor-band2");
            bm?.setAttribute("data-role", "resistor-mult");

            b1?.removeAttribute("id");
            b2?.removeAttribute("id");
            bm?.removeAttribute("id");
        },

        initialState(component) {
            // Puente incondicional entre sus 2 terminales (ver el
            // bloque nuevo en SignalEngine.getNet) -- se fija una sola
            // vez acá, no depende de ningún estado que cambie en runtime.
            component.alwaysBridgePins = ["term1", "term2"];

            component.properties = component.properties || {};
            if (component.properties.ohms === undefined) component.properties.ohms = 220;

            ComponentBehaviorRegistry.get("resistencia").applyBands(component);
        },

    },

    propertyPanel: {

        render(component, panel) {

            const behavior = ComponentBehaviorRegistry.get("resistencia");

            const draw = () => {

                panel.content.innerHTML = "";

                const title = document.createElement("h4");
                title.style.cssText = "margin-bottom: 12px; color: #fff;";
                title.textContent = "Resistencia";
                panel.content.appendChild(title);

                const ohms = component.properties?.ohms ?? 220;
                const isPreset = behavior.PRESETS.includes(ohms);

                const wrap = document.createElement("div");
                wrap.className = "property-field";

                const lbl = document.createElement("label");
                lbl.textContent = "Valor";
                wrap.appendChild(lbl);

                const select = document.createElement("select");
                select.className = "property-select";

                behavior.PRESETS.forEach(v => {
                    const opt = document.createElement("option");
                    opt.value = String(v);
                    opt.textContent = behavior.formatOhms(v);
                    select.appendChild(opt);
                });

                const customOpt = document.createElement("option");
                customOpt.value = "custom";
                customOpt.textContent = "Personalizado";
                select.appendChild(customOpt);

                select.value = isPreset ? String(ohms) : "custom";
                wrap.appendChild(select);
                panel.content.appendChild(wrap);

                const applyValue = (newOhms) => {
                    component.properties = component.properties || {};
                    component.properties.ohms = newOhms;
                    behavior.applyBands(component);
                };

                if (!isPreset) {
                    const customWrap = document.createElement("div");
                    customWrap.className = "property-field";

                    const customLbl = document.createElement("label");
                    customLbl.textContent = "Ohms (personalizado)";
                    customWrap.appendChild(customLbl);

                    const customInput = document.createElement("input");
                    customInput.type = "number";
                    customInput.min = "1";
                    customInput.step = "1";
                    customInput.value = ohms;
                    customInput.addEventListener("change", () => {
                        const val = Math.max(1, parseFloat(customInput.value) || 1);
                        applyValue(val);
                    });
                    customWrap.appendChild(customInput);
                    panel.content.appendChild(customWrap);
                }

                select.addEventListener("change", () => {
                    if (select.value === "custom") {
                        // Al pasar a "Personalizado" se conserva el valor
                        // actual como punto de partida (no se resetea a
                        // 1Ω) -- se vuelve a dibujar para mostrar el input.
                        draw();
                        return;
                    }
                    applyValue(parseFloat(select.value));
                    draw();
                });

                const sep = document.createElement("div");
                sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
                panel.content.appendChild(sep);

                panel._renderCommonProperties(component);

            };

            draw();

        },

    },

});
