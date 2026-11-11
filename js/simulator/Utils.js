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
    // opts (opcional): { obstacles: [{x1,y1,x2,y2}], endBoxes: [...] } --
    // cajas de los componentes del lienzo, para que el enrutador
    // automático (cable sin codos manuales) prefiera rodearlos en vez
    // de pasar por encima. Ver routePinToPin().
    static buildOrthogonalPoints(points, startDir = null, endDir = null, opts = null) {

        if (!Array.isArray(points) || points.length < 2) {
            return Array.isArray(points) ? points : [];
        }

        let normalized = points.filter(Boolean).map(p => ({ ...p }));
        if (normalized.length < 2) return normalized;

        // Cable pin a pin SIN codos manuales: enrutador automático que
        // prueba varias formas y elige la más limpia (ver routePinToPin).
        if (normalized.length === 2 && startDir && endDir) {
            return Utils.routePinToPin(normalized[0], startDir, normalized[1], endDir, opts || {});
        }

        return Utils.simplifyOrthogonal(Utils._buildWithManualPoints(normalized, startDir, endDir));

    }

    // Trazado con codos que el usuario puso a mano (o que quedaron de
    // un arrastre): se respetan esos puntos tal cual -- mismo algoritmo
    // de siempre. buildOrthogonalPoints() después le quita los "rulos"
    // (tramos que van y vuelven sobre la misma línea).
    static _buildWithManualPoints(normalized, startDir, endDir) {

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

    //------------------------------------------------------
    // Limpiar un trazado ortogonal: quita puntos repetidos, puntos en
    // medio de una recta, y "rulos" -- un tramo que avanza y vuelve
    // sobre la MISMA línea (A -> B -> C alineados con C entre A y B o
    // del otro lado). Eso era lo que se veía como un cable doblado
    // sobre sí mismo (ej. el amarillo del semáforo). Los extremos
    // (los pines) nunca se tocan.
    //------------------------------------------------------

    static simplifyOrthogonal(points) {

        const EPS = 0.01;
        const out = [];
        for (const p of points || []) {
            if (!p) continue;
            const last = out[out.length - 1];
            if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
            out.push({ ...p });
        }

        let changed = true;
        while (changed && out.length > 2) {
            changed = false;
            for (let i = 1; i < out.length - 1; i++) {
                const a = out[i - 1], b = out[i], c = out[i + 1];
                const sameX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS;
                const sameY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS;
                const dupAC = Math.abs(a.x - c.x) < EPS && Math.abs(a.y - c.y) < EPS;
                if (sameX || sameY) { out.splice(i, 1); changed = true; break; }
                if (dupAC && i + 1 < out.length - 1) { out.splice(i, 2); changed = true; break; }
            }
        }

        return out;

    }

    //------------------------------------------------------
    // Enrutador automático pin a pin (cable sin codos manuales).
    //
    // En vez de una sola receta fija, arma varias formas candidatas
    // (en L, en Z con el quiebre a mitad de camino, y en U rodeando a
    // los componentes de los extremos), las limpia y se queda con la
    // de menor "costo":
    //   - largo total del cable
    //   - cada codo cuesta (menos codos = más limpio)
    //   - salir del pin hacia el lado equivocado (o entrar al otro pin
    //     de costado/por detrás) cuesta mucho
    //   - pasar por encima de un componente cuesta por cada unidad de
    //     recorrido encima de él
    //   - tramitos minúsculos (zigzag de 1-3 unidades) cuestan
    // Es el mismo enfoque de "ruteo ortogonal por candidatos" que usan
    // editores de diagramas (draw.io / yFiles en modo simple), sin
    // librerías externas y lo bastante rápido para correr en cada
    // redibujado mientras se arrastra.
    //------------------------------------------------------

    static routePinToPin(s, sd, e, ed, opts = {}) {

        const STUB = 14;
        const ALIGN = 1.5;
        const obstacles = opts.obstacles || [];
        const endBoxes  = opts.endBoxes || [];

        // Ya alineados y uno frente al otro: línea recta (tolerando un
        // desfase de hasta 1.5 unidades, invisible, en vez de un
        // escaloncito feo pegado a los pines).
        const facing = (sd.dx === -ed.dx && sd.dy === -ed.dy);
        if (facing && sd.dx === 0 && Math.abs(s.x - e.x) <= ALIGN && Math.sign(e.y - s.y) === sd.dy) {
            return [{ ...s }, { ...e }];
        }
        if (facing && sd.dy === 0 && Math.abs(s.y - e.y) <= ALIGN && Math.sign(e.x - s.x) === sd.dx) {
            return [{ ...s }, { ...e }];
        }

        // Largo del tiro recto de salida: si los dos pines se miran de
        // frente con poco espacio entre ellos, a lo sumo la mitad del
        // hueco (los dos tiros nunca se cruzan).
        let ls = STUB, le = STUB;
        if (facing) {
            const gap = sd.dx !== 0 ? (e.x - s.x) * sd.dx : (e.y - s.y) * sd.dy;
            if (gap > 0) { ls = Math.min(STUB, gap / 2); le = ls; }
        }
        const s1 = { x: s.x + sd.dx * ls, y: s.y + sd.dy * ls };
        const e1 = { x: e.x + ed.dx * le, y: e.y + ed.dy * le };

        // Líneas por donde se puede "rodear": a mitad de camino, y por
        // fuera de las cajas de los componentes de los extremos.
        const xs = [(s1.x + e1.x) / 2];
        const ys = [(s1.y + e1.y) / 2];
        if (endBoxes.length) {
            xs.push(Math.min(...endBoxes.map(b => b.x1)) - STUB, Math.max(...endBoxes.map(b => b.x2)) + STUB);
            ys.push(Math.min(...endBoxes.map(b => b.y1)) - STUB, Math.max(...endBoxes.map(b => b.y2)) + STUB);
        }

        // Orden = desempate: a igual costo gana la primera (el quiebre a
        // mitad de camino se ve más prolijo que pegado a un pin).
        const mids = [
            ...xs.map(X => [{ x: X, y: s1.y }, { x: X, y: e1.y }]),
            ...ys.map(Y => [{ x: s1.x, y: Y }, { x: e1.x, y: Y }]),
            [{ x: e1.x, y: s1.y }],
            [{ x: s1.x, y: e1.y }],
        ];

        let best = null, bestCost = Infinity;
        for (const mid of mids) {
            const pts = Utils.simplifyOrthogonal([s, s1, ...mid, e1, e]);
            if (!Utils._isOrthogonal(pts)) continue;
            const cost = Utils._routeCost(pts, sd, ed, obstacles);
            if (cost < bestCost) { bestCost = cost; best = pts; }
        }

        return best || Utils.simplifyOrthogonal(Utils._buildWithManualPoints([{ ...s }, { ...e }], sd, ed));

    }

    //------------------------------------------------------
    // Separar cables que comparten carril. Si dos o más cables tienen
    // un tramo interior (que no toca un pin) sobre la MISMA línea,
    // encimados, se dibujaban uno encima del otro y parecían un solo
    // cable. Acá cada grupo de tramos encimados se abre en carriles
    // paralelos separados "gap" unidades, ordenados para que no se
    // crucen al doblar (como un bus de cables prolijo). Solo mueve
    // tramos interiores, así que los pines y la forma general no
    // cambian. Devuelve copias; no toca los arreglos recibidos.
    //------------------------------------------------------

    static nudgeOverlaps(routes, gap = 6) {

        const out = routes.map(r => (r || []).map(p => ({ ...p })));
        const segs = [];
        out.forEach((pts, r) => {
            // tramo i va de pts[i-1] a pts[i]; interior = ninguno de sus
            // dos extremos es un pin (primer/último punto)
            for (let i = 2; i < pts.length - 1; i++) {
                const a = pts[i - 1], b = pts[i];
                const horiz = Math.abs(a.y - b.y) < 0.01;
                const vert  = Math.abs(a.x - b.x) < 0.01;
                if (!horiz && !vert) continue;
                const c  = horiz ? a.y : a.x;
                const lo = horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
                const hi = horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
                if (hi - lo < 2) continue;
                segs.push({ r, i, horiz, c, lo, hi });
            }
        });

        // Agrupar tramos de cables DISTINTOS, misma orientación, misma
        // línea y que se pisan en un largo > 2.
        const parent = segs.map((_, k) => k);
        const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
        for (let x = 0; x < segs.length; x++) {
            for (let y = x + 1; y < segs.length; y++) {
                const A = segs[x], B = segs[y];
                if (A.r === B.r || A.horiz !== B.horiz || Math.abs(A.c - B.c) > 1) continue;
                if (Math.min(A.hi, B.hi) - Math.max(A.lo, B.lo) <= 2) continue;
                parent[find(x)] = find(y);
            }
        }
        const groups = new Map();
        segs.forEach((s, k) => {
            const g = find(k);
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g).push(s);
        });

        for (const group of groups.values()) {
            // un tramo por cable (si un cable tuviera dos en el grupo, el primero)
            const byRoute = new Map();
            for (const s of group) if (!byRoute.has(s.r)) byRoute.set(s.r, s);
            const list = [...byRoute.values()];
            if (list.length < 2) continue;

            // Orden para no cruzarse: mirar hacia dónde dobla el cable en
            // el extremo "inicial" del tramo (izquierdo si es horizontal,
            // de arriba si es vertical).
            for (const s of list) {
                const pts = out[s.r];
                const a = pts[s.i - 1], b = pts[s.i];
                const aFirst = s.horiz ? a.x <= b.x : a.y <= b.y;
                const endPt = aFirst ? a : b;
                const nb = aFirst ? pts[s.i - 2] : pts[s.i + 1];
                const along = s.horiz ? endPt.x : endPt.y;
                const turn = nb ? Math.sign(s.horiz ? nb.y - s.c : nb.x - s.c) : 1;
                s.key = turn < 0 ? -along : along;
            }
            list.sort((p, q) => p.key - q.key);

            const base = list.reduce((acc, s) => acc + s.c, 0) / list.length;
            list.forEach((s, k) => {
                const v = base + (k - (list.length - 1) / 2) * gap;
                const pts = out[s.r];
                if (s.horiz) { pts[s.i - 1].y = v; pts[s.i].y = v; }
                else         { pts[s.i - 1].x = v; pts[s.i].x = v; }
            });
        }

        return out;

    }

    static _isOrthogonal(pts) {
        for (let i = 1; i < pts.length; i++) {
            if (Math.abs(pts[i].x - pts[i - 1].x) > 0.01 && Math.abs(pts[i].y - pts[i - 1].y) > 0.01) return false;
        }
        return true;
    }

    static _routeCost(pts, sd, ed, obstacles) {

        const BEND = 18, WRONG_WAY = 1000, SIDEWAYS = 60, OVER = 4, TINY = 25;
        let cost = 0;

        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
            cost += len;
            if (len < 4 && i > 1 && i < pts.length - 1) cost += TINY;
            for (const o of obstacles) cost += OVER * Utils._overlapLength(a, b, o);
        }
        cost += BEND * Math.max(0, pts.length - 2);

        // Dirección del primer tramo (sale del pin) y del último (entra
        // al otro pin, que debe llegar desde "afuera": sentido -ed).
        const dirOf = (a, b) => ({ dx: Math.sign(Math.round(b.x - a.x)), dy: Math.sign(Math.round(b.y - a.y)) });
        const judge = (d, want) => {
            const dot = d.dx * want.dx + d.dy * want.dy;
            if (dot < 0) return WRONG_WAY;
            if (dot === 0) return SIDEWAYS;
            return 0;
        };
        if (pts.length >= 2) {
            cost += judge(dirOf(pts[0], pts[1]), sd);
            cost += judge(dirOf(pts[pts.length - 2], pts[pts.length - 1]), { dx: -ed.dx, dy: -ed.dy });
        }

        return cost;

    }

    // Cuánto recorre el tramo a-b (horizontal o vertical) por DENTRO de
    // la caja o, con un margen de 4 unidades alrededor: un cable que va
    // justo pegado al borde se ve como si pasara por encima del
    // componente, así que también cuenta.
    static _overlapLength(a, b, o, margin = 4) {
        const x1 = o.x1 - margin, x2 = o.x2 + margin, y1 = o.y1 - margin, y2 = o.y2 + margin;
        if (x1 >= x2 || y1 >= y2) return 0;
        if (Math.abs(a.y - b.y) < 0.01) {
            if (a.y <= y1 || a.y >= y2) return 0;
            const lo = Math.max(Math.min(a.x, b.x), x1), hi = Math.min(Math.max(a.x, b.x), x2);
            return Math.max(0, hi - lo);
        }
        if (a.x <= x1 || a.x >= x2) return 0;
        const lo = Math.max(Math.min(a.y, b.y), y1), hi = Math.min(Math.max(a.y, b.y), y2);
        return Math.max(0, hi - lo);
    }

    //------------------------------------------------------
    // Dirección de salida de un pin en coordenadas LOCALES del
    // componente (antes de rotar/reflejar). Ver
    // Component.getPinExitDirection().
    //
    // ANTES: solo "el borde más cercano". Falla en componentes angostos
    // con una fila de pines (semáforo 40x100: sus 4 pines en fila abajo
    // quedaban "más cerca" del costado y los cables salían de lado,
    // enredándose). Ahora:
    //   1. Si el .json del pin declara "exit" ("up"/"down"/"left"/
    //      "right"), manda eso.
    //   2. Pin pegado a un borde (<= 2.5): ese borde (terminales de
    //      resistencia, borneras del L298N...).
    //   3. Pin que forma FILA con otros (misma Y): sale perpendicular a
    //      la fila, hacia el borde (arriba/abajo) más cercano. Igual
    //      para COLUMNA (misma X) hacia izquierda/derecha.
    //   4. Si no, el borde más cercano (como antes).
    //------------------------------------------------------

    static pinExitLocal(pin, pins, w, h) {

        const named = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
        if (pin && typeof pin.exit === "string" && named[pin.exit]) {
            const [dx, dy] = named[pin.exit];
            return { dx, dy };
        }

        const dT = pin.y, dB = h - pin.y, dL = pin.x, dR = w - pin.x;
        const nearest = () => {
            const m = Math.min(dT, dB, dL, dR);
            if (m === dT) return { dx: 0, dy: -1 };
            if (m === dB) return { dx: 0, dy: 1 };
            if (m === dL) return { dx: -1, dy: 0 };
            return { dx: 1, dy: 0 };
        };

        if (Math.min(dT, dB, dL, dR) <= 2.5) return nearest();

        const TOL = 0.75;
        const list = Array.isArray(pins) ? pins : [];
        const row = list.filter(p => Math.abs(p.y - pin.y) <= TOL).length;
        const col = list.filter(p => Math.abs(p.x - pin.x) <= TOL).length;

        if (row >= 2 && row >= col) return dT <= dB ? { dx: 0, dy: -1 } : { dx: 0, dy: 1 };
        if (col >= 2) return dL <= dR ? { dx: -1, dy: 0 } : { dx: 1, dy: 0 };

        return nearest();

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
