/*
==========================================================
 PitSimulator — ReportGenerator.js
 Botón 📄 (junto al nombre del proyecto, ver index.html) que arma un
 reporte imprimible de la práctica en un solo archivo (A4): título +
 qué vamos a aprender + alumno/fecha (los completa el alumno), lista
 de componentes/cables usados (automática, tomada del canvas),
 captura del circuito, el código del editor (o una imagen de bloques
 cargada a mano) y comentarios/tips finales. El documento en sí se
 arma siempre como SVG (texto plano, sin librerías) -- si
 OUTPUT_FORMAT pide "pdf", ese mismo SVG se rasteriza a un canvas de
 alta resolución y se empaqueta como PDF de una sola página con jsPDF
 (vendorizado en lib/jspdf/, ver _svgToPdfBlob()). El SVG sigue siendo
 el formato "nativo" -- el PDF es una conversión posterior, no un
 armado alternativo del documento.
==========================================================
*/

class ReportGenerator {

    // Único lugar que define en qué formato se exporta el reporte --
    // "svg" (el documento tal cual se arma, sin conversión) o "pdf"
    // (mismo SVG, rasterizado + empaquetado con jsPDF, ver
    // _svgToPdfBlob()). Cambiar esto alcanza para probar/usar el otro
    // formato, no hace falta tocar nada más.
    static OUTPUT_FORMAT = "pdf";

    constructor(simulator, replPanel, toolbar) {

        this.simulator = simulator;
        this.replPanel = replPanel;
        this.toolbar   = toolbar;

        // Data URL del ícono ya convertido a PNG (ver _loadLogoDataUrl) --
        // se resuelve una sola vez y se reusa en reportes siguientes,
        // no hace falta re-decodificar el .ico cada vez.
        this._logoDataUrl = null;

        // Imagen de código cargada a mano (ej. captura de los bloques
        // desde Blocks/AppBlock3), ver _bindCodeImageInput(). null =
        // usar el código en texto plano del editor, como antes.
        this._codeImage = null;

        // Los valores del formulario solo se precargan la PRIMERA vez
        // que se abre el modal en esta sesión -- a pedido explícito:
        // cerrar el modal (click afuera) y volver a abrirlo no debe
        // perder lo que el alumno ya había escrito.
        this._openedOnce = false;

        this.buildDOM();

    }

    // ====================================================
    // DOM: botón + modal con los campos que completa el alumno
    // ====================================================

    buildDOM() {

        this.btn = document.getElementById("btnGenerateReport");
        this.btn?.addEventListener("click", () => this.openModal());

        this.overlay = document.createElement("div");
        this.overlay.className = "report-modal-overlay hidden";
        this.overlay.innerHTML = `
            <div class="report-modal">
                <div class="report-modal-header">
                    <span class="report-modal-title">📄 Reporte de la práctica</span>
                    <button class="report-modal-close" title="Cerrar">✕</button>
                </div>

                <div class="report-modal-field">
                    <label for="reportTitle">Título</label>
                    <input type="text" id="reportTitle" maxlength="80">
                </div>

                <div class="report-modal-field">
                    <label for="reportGoal">¿Qué vamos a aprender?</label>
                    <textarea id="reportGoal" maxlength="600" placeholder="Ej.: Aprenderemos a usar la LCD 16x2 I2C para mostrar texto desde MicroPython."></textarea>
                </div>

                <div class="report-modal-field report-modal-field-row">
                    <div>
                        <label for="reportStudent">Nombre del alumno</label>
                        <input type="text" id="reportStudent" maxlength="80">
                    </div>
                    <div>
                        <label for="reportDate">Fecha</label>
                        <input type="date" id="reportDate">
                    </div>
                </div>

                <div class="report-modal-field">
                    <label for="reportSchool">Escuela / CCT</label>
                    <input type="text" id="reportSchool" maxlength="80">
                </div>

                <div class="report-modal-field">
                    <label>Código</label>
                    <div class="report-modal-code-image-row">
                        <button type="button" class="report-modal-load-image">📂 Cargar imagen del código (bloques)</button>
                        <span class="report-modal-code-image-name"></span>
                        <button type="button" class="report-modal-clear-image hidden" title="Quitar imagen, usar el código en texto">✕</button>
                    </div>
                    <input type="file" id="reportCodeImageInput" accept="image/*" class="report-modal-file-hidden">
                    <p class="report-modal-hint">
                        Opcional -- si cargás una imagen (ej. una captura de los
                        bloques desde Blocks) se usa esa en vez del código en
                        texto plano del editor.
                    </p>
                </div>

                <div class="report-modal-field">
                    <label for="reportTips">Comentarios o tips a considerar</label>
                    <textarea id="reportTips" maxlength="600" placeholder="Ej.: Revisar que el GND esté compartido entre todos los módulos."></textarea>
                </div>

                <div class="report-modal-field report-modal-checkbox-field">
                    <label>
                        <input type="checkbox" id="reportShowNames" checked>
                        Mostrar el nombre de cada componente en la imagen del circuito
                    </label>
                </div>

                <p class="report-modal-hint">
                    Se incluyen automáticamente: la lista de componentes y
                    cables del lienzo, y una captura del circuito.
                </p>

                <div class="report-modal-actions">
                    <button class="report-modal-cancel">Cancelar</button>
                    <button class="report-modal-preview">👁 Vista previa</button>
                    <button class="report-modal-generate">Generar reporte</button>
                </div>
            </div>
        `;
        document.body.appendChild(this.overlay);

        this._els = {
            title:          this.overlay.querySelector("#reportTitle"),
            goal:           this.overlay.querySelector("#reportGoal"),
            student:        this.overlay.querySelector("#reportStudent"),
            date:           this.overlay.querySelector("#reportDate"),
            school:         this.overlay.querySelector("#reportSchool"),
            tips:           this.overlay.querySelector("#reportTips"),
            showNames:      this.overlay.querySelector("#reportShowNames"),
            codeImageInput: this.overlay.querySelector("#reportCodeImageInput"),
            loadImageBtn:   this.overlay.querySelector(".report-modal-load-image"),
            clearImageBtn:  this.overlay.querySelector(".report-modal-clear-image"),
            codeImageName:  this.overlay.querySelector(".report-modal-code-image-name"),
            preview:        this.overlay.querySelector(".report-modal-preview"),
            generate:       this.overlay.querySelector(".report-modal-generate"),
        };

        this.overlay.querySelector(".report-modal-close").addEventListener("click", () => this.closeModal());
        this.overlay.querySelector(".report-modal-cancel").addEventListener("click", () => this.closeModal());
        this.overlay.addEventListener("click", (e) => { if (e.target === this.overlay) this.closeModal(); });

        this._els.preview.addEventListener("click", () => this.preview());
        this._els.generate.addEventListener("click", () => this.generate());

        this._bindCodeImageInput();

        // Recuerda lo último escrito (alumno/escuela se repiten seguido
        // entre una práctica y la siguiente).
        this._els.student.addEventListener("change", () => {
            localStorage.setItem("pit_report_student", this._els.student.value);
        });
        this._els.school.addEventListener("change", () => {
            localStorage.setItem("pit_report_school", this._els.school.value);
        });

    }

    _bindCodeImageInput() {

        this._els.loadImageBtn.addEventListener("click", () => this._els.codeImageInput.click());

        this._els.codeImageInput.addEventListener("change", async () => {

            const file = this._els.codeImageInput.files?.[0];
            if (!file) return;

            try {
                this._codeImage = await this._loadImageFile(file);
                this._els.codeImageName.textContent = file.name;
                this._els.clearImageBtn.classList.remove("hidden");
            } catch (err) {
                console.error("[ReportGenerator] No se pudo leer la imagen:", err);
                alert("❌ No se pudo leer esa imagen.");
            }

        });

        this._els.clearImageBtn.addEventListener("click", () => {
            this._codeImage = null;
            this._els.codeImageInput.value = "";
            this._els.codeImageName.textContent = "";
            this._els.clearImageBtn.classList.add("hidden");
        });

    }

    openModal() {

        // Ver el comentario en el constructor -- solo la PRIMERA vez
        // se pisan los campos con valores por defecto, para no perder
        // lo que el alumno ya escribió si cierra y vuelve a abrir.
        if (!this._openedOnce) {

            const pm = this.simulator.projectManager;
            const currentName = (pm.currentFileName || "").replace(/\.json$/i, "");
            this._els.title.value   = currentName || "Práctica de circuitos";
            this._els.student.value = localStorage.getItem("pit_report_student") || "";
            this._els.school.value  = localStorage.getItem("pit_report_school") || "";
            this._els.date.value    = new Date().toISOString().slice(0, 10);

            this._openedOnce = true;

        }

        this.overlay.classList.remove("hidden");
        this._els.title.focus();

    }

    closeModal() {
        this.overlay.classList.add("hidden");
    }

    // ====================================================
    // Vista previa / generación -- ambas arman los mismos datos y el
    // mismo SVG, solo cambia qué se hace con el resultado al final.
    // ====================================================

    async preview() {

        const data = await this._gatherReportData(this._els.preview);
        if (!data) return;

        const svgString = this._buildReportSvg(data);

        const blob = ReportGenerator.OUTPUT_FORMAT === "pdf"
            ? await this._svgToPdfBlob(svgString)
            : new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });

        const url = URL.createObjectURL(blob);

        // Se abre en una pestaña nueva -- no hace falta revocar el
        // object URL nosotros mismos, esa pestaña lo mantiene vivo
        // mientras esté abierta. Un PDF se abre en el visor nativo del
        // navegador, igual que el SVG se abre como imagen.
        window.open(url, "_blank");

    }

    async generate() {

        const data = await this._gatherReportData(this._els.generate, "Generando...");
        if (!data) return;

        const svgString = this._buildReportSvg(data);

        try {
            await this._saveReport(svgString, data.title);
            this.closeModal();
        } catch (err) {
            console.error("[ReportGenerator] Error al guardar el reporte:", err);
            alert("❌ No se pudo guardar el reporte: " + err.message);
        } finally {
            this._els.generate.disabled = false;
            this._els.generate.textContent = "Generar reporte";
        }

    }

    // Junta todo lo que necesita el SVG (captura del circuito, logo,
    // checklist, campos del formulario) -- compartido por preview() y
    // generate(). Devuelve null (sin alertar dos veces) si no hay
    // nada que reportar todavía.
    async _gatherReportData(triggerBtn, busyLabel) {

        const components = this.simulator.componentManager.getAll();

        if (components.length === 0) {
            alert("No hay ningún componente en el lienzo todavía -- armá el circuito antes de generar el reporte.");
            return null;
        }

        const originalLabel = triggerBtn.textContent;
        triggerBtn.disabled = true;
        if (busyLabel) triggerBtn.textContent = busyLabel;

        try {

            const [circuitImage, logoDataUrl] = await Promise.all([
                this._captureCircuitImage(),
                this._loadLogoDataUrl(),
            ]);

            return {
                title:   this._els.title.value.trim() || "Práctica de circuitos",
                goal:    this._els.goal.value.trim(),
                student: this._els.student.value.trim(),
                school:  this._els.school.value.trim(),
                date:    this._els.date.value || new Date().toISOString().slice(0, 10),
                tips:    this._els.tips.value.trim(),
                code:    this.replPanel?.codeMirror?.getValue()?.trim() || "",
                codeImage: this._codeImage,
                checklist: this._buildChecklist(components),
                circuitImage,
                logoDataUrl,
            };

        } catch (err) {

            console.error("[ReportGenerator] Error al armar el reporte:", err);
            alert("❌ No se pudo generar el reporte: " + err.message);
            return null;

        } finally {

            if (busyLabel) {
                triggerBtn.disabled = false;
                triggerBtn.textContent = originalLabel;
            } else {
                triggerBtn.disabled = false;
            }

        }

    }

    // Lista de materiales tipo "* 2 LED, * 1 ESP32 WeMos D1 R32, ..."
    // (mismo espíritu que el listado de adkeypad.svg) -- agrupa por
    // tipo, usa el nombre "lindo" del primer componente de cada grupo
    // (Component.name ya viene resuelto desde <type>.json, no hace
    // falta re-leer manifest.json acá) y agrega el conteo de cables
    // POR TIPO (ver _classifyWires).
    _buildChecklist(components) {

        const groups = new Map();

        components.forEach((c) => {
            const entry = groups.get(c.type) || { name: c.name, count: 0, type: c.type };
            entry.count++;
            groups.set(c.type, entry);
        });

        const sorted = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));

        const items = [];
        sorted.forEach((g) => {

            items.push(`${g.count} ${g.name}`);

            // El cable USB a mini USB no es un componente del lienzo
            // (no se arrastra ni se conecta con cables) pero hace falta
            // sí o sí para alimentar/programar cada ESP32 -- se agrega
            // acá a mano, justo debajo de ella en la lista, en vez de
            // pedirle al usuario que se acuerde de sumarlo aparte.
            if (g.type.startsWith("esp32")) {
                items.push(`${g.count} cable${g.count === 1 ? "" : "s"} USB a mini USB`);
            }

        });

        return items.concat(this._classifyWires());

    }

    // Tipo de cable para armar el circuito FÍSICO real -- agrupa por
    // wire.connectorType (ver WireManager.CONNECTOR_TYPES), que el
    // usuario puede elegir a mano por cada cable desde el panel de
    // propiedades (PropertyPanel._appendWireConnectorTypeField). Ya no
    // es una regla automática adivinada acá -- el usuario es quien
    // mejor sabe qué conectores tiene, el valor inicial de cada cable
    // (ver WireManager.defaultConnectorType) es solo un punto de
    // partida razonable.
    _classifyWires() {

        const counts = new Map();

        this.simulator.wireManager.wires.forEach((wire) => {
            const type = wire.connectorType || "hembra-hembra";
            counts.set(type, (counts.get(type) || 0) + 1);
        });

        const items = [...counts.entries()].map(([type, count]) =>
            `${count} cable${count === 1 ? "" : "s"} ${type}`
        );

        if (items.length === 0) items.push("0 cables");

        return items;

    }

    async _captureCircuitImage() {

        const result = await this.toolbar._buildCircuitPngBlob({ showNames: this._els.showNames.checked });
        if (!result) return null;

        const dataUrl = await this._blobToDataUrl(result.blob);
        return { dataUrl, width: result.width, height: result.height };

    }

    _blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    // Lee un <input type="file"> de imagen y devuelve {dataUrl, width,
    // height} -- mismo shape que _captureCircuitImage(), así
    // _buildReportSvg() puede tratar "código como imagen" y "captura
    // del circuito" con el mismo bloque de escalado/centrado.
    _loadImageFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload  = () => resolve({ dataUrl: reader.result, width: img.naturalWidth, height: img.naturalHeight });
                img.onerror = () => reject(new Error("no se pudo decodificar la imagen"));
                img.src = reader.result;
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    // El logo del proyecto es un .ico (3DPit.ico, junto a index.html) --
    // se decodifica una vez vía <img>/<canvas> (los navegadores SÍ
    // rasterizan .ico en un <img>, es como cargan el favicon) y se
    // reexporta como PNG: un .ico embebido tal cual como data URI
    // dentro de un <image> de SVG no es tan confiable fuera del propio
    // navegador (ej. al abrir el .svg en otro programa), un PNG sí.
    async _loadLogoDataUrl() {

        if (this._logoDataUrl) return this._logoDataUrl;

        try {

            const img = await new Promise((resolve, reject) => {
                const el = new Image();
                el.onload  = () => resolve(el);
                el.onerror = () => reject(new Error("no se pudo cargar 3DPit.ico"));
                el.src = "3DPit.ico";
            });

            const size = 64;
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            canvas.getContext("2d").drawImage(img, 0, 0, size, size);

            this._logoDataUrl = canvas.toDataURL("image/png");

        } catch (err) {
            console.warn("[ReportGenerator] No se pudo preparar el logo, el reporte sale sin él:", err);
            this._logoDataUrl = null;
        }

        return this._logoDataUrl;

    }

    _escapeXml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }

    // Corte de línea manual -- SVG <text> no hace word-wrap solo.
    // Corta por cantidad de caracteres (aproximado, fuente monoespaciada
    // asumida para el cálculo aunque el texto libre no lo sea -- alcanza
    // para que no se salga de la página).
    _wrapText(text, maxChars) {

        const words = text.split(/\s+/).filter(Boolean);
        const lines = [];
        let current = "";

        words.forEach((word) => {
            const candidate = current ? `${current} ${word}` : word;
            if (candidate.length > maxChars && current) {
                lines.push(current);
                current = word;
            } else {
                current = candidate;
            }
        });
        if (current) lines.push(current);

        return lines;

    }

    // ====================================================
    // Armado del documento SVG (A4, unidades = mm, mismo criterio que
    // el ejemplo de referencia adkeypad.svg: width/height en "mm" +
    // viewBox en las mismas unidades numéricas).
    // ====================================================

    _buildReportSvg(data) {

        const esc = (s) => this._escapeXml(s);
        const PAGE_W = 210;
        const PAGE_H = 297;
        const MARGIN = 12;
        const CONTENT_W = PAGE_W - MARGIN * 2;

        const parts = [];

        parts.push(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>`);
        parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${PAGE_W}mm" height="${PAGE_H}mm" viewBox="0 0 ${PAGE_W} ${PAGE_H}" font-family="Segoe UI, Arial, sans-serif">`);
        parts.push(`<rect x="0" y="0" width="${PAGE_W}" height="${PAGE_H}" fill="#ffffff"/>`);

        // ---- Encabezado: logo + título + alumno/fecha (izquierda) --
        // materiales en una caja aparte (derecha), mismo lugar/estilo
        // que el listado "* 1 PC / * 1 ESP32 / ..." del adkeypad.svg
        // de referencia. Las dos columnas pueden terminar a distinta
        // altura -- el resto de la página arranca debajo de la más
        // alta de las dos.
        const headerTop = MARGIN;

        if (data.logoDataUrl) {
            parts.push(`<image href="${data.logoDataUrl}" x="${MARGIN}" y="${headerTop}" width="16" height="16"/>`);
        }
        const titleX = data.logoDataUrl ? MARGIN + 20 : MARGIN;
        parts.push(`<text x="${titleX}" y="${headerTop + 6}" font-size="7" font-weight="700" fill="#1a1a1a">${esc(data.title)}</text>`);
        parts.push(`<text x="${titleX}" y="${headerTop + 11}" font-size="3" fill="#777">Reporte de práctica -- 3DPitSim</text>`);
        parts.push(`<text x="${titleX}" y="${headerTop + 16.5}" font-size="3.2" fill="#333">Alumno: ${esc(data.student || "________________")}    Fecha: ${esc(data.date)}</text>`);
        parts.push(`<text x="${titleX}" y="${headerTop + 21.5}" font-size="3.2" fill="#333">Escuela / CCT: ${esc(data.school || "________________")}</text>`);
        const leftColBottom = headerTop + 21.5;

        const BOX_X = 130;
        const BOX_W = PAGE_W - MARGIN - BOX_X;
        const boxLineH = 4.2;
        const boxTitleH = 6;
        const boxH = boxTitleH + data.checklist.length * boxLineH + 3;
        parts.push(`<rect x="${BOX_X}" y="${headerTop}" width="${BOX_W}" height="${boxH}" rx="1.5" fill="#f5f7fa" stroke="#ccc" stroke-width="0.3"/>`);
        parts.push(`<text x="${BOX_X + 3}" y="${headerTop + 5}" font-size="3.6" font-weight="700" fill="#1a1a1a">Materiales</text>`);
        let matY = headerTop + boxTitleH + 3;
        data.checklist.forEach((item) => {
            parts.push(`<text x="${BOX_X + 3}" y="${matY}" font-size="3" fill="#333"><tspan font-size="4.5" fill="#2a7fff">&#9633;</tspan> ${esc(item)}</text>`);
            matY += boxLineH;
        });
        const rightColBottom = headerTop + boxH;

        let y = Math.max(leftColBottom, rightColBottom) + 8;
        parts.push(`<line x1="${MARGIN}" y1="${y}" x2="${PAGE_W - MARGIN}" y2="${y}" stroke="#ccc" stroke-width="0.3"/>`);
        y += 7;

        // ---- ¿Qué vamos a aprender? ----
        parts.push(`<text x="${MARGIN}" y="${y}" font-size="4.5" font-weight="700" fill="#1a1a1a">¿Qué vamos a aprender?</text>`);
        y += 5;
        const goalLines = data.goal
            ? this._wrapText(data.goal, 100)
            : ["________________________________________________________"];
        goalLines.forEach((line) => {
            parts.push(`<text x="${MARGIN}" y="${y}" font-size="3.3" fill="#333">${esc(line)}</text>`);
            y += 4.2;
        });
        y += 3;

        // ---- Conexiones (captura del circuito) ----
        parts.push(`<text x="${MARGIN}" y="${y}" font-size="4.5" font-weight="700" fill="#1a1a1a">Conexiones</text>`);
        y += 4;

        const IMG_MAX_H = 85;
        if (data.circuitImage) {
            const scale = Math.min(CONTENT_W / data.circuitImage.width, IMG_MAX_H / data.circuitImage.height);
            const imgW = data.circuitImage.width  * scale;
            const imgH = data.circuitImage.height * scale;
            const imgX = MARGIN + (CONTENT_W - imgW) / 2;
            parts.push(`<rect x="${MARGIN}" y="${y}" width="${CONTENT_W}" height="${imgH + 4}" fill="#f5f7fa" stroke="#ddd" stroke-width="0.3"/>`);
            parts.push(`<image href="${data.circuitImage.dataUrl}" x="${imgX}" y="${y + 2}" width="${imgW}" height="${imgH}"/>`);
            y += imgH + 8;
        } else {
            parts.push(`<text x="${MARGIN}" y="${y}" font-size="3.3" fill="#999">(no se pudo capturar el circuito)</text>`);
            y += 6;
        }

        // ---- Código -- imagen cargada a mano (ej. bloques) si hay
        // una, si no el texto plano del editor como antes. ----
        const CODE_BOTTOM = PAGE_H - MARGIN - 20; // deja lugar a tips + pie de página

        if (data.codeImage) {

            parts.push(`<text x="${MARGIN}" y="${y}" font-size="4.5" font-weight="700" fill="#1a1a1a">Código</text>`);
            y += 4;
            const maxH = Math.max(20, CODE_BOTTOM - y - 4);
            const scale = Math.min(CONTENT_W / data.codeImage.width, maxH / data.codeImage.height, 1);
            const imgW = data.codeImage.width  * scale;
            const imgH = data.codeImage.height * scale;
            const imgX = MARGIN + (CONTENT_W - imgW) / 2;
            parts.push(`<rect x="${MARGIN}" y="${y}" width="${CONTENT_W}" height="${imgH + 4}" fill="#f5f7fa" stroke="#ddd" stroke-width="0.3"/>`);
            parts.push(`<image href="${data.codeImage.dataUrl}" x="${imgX}" y="${y + 2}" width="${imgW}" height="${imgH}"/>`);
            y += imgH + 8;

        } else {

            parts.push(`<text x="${MARGIN}" y="${y}" font-size="4.5" font-weight="700" fill="#1a1a1a">Código</text>`);
            y += 5;

            const CODE_LINE_H = 3.4;
            const maxCodeLines = Math.max(3, Math.floor((CODE_BOTTOM - y - 4) / CODE_LINE_H));

            const codeLines = data.code ? data.code.split("\n") : ["(el editor está vacío)"];
            const shown = codeLines.slice(0, maxCodeLines);
            const truncated = codeLines.length > maxCodeLines;

            const boxH2 = shown.length * CODE_LINE_H + 4 + (truncated ? CODE_LINE_H : 0);
            parts.push(`<rect x="${MARGIN}" y="${y}" width="${CONTENT_W}" height="${boxH2}" fill="#1e1f22" rx="1.5"/>`);
            let codeY = y + 4;
            shown.forEach((line) => {
                parts.push(`<text x="${MARGIN + 2}" y="${codeY}" font-size="2.7" font-family="Consolas, 'Courier New', monospace" fill="#e6e6e6" xml:space="preserve">${esc(line)}</text>`);
                codeY += CODE_LINE_H;
            });
            if (truncated) {
                parts.push(`<text x="${MARGIN + 2}" y="${codeY}" font-size="2.7" font-family="Consolas, 'Courier New', monospace" fill="#888">... (${codeLines.length - maxCodeLines} líneas más -- ver el proyecto completo)</text>`);
                codeY += CODE_LINE_H;
            }
            y = Math.max(y + boxH2, codeY) + 6;

        }

        // ---- Comentarios / tips a considerar ----
        if (data.tips) {
            parts.push(`<text x="${MARGIN}" y="${y}" font-size="4.5" font-weight="700" fill="#1a1a1a">Comentarios / tips a considerar</text>`);
            y += 5;
            this._wrapText(data.tips, 100).forEach((line) => {
                parts.push(`<text x="${MARGIN}" y="${y}" font-size="3.3" fill="#333">${esc(line)}</text>`);
                y += 4.2;
            });
        }

        // ---- Pie de página ----
        parts.push(`<text x="${PAGE_W / 2}" y="${PAGE_H - MARGIN + 4}" font-size="2.6" fill="#aaa" text-anchor="middle">Generado con 3DPitSim</text>`);

        parts.push(`</svg>`);

        return parts.join("\n");

    }

    _safeFileName(title) {
        return title
            .normalize("NFD").replace(/[̀-ͯ]/g, "") // saca tildes
            .replace(/[^a-zA-Z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .toLowerCase() || "reporte";
    }

    // Convierte el SVG A4 ya armado (_buildReportSvg) a un PDF de una
    // sola página. No hay forma de "convertir" el texto SVG a PDF
    // directamente sin una librería -- el camino más simple y robusto
    // es rasterizarlo a un canvas de alta resolución (mismo patrón que
    // Toolbar._svgToPngBlob para la captura del circuito: data URI en
    // vez de blob URL, ver el comentario de esa función sobre el bug
    // de canvas tainted con <image> embebidas) y después empaquetar
    // ese PNG como la única página de un documento jsPDF -- el
    // resultado es un PDF real, abrible en cualquier lector, aunque
    // "por dentro" sea una imagen y no texto/vectores seleccionables.
    async _svgToPdfBlob(svgString) {

        const PAGE_W_MM = 210;
        const PAGE_H_MM = 297;

        // ~192dpi en A4 -- nítido para leer en pantalla/imprimir sin
        // generar un archivo enorme (jsPDF re-comprime como JPEG abajo).
        const PX_PER_MM = 7.5;
        const pxW = Math.round(PAGE_W_MM * PX_PER_MM);
        const pxH = Math.round(PAGE_H_MM * PX_PER_MM);

        const svgDataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);

        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload  = () => resolve(el);
            el.onerror = () => reject(new Error("No se pudo rasterizar el SVG del reporte"));
            el.src = svgDataUrl;
        });

        const canvas = document.createElement("canvas");
        canvas.width = pxW;
        canvas.height = pxH;

        const ctx = canvas.getContext("2d");
        // Fondo blanco explícito -- toDataURL("image/jpeg") no tiene
        // canal alfa, sin esto cualquier zona transparente del SVG
        // saldría negra en vez de blanca.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, pxW, pxH);
        ctx.drawImage(img, 0, 0, pxW, pxH);

        const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.92);

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
        doc.addImage(jpegDataUrl, "JPEG", 0, 0, PAGE_W_MM, PAGE_H_MM);

        return doc.output("blob");

    }

    // Guarda el reporte pidiendo ubicación con el selector nativo del
    // sistema si el navegador lo soporta -- mismo patrón que
    // ProjectManager.saveProjectAs()/Toolbar.captureScreenshot(), en
    // vez de tirar la descarga directo a la carpeta de Descargas sin
    // preguntar.
    async _saveReport(svgString, title) {

        const isPdf = ReportGenerator.OUTPUT_FORMAT === "pdf";

        const suggestedName = `reporte_${this._safeFileName(title)}.${ReportGenerator.OUTPUT_FORMAT}`;
        const blob = isPdf
            ? await this._svgToPdfBlob(svgString)
            : new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });

        if (window.showSaveFilePicker) {

            try {

                const handle = await window.showSaveFilePicker({
                    suggestedName,
                    types: [isPdf
                        ? { description: "Reporte PDF", accept: { "application/pdf": [".pdf"] } }
                        : { description: "Reporte SVG", accept: { "image/svg+xml": [".svg"] } }]
                });

                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();

                return;

            } catch (err) {

                if (err?.name === "AbortError") return;
                console.warn("[ReportGenerator] No se pudo abrir el selector de guardado, se descarga directo:", err);

            }

        }

        // Fallback sin File System Access API (Firefox, Safari)
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedName;
        a.click();
        URL.revokeObjectURL(url);

    }

}
