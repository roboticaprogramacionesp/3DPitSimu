/*
==========================================================
 PitSimulator
 Archivo: Utils.js
 Funciones de apoyo (carga de archivos, IDs, etc.)
==========================================================
*/

class Utils {

    // Namespace de SVG, usado por Renderer, SelectionManager, DragManager, etc.
    static SVG_NS = "http://www.w3.org/2000/svg";

    //------------------------------------------------------
    // Convertir coordenadas de pantalla (clientX/clientY, ej.
    // las de un evento de mouse) a coordenadas dentro de un
    // elemento SVG (respeta cualquier zoom/pan que tenga ese
    // elemento o sus padres).
    //------------------------------------------------------

    static getCanvasPoint(referenceElement, clientX, clientY) {

        const ctm = referenceElement.getScreenCTM();

        if (!ctm) {
            return { x: clientX, y: clientY };
        }

        const point = new DOMPoint(clientX, clientY);
        const transformed = point.matrixTransform(ctm.inverse());

        return { x: transformed.x, y: transformed.y };

    }

    //------------------------------------------------------
    // Normalizar un color hex: minúsculas, con #, y expandir
    // la forma corta (#abc -> #aabbcc) para poder comparar
    // colores sin importar cómo estén escritos
    //------------------------------------------------------

    static normalizeHex(hex) {

        if (!hex) return "";

        let h = hex.trim().toLowerCase();

        if (h[0] !== "#") h = "#" + h;

        if (h.length === 4) {
            h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
        }

        return h;

    }

    //------------------------------------------------------
    // Aclarar un color hex mezclándolo con blanco
    // (amount: 0 = igual, 1 = blanco puro)
    //------------------------------------------------------

    static lightenColor(hex, amount) {

        const clean = hex.replace("#", "");

        const r = parseInt(clean.substring(0, 2), 16);
        const g = parseInt(clean.substring(2, 4), 16);
        const b = parseInt(clean.substring(4, 6), 16);

        const mix = (channel) => Math.round(channel + (255 - channel) * amount);

        const toHex = (n) => n.toString(16).padStart(2, "0");

        return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;

    }

    //------------------------------------------------------
    // Ajustar un valor a la cuadrícula (por defecto 20px,
    // igual al tamaño definido en grid.css)
    //------------------------------------------------------

    static snapToGrid(value, size = 20, enabled = true) {

        // Guardia contra división por cero: cuando la cuadrícula está en
        // "Hoja en blanco" (gridSize = 0), size llega en 0. Si en ese
        // momento "enabled" quedó en true (ver WireManager.snapEnabled,
        // que solo se sincroniza con el select del toolbar en su evento
        // "change" -- nunca al cargar la página), Math.round(value/0)*0
        // da Infinity*0 = NaN, y ese NaN se guarda en wire.points/
        // component.x/y, rompiendo el render (o, en el peor caso,
        // "moviendo" el cable a NaN sin que se note hasta que se intenta
        // dibujar la vista previa de un cable nuevo). size=0 significa
        // "sin cuadrícula": tratamos eso como snap desactivado siempre,
        // sin importar el flag "enabled".
        if (!enabled || !size) return value;

        return Math.round(value / size) * size;

    }

    //------------------------------------------------------
    // Cargar un archivo .json (ej: definición de un componente)
    //------------------------------------------------------

    static async loadJSON(path) {

        try {

            const response = await fetch(path);

            if (!response.ok) {
                console.warn(`No se pudo cargar el JSON: ${path}`);
                return null;
            }

            return await response.json();

        } catch (err) {

            console.error(`Error cargando JSON (${path}):`, err);
            return null;

        }

    }

    //------------------------------------------------------
    // Generar un ID corto y único
    //------------------------------------------------------

    static generateId(prefix = "id") {

        return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

    }

    //------------------------------------------------------
    // Limitar un número entre un mínimo y un máximo
    //------------------------------------------------------

    static clamp(value, min, max) {

        return Math.min(Math.max(value, min), max);

    }

    //------------------------------------------------------
    // Calcular el punto de "codo" para rutear un cable en
    // ángulo recto entre dos puntos (estilo Wokwi), en vez de
    // una diagonal directa. Se avanza primero por el eje más
    // largo y luego por el corto.
    //
    // Devuelve null si start/end ya están alineados (no hace
    // falta ningún punto intermedio).
    //------------------------------------------------------

    static computeElbow(start, end) {

        const dx = Math.abs(end.x - start.x);
        const dy = Math.abs(end.y - start.y);

        if (dx < 0.01 || dy < 0.01) return null;

        return (dx >= dy)
            ? { x: end.x,   y: start.y } // horizontal primero, luego vertical
            : { x: start.x, y: end.y };  // vertical primero, luego horizontal

    }

    //------------------------------------------------------
    // Construir un path ortogonal a partir de una lista de puntos
    // de anclaje. Cada tramo se convierte en una esquina en ángulo
    // recto para que el resultado se vea más limpio y cercano a Wokwi.
    //------------------------------------------------------

    static buildOrthogonalPoints(points) {

        if (!Array.isArray(points) || points.length < 2) {
            return Array.isArray(points) ? points : [];
        }

        const normalized = points.filter(Boolean);
        if (normalized.length < 2) return normalized;

        const result = [{ ...normalized[0] }];

        for (let i = 1; i < normalized.length; i++) {
            const prev = result[result.length - 1];
            const next = normalized[i];

            const dx = next.x - prev.x;
            const dy = next.y - prev.y;

            if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
                continue;
            }

            if (Math.abs(dx) < 0.01 || Math.abs(dy) < 0.01) {
                result.push({ ...next });
                continue;
            }

            const elbow = Math.abs(dx) >= Math.abs(dy)
                ? { x: next.x, y: prev.y }
                : { x: prev.x, y: next.y };

            if (Math.abs(elbow.x - prev.x) > 0.01 || Math.abs(elbow.y - prev.y) > 0.01) {
                result.push(elbow);
            }

            result.push({ ...next });
        }

        return result;

    }

    static buildComponentDefinition(definition = {}, overrides = {}) {

        return {
            ...definition,
            ...overrides,
            svgPath: overrides.svgPath
                || definition.svgPath
                || definition.svg
                || `components/${definition.type}/${definition.type}.svg`
        };

    }

}
if (typeof module !== "undefined") module.exports = Utils;
