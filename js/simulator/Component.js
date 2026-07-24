/*
==========================================================
 PitSimulator
 Archivo: Component.js
 Clase base de todos los componentes
==========================================================
*/

class Component {

    constructor(data = {}) {

        // ============================================
        // Información básica
        // ============================================

        //this.id = data.id || crypto.randomUUID();
        this.id = data.id || "";

        this.type = data.type || "component";

        this.name = data.name || "Component";

        // ============================================
        // Posición
        // ============================================

        // NOTA: acá usamos "??" (nullish coalescing) y no "||". Con "||",
        // un valor 0 explícito (ej. un componente ubicado justo en
        // x=0, muy común con la cuadrícula activada) se trata como "no
        // vino nada" y se pisa con el default -- eso hacía que un
        // componente guardado en x=0/y=0 "saltara" a (100,100) cada vez
        // que se reconstruye (cargar un proyecto, pegar/duplicar,
        // undo/redo). "??" solo aplica el default si el valor es
        // null/undefined de verdad.

        this.x = data.x ?? 100;

        this.y = data.y ?? 100;

        // ============================================
        // Tamaño
        // ============================================

        this.width = data.width ?? 100;

        this.height = data.height ?? 100;

        // ============================================
        // Transformaciones
        // ============================================

        this.rotation = data.rotation ?? 0;

        this.scale = data.scale ?? 1;

        // Espejo horizontal (mirror). No cambia el tamaño del marco
        // de selección, solo invierte el dibujo y las posiciones X
        // de los pines para que los cables sigan enganchando bien.
        this.flipX = data.flipX || false;

        // ============================================
        // Botón momentáneo (pushbutton)
        // ============================================

        // Si el componente tiene una zona "data-role=button-cap" en su
        // SVG y define pressPins: [idPinA, idPinB] en su .json, esos dos
        // pines quedan puenteados SOLO mientras el usuario mantiene
        // presionado el botón (ver Renderer.bindPressButton + SignalEngine.getNet)
        this.pressPins = data.pressPins || null;
        this.pressed   = false;

        // ============================================
        // Estado
        // ============================================

        this.visible = true;

        this.selected = false;

        this.enabled = true;

        this.locked = false;

        // ============================================
        // SVG
        // ============================================

        // Ruta al archivo .svg del componente (ej: "components/led/led.svg")
        this.svgPath = data.svgPath || data.svg || "";

        // Elemento SVG cargado (grupo <g> creado por el Renderer)
        this.element = null;

        // ============================================
        // Apariencia de los pines
        // ============================================

        // "circle" o "square"
        this.pinShape = data.pinShape || "circle";

        // Tamaño total del pin (diámetro si es círculo, lado si es cuadrado), en unidades del canvas
        this.pinSize = data.pinSize ?? 8;

        // ============================================
        // Color personalizable
        // ============================================

        // Colores originales del .svg que se pueden recolorear desde
        // el PropertyPanel (el primero se considera el color "base",
        // los demás se tratan como variantes más claras de ese mismo color)
        this.colorTargets = data.colorTargets || [];

        // ============================================
        // Pines
        // ============================================

        this.pins = [];

        if (Array.isArray(data.pins)) {

            data.pins.forEach(pin => this.addPin(pin));

        }

        // ============================================
        // Propiedades
        // ============================================

        this.properties = data.properties || {};

    }

    //--------------------------------------------------
    // Posición
    //--------------------------------------------------

    setPosition(x, y) {

        this.x = x;

        this.y = y;

        this.updateTransform();

    }

    move(dx, dy) {

        this.x += dx;

        this.y += dy;

        this.updateTransform();

    }

    //--------------------------------------------------
    // Rotación
    //--------------------------------------------------

    setRotation(angle) {

        this.rotation = angle;

        this.updateTransform();

    }

    //--------------------------------------------------
    // Escala
    //--------------------------------------------------

    setScale(scale) {

        this.scale = scale;

        this.updateTransform();

    }

    //--------------------------------------------------
    // Espejo horizontal
    //--------------------------------------------------

    setFlip(flipX) {

        this.flipX = !!flipX;

        this.updateTransform();

    }

    toggleFlip() {

        this.setFlip(!this.flipX);

    }

    //--------------------------------------------------
    // Selección
    //--------------------------------------------------

    select() {

        this.selected = true;

        if (this.element) {
            this.element.classList.add("selected");
        }

    }

    deselect() {

        this.selected = false;

        if (this.element) {
            this.element.classList.remove("selected");
        }

    }

    //--------------------------------------------------
    // Pines
    //--------------------------------------------------

    addPin(pin) {

        this.pins.push(pin);

    }

    getPin(id) {

        return this.pins.find(p => p.id === id);

    }

    //--------------------------------------------------
    // Posición absoluta de un pin (para dibujar cables)
    //--------------------------------------------------

    getPinPosition(id) {

        const pin = this.getPin(id);

        if (!pin) return null;

        // Si hay flip horizontal, la posición local X se refleja
        // respecto al centro del ancho (mismo truco que updateTransform:
        // translate(width*scale,0) scale(-scale,scale) equivale a
        // usar (width - pin.x) como X local antes de escalar/rotar).

        const localX = this.flipX ? (this.width - pin.x) : pin.x;
        const localY = pin.y;

        const scaledX = localX * this.scale;
        const scaledY = localY * this.scale;

        const rad = (this.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const rotatedX = scaledX * cos - scaledY * sin;
        const rotatedY = scaledX * sin + scaledY * cos;

        return {
            x: this.x + rotatedX,
            y: this.y + rotatedY
        };

    }

    //--------------------------------------------------
    // SVG
    //--------------------------------------------------

    setElement(element) {

        this.element = element;

        this.updateTransform();

    }

    //--------------------------------------------------
    // Actualizar posición del SVG
    //--------------------------------------------------

    updateTransform() {

        if (!this.element)
            return;

        // Con flip: reflejar respecto al centro del ancho, no respecto
        // al origen (si no, el componente "saltaría" de lugar en vez
        // de espejarse sobre sí mismo).
        const flipPart = this.flipX
            ? `translate(${this.width * this.scale},0) scale(${-this.scale},${this.scale})`
            : `scale(${this.scale})`;

        this.element.setAttribute(
            "transform",
            `translate(${this.x},${this.y}) rotate(${this.rotation}) ${flipPart}`
        );

    }

}
if (typeof module !== "undefined") module.exports = Component;
