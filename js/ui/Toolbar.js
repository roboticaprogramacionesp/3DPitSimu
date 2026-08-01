/*
==========================================================
 PitSimulator — Toolbar.js
 Barra superior con botones + indicador de simulación
==========================================================
*/

class Toolbar {

    constructor(simulator) {

        this.simulator = simulator;

        this.bindEvents();
        this.bindSimToggle();
        this.bindWasmModeToggle();
        this.bindSimulationEvents();
        this.bindWireWarnings();
        this.bindCanvasThemeToggle();
        this.bindCanvasTools();

    }

    //------------------------------------------------------
    // Botón 🌐 -- alternar entre modo escritorio (QEMU) y modo
    // navegador (WasmBridge, experimental -- ver plan "PitSimulator
    // en GitHub Pages"). Recarga la página a propósito: los dos
    // bridges se deciden UNA sola vez en js/app.js antes de crear
    // nada, nunca se reemplazan en caliente (ver el comentario
    // grande ahí sobre por qué).
    //------------------------------------------------------

    bindWasmModeToggle() {

        const btn = document.getElementById("btnWasmModeToggle");
        if (!btn) return;

        const isWasmMode = location.hash === "#modo=wasm";
        btn.classList.toggle("active", isWasmMode);
        btn.title = isWasmMode
            ? "Modo navegador activo -- clic para volver al modo escritorio"
            : "Modo escritorio activo -- clic para probar el modo navegador (experimental)";

        btn.addEventListener("click", () => {

            location.hash = isWasmMode ? "" : "modo=wasm";
            location.reload();

        });

    }

    //------------------------------------------------------
    // Barra flotante arriba a la derecha del lienzo: Deshacer,
    // Rehacer (mismo HistoryManager que ya escucha Ctrl+Z/Ctrl+Y --
    // estos botones son solo otra forma de disparar undo()/redo(),
    // no un mecanismo aparte) y capturar el circuito como PNG.
    //------------------------------------------------------

    bindCanvasTools() {

        const btnUndo = document.getElementById("btnUndo");
        const btnRedo = document.getElementById("btnRedo");
        const btnScreenshot = document.getElementById("btnScreenshot");

        btnUndo?.addEventListener("click", () => this.simulator.history.undo());
        btnRedo?.addEventListener("click", () => this.simulator.history.redo());

        const updateUndoRedoState = () => {
            if (btnUndo) btnUndo.disabled = this.simulator.history.undoStack.length === 0;
            if (btnRedo) btnRedo.disabled = this.simulator.history.redoStack.length === 0;
        };

        this.simulator.eventBus.on("history:changed", updateUndoRedoState);
        this.simulator.eventBus.on("project:new", updateUndoRedoState);
        updateUndoRedoState();

        btnScreenshot?.addEventListener("click", () => this.captureScreenshot());

        document.getElementById("btnAddAnnotation")?.addEventListener("click", () => {
            this.simulator.annotationManager.addNew();
        });

    }

    //------------------------------------------------------
    // Capturar el circuito completo (componentes + cables) como PNG,
    // en las coordenadas REALES del canvas (no lo que se ve recortado
    // por el zoom/paneo actual) -- mismo criterio que ya usa
    // centerViewOnComponents() para calcular el bounding box. Se arma
    // un <svg> nuevo con un clon de componentLayer/wireLayer (nunca se
    // toca el original) y se rasteriza a PNG vía <canvas>.
    //------------------------------------------------------

    // Arma el PNG del circuito completo (componentes + cables) sin
    // guardarlo a disco -- extraído de captureScreenshot() para que
    // ReportGenerator.js pueda reusar exactamente la misma captura
    // (bounding box real, canvases aplanados a <img>, etc.) al armar
    // el reporte, en vez de duplicar esta lógica.
    // options.showNames: si viene true/false, fuerza la etiqueta de
    // nombre (ver ContextMenu "Mostrar el nombre del componente") de
    // TODOS los componentes en la imagen exportada, sin tocar el
    // estado real de cada uno en el lienzo (se aplica sobre el CLON,
    // nunca sobre componentLayer). undefined (default, el botón de
    // captura suelto no manda nada) respeta lo que cada componente ya
    // tenía puesto.
    async _buildCircuitPngBlob(options = {}) {

        const { showNames } = options;

        const components = this.simulator.componentManager.getAll();

        if (components.length === 0) return null;

        const PADDING = 10;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        components.forEach((c) => {
            minX = Math.min(minX, c.x);
            minY = Math.min(minY, c.y);
            maxX = Math.max(maxX, c.x + c.width);
            maxY = Math.max(maxY, c.y + c.height);
        });

        // Las notas también entran en el recorte -- si no se cuentan acá,
        // una nota ubicada afuera del rectángulo que ocupan los
        // componentes quedaría cortada por el viewBox aunque el paso de
        // abajo sí la incluya en la imagen.
        (this.simulator.annotationManager?.getAll() || []).forEach((a) => {
            minX = Math.min(minX, a.x);
            minY = Math.min(minY, a.y);
            maxX = Math.max(maxX, a.x + a.width);
            maxY = Math.max(maxY, a.y + a.height);
        });

        // Y los cables -- un cable ruteado más allá del rectángulo que
        // ocupan los componentes (ej. un componente lejos, con codos de
        // por medio) quedaba directamente cortado por el viewBox, aunque
        // wireLayer sí lo dibujara. Se suman start/end (posición real
        // del pin) + cada codo intermedio (wire.points) de cada cable.
        const wireManager = this.simulator.wireManager;
        wireManager.wires.forEach((wire) => {
            const start = wireManager.getPinAbsolutePosition(wire.from);
            const end   = wireManager.getPinAbsolutePosition(wire.to);
            [start, end, ...wire.points].forEach((p) => {
                if (!p) return;
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            });
        });

        minX -= PADDING; minY -= PADDING;
        maxX += PADDING; maxY += PADDING;

        const width  = Math.max(1, maxX - minX);
        const height = Math.max(1, maxY - minY);

        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("xmlns", svgNS);
        svg.setAttribute("width", width);
        svg.setAttribute("height", height);
        svg.setAttribute("viewBox", `${minX} ${minY} ${width} ${height}`);

        // Fondo -- el degradé real lo pinta el CSS de #workspace, no el
        // SVG, así que sin esto la imagen exportada saldría transparente.
        const bg = document.createElementNS(svgNS, "rect");
        bg.setAttribute("x", minX);
        bg.setAttribute("y", minY);
        bg.setAttribute("width", width);
        bg.setAttribute("height", height);
        bg.setAttribute("fill", "#eef3f8");
        svg.appendChild(bg);

        const wireClone = this.simulator.wireLayer.cloneNode(true);
        const compClone = this.simulator.componentLayer.cloneNode(true);

        // Limpiar artefactos de la sesión EN VIVO que no tienen sentido
        // en una imagen estática (selección, arrastre en curso, el
        // resaltado del tutorial, la animación de "corriente circulando").
        wireClone.querySelectorAll(".wire-flow").forEach((el) => el.remove());
        wireClone.querySelectorAll(".selected")
            .forEach((el) => el.classList.remove("selected"));
        compClone.querySelectorAll(".selected, .dragging, .tutorial-highlight")
            .forEach((el) => el.classList.remove("selected", "dragging", "tutorial-highlight"));

        // La etiqueta de nombre se muestra/esconde con
        // ".component.show-name .component-name-label { display:... }"
        // en simulator.css -- una regla EXTERNA que, igual que el
        // fill:none de los cables (ver WireManager), no viaja cuando
        // este layer se clona/serializa para exportar. Sin fijar acá
        // el display de cada etiqueta A MANO, TODAS las etiquetas
        // quedaban visibles en la imagen exportada sin importar el
        // estado real de cada componente (ni lo que pida este
        // checkbox) -- el <text> nunca tuvo ningún display:none propio,
        // solo lo tenía por esa regla que se pierde al exportar.
        compClone.querySelectorAll(".component").forEach((el) => {
            const id = el.getAttribute("data-id");
            const component = this.simulator.componentManager.get(id);
            const shouldShow = showNames !== undefined ? showNames : !!component?.showName;
            el.classList.toggle("show-name", shouldShow);
            const label = el.querySelector(".component-name-label");
            if (label) label.style.display = shouldShow ? "block" : "none";
        });

        // Mismo bug de "CSS externo perdido al clonar/serializar" que
        // .wire-visual y .component-name-label (ver WireManager y el
        // bloque de arriba): ".pin-hit { fill:transparent }" y
        // ".pin-visible { fill:#ffcf40; stroke:#1e1f22 }" viven solo en
        // simulator.css. Sin esto, AMBOS pierden su fill en la imagen
        // exportada y caen al default de SVG (negro sólido) -- como
        // pin-hit es más grande que pin-visible (hitSize = size*2.2,
        // ver Renderer.renderPins), el resultado es un cuadrado/círculo
        // negro tapando cada pin. Se copia el estilo resuelto (fill/
        // stroke) del pin EN VIVO correspondiente, no un valor fijo,
        // para que un pin en HIGH (".pin-active .pin-visible" -> verde)
        // también se exporte con su color real.
        compClone.querySelectorAll(".pin").forEach((pinClone) => {
            const compId = pinClone.getAttribute("data-component-id");
            const pinId = pinClone.getAttribute("data-pin-id");
            const livePin = this.simulator.componentLayer.querySelector(
                `.pin[data-component-id="${compId}"][data-pin-id="${pinId}"]`
            );
            if (!livePin) return;

            const cloneHit = pinClone.querySelector(".pin-hit");
            if (cloneHit) cloneHit.style.fill = "transparent";

            const liveVis = livePin.querySelector(".pin-visible");
            const cloneVis = pinClone.querySelector(".pin-visible");
            if (liveVis && cloneVis) {
                const cs = getComputedStyle(liveVis);
                cloneVis.style.fill = cs.fill;
                cloneVis.style.stroke = cs.stroke;
                cloneVis.style.strokeWidth = cs.strokeWidth;
            }
        });

        this._flattenCanvasesForScreenshot(compClone, this.simulator.componentLayer);

        // Las notas del lienzo (AnnotationManager) no se clonaban acá
        // en absoluto -- por eso desaparecían de cualquier captura, aunque
        // se vieran bien en el lienzo en vivo.
        const annotationLayer = this.simulator.annotationLayer;
        let annotationClone = null;

        if (annotationLayer && annotationLayer.children.length > 0) {

            annotationClone = annotationLayer.cloneNode(true);

            annotationClone.querySelectorAll(".annotation").forEach((noteClone) => {

                noteClone.classList.remove("dragging", "resizing");

                // Solo el contenido de la nota (fondo + texto) tiene
                // sentido en una imagen exportada -- la franja de
                // colores/borrar, el grip "≡" de arrastre y la
                // agarradera de tamaño son UI de edición, no parte del
                // diagrama.
                noteClone.querySelector(".annotation-toolbar")?.remove();
                noteClone.querySelector(".annotation-grip")?.remove();
                noteClone.querySelector(".annotation-resize-handle")?.remove();

                const id = noteClone.getAttribute("data-id");
                const liveNote = annotationLayer.querySelector(`.annotation[data-id="${id}"]`);
                if (!liveNote) return;

                // Mismo bug de "CSS externo perdido al clonar" que cables/
                // pines/etiquetas más arriba: el color de fondo/borde de
                // cada nota (".annotation-blue .annotation-rect", etc.) y
                // el estilo del texto viven solo en annotations.css.
                const copyStyle = (selector, props) => {
                    const liveEl = liveNote.querySelector(selector);
                    const cloneEl = noteClone.querySelector(selector);
                    if (!liveEl || !cloneEl) return;
                    const cs = getComputedStyle(liveEl);
                    props.forEach((p) => { cloneEl.style[p] = cs[p]; });
                };

                copyStyle(".annotation-rect", ["fill", "stroke", "strokeWidth"]);
                copyStyle(".annotation-header", ["fill"]);
                copyStyle(".annotation-text", [
                    "color", "fontFamily", "fontSize", "lineHeight",
                    "padding", "boxSizing", "whiteSpace", "wordBreak",
                ]);

            });

        }

        // Mismo orden que el lienzo real (ver index.html: #componentLayer,
        // luego #wireLayer, luego #annotationLayer al final) -- si se
        // invierte, cualquier cable cuyo trazo pase cerca o sobre el
        // cuerpo de una placa queda tapado por ella en la imagen
        // exportada, aunque en el lienzo en vivo se vea bien.
        svg.appendChild(compClone);
        svg.appendChild(wireClone);
        if (annotationClone) svg.appendChild(annotationClone);

        const blob = await this._svgToPngBlob(svg, width, height);

        return { blob, width, height };

    }

    async captureScreenshot() {

        const result = await this._buildCircuitPngBlob().catch((err) => {
            console.error("[Toolbar] Error al generar el screenshot:", err);
            return undefined;
        });

        if (result === undefined) {
            alert("❌ No se pudo generar la captura del circuito.");
            return;
        }

        if (!result) {
            alert("No hay ningún componente en el lienzo todavía.");
            return;
        }

        const { blob } = result;
        const suggestedName = `pitsimulator_circuito_${Date.now()}.png`;

        try {

            // Mismo patrón que ProjectManager.saveProjectAs(): pedir
            // ubicación real con el selector nativo del sistema si el
            // navegador lo soporta, en vez de tirar la descarga directo
            // a la carpeta de Descargas sin preguntar.
            if (window.showSaveFilePicker) {

                try {

                    const handle = await window.showSaveFilePicker({
                        suggestedName,
                        types: [{
                            description: "Imagen PNG",
                            accept: { "image/png": [".png"] }
                        }]
                    });

                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();

                    return;

                } catch (err) {

                    // Cancelar el selector cancela de verdad -- no cae al
                    // fallback de descarga automática (mismo criterio que
                    // ProjectManager.saveProjectAs()).
                    if (err?.name === "AbortError") return;

                    console.warn("[Toolbar] No se pudo abrir el selector de guardado, se descarga directo:", err);

                }

            }

            // Fallback sin File System Access API (Firefox, Safari)
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = suggestedName;
            a.click();
            URL.revokeObjectURL(url);

        } catch (err) {

            console.error("[Toolbar] Error al generar el screenshot:", err);
            alert("❌ No se pudo generar la captura del circuito.");

        }

    }

    // cloneNode() copia el elemento <canvas> pero NUNCA lo que está
    // dibujado en él -- ese bitmap vive aparte, en el backing store del
    // canvas, no en el DOM/atributos. Sin este paso, cualquier display
    // que se dibuja por JS (LCD, OLED, matrices de LED, etc.) saldría
    // en blanco en la captura. Reemplaza cada <canvas> del clon por un
    // <img> con su contenido actual (canvas.toDataURL) -- mismo orden
    // en vivo y en el clon (cloneNode preserva el orden de los hijos),
    // así que emparejar por índice es seguro.
    _flattenCanvasesForScreenshot(clonedRoot, liveRoot) {

        const liveCanvases    = liveRoot.querySelectorAll("canvas");
        const clonedCanvases  = clonedRoot.querySelectorAll("canvas");

        liveCanvases.forEach((liveCanvas, i) => {

            const clonedCanvas = clonedCanvases[i];
            if (!clonedCanvas) return;

            let dataUrl;
            try {
                dataUrl = liveCanvas.toDataURL("image/png");
            } catch (err) {
                return; // no debería pasar (todo el contenido es local) -- si pasa, se deja el <canvas> vacío tal cual
            }

            const img = document.createElementNS("http://www.w3.org/1999/xhtml", "img");
            img.setAttribute("width", clonedCanvas.getAttribute("width") || clonedCanvas.width);
            img.setAttribute("height", clonedCanvas.getAttribute("height") || clonedCanvas.height);
            img.setAttribute("style", clonedCanvas.getAttribute("style") || "");
            img.setAttribute("src", dataUrl);

            clonedCanvas.replaceWith(img);

        });

    }

    _svgToPngBlob(svg, width, height, scale = 2) {

        return new Promise((resolve, reject) => {

            // Antes esto cargaba el SVG armado como blob: URL
            // (URL.createObjectURL). Reportado: "SecurityError: Tainted
            // canvases may not be exported" al dibujarlo en el canvas --
            // bug conocido de Chrome cuando el SVG fuente (cargado vía
            // blob:) contiene a su vez <image> con datos rasterizados
            // embebidos (algunos .svg de componentes, ej. dht11.svg/
            // hcsr04.svg, traen su gráfico como PNG en base64 adentro
            // del propio <image>) -- el canvas resultante queda marcado
            // "tainted" aunque todo el contenido sea local/data URI, y
            // toBlob()/toDataURL() se rompen. Cargar el mismo SVG como
            // data: URI (en vez de blob:) es el workaround estándar
            // para este bug -- ya no hace falta URL.createObjectURL ni
            // revokeObjectURL en absoluto.
            const serializer = new XMLSerializer();
            const svgStr = serializer.serializeToString(svg);
            const dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);

            const img = new Image();

            img.onload = () => {

                const canvas = document.createElement("canvas");
                canvas.width  = width  * scale;
                canvas.height = height * scale;

                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error("canvas.toBlob() devolvió null"));
                }, "image/png");

            };

            img.onerror = (err) => reject(err);

            img.src = dataUrl;

        });

    }

    //------------------------------------------------------
    // Botón 🌙/☀ junto a Simular: fondo del lienzo día (claro, el
    // default de siempre) / noche (oscuro) -- ver la variable CSS
    // --canvas-bg/--grid-line y :root[data-theme="dark"] en
    // simulator.css. Solo afecta el workspace/canvas: el resto de la
    // UI (toolbar, toolbox, panel de propiedades) ya es oscura de
    // por sí, no forma parte de este toggle. Persistido en
    // localStorage para no tener que volver a elegirlo cada sesión.
    //------------------------------------------------------

    bindCanvasThemeToggle() {

        const btn = document.getElementById("btnCanvasTheme");
        if (!btn) return;

        const apply = (theme) => {
            if (theme === "dark") {
                document.documentElement.setAttribute("data-theme", "dark");
                btn.textContent = "🌞";
                btn.title = "Cambiar a fondo claro (día)";
            } else {
                document.documentElement.removeAttribute("data-theme");
                btn.textContent = "🌙";
                btn.title = "Cambiar a fondo oscuro (noche)";
            }
        };

        apply(localStorage.getItem("pit_canvas_theme") === "dark" ? "dark" : "light");

        btn.addEventListener("click", () => {
            const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
            localStorage.setItem("pit_canvas_theme", next);
            apply(next);
        });

    }

    //------------------------------------------------------
    // Aviso inmediato al trazar un cable que ata GND a un pin de
    // alimentación -- ver WireManager.addWire()/
    // ValidationEngine._groundPowerMismatch(). Reusa el mismo
    // #statusText que _showSaveFeedback(), pero con más tiempo en
    // pantalla (es un error real, no una confirmación de guardado) y
    // en rojo para que se note.
    //------------------------------------------------------

    bindWireWarnings() {

        this.simulator.eventBus.on("wire:invalidPolarity", ({ message }) => {

            console.warn("[Wiring] " + message);

            const status = document.getElementById("statusText");
            if (!status) return;

            const previousText  = status.textContent;
            const previousColor = status.style.color;

            status.textContent = "⚠ " + message;
            status.style.color = "#ff5252";

            clearTimeout(this._wireWarningTimeout);
            this._wireWarningTimeout = setTimeout(() => {
                status.textContent = previousText;
                status.style.color = previousColor;
            }, 6000);

        });

    }

    //------------------------------------------------------
    // Botón ▶ Simular / ⏹ Detener del toolbar
    //------------------------------------------------------

    bindSimToggle() {

        const btn = document.getElementById("btnSimToggle");
        if (!btn) return;

        btn.addEventListener("click", () => {

            if (this.simulator.isRunning) {
                this.simulator.eventBus.emit("simulation:stop");
                return;
            }

            // Candado: sin una ESP32 en el lienzo, QemuBridge.getEsp32()
            // no tiene con qué conectar -- mejor cortarlo acá, con un
            // mensaje claro, que dejar que el botón quede "Iniciando..."
            // colgado 6 segundos para terminar sin hacer nada.
            const esp32s = this.simulator.componentManager.getAll()
                .filter((c) => c.type.startsWith("esp32"));
            const warningEl = document.getElementById("statusWarning");

            if (esp32s.length === 0) {

                const status = document.getElementById("statusText");
                if (status) {

                    const previousText  = status.textContent;
                    const previousColor = status.style.color;

                    status.textContent = "⚠ Necesitás una ESP32 en el lienzo para poder simular.";
                    status.style.color = "#ff5252";

                    clearTimeout(this._esp32MissingTimeout);
                    this._esp32MissingTimeout = setTimeout(() => {
                        status.textContent = previousText;
                        status.style.color = previousColor;
                    }, 6000);

                }

                return;

            }

            // 2+ ESP32 no bloquea (QemuBridge.getEsp32() igual arranca
            // con la primera que encuentra) pero avisa, porque el
            // circuito casi seguro no es el que el usuario tenía pensado.
            if (warningEl) {
                if (esp32s.length > 1) {
                    warningEl.textContent = `⚠ Hay ${esp32s.length} ESP32 en el lienzo -- se va a usar la primera.`;
                    warningEl.classList.remove("hidden");
                } else {
                    warningEl.classList.add("hidden");
                }
            }

            btn.disabled = true;
            btn.textContent = "⏳ Iniciando...";
            this.simulator.eventBus.emit("simulation:start");

            // Si bridge.js no responde (o QEMU no llega a conectar),
            // no dejamos el botón trabado en "Iniciando..." para siempre.
            setTimeout(() => {
                if (!this.simulator.isRunning) {
                    btn.disabled = false;
                    btn.textContent = "▶ Simular";
                }
            }, 6000);

        });

    }

    bindEvents() {

        this.bindProjectButtons();

        // Supr / Backspace / Ctrl+C / Ctrl+D
        // (Eliminar y Zoom ya no son botones fijos del toolbar --
        //  ni Wokwi ni Fritzing los muestran así -- viven en el
        //  menú de clic derecho y en estos atajos + rueda del mouse)
        window.addEventListener("keydown", (e) => {

            const isTyping = e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA";
            if (isTyping) return;

            if ((e.key === "Delete" || e.key === "Backspace")) {

                const hasWirePoint  = !!this.simulator.wireManager.selectedPoint;
                const hasWire       = !!this.simulator.wireManager.selectedWire;
                const hasComponents = this.simulator.selectionManager.getSelectedComponents().length > 0;

                if (hasWirePoint || hasWire || hasComponents) {
                    e.preventDefault();
                    this.simulator.deleteSelection();
                }

                return;

            }

            if (e.ctrlKey && e.shiftKey && (e.key === "s" || e.key === "S")) {

                e.preventDefault();
                this.saveProjectAsWithFeedback();
                return;

            }

            if (e.ctrlKey && !e.shiftKey && (e.key === "s" || e.key === "S")) {

                e.preventDefault();
                this.saveProjectWithFeedback();
                return;

            }

            if (e.ctrlKey && !e.shiftKey && (e.key === "o" || e.key === "O")) {

                e.preventDefault();
                void this.simulator.projectManager.openProject();
                return;

            }

            if (e.ctrlKey && !e.shiftKey && (e.key === "c" || e.key === "C")) {

                const [component] = this.simulator.selectionManager.getSelectedComponents();
                if (component) {
                    e.preventDefault();
                    this.simulator.contextMenu.copy(component);
                }

                return;

            }

            if (e.ctrlKey && (e.key === "d" || e.key === "D")) {

                const [component] = this.simulator.selectionManager.getSelectedComponents();
                if (component) {
                    e.preventDefault();
                    this.simulator.contextMenu.duplicate(component);
                }

                return;

            }

            if (e.key === "F12") {
                e.preventDefault();
                this.validateCircuit();
                return;
            }

        });

    }

    bindProjectButtons() {

        this.bindProjectDrawer();

        const gridSelect = document.getElementById("gridSelect");

        if (gridSelect) {
            // Inicializar con el valor actual del simulador
            gridSelect.value = String(this.simulator.gridSize || 0);
            // Sincronizar el snap de cables con el estado REAL inicial del
            // grid -- antes esto solo pasaba en el evento "change" de más
            // abajo, así que al cargar la página con "Hoja en blanco"
            // (gridSize=0) el WireManager.snapEnabled se quedaba en su
            // default (true) sin que nada lo corrigiera, produciendo
            // division por cero (NaN) en Utils.snapToGrid.
            this.simulator.wireManager.snapEnabled = !!this.simulator.gridSize;
            gridSelect.addEventListener("change", (e) => {
                const val = parseInt(e.target.value, 10);
                this.simulator.gridSize = isNaN(val) ? 0 : val;
                // Si se elige '0' deshabilitamos el snap globalmente para cables
                this.simulator.wireManager.snapEnabled = !!this.simulator.gridSize;
                this.simulator.applyViewportTransform();
                this.simulator.eventBus.emit("grid:changed", this.simulator.gridSize);
            });
        }

    }

    //------------------------------------------------------
    // Deslizador de Proyecto (junto al logo): Nuevo / Abrir / Guardar
    // (Ctrl+S) / Guardar como (Ctrl+Shift+S) / Validar. Mismo patrón
    // que cualquier editor estándar -- ver ProjectManager.js para el
    // detalle de por qué "Abrir" y "Guardar" ya no distinguen entre
    // localStorage y archivo real (antes había 4 botones para esto,
    // ahora 2: Abrir y Guardar/Guardar como).
    //------------------------------------------------------

    bindProjectDrawer() {

        const toggleBtn = document.getElementById("btnProjectMenu");
        const drawer     = document.getElementById("projectDrawer");

        if (!toggleBtn || !drawer) return;

        const open = () => {
            drawer.classList.remove("hidden");
            toggleBtn.classList.add("active");
        };

        const close = () => {
            drawer.classList.add("hidden");
            toggleBtn.classList.remove("active");
        };

        toggleBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (drawer.classList.contains("hidden")) open();
            else close();
        });

        // Cerrar al clickear afuera (mismo criterio que ContextMenu.close())
        document.addEventListener("pointerdown", (e) => {
            if (drawer.classList.contains("hidden")) return;
            if (drawer.contains(e.target) || toggleBtn.contains(e.target)) return;
            close();
        });

        window.addEventListener("keydown", (e) => {
            if (e.key === "Escape") close();
        });

        document.getElementById("pdNewProject")?.addEventListener("click", async () => {
            close();
            await this.simulator.projectManager.newProject();
        });

        document.getElementById("pdOpenProject")?.addEventListener("click", async () => {
            close();
            await this.simulator.projectManager.openProject();
        });

        document.getElementById("pdSaveProject")?.addEventListener("click", () => {
            close();
            this.saveProjectWithFeedback();
        });

        document.getElementById("pdSaveAsProject")?.addEventListener("click", () => {
            close();
            this.saveProjectAsWithFeedback();
        });

        document.getElementById("pdValidate")?.addEventListener("click", () => {
            close();
            this.validateCircuit();
        });

        // Recargar la página desde un botón propio -- mismo efecto que
        // F5, pero sin que el usuario tenga que salir del simulador para
        // reiniciar un estado colgado (QEMU desincronizado, REPL trabado,
        // etc.). Mismo aviso de "hay cambios sin guardar" que "Nuevo
        // proyecto" (ver ProjectManager.newProject()) -- acá no hace
        // falta llamar a newProject() en sí, location.reload() ya
        // descarta todo el estado en memoria de una.
        document.getElementById("pdReload")?.addEventListener("click", () => {
            close();
            if (this.simulator.projectManager.dirty) {
                const ok = confirm(
                    "¿Recargar el simulador?\n\nSe perderán los cambios que todavía no guardaste."
                );
                if (!ok) return;
            }
            location.reload();
        });

        this.bindCurrentFileLabel();

    }

    //------------------------------------------------------
    // Nombre del archivo actual + indicador de cambios sin guardar,
    // junto al logo (ver ProjectManager._setCurrentFile/_setDirty).
    //------------------------------------------------------

    bindCurrentFileLabel() {

        const input = document.getElementById("currentFileLabel");
        const dirtyDot = document.getElementById("currentFileLabelDirty");
        if (!input) return;

        const pm = this.simulator.projectManager;

        const render = () => {
            // No pisar lo que el usuario está escribiendo ahora mismo
            // (los eventos "project:*" pueden dispararse mientras el
            // input todavía tiene foco, ej. por el auto-guardado).
            if (document.activeElement !== input) {
                input.value = pm.currentFileName || "Sin guardar";
            }
            input.classList.toggle("dirty", !!pm.dirty);
            dirtyDot?.classList.toggle("visible", !!pm.dirty);
        };

        // Confirmar el nombre nuevo al perder el foco o con Enter --
        // mismo patrón que renombrar un archivo en cualquier explorador.
        // Solo llama a setProjectName() si el valor REALMENTE cambió
        // durante este foco -- si no, un simple click adentro/afuera
        // del input (sin escribir nada) terminaba "renombrando" el
        // proyecto al placeholder ("Sin guardar" -> "Sin guardar.json")
        // y marcándolo sucio sin que el usuario tocara nada.
        let valueOnFocus = null;

        input.addEventListener("focus", () => {
            valueOnFocus = input.value;
        });

        input.addEventListener("blur", () => {
            if (input.value !== valueOnFocus) {
                pm.setProjectName(input.value);
            }
            render();
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                input.blur();
            } else if (e.key === "Escape") {
                e.preventDefault();
                input.value = pm.currentFileName || "Sin guardar"; // descartar lo escrito
                input.blur();
            }
            // No dejar que atajos globales (Ctrl+S, Supr, flechas de
            // mover componente, etc.) actúen mientras se escribe acá --
            // la mayoría de esos listeners ya chequean el tagName del
            // target, pero cortar la propagación acá es más robusto
            // que confiar en que todos los futuros lo hagan.
            e.stopPropagation();
        });

        this.simulator.eventBus.on("project:file-changed", render);
        this.simulator.eventBus.on("project:dirty-changed", render);
        this.simulator.eventBus.on("project:new", render);

        render();

    }

    //------------------------------------------------------
    // Guardar / Guardar como + feedback visual breve en la barra de
    // estado (así se sienten igual de "instantáneos" que en un
    // editor de texto normal).
    //------------------------------------------------------

    _showSaveFeedback(result) {

        const status = document.getElementById("statusText");
        if (!status || this.simulator.isRunning) return;

        const previousText  = status.textContent;
        const previousColor = status.style.color;

        if (result.cancelled) return;

        status.textContent = result.savedToFile
            ? (result.downloaded ? "⬇ Descargado" : "💾 Guardado")
            : "💾 Guardado en el navegador";
        status.style.color = "#4da3ff";

        clearTimeout(this._saveFeedbackTimeout);
        this._saveFeedbackTimeout = setTimeout(() => {
            status.textContent = previousText;
            status.style.color = previousColor;
        }, 1200);

    }

    async saveProjectWithFeedback() {

        const result = await this.simulator.projectManager.saveProject();
        this._showSaveFeedback(result);

    }

    async saveProjectAsWithFeedback() {

        const result = await this.simulator.projectManager.saveProjectAs();
        this._showSaveFeedback(result);

    }

    validateCircuit() {

        const report = this.simulator.validationEngine.getReport();
        alert(report);

    }

    bindSimulationEvents() {

        // Actualizar el toolbar visualmente cuando cambia el estado
        this.simulator.eventBus.on("simulation:started", () => this.updateUI(true));
        this.simulator.eventBus.on("simulation:stopped", () => this.updateUI(false));

    }

    updateUI(isRunning) {

        const status = document.getElementById("statusText");

        if (status) {

            if (isRunning) {
                status.innerHTML = `<span class="sim-running-dot"></span> Simulación corriendo`;
                status.style.color = "#00ff88";
            } else {
                status.textContent = "Listo";
                status.style.color = "";
            }

        }

        // Botón ▶ Simular / ⏹ Detener
        const btnSim = document.getElementById("btnSimToggle");
        if (btnSim) {
            btnSim.disabled = false;
            btnSim.textContent = isRunning ? "⏹ Detener" : "▶ Simular";
            btnSim.classList.toggle("running", isRunning);
        }

        // Al iniciar, quitamos la manija de rotación / marco de edición
        if (isRunning) {
            this.simulator.selectionManager.renderHighlight();
        }

        // Cursor del canvas: mostrar "no-drop" sobre pines cuando está bloqueado
        const canvas = document.getElementById("simulatorCanvas");
        if (canvas) canvas.classList.toggle("sim-locked", isRunning);

    }

}