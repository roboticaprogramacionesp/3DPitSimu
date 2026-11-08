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

    // startDir/endDir (opcionales): {dx,dy} con la dirección "natural"
    // de salida del pin inicial/final (ver Component.getPinExitDirection()).
    // Sin esto, el codo entre dos puntos se elegía SOLO según cuál
    // distancia (horizontal o vertical) fuera más grande -- sin
    // ninguna relación con el lado real del componente del que sale
    // cada pin, lo que podía mandar un cable "de costado" por encima
    // del propio dibujo del componente (reportado en vivo con
    // captura). Con la dirección, se inserta un tramo recto corto
    // ("tiro") que sale derecho del pin en SU dirección antes de
    // doblar -- mismo truco que usan Wokwi/Fritzing/la mayoría de los
    // editores de esquemáticos para que un cable nunca "nazca" yendo
    // para el lado equivocado.
    static buildOrthogonalPoints(points, startDir = null, endDir = null) {

        if (!Array.isArray(points) || points.length < 2) {
            return Array.isArray(points) ? points : [];
        }

        let normalized = points.filter(Boolean).map(p => ({ ...p }));
        if (normalized.length < 2) return normalized;

        const STUB = 14; // unidades del lienzo -- largo del tiro recto que sale del pin

        // El resto de esta función (más abajo) ya elige un codo "natural"
        // comparando qué eje tiene más distancia que recorrer. Si ESE
        // codo natural YA sale en la misma dirección/sentido que el pin
        // (ej. el siguiente punto está bastante más abajo que al costado,
        // y el pin apunta hacia abajo), forzar un tiro extra no corrige
        // nada -- solo agrega un codo de más pegado al pin que antes no
        // estaba (reportado en vivo con captura: "ahora crea codos... se
        // ve peor" en cables que antes salían derechos sin necesitarlo).
        // Solo insertamos el tiro cuando el codo natural de verdad
        // saldría para el lado equivocado (eje incorrecto, o eje correcto
        // pero sentido contrario -- ej. el destino queda "detrás" del
        // pin respecto a por dónde debe salir).
        const exitsNaturally = (dir, from, to) => {
            if (!dir || (dir.dx === 0 && dir.dy === 0)) return true;
            const ddx = to.x - from.x;
            const ddy = to.y - from.y;
            if (dir.dx !== 0) {
                return Math.abs(ddx) > Math.abs(ddy) && Math.sign(ddx || dir.dx) === Math.sign(dir.dx);
            }
            return Math.abs(ddy) > Math.abs(ddx) && Math.sign(ddy || dir.dy) === Math.sign(dir.dy);
        };

        // Ambas decisiones se evalúan contra los puntos ORIGINALES (antes
        // de insertar nada) -- si se insertara el tiro inicial primero,
        // la revisión del tiro final terminaría comparando contra ese
        // punto recién inventado en vez del vecino real.
        const first  = normalized[0];
        const second = normalized[1];
        const needsStartStub = !!startDir && !exitsNaturally(startDir, first, second);

        const lastIdx    = normalized.length - 1;
        const last       = normalized[lastIdx];
        const secondLast = normalized[lastIdx - 1];
        const needsEndStub = !!endDir && !exitsNaturally(endDir, last, secondLast);

        // Si AMBOS extremos necesitan tiro y los dos son sobre el MISMO
        // eje (ej. un componente pegado justo arriba del ESP32: su pin
        // sale hacia abajo y el del ESP32 hacia arriba, los dos en Y),
        // un tiro de 14 fijo de cada lado puede "pasarse" cuando el
        // hueco real entre los dos pines es más chico que 28 -- los dos
        // tiros se cruzan y el tramo que los une termina yendo para
        // atrás antes de volver, el zigzag feo reportado en vivo con
        // captura ("ahora crea codos... se ve peor"). Acortamos cada
        // tiro a lo sumo a la mitad del hueco disponible en ese eje para
        // que, en el peor caso, se toquen justo en el medio y nunca se
        // crucen.
        let startStubLen = STUB;
        let endStubLen = STUB;
        if (needsStartStub && needsEndStub) {
            if (startDir.dx === 0 && endDir.dx === 0) {
                const half = Math.abs(last.y - first.y) / 2;
                startStubLen = Math.min(STUB, half);
                endStubLen = Math.min(STUB, half);
            } else if (startDir.dy === 0 && endDir.dy === 0) {
                const half = Math.abs(last.x - first.x) / 2;
                startStubLen = Math.min(STUB, half);
                endStubLen = Math.min(STUB, half);
            }
        }

        // Insertar primero el del final (en lastIdx, no afecta el índice
        // 1) y recién después el del inicio (en el índice 1) -- así
        // ninguno de los dos splice corre al otro de lugar.
        if (needsEndStub) {
            normalized.splice(lastIdx, 0, { x: last.x + endDir.dx * endStubLen, y: last.y + endDir.dy * endStubLen });
        }
        if (needsStartStub) {
            normalized.splice(1, 0, { x: first.x + startDir.dx * startStubLen, y: first.y + startDir.dy * startStubLen });
        }

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
