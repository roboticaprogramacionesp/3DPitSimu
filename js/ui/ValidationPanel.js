/*
==========================================================
 PitSimulator — ValidationPanel.js

 Reemplaza el alert() crudo que tenía Toolbar.validateCircuit() (botón
 "✓ Validar circuito" del menú 📁 Archivo, o F12) por un modal prolijo:
 lista de errores/advertencias de ValidationEngine.validateCircuit(),
 cada una clickeable para resaltar/ubicar en el lienzo el componente
 que señala (ver Renderer.locateComponent(), mismo mecanismo que ya
 usa el botón 📍 del selector de dispositivo en ReplPanel.js).

 ValidationEngine ya hacía TODos estos chequeos (componente sin
 conectar, GND atado a un pin de alimentación, mezcla de voltajes,
 duplicados superpuestos) -- lo único que faltaba era presentarlos
 bien, no una lógica nueva de detección.
==========================================================
*/

class ValidationPanel {

    constructor(simulator) {

        this.simulator = simulator;

        this.buildDOM();

    }

    buildDOM() {

        this.overlay = document.createElement("div");
        this.overlay.className = "validation-modal-overlay hidden";
        this.overlay.innerHTML = `
            <div class="validation-modal">
                <div class="validation-modal-header">
                    <span class="validation-modal-title">✓ Validación del circuito</span>
                    <button type="button" class="validation-modal-close" title="Cerrar">✕</button>
                </div>
                <div class="validation-modal-body"></div>
            </div>
        `;
        document.body.appendChild(this.overlay);

        this.body = this.overlay.querySelector(".validation-modal-body");

        this.overlay.querySelector(".validation-modal-close").addEventListener("click", () => this.close());
        this.overlay.addEventListener("click", (e) => { if (e.target === this.overlay) this.close(); });

    }

    close() {
        this.overlay.classList.add("hidden");
    }

    // Corre la validación DE NUEVO cada vez que se abre (no cachea
    // nada) -- el circuito pudo haber cambiado desde la última vez.
    show() {

        const result = this.simulator.validationEngine.validateCircuit();

        this.body.innerHTML = "";

        if (result.errors.length === 0 && result.warnings.length === 0) {
            const ok = document.createElement("div");
            ok.className = "validation-ok";
            ok.textContent = "✅ No se encontró ningún problema en el circuito.";
            this.body.appendChild(ok);
        } else {

            if (result.errors.length > 0) {
                this.body.appendChild(this._buildSection("❌ Errores", result.errors, "error"));
            }

            if (result.warnings.length > 0) {
                this.body.appendChild(this._buildSection("⚠️ Advertencias", result.warnings, "warning"));
            }

        }

        this.overlay.classList.remove("hidden");

    }

    _buildSection(title, items, kind) {

        const section = document.createElement("div");
        section.className = "validation-section";

        const heading = document.createElement("div");
        heading.className = `validation-section-title validation-section-title-${kind}`;
        heading.textContent = title;
        section.appendChild(heading);

        const list = document.createElement("ul");
        list.className = "validation-list";

        items.forEach((item) => {

            const li = document.createElement("li");
            li.className = `validation-item validation-item-${kind}`;

            const componentIds = item.componentIds || [];
            const clickable = componentIds.some((id) => this.simulator.componentManager.get(id));

            if (clickable) {
                li.classList.add("validation-item-clickable");
                li.title = "Click para ubicar en el lienzo";
                li.addEventListener("click", () => this._locate(componentIds));
            }

            const text = document.createElement("span");
            text.textContent = item.message;
            li.appendChild(text);

            if (clickable) {
                const pin = document.createElement("span");
                pin.className = "validation-item-pin";
                pin.textContent = "📍";
                li.appendChild(pin);
            }

            list.appendChild(li);

        });

        section.appendChild(list);
        return section;

    }

    _locate(componentIds) {

        componentIds.forEach((id) => {
            const component = this.simulator.componentManager.get(id);
            if (component) this.simulator.renderer.locateComponent(component);
        });

        // Deja ver el resaltado en el lienzo -- cerrar el modal en vez
        // de dejarlo tapando el componente que se acaba de ubicar.
        this.close();

    }

}
