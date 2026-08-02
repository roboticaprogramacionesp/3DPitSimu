/*
==========================================================
 PitSimulator — BlocklyPanel.js
 Botón 🧩 (barra superior) que abre un overlay a pantalla completa con
 el editor de bloques (Blockly), portado de AppBlock3 tal cual --
 misma versión de Blockly (v6.20210701.0), mismos bloques/generadores
 (js/blockly/blocks.js + generators.js, copias de conversion.js/
 micropython.js de AppBlock3), mismo toolbox (js/blockly/toolbox.js,
 el XML de AppBlock3 sin la sección de minijuego "🎮 Juego" -- esos
 bloques nunca se registran acá, no se portó game_blocks.js/
 animation.js).

 A propósito NO se porta nada de flasheo real por USB/serial, BLE,
 monitor serial, ni la ventana de "ver código" separada de AppBlock3
 (con sus propias pestañas) -- PitSimulator ya resuelve todo eso con
 su botón "Simular" + el panel REPL/Editor existente. El único punto
 de integración real es: generar el Python de los bloques
 (Blockly.Python.workspaceToCode) y ponerlo en el editor que YA
 existe -- mismo idioma de 3 líneas que ya usa
 ReplPanel._loadCodeFromDisk() para cargar un .py del disco:
 codeMirror.setValue(...) + switchTab("editor") + focus().
==========================================================
*/

class BlocklyPanel {

    constructor(simulator, replPanel) {

        this.simulator = simulator;
        this.replPanel = replPanel;

        // Blockly.inject() necesita un contenedor con dimensiones
        // reales -- inyectar en un div todavía oculto (display:none)
        // lo deja roto (workspace de 0x0). Por eso la inyección real
        // se pospone a la PRIMERA vez que se abre el overlay (ver
        // open()), no acá en el constructor.
        this.workspace = null;

        this.buildDOM();

    }

    buildDOM() {

        this.btn = document.getElementById("btnBlockly");
        this.btn?.addEventListener("click", () => this.open());

        this.overlay = document.createElement("div");
        this.overlay.className = "blockly-panel-overlay hidden";
        this.overlay.innerHTML = `
            <div class="blockly-panel-header">
                <div class="blockly-panel-filemenu">
                    <button type="button" class="blockly-panel-file-toggle">📁 Archivo</button>
                    <div class="project-drawer hidden">
                        <div class="project-drawer-section">
                            <button class="project-drawer-item" id="blocklyFileNew">🆕 Nuevo</button>
                            <button class="project-drawer-item" id="blocklyFileSave">💾 Guardar .xml</button>
                            <button class="project-drawer-item" id="blocklyFileOpen">📂 Abrir .xml…</button>
                        </div>
                    </div>
                </div>
                <span class="blockly-panel-title">🧩 Editor de bloques</span>
                <button type="button" class="blockly-panel-insert">⬇ Insertar en el editor</button>
                <button type="button" class="blockly-panel-close" title="Cerrar">✕</button>
            </div>
            <div id="blocklyDiv" class="blockly-panel-workspace"></div>
        `;
        document.body.appendChild(this.overlay);

        this._bindFileMenu();

        // Toolbox: mismo criterio que AppBlock3 (un <xml> real en el
        // DOM, oculto, referenciado por id) -- Blockly.inject() lo
        // toma como nodo, no como texto.
        const toolboxWrapper = document.createElement("div");
        toolboxWrapper.style.display = "none";
        toolboxWrapper.innerHTML = PIT_BLOCKLY_TOOLBOX_XML;
        document.body.appendChild(toolboxWrapper);
        this.toolboxEl = toolboxWrapper.querySelector("#toolbox");

        this.overlay.querySelector(".blockly-panel-close")
            .addEventListener("click", () => this.close());
        this.overlay.querySelector(".blockly-panel-insert")
            .addEventListener("click", () => this.insertIntoEditor());

        // Sin "cerrar al click afuera" a propósito -- a diferencia de
        // un modal chico (ReportGenerator), acá el overlay ocupa toda
        // la pantalla y se está arrastrando bloques todo el tiempo
        // cerca de los bordes; cerrar por accidente perdería el
        // workspace armado (Blockly.inject() se reusa, no se
        // reconstruye, pero igual es una interrupción molesta).

        window.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !this.overlay.classList.contains("hidden")) {
                this.close();
            }
        });

    }

    // ====================================================
    // Menú "Archivo" (Nuevo / Guardar .xml / Abrir .xml) -- guarda/
    // carga el workspace de bloques como .xml, mismo formato que
    // Blockly.Xml.workspaceToDom()/domToWorkspace() ya usaba en
    // AppBlock3. A diferencia de la versión de AppBlock3 (atada a
    // diálogos nativos de pywebview + autoguardado en Python), acá se
    // reusa el MISMO patrón ya establecido en ProjectManager.js para
    // guardar/abrir el .json del proyecto: File System Access API
    // (showSaveFilePicker/showOpenFilePicker) con fallback a
    // <a download>/<input type=file> para navegadores sin esa API.
    // "Recargar" del menú original de AppBlock3 no se portó -- ahí
    // recargaba desde un autoguardado en localStorage que este panel
    // no tiene (no pareció necesario: el workspace ya persiste solo,
    // en memoria, mientras la pestaña siga abierta).
    // ====================================================

    _bindFileMenu() {

        const wrapper = this.overlay.querySelector(".blockly-panel-filemenu");
        const toggle = wrapper.querySelector(".blockly-panel-file-toggle");
        const drawer = wrapper.querySelector(".project-drawer");

        toggle.addEventListener("click", (e) => {
            e.stopPropagation();
            drawer.classList.toggle("hidden");
        });

        document.addEventListener("click", (e) => {
            if (!wrapper.contains(e.target)) drawer.classList.add("hidden");
        });

        this.overlay.querySelector("#blocklyFileNew")
            .addEventListener("click", () => { drawer.classList.add("hidden"); this._newWorkspace(); });
        this.overlay.querySelector("#blocklyFileSave")
            .addEventListener("click", () => { drawer.classList.add("hidden"); this._saveWorkspaceXml(); });
        this.overlay.querySelector("#blocklyFileOpen")
            .addEventListener("click", () => { drawer.classList.add("hidden"); this._openWorkspaceXml(); });

    }

    _newWorkspace() {

        if (!this.workspace) return;
        if (this.workspace.getAllBlocks(false).length === 0) return;

        const ok = confirm("¿Vaciar el workspace de bloques? Se perderán los bloques que no hayas guardado.");
        if (!ok) return;

        this.workspace.clear();

    }

    _saveWorkspaceXml() {

        if (!this.workspace) return;

        const dom = Blockly.Xml.workspaceToDom(this.workspace);
        const xmlText = Blockly.Xml.domToPrettyText(dom);
        const blob = new Blob([xmlText], { type: "application/xml" });
        const suggestedName = `bloques_${new Date().toISOString().slice(0, 10)}.xml`;

        if (window.showSaveFilePicker) {

            (async () => {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName,
                        types: [{ description: "Bloques (XML)", accept: { "application/xml": [".xml"] } }],
                    });
                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                } catch (err) {
                    if (err?.name !== "AbortError") {
                        console.warn("[BlocklyPanel] No se pudo guardar el .xml:", err);
                        alert("❌ Error guardando el archivo: " + err.message);
                    }
                }
            })();
            return;

        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedName;
        a.click();
        URL.revokeObjectURL(url);

    }

    async _openWorkspaceXml() {

        if (!this.workspace) return;

        try {

            let text = null;

            if (window.showOpenFilePicker) {

                // showOpenFilePicker() SIEMPRE primero, antes de
                // cualquier confirm()/alert() -- un diálogo bloqueante
                // corrido antes le come el "user gesture" del click al
                // navegador (mismo bug real ya encontrado y arreglado
                // en ProjectManager.openProject(), ver ese archivo).
                const [handle] = await window.showOpenFilePicker({
                    multiple: false,
                    types: [{ description: "Bloques (XML)", accept: { "application/xml": [".xml"] } }],
                });
                const file = await handle.getFile();
                text = await file.text();

            } else {

                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".xml";
                const file = await new Promise((resolve) => {
                    input.onchange = () => resolve(input.files?.[0] || null);
                    input.click();
                });
                if (!file) return;
                text = await file.text();

            }

            if (!text) return;

            if (this.workspace.getAllBlocks(false).length > 0) {
                const ok = confirm("¿Reemplazar los bloques actuales por los del archivo elegido?");
                if (!ok) return;
            }

            const dom = Blockly.Xml.textToDom(text);
            this.workspace.clear();
            Blockly.Xml.domToWorkspace(dom, this.workspace);

        } catch (err) {

            if (err?.name !== "AbortError") {
                console.warn("[BlocklyPanel] No se pudo abrir el .xml:", err);
                alert("❌ Error abriendo el archivo: " + err.message);
            }

        }

    }

    open() {

        this.overlay.classList.remove("hidden");

        if (!this.workspace) {

            this.workspace = Blockly.inject("blocklyDiv", {
                toolbox: this.toolboxEl,
                media: "assets/blockly-media/",
                trashcan: true,
                undo: true,
                oneBasedIndex: false,
                grid: { spacing: 20, length: 3, colour: "#ccc", snap: true },
                zoom: { controls: true, wheel: true, startScale: 1.0, maxScale: 3, minScale: 0.3, scaleSpeed: 1.2 },
            });

            // Botones dibujados directo sobre el SVG del workspace
            // (no son <button> HTML -- por eso se mueven solos con el
            // zoom/scroll de Blockly), portados de AppBlock3
            // (static/undoRedo.js + static/svgToPng.js), ver
            // js/blockly/canvasButtons.js.
            pitAddScreenshotButton(this.workspace, () => this._downloadScreenshot());
            pitAddUndoRedoButtons(this.workspace);

        } else {

            // Blockly.inject() ya se hizo antes -- el contenedor
            // estuvo oculto (display:none) mientras tanto, así que
            // hay que forzar un resize real ahora que vuelve a ser
            // visible, o el workspace queda con las medidas viejas
            // (mismo problema que ya resolvía refreshBlockly() en
            // AppBlock3 al cambiar de pestaña).
            Blockly.svgResize(this.workspace);

        }

    }

    close() {
        this.overlay.classList.add("hidden");
    }

    // Blockly.Python declara TODAS las variables del workspace como
    // "nombre = None" al principio del código generado -- es su red
    // de seguridad para no explotar con NameError si alguna rama
    // llegara a leer una variable antes de que el programa le asigne
    // un valor real. Si esa misma variable YA tiene una asignación
    // real en otra línea (ej. "contador = 0" puesto por el bloque
    // "establecer variable"), esa declaración es puro ruido visual
    // para quien está aprendiendo -- porteado tal cual de AppBlock3
    // (tsCleanCodeForDisplay() en static/main.js), a pedido del
    // usuario ("var = None" -> "var = 0").
    //
    // OJO -- diferencia real con AppBlock3: allá esto SOLO limpiaba
    // lo que se mostraba en un visor de código de solo lectura,
    // separado del código que de verdad se subía/ejecutaba
    // (getCode()/Tabs.getActiveCode() no pasaban por acá). PitSimulator
    // no tiene esa separación -- el editor de Python ES la única
    // fuente de verdad, tanto para mostrar como para lo que corre
    // "Ejecutar" después. Se limpia igual, en el único punto donde
    // el código de Blockly entra al editor (acá) -- a partir de ahí
    // es texto Python común y silvestre, editable por el alumno como
    // cualquier otro. Riesgo aceptado: si algún workspace de verdad
    // dependiera de una rama sin asignar leyendo su propio "= None"
    // (caso raro), el fallo sería un NameError claro al ejecutar, no
    // silencioso.
    _cleanCodeForDisplay(code) {

        if (typeof code !== "string" || !code) return code;

        const lines = code.split("\n");
        const noneDeclRe = /^([A-Za-z_]\w*)\s*=\s*None\s*$/;
        // "nombre = <algo que no sea None>", cuidando de no confundir
        // el "=" con comparaciones (==, <=, >=) ni con la propia
        // declaración None.
        const realAssignRe = /^\s*([A-Za-z_]\w*)\s*=(?!=)\s*(?!None\s*$)\S.*$/;

        const varsConValorReal = new Set();
        lines.forEach((line) => {
            const m = line.match(realAssignRe);
            if (m) varsConValorReal.add(m[1]);
        });

        return lines
            .filter((line) => {
                const m = line.match(noneDeclRe);
                return !m || !varsConValorReal.has(m[1]);
            })
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/^\n+/, "");

    }

    insertIntoEditor() {

        if (!this.workspace) return;

        const code = this._cleanCodeForDisplay(Blockly.Python.workspaceToCode(this.workspace));

        this.replPanel.codeMirror.setValue(code);

        // BUG REAL (reportado por el usuario: "la ventana del editor
        // se distorsiona, dar click es más complicado"): el panel
        // REPL/Editor arranca COLAPPSADO (.repl-closed, altura 32px,
        // ver el constructor de ReplPanel) -- si el usuario nunca lo
        // abrió antes de entrar al editor de bloques, switchTab()
        // solo (más abajo) mide/hace .refresh() de CodeMirror con el
        // panel TODAVÍA en esa altura chica. Hay que abrirlo primero
        // si estaba cerrado (ReplPanel.toggle() -- ojo, es un TOGGLE,
        // llamarlo con el panel ya abierto lo cerraría).
        if (!this.replPanel.open) this.replPanel.toggle();

        this.replPanel.switchTab("editor");

        // Igual que ReplPanel.toggle() ya hace consigo mismo (ver ese
        // método): el panel anima su altura por CSS (0.25s, ver
        // repl-panel.css) -- un refresh() inmediato (el que
        // switchTab() ya dispara) puede correr TODAVÍA a mitad de esa
        // transición y medir mal. Se repite el refresh una vez que la
        // transición terminó, mismo tiempo de espera que ya usa
        // ReplPanel.toggle() para el mismo motivo.
        setTimeout(() => {
            this.replPanel.codeMirror.refresh();
            this.replPanel.codeMirror.focus();
        }, 260);

        this.close();

    }

    // ====================================================
    // Captura del workspace actual como imagen (dataUrl + width +
    // height, mismo shape que ReportGenerator._captureCircuitImage()/
    // _loadImageFile()) -- usado por el botón 📄 "Generar reporte"
    // para meter una foto de los bloques en el reporte SIN que el
    // usuario tenga que exportar/cargar una imagen a mano, Y por el
    // botón 📷 dibujado sobre el propio canvas de Blockly (ver
    // js/blockly/canvasButtons.js).
    //
    // La lógica real vive en js/blockly/canvasButtons.js
    // (pitWorkspaceToSvg()/pitSvgToPng()) -- primer intento acá mismo
    // (ya reemplazado) se había quedado corto: le faltaba juntar los
    // <style> REALES que Blockly inyecta en la página (de ahí salían
    // negros ciertos íconos especiales, aunque otros -- como el color
    // del LED -- ya se veían bien). canvasButtons.js es un port fiel
    // de static/svgToPng.js de AppBlock3 (el mecanismo que el usuario
    // ya había confirmado que sacaba fotos buenas ahí), así que ambos
    // caminos (botón manual y captura automática del reporte)
    // comparten EXACTAMENTE la misma implementación -- no hay riesgo
    // de que diverjan.
    //
    // Devuelve null si no hay workspace o está vacío -- el llamador
    // (ReportGenerator) ya sabe caer al código en texto plano en ese
    // caso, mismo criterio que cuando no había imagen cargada a mano.
    // ====================================================

    async captureWorkspaceImage() {

        if (!this.workspace) return null;
        if (this.workspace.getAllBlocks(false).length === 0) return null;

        try {
            const svg = await pitWorkspaceToSvg(this.workspace);
            return await pitSvgToPng(svg);
        } catch (err) {
            console.warn("[BlocklyPanel] No se pudo capturar la imagen del workspace:", err);
            return null;
        }

    }

    // Botón 📷 sobre el canvas -- misma captura de arriba, pero en vez
    // de guardarse para el reporte se ofrece para descargar. A pedido,
    // usa el mismo patrón que _saveWorkspaceXml() (showSaveFilePicker,
    // eligiendo dónde guardar) en vez de bajar directo a Descargas.
    async _downloadScreenshot() {

        const img = await this.captureWorkspaceImage();
        if (!img) return;

        const res = await fetch(img.dataUrl);
        const blob = await res.blob();
        const suggestedName = `bloques_${new Date().toISOString().slice(0, 10)}.png`;

        if (window.showSaveFilePicker) {

            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName,
                    types: [{ description: "Imagen PNG", accept: { "image/png": [".png"] } }],
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
            } catch (err) {
                if (err?.name !== "AbortError") {
                    console.warn("[BlocklyPanel] No se pudo guardar la captura:", err);
                    alert("❌ Error guardando la imagen: " + err.message);
                }
            }
            return;

        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedName;
        a.click();
        URL.revokeObjectURL(url);

    }

}
