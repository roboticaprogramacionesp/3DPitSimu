/*
==========================================================
 PitSimulator — display7.behavior.js
 Comportamiento de señal del display 7 segmentos, migrado tal
 cual desde SignalEngine.evaluateDisplay7() hacia
 ComponentBehaviorRegistry. Ver
 js/simulator/ComponentBehaviorRegistry.js para el contrato.
==========================================================
*/

ComponentBehaviorRegistry.register("display7", {

    signal: {

        evaluate(component, engine) {

            const isCathode =
                (component.properties?.commonType || "cathode") === "cathode";

            const commonOk = isCathode
                ? engine.isKeyConnectedToGnd(`${component.id}:com1`) ||
                  engine.isKeyConnectedToGnd(`${component.id}:com2`)
                : engine.isKeyConnectedToHighDriver(`${component.id}:com1`) ||
                  engine.isKeyConnectedToHighDriver(`${component.id}:com2`);

            const segmentIds = ["a", "b", "c", "d", "e", "f", "g"];
            const segments = {};

            segmentIds.forEach((id) => {
                segments[id] =
                    commonOk &&
                    (isCathode
                        ? engine.isKeyConnectedToHighDriver(`${component.id}:${id}`)
                        : engine.isKeyConnectedToGnd(`${component.id}:${id}`));
            });

            const dp =
                commonOk &&
                (isCathode
                    ? engine.isKeyConnectedToHighDriver(`${component.id}:dp`)
                    : engine.isKeyConnectedToGnd(`${component.id}:dp`));

            engine.simulator.renderer.applyDisplay7State(component, segments, dp);

        },

    },

    render: {

        // Migrado tal cual desde Renderer.tagDisplay7Elements().
        // Renderer.DISPLAY7_SEGMENT_MAP sigue siendo un static de
        // Renderer -- se referencia como global, igual que en el resto
        // del proyecto (ej. SignalEngine.js ya hace lo mismo con
        // Renderer.isLed()).
        tag(component, graphic, renderer) {

            Object.entries(Renderer.DISPLAY7_SEGMENT_MAP).forEach(
                ([originalId, role]) => {
                    const el = graphic.querySelector(`#${originalId}`);

                    if (!el) {
                        console.warn(
                            `[display7.behavior] no se encontró #${originalId} (segmento "${role}")`,
                        );
                        return;
                    }

                    el.setAttribute("data-display7-role", role);
                    el.setAttribute("data-display7-original-id", originalId);
                    el.removeAttribute("id");
                    el.style.removeProperty("fill");
                },
            );

        },

        // Migrado tal cual desde el bloque "Estado inicial del display 7
        // segmentos" de Renderer.renderComponent().
        initialState(component, renderer) {
            renderer.applyDisplay7State(
                component,
                { a: false, b: false, c: false, d: false, e: false, f: false, g: false },
                false,
            );
        },

    },

    propertyPanel: {

        // Migrado tal cual desde PropertyPanel._renderDisplay7().
        render(component, panel) {

            panel.content.innerHTML = "";

            component.properties = component.properties || {};
            if (!component.properties.commonType) component.properties.commonType = "cathode";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "Display 7 Segmentos";
            panel.content.appendChild(title);

            const warn = document.createElement("div");
            warn.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5; background:#1e1f22; border:1px solid #333; border-radius:6px; padding:8px 10px;";
            warn.textContent = "El SVG no separa los 7 segmentos, así que el brillo del dígito completo representa cuántos segmentos deberían estar encendidos. El punto decimal sí se prende y apaga de forma real.";
            panel.content.appendChild(warn);

            const label = document.createElement("label");
            label.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            label.textContent = "Tipo de común";
            panel.content.appendChild(label);

            const group = document.createElement("div");
            group.style.cssText = "display:flex; gap:8px; margin-bottom:8px;";

            const makeBtn = (value, text) => {

                const btn = document.createElement("button");
                btn.className = "property-flip-btn";
                btn.style.flex = "1";
                btn.textContent = text;
                if (component.properties.commonType === value) btn.classList.add("active");

                btn.addEventListener("click", () => {
                    if (component.properties.commonType === value) return;
                    component.properties.commonType = value;
                    panel.simulator.signalEngine.evaluateDisplay7(component);
                    ComponentBehaviorRegistry.get(component.type).propertyPanel.render(component, panel); // re-pintar para reflejar el botón activo
                });

                return btn;

            };

            group.appendChild(makeBtn("cathode", "Cátodo común"));
            group.appendChild(makeBtn("anode",  "Ánodo común"));
            panel.content.appendChild(group);

            const note = document.createElement("div");
            note.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;";
            note.textContent = component.properties.commonType === "cathode"
                ? "COM va a GND. Cada segmento se enciende con HIGH."
                : "COM va a VCC/3V3. Cada segmento se enciende con LOW.";
            panel.content.appendChild(note);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
