/*
==========================================================
 PitSimulator — rc522_real.behavior.js
 Idéntico panel de propiedades que components/rc522/rc522.behavior.js
 (mismo circuito real, esta versión solo cambia el aspecto visual) --
 ver ese archivo para el detalle. Constante con nombre propio
 ("RC522_REAL_CARDS") porque los .behavior.js se cargan como <script>
 clásicos en un mismo scope global, y "rc522" (ahora oculto, pero
 igual se carga) también declara la suya.
==========================================================
*/

const RC522_REAL_CARDS = [
    { name: "Blue Card",   color: "#4da3ff", uid: "04112233" },
    { name: "Green Card",  color: "#33cc55", uid: "04223344" },
    { name: "Yellow Card", color: "#e0c040", uid: "04334455" },
    { name: "Red Card",    color: "#cc3333", uid: "04445566" },
    { name: "NFC Tag",     color: "#999999", uid: "04556677" },
    { name: "Key Fob",     color: "#ff8800", uid: "04667788" },
];

ComponentBehaviorRegistry.register("rc522_real", {

    signal: {
        // Ver nota "resync" en ComponentBehaviorRegistry.js -- sin
        // esto, un Hold prendido desde un proyecto recién cargado (o
        // desde antes de un restart/reconexión de QEMU) nunca le
        // llega al firmware: setRc522PresentedCard() solo se llama
        // desde los clicks del panel, nunca automáticamente.
        resync(component, engine) {
            component.properties = component.properties || {};
            if (!component.properties.holding) return;
            const card = RC522_REAL_CARDS[component.properties.cardIndex] || RC522_REAL_CARDS[0];
            engine.setRc522PresentedCard(component, card.uid);
        },
    },

    propertyPanel: {

        render(component, panel) {

            panel.content.innerHTML = "";
            component.properties = component.properties || {};
            if (typeof component.properties.cardIndex !== "number") {
                component.properties.cardIndex = 0;
            }
            if (typeof component.properties.holding !== "boolean") {
                component.properties.holding = false;
            }

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "Lector RFID RC522";
            panel.content.appendChild(title);

            const cardRow = document.createElement("div");
            cardRow.style.cssText = "margin-bottom: 14px;";

            const cardLabel = document.createElement("label");
            cardLabel.textContent = "Card";
            cardLabel.style.cssText = "display:block; font-size:12px; color:#4da3ff; text-transform:uppercase; margin-bottom:6px;";

            const cardPicker = document.createElement("div");
            cardPicker.style.cssText = "display:flex; align-items:center; gap:8px;";

            const swatch = document.createElement("div");
            swatch.style.cssText = "width:18px; height:18px; border-radius:4px; flex-shrink:0;";

            const select = document.createElement("select");
            select.style.cssText = "flex:1; background:#1e1f22; color:#fff; border:1px solid #333; border-radius:6px; padding:8px; font-size:13px;";
            RC522_REAL_CARDS.forEach((card, i) => {
                const opt = document.createElement("option");
                opt.value = String(i);
                opt.textContent = card.name;
                select.appendChild(opt);
            });
            select.value = String(component.properties.cardIndex);

            const applySwatch = () => {
                const card = RC522_REAL_CARDS[component.properties.cardIndex] || RC522_REAL_CARDS[0];
                swatch.style.background = card.color;
            };
            applySwatch();

            select.addEventListener("change", () => {
                component.properties.cardIndex = parseInt(select.value, 10);
                applySwatch();
                if (component.properties.holding) {
                    const card = RC522_REAL_CARDS[component.properties.cardIndex];
                    panel.simulator.signalEngine.setRc522PresentedCard(component, card.uid);
                }
            });

            cardPicker.appendChild(swatch);
            cardPicker.appendChild(select);
            cardRow.appendChild(cardLabel);
            cardRow.appendChild(cardPicker);
            panel.content.appendChild(cardRow);

            const controlsRow = document.createElement("div");
            controlsRow.style.cssText = "display:flex; align-items:center; gap:14px; margin-bottom:14px;";

            const tapBtn = document.createElement("button");
            tapBtn.textContent = "TAP";
            tapBtn.style.cssText = "padding:10px 18px; background:#4da3ff; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:13px; font-weight:700;";
            tapBtn.addEventListener("click", () => {
                if (component.properties.holding) return;
                const card = RC522_REAL_CARDS[component.properties.cardIndex];
                panel.simulator.signalEngine.tapRc522(component, card.uid);
            });

            const holdWrap = document.createElement("label");
            holdWrap.style.cssText = "display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; color:#ccc;";

            const holdToggle = document.createElement("input");
            holdToggle.type = "checkbox";
            holdToggle.checked = component.properties.holding;
            holdToggle.style.cssText = "width:16px; height:16px; cursor:pointer;";
            holdToggle.addEventListener("change", () => {
                component.properties.holding = holdToggle.checked;
                const card = RC522_REAL_CARDS[component.properties.cardIndex];
                panel.simulator.signalEngine.setRc522PresentedCard(component, holdToggle.checked ? card.uid : null);
            });

            const holdText = document.createElement("span");
            holdText.textContent = "Hold";

            holdWrap.appendChild(holdToggle);
            holdWrap.appendChild(holdText);

            controlsRow.appendChild(tapBtn);
            controlsRow.appendChild(holdWrap);
            panel.content.appendChild(controlsRow);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
