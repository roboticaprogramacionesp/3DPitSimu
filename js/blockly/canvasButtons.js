/*
==========================================================
 PitSimulator — js/blockly/canvasButtons.js
 Portado de AppBlock3 (static/svgToPng.js + static/undoRedo.js),
 fusionados en un solo archivo -- botones dibujados DIRECTO sobre el
 SVG del workspace de Blockly (no son <button> HTML, por eso se
 mueven solos con el zoom/scroll, igual que en AppBlock3): 📷
 screenshot, ↩ deshacer, ↪ rehacer.

 workspaceToSvg()/svgToPng() son el mecanismo REAL que ya usaba el
 botón de cámara de AppBlock3 para sacar fotos buenas de los bloques
 (confirmado por el usuario) -- reemplaza el primer intento en
 BlocklyPanel.captureWorkspaceImage(), que se había quedado corto:
 le faltaba el paso de juntar los <style> reales que Blockly inyecta
 en la página (fills/colores de íconos especiales como el de
 mutator, warning, etc. -- esos dependen de CSS, no de atributos SVG
 sueltos), por eso esos íconos puntuales salían negros aunque la
 imagen del LED (que sí tiene su color como atributo/imagen propia)
 ya se veía bien.

 Único cambio real de fondo vs. el original: downloadBlocklyScreenshot()
 en AppBlock3 dependía de window.pywebview.api.save_png (app de
 escritorio de AppBlock3) -- acá no existe nada de eso, así que el
 botón de cámara simplemente dispara una descarga <a download> común,
 mismo patrón que ya usa el resto de PitSimulator (ver
 ProjectManager.js).
==========================================================
*/

// ================== SVG ==================
async function pitWorkspaceToSvg(workspace) {
    const bBox = workspace.getBlocksBoundingBox();

    const x = bBox.x ?? bBox.left;
    const y = bBox.y ?? bBox.top;
    const width = bBox.width ?? (bBox.right - x);
    const height = bBox.height ?? (bBox.bottom - y);

    const clone = workspace.getCanvas().cloneNode(true);
    clone.removeAttribute("transform");

    // Convertir <image> a base64 -- si no, cada ícono de bloque
    // (ej. el color del LED, el ícono de OLED) queda apuntando a su
    // URL relativa original, que no resuelve una vez que este SVG se
    // sirve como blob: URL independiente (sin el mismo contexto/base
    // que index.html) -- sale negro/vacío.
    const images = clone.querySelectorAll("image");
    for (const img of images) {
        const url = img.getAttribute("href") || img.getAttributeNS("http://www.w3.org/1999/xlink", "href");
        if (url && !url.startsWith("data:")) {
            const dataUri = await pitUrlToDataUri(url);
            if (dataUri) {
                img.setAttribute("href", dataUri);
                img.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataUri);
            }
        }
    }

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
    svg.appendChild(clone);

    // Estilos REALES que Blockly inyectó en la página -- acá vive el
    // fill/color de piezas especiales (mutator, warning, campos
    // editables) que no son atributos SVG sueltos sino reglas CSS.
    // Este era el paso que faltaba en el primer intento.
    const css = [...document.querySelectorAll("style")]
        .map((s) => s.innerText)
        .filter((text) => text.includes(".blockly"))
        .join("\n");

    const editableRect = document.querySelector(
        ".geras-renderer.classic-theme .blocklyEditableText > rect",
    );

    let fillColor = "#ffffff";
    let fillOpacity = "1";

    if (editableRect) {
        const computed = window.getComputedStyle(editableRect);
        fillColor = computed.fill;
        fillOpacity = computed.fillOpacity;
    }

    // PitSimulator hereda "color:white" global del <body> (ver
    // css/simulator.css) -- sin forzar negro acá, el texto de los
    // bloques (que en la UI en vivo se ve bien porque blockly-panel.css
    // ya lo pisa, ver ese archivo) queda blanco sobre blanco en esta
    // captura aislada, que no incluye ese CSS del panel.
    const extraCss = `
.blocklyText,
.blocklyEditableText text,
.blocklyNonEditableText text,
.blocklyFlyoutLabelText {
  fill: #000000 !important;
  font-family: Arial, sans-serif !important;
  font-size: 14px !important;
}

.blocklyEditableText rect,
.blocklyNonEditableText rect {
  fill: ${fillColor} !important;
  fill-opacity: ${fillOpacity} !important;
  stroke: none !important;
}
`;

    const style = document.createElement("style");
    style.innerHTML = css + extraCss;
    svg.insertBefore(style, svg.firstChild);

    svg.querySelectorAll("text").forEach((t) => {
        if (!t.getAttribute("fill") || t.getAttribute("fill") === "black") {
            t.setAttribute("fill", "#000000");
        }
    });

    return svg;
}

// ================== PNG ==================
// Versión Promise-based del svgToPng(svg, callback) de AppBlock3 --
// mismo cuerpo, solo el wrapping cambia (BlocklyPanel.captureWorkspaceImage()
// necesita poder hacer "await" en vez de pasar un callback).
function pitSvgToPng(svg) {
    return new Promise((resolve, reject) => {

        const serializer = new XMLSerializer();
        let svgStr = serializer.serializeToString(svg).replace(/&nbsp;/g, "&#160;");

        const img = new Image();
        const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(svgBlob);

        img.onload = () => {
            const SCALE = 2; // mas nitido para el reporte/descarga
            const canvas = document.createElement("canvas");
            canvas.width = svg.width.baseVal.value * SCALE;
            canvas.height = svg.height.baseVal.value * SCALE;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            URL.revokeObjectURL(url);
            resolve({ dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height });
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("no se pudo rasterizar el SVG del workspace"));
        };

        img.src = url;

    });
}

function pitUrlToDataUri(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = function () {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            canvas.getContext("2d").drawImage(img, 0, 0);
            resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = function () {
            console.warn("[canvasButtons] No se pudo cargar imagen, se omite:", url);
            resolve(null);
        };
        img.src = url;
    });
}

// ================== BOTONES SOBRE EL CANVAS ==================
// Iguales a AppBlock3 (posición/tamaño/estilo), solo cambian las
// rutas de los íconos (ver comentario del header) y qué hace el click
// de la cámara (acá: descarga directa, no pywebview).

function pitAddScreenshotButton(workspace, onCapture) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = workspace.getParentSvg();

    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "blocklyScreenshotButton");
    g.style.cursor = "pointer";

    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", 10);
    rect.setAttribute("y", 0);
    rect.setAttribute("rx", 6);
    rect.setAttribute("ry", 6);
    rect.setAttribute("width", 50);
    rect.setAttribute("height", 50);
    rect.setAttribute("fill", "#ffffff");
    rect.setAttribute("stroke", "#888");

    const img = document.createElementNS(NS, "image");
    img.setAttribute("x", 16);
    img.setAttribute("y", 6);
    img.setAttribute("width", 40);
    img.setAttribute("height", 40);
    img.setAttributeNS("http://www.w3.org/1999/xlink", "href", "js/blockly/img/camera.png");

    g.appendChild(rect);
    g.appendChild(img);
    svg.appendChild(g);

    function position() {
        const metrics = workspace.getMetrics();
        if (!metrics) return;
        const x = metrics.absoluteLeft + metrics.viewWidth - 80;
        const y = metrics.absoluteTop + 10;
        g.setAttribute("transform", `translate(${x},${y})`);
    }
    position();

    window.addEventListener("resize", position);
    workspace.addChangeListener((e) => {
        if (e.type === Blockly.Events.VIEWPORT_CHANGE) position();
    });

    g.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onCapture();
    });

    return g;
}

function pitAddUndoRedoButtons(workspace) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = workspace.getParentSvg();

    let container = svg.querySelector("g.blocklyUndoRedo");
    if (!container) {
        container = document.createElementNS(NS, "g");
        container.setAttribute("class", "blocklyUndoRedo");
        container.style.cursor = "pointer";
        container.setAttribute("pointer-events", "all");
        svg.appendChild(container);
    }

    function createButton(iconPath, offsetY, onClick) {
        const g = document.createElementNS(NS, "g");

        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", 10);
        rect.setAttribute("y", offsetY);
        rect.setAttribute("rx", 6);
        rect.setAttribute("ry", 6);
        rect.setAttribute("width", 50);
        rect.setAttribute("height", 50);
        rect.setAttribute("fill", "#ffffff");
        rect.setAttribute("stroke", "#888");

        const img = document.createElementNS(NS, "image");
        img.setAttribute("x", 16);
        img.setAttribute("y", offsetY + 6);
        img.setAttribute("width", 40);
        img.setAttribute("height", 40);
        img.setAttributeNS("http://www.w3.org/1999/xlink", "href", iconPath);
        img.style.pointerEvents = "none";

        g.appendChild(rect);
        g.appendChild(img);

        g.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });

        container.appendChild(g);
        return { group: g, rect, img };
    }

    const undoBtn = createButton("assets/blockly-media/undo.png", 60, () => workspace.undo(false));
    const redoBtn = createButton("assets/blockly-media/redo.png", 120, () => workspace.undo(true));

    function position() {
        const metrics = workspace.getMetrics();
        if (!metrics) return;
        const x = metrics.absoluteLeft + metrics.viewWidth - 80;
        const y = metrics.absoluteTop + 10;
        container.setAttribute("transform", `translate(${x},${y})`);
    }
    position();

    window.addEventListener("resize", position);
    workspace.addChangeListener((e) => {
        if (e.type === Blockly.Events.VIEWPORT_CHANGE) position();
    });

    function getUndoCountSafe() {
        return typeof workspace.getUndoStack === "function"
            ? workspace.getUndoStack().length
            : (workspace.undoStack_?.length || 0);
    }
    function getRedoCountSafe() {
        return typeof workspace.getRedoStack === "function"
            ? workspace.getRedoStack().length
            : (workspace.redoStack_?.length || 0);
    }
    function updateState() {
        undoBtn.rect.setAttribute("opacity", getUndoCountSafe() > 0 ? "1" : "0.3");
        redoBtn.rect.setAttribute("opacity", getRedoCountSafe() > 0 ? "1" : "0.3");
    }
    workspace.addChangeListener(updateState);
    updateState();

    return { container, undoBtn: undoBtn.group, redoBtn: redoBtn.group };
}
