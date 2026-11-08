/*
==========================================================
 PitSimulator — WireManager.js
 Igual que el original + bloqueo durante simulación
==========================================================
*/

class WireManager {

    static COLORS = ["#f2c94c", "#4da3ff", "#ff5252", "#2ecc71", "#bb86fc", "#ffffff"];

    // ────────────────────────────────────────────────────────────
    // Color automático por tipo de señal (según el/los pin(es) del
    // cable). Se elige al crear el cable, en base a pin.type / pin.signal
    // / pin.id / pin.name del componente definido en su .json.
    // ────────────────────────────────────────────────────────────

    static CATEGORY_COLORS = {
        ground:  "#1a1a1a", // GND -- negro
        power:   "#ff5252", // VCC / 5V / 3V3 -- rojo
        i2c:     "#2ecc71", // SDA/SCL (I2C) -- verde
        spi:     "#bb86fc", // MOSI/MISO/SCK/CS (SPI) -- morado
        uart:    "#4da3ff", // TX/RX -- azul
        pwm:     "#ff66cc", // señal PWM (servo, ENA/ENB, etc.) -- rosa
        analog:  "#26c6da", // entrada analógica (ADC) -- celeste
        reset:   "#ffffff", // RST/EN -- blanco
        motor:   "#8d6e63", // salida de motor (L298N OUTx) -- café
        digital: "#f2994a", // señal digital genérica -- naranja
    };

    // Orden de prioridad cuando los dos extremos del cable "opinan"
    // distinto (ej. un pin genérico "gpio" contra un pin "ground"):
    // gana la categoría más específica.
    static CATEGORY_PRIORITY = [
        "ground", "power", "i2c", "spi", "uart",
        "pwm", "motor", "analog", "reset", "digital"
    ];

    // Clasificar un pin en una de las categorías de arriba,
    // mirando pin.type, pin.signal, pin.id y pin.name.
    static classifyPin(pin) {

        if (!pin) return "digital";

        const type   = (pin.type   || "").toLowerCase();
        const signal = (pin.signal || "").toLowerCase();
        const id     = (pin.id     || "").toLowerCase();
        const name   = (pin.name   || "").toLowerCase();

        if (type === "ground" || signal === "ground") return "ground";
        if (type === "power"  || signal === "power")  return "power";

        if (signal === "i2c" ||
            /\bsda\b/.test(id)  || /\bsda\b/.test(name) ||
            /\bscl\b/.test(id)  || /\bscl\b/.test(name) ||
            name.includes("i2c")) {
            return "i2c";
        }

        if (signal === "spi")    return "spi";
        if (signal === "uart")   return "uart";
        if (signal === "pwm")    return "pwm";
        if (signal === "motor")  return "motor";
        if (signal === "analog") return "analog";
        if (signal === "reset")  return "reset";

        return "digital";

    }

    // Color final del cable según los pines "from"/"to"
    static colorForPins(pinFrom, pinTo) {

        const catFrom = WireManager.classifyPin(pinFrom);
        const catTo   = WireManager.classifyPin(pinTo);

        for (const cat of WireManager.CATEGORY_PRIORITY) {
            if (catFrom === cat || catTo === cat) {
                return WireManager.CATEGORY_COLORS[cat];
            }
        }

        return WireManager.CATEGORY_COLORS.digital;

    }

    // Las 3 opciones que puede elegir el usuario en el panel de
    // propiedades del cable (ver PropertyPanel._renderWire()) -- para
    // armar el circuito FÍSICO real con el conector correcto.
    static CONNECTOR_TYPES = ["hembra-hembra", "hembra-macho", "macho-macho"];

    // Componentes que se conectan por un borne/terminal en vez de un
    // pin header (ver también ReportGenerator, que agrupa el
    // checklist de cables por connectorType) -- estos arrancan en
    // "macho-macho" en vez de "hembra-hembra" porque conectarse a un
    // simple borne normalmente necesita una punta de cable pelada o un
    // pin macho, no un socket hembra.
    static TERMINAL_COMPONENT_TYPES = new Set(["battery_18650", "clavija_127v"]);

    static defaultConnectorType(simulator, from, to) {

        const cm = simulator.componentManager;
        const fromComp = cm.get(from.componentId);
        const toComp   = cm.get(to.componentId);

        const isTerminal =
            WireManager.TERMINAL_COMPONENT_TYPES.has(fromComp?.type) ||
            WireManager.TERMINAL_COMPONENT_TYPES.has(toComp?.type);

        return isTerminal ? "macho-macho" : "hembra-hembra";

    }


    constructor(simulator) {

        this.simulator = simulator;

        this.wires = [];
        this.pendingFrom = null;

        // Codos que el usuario va fijando con click mientras dibuja
        // un cable nuevo (antes de llegar al pin final). Estilo Wokwi:
        // cada click en el canvas fija un punto y el cable sigue desde ahí.
        this.pendingPoints = [];

        this.tempLine = null;
        this.draggingPoint = null;
        this.selectedPoint = null;
        this.selectedWire = null;
        this.pendingSegmentClick = null;
        this.dragStartPos = null;
        this.capturedPointerId = null;
        this.counter = 1;
        this.snapEnabled = true;
        this.shiftKeyPressed = false;

        // Ciclado de cables superpuestos -- ver _pickOverlappingWireSegment().
        this._overlapCycle = null;

        this.bindEvents();

    }

    //------------------------------------------------------
    // ¿Está bloqueado el circuito? (simulación corriendo)
    //------------------------------------------------------

    get locked() {
        return this.simulator.isRunning;
    }

    //------------------------------------------------------
    // Eventos
    //------------------------------------------------------

    bindEvents() {

        this.simulator.componentLayer.addEventListener("pointerdown", (e) => {
            this.onPinDown(e);
        });

        this.simulator.wireLayer.addEventListener("pointerdown", (e) => {
            this.onWireLayerDown(e);
        });

        // Click en cualquier parte del canvas MIENTRAS se está dibujando
        // un cable nuevo -> fija un codo ahí y el cable sigue desde ese
        // punto (estilo Wokwi). Se registra en el canvas completo porque
        // un click en área vacía no pertenece ni a componentLayer ni a
        // wireLayer.
        this.simulator.canvas.addEventListener("pointerdown", (e) => {
            this.onCanvasDown(e);
        });

        this.simulator.wireLayer.addEventListener("dblclick", (e) => {
            this.onWireLayerDblClick(e);
        });

        // Click derecho -> cancelar el cable en curso. Antes la ÚNICA
        // forma de salir de "modo dibujar cable" (pendingFrom activo)
        // era Escape o volver a tocar el mismo pin de origen -- si el
        // usuario entraba a ese modo sin querer (el área de click de
        // un pin es 2.2x más grande que el punto visible, ver
        // Renderer.renderPins/hitSize) y no lo notaba, cada click en
        // el canvas se interpretaba como "fijar un codo" en vez de
        // deseleccionar o dejar pasar el paneo (ver SelectionManager,
        // que a propósito no deselecciona mientras pendingFrom esté
        // activo, y onCanvasDown más abajo, que consume el click como
        // waypoint). El click derecho es la convención estándar en
        // editores de este estilo (Wokwi/Fritzing) para "cancelar la
        // acción en curso" sin interferir con el resto de los gestos.
        this.simulator.canvas.addEventListener("contextmenu", (e) => {
            if (this.pendingFrom) {
                e.preventDefault();
                this.cancelWire();
            }
        });

        this.simulator.canvas.addEventListener("pointermove", (e) => {
            this.onPointerMove(e);
        });

        window.addEventListener("pointerup", (e) => {
            this.onPointerUp(e);
        });

        window.addEventListener("keydown", (e) => {
            this.shiftKeyPressed = e.shiftKey;

            if (e.key === "Escape") {
                this.cancelWire();
                return;
            }

            if (e.key === "g" || e.key === "G") {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    this.snapEnabled = !this.snapEnabled;
                    this.renderAll();
                }
            }

            this.handleKeyboardNudge(e);
        });

        window.addEventListener("keyup", (e) => {
            if (e.key === "Shift") {
                this.shiftKeyPressed = false;
            }
        });

        this.simulator.eventBus.on("component:moved",   () => this.renderAll());
        this.simulator.eventBus.on("component:dragend", () => this.renderAll());

        this.simulator.eventBus.on("selection:changed", () => {
            this.selectedWire  = null;
            this.selectedPoint = null;
            this.renderAll();
        });

        // Cuando para la simulación, re-dibujar los cables
        // (quitar el aspecto "bloqueado" si lo hubiera)
        this.simulator.eventBus.on("simulation:stopped", () => this.renderAll());
        this.simulator.eventBus.on("simulation:started", () => this.renderAll());

    }

    //------------------------------------------------------
    // Ajustar un punto: por defecto SIEMPRE restringido a un solo eje
    // (igual criterio que moveSegmentWithConstraint para los tramos).
    //
    // Por qué: mover una esquina en diagonal libre (x e y a la vez)
    // deja ese punto desalineado de AMBOS vecinos, y en el render
    // (Utils.buildOrthogonalPoints) eso obliga a insertar codos
    // virtuales extra de los dos lados para mantener el cable en
    // ángulo recto -- ese es el efecto "escalera"/zigzag reportado
    // (se ve peor todavía si esos codos virtuales se llegan a
    // "bakear" como puntos reales al arrastrar después un tramo).
    // Restringiendo el movimiento a un solo eje por vez, sólo hace
    // falta un codo nuevo del lado que se movió y el cable se
    // mantiene limpio siempre. Si de verdad se quiere mover en
    // diagonal libre, mantené Shift apretado.
    //------------------------------------------------------

    movePointWithConstraint(wire, pointIndex, point, freeAxis = null) {

        // Guardia contra NaN/undefined: si el point que nos llega de
        // onPointerMove está mal (pointermove con el cursor fuera del
        // canvas, evento que llega antes de tiempo, o que
        // Utils.getCanvasPoint falle) NO escribimos en wire.points.
        // Si lo hiciéramos, el NaN se queda en el state y revienta
        // TODO el renderAll() con "<line> attribute x2: Expected
        // length, 'NaN'" en cada segmento del cable.
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

        const current = wire.points[pointIndex];
        if (!current) return;

        let next = { ...point };

        if (freeAxis === "y") {
            // Solo se permite mover en Y (el punto viene de un tramo
            // horizontal cuyo manejador de en medio quedó bloqueado a
            // ese eje -- ver moveSegmentWithConstraint / onWireLayerDown)
            next.x = current.x;
        } else if (freeAxis === "x") {
            next.y = current.y;
        } else if (!this.shiftKeyPressed) {

            // Restricción por defecto: solo se mueve el eje dominante
            // (el que tuvo mayor desplazamiento desde la posición actual).
            const dx = point.x - current.x;
            const dy = point.y - current.y;

            if (Math.abs(dx) > Math.abs(dy)) {
                next.y = current.y;
            } else {
                next.x = current.x;
            }

        }
        // (con Shift apretado: movimiento libre en ambos ejes, sin restricción)

        wire.points[pointIndex] = {
            x: Utils.snapToGrid(next.x, this.simulator.gridSize, this.snapEnabled),
            y: Utils.snapToGrid(next.y, this.simulator.gridSize, this.snapEnabled)
        };

        this.renderAll();

    }

    //------------------------------------------------------
    // Arrastrar un TRAMO completo (los dos puntos que lo forman
    // se mueven juntos) bloqueado al eje perpendicular a su
    // orientación original -- estilo Wokwi. Así el tramo se
    // mantiene siempre recto en vez de deformarse en diagonal.
    //------------------------------------------------------

    moveSegmentWithConstraint(wire, drag, point) {

        // Misma guardia que en movePointWithConstraint -- ver el
        // comentario largo de esa función. El error "<line> attribute
        // x2: NaN" en renderAll (vía onPointerMove) venía exactamente
        // de acá: un point malo se metía en left.x/right.x y quedaba
        // persistido en wire.points.
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

        const left  = wire.points[drag.leftIndex];
        const right = wire.points[drag.rightIndex];
        if (!left || !right) return;

        if (drag.freeAxis === "y") {

            const snappedY = Utils.snapToGrid(point.y, this.simulator.gridSize, this.snapEnabled);
            left.y = snappedY;
            right.y = snappedY;

        } else {

            const snappedX = Utils.snapToGrid(point.x, this.simulator.gridSize, this.snapEnabled);
            left.x = snappedX;
            right.x = snappedX;

        }

        this.renderAll();

    }

    //------------------------------------------------------
    // Click sobre un pin
    //------------------------------------------------------

    onPinDown(e) {

        if (this.locked) return;   // ← BLOQUEADO durante simulación

        const pinEl = e.target.closest(".pin");
        if (!pinEl) return;

        const componentId = pinEl.getAttribute("data-component-id");
        const pinId       = pinEl.getAttribute("data-pin-id");

        if (!this.pendingFrom) {
            this.pendingFrom = { componentId, pinId };
            this.capturePointer(e.pointerId);
            return;
        }

        if (this.pendingFrom.componentId === componentId &&
            this.pendingFrom.pinId       === pinId) {
            this.cancelWire();
            return;
        }

        const wire = this.addWire(this.pendingFrom, { componentId, pinId });
        this.cancelWire();

        // Antes trazar un cable NO entraba al historial: Ctrl+Z
        // deshacía lo anterior (ej. quitaba el componente recién puesto
        // y con él se perdían en silencio los cables, sin poder
        // rehacerlos).
        if (wire) {
            this.simulator.history.push({
                undo: () => this.removeWire(wire.id),
                redo: () => this.restoreWire(wire),
            });
        }

    }

    //------------------------------------------------------
    // Click en el canvas MIENTRAS se dibuja un cable nuevo:
    // fija un codo permanente ahí y el cable sigue desde ese
    // punto hacia el mouse (estilo Wokwi -- click-click-click
    // para ir dirigiendo el camino, y click final sobre un pin
    // para terminar el cable).
    //------------------------------------------------------

    onCanvasDown(e) {

        if (this.locked) return;
        if (!this.pendingFrom) return;

        // Si el click fue sobre un pin, que lo maneje onPinDown()
        // (ese listener ya corrió antes, por el orden de burbujeo).
        if (e.target.closest(".pin")) return;

        // Si fue sobre una manija de un cable existente, no aplica acá
        // (los cables existentes están bloqueados mientras pendingFrom
        // esté activo, ver onWireLayerDown).
        if (e.target.closest(".wire-node-hit")) return;

        const point = Utils.getCanvasPoint(this.simulator.componentLayer, e.clientX, e.clientY);
        const snappedPoint = {
            x: Utils.snapToGrid(point.x, this.simulator.gridSize, this.snapEnabled),
            y: Utils.snapToGrid(point.y, this.simulator.gridSize, this.snapEnabled)
        };

        this.pendingPoints.push(snappedPoint);

        // Redibujar la vista previa de inmediato con el nuevo codo fijo
        // (sin esperar al próximo pointermove)
        const origin = this.getPinAbsolutePosition(this.pendingFrom);
        if (origin) {
            const pinFrom = this.getPinDefinition(this.pendingFrom);
            this.drawTempLine([origin, ...this.pendingPoints], point, WireManager.colorForPins(pinFrom, null));
        }

    }

    //------------------------------------------------------
    // Click sobre un cable existente
    //------------------------------------------------------

    onWireLayerDown(e) {

        // Mientras se está dibujando un cable nuevo (pendingFrom activo),
        // los cables YA existentes no deben capturar el click -- ese click
        // lo maneja onCanvasDown() y fija un codo del cable en curso.
        if (this.pendingFrom) return;

        // NOTA: los puntos de esquina (wire.points, entre start y end)
        // YA NO se pueden arrastrar a propósito -- por eso acá NO se
        // arma un this.draggingPoint para ".wire-node-hit". Solo el
        // tirador de en medio de cada tramo (.wire-seg-handle-hit,
        // más abajo) puede mover el cable, porque ese SIEMPRE queda
        // bloqueado a un solo eje. Arrastrar una esquina libremente era
        // justo lo que producía el efecto zigzag/escalera reportado
        // antes. El doble-click sobre la esquina para borrarla sigue
        // andando (ver onWireLayerDblClick) -- pero ESTE return acá es
        // clave: sin él, el pointerdown caía en el "else" de más abajo
        // (deseleccionar todo), lo que llamaba a setSelectedWire(null)
        // y volvía a dibujar el wireLayer SIN los tiradores (solo se
        // muestran con el cable seleccionado) -- entre el primer y el
        // segundo click del doble-click, el círculo desaparecía de
        // abajo del mouse y el borrado nunca llegaba a dispararse.
        if (e.target.closest(".wire-node-hit")) return;

        // Si hizo click en el "handle" que está en el medio del tramo,
        // insertamos un punto en el medio y comenzamos a arrastrarlo
        const segHandle = e.target.closest('.wire-seg-handle-hit');

        if (segHandle) {
            if (!this.locked) {
                const wireId = segHandle.getAttribute('data-wire-id');
                const segmentIndex = parseInt(segHandle.getAttribute('data-seg-index'), 10);
                const wire = this.wires.find(w => w.id === wireId);
                if (!wire) return;

                // Reconstruir puntos visibles (start, ...wire.points, end)
                const start = this.getPinAbsolutePosition(wire.from);
                const end = this.getPinAbsolutePosition(wire.to);
                const startDir = this.getPinExitDirectionFor(wire.from);
                const endDir   = this.getPinExitDirectionFor(wire.to);
                const allPoints = Utils.buildOrthogonalPoints([start, ...wire.points, end], startDir, endDir);
                const a = allPoints[segmentIndex];
                const b = allPoints[segmentIndex + 1];
                if (!a || !b) return;

                // Foto de los codos ANTES de tocar nada (incluido el
                // "bakeado" de abajo), para que deshacer vuelva justo acá.
                const beforePoints = WireManager.clonePoints(wire.points);

                // A partir de ACÁ, este cable queda "ruteado a mano" --
                // ver el comentario grande en DragManager.startDrag()
                // sobre por qué esto importa: mientras no se toque este
                // tirador, mover cualquiera de los dos componentes
                // puede resetear los codos a un trazado limpio de
                // vuelta; en cuanto el usuario arregla el tramo A MANO
                // acá, esa reconstrucción automática se apaga para
                // SIEMPRE en este cable (su forma ya es intención
                // explícita, no un resto de un trazado viejo).
                wire.autoRouted = false;

                // ── "Bakear" los codos automáticos ──────────────────────
                // buildOrthogonalPoints() puede insertar codos "virtuales"
                // (que no existen en wire.points) para cualquier tramo entre
                // start/end que no esté ya alineado -- esto pasa, por
                // ejemplo, en CUALQUIER cable recién dibujado con un solo
                // doblez, que es el caso más común. Si no materializamos
                // esos codos como puntos reales antes de arrastrar, el
                // índice de "allPoints" no coincide 1 a 1 con wire.points y
                // el arrastre termina generando zigzags (justo el bug que
                // seguía apareciendo). Al bakearlos, la forma visual no
                // cambia en nada, pero a partir de acá sí hay un punto real
                // por cada codo, y el arrastre del tramo puede operar de
                // forma consistente siempre.
                if (allPoints.length !== wire.points.length + 2) {
                    wire.points = allPoints.slice(1, -1).map(p => ({ ...p }));
                }

                const n = wire.points.length;

                // Orientación del tramo: horizontal -> el manejador solo se
                // puede arrastrar en Y; vertical -> solo en X. Así el tramo
                // se mueve en bloque y se mantiene recto (estilo Wokwi).
                const freeAxis = (Math.abs(a.y - b.y) < Math.abs(a.x - b.x)) ? "y" : "x";

                // El tramo va entre dos "anclas" que pueden ser pines fijos
                // (start/end) o puntos ya existentes en wire.points. Si el
                // ancla es un pin, se inserta un punto real nuevo ahí mismo
                // (mismas coords que el pin) para poder arrastrarlo; si ya
                // era un punto del cable, se reutiliza tal cual. Los dos
                // extremos del tramo se mueven siempre juntos.
                const s = segmentIndex;
                const points = wire.points;

                let leftIndex, rightIndex, leftWasNew = false, rightWasNew = false;

                if (s === 0 && s === n) {
                    points.unshift({ x: start.x, y: start.y });
                    points.push({ x: end.x, y: end.y });
                    leftIndex = 0;
                    rightIndex = 1;
                    leftWasNew = true;
                    rightWasNew = true;
                } else if (s === 0) {
                    points.unshift({ x: start.x, y: start.y });
                    leftIndex = 0;
                    rightIndex = 1; // el que era points[0] ahora es points[1]
                    leftWasNew = true;
                } else if (s === n) {
                    leftIndex = n - 1;
                    points.push({ x: end.x, y: end.y });
                    rightIndex = points.length - 1;
                    rightWasNew = true;
                } else {
                    leftIndex = s - 1;
                    rightIndex = s;
                }

                const startLeft  = { ...points[leftIndex] };
                const startRight = { ...points[rightIndex] };

                this.renderAll();

                this.draggingPoint = {
                    wireId,
                    segmentDrag: true,
                    freeAxis,
                    leftIndex,
                    rightIndex,
                    leftWasNew,
                    rightWasNew,
                    startLeft,
                    startRight,
                    beforePoints
                };
                this.dragStartPos = { x: e.clientX, y: e.clientY };
                this.capturePointer(e.pointerId);
            }
            return;
        }

        const segment = this._pickOverlappingWireSegment(e);

        if (segment) {
            const wireId = segment.getAttribute("data-wire-id");
            this.setSelectedWire(wireId);
            this.setSelectedPoint(null);
            return;
        }

        this.setSelectedPoint(null);
        this.setSelectedWire(null);

    }

    //------------------------------------------------------
    // Desempate cuando 2+ cables se superponen en el mismo punto de
    // pantalla -- SIN esto, el click SIEMPRE selecciona el cable
    // dibujado más arriba (el último del array this.wires que pasa
    // por ese punto), y no hay forma de agarrar el que queda "tapado"
    // para moverlo (reportado en vivo: "cuando 2 cables se empalman
    // y quiero mover el que está detrás es imposible").
    //
    // document.elementsFromPoint() devuelve la pila COMPLETA de
    // elementos en ese punto de arriba hacia abajo -- no solo el de
    // más arriba, que es lo único que e.target ya daba. Si el click
    // cae sobre más de un cable distinto Y el click anterior fue casi
    // en el mismo punto (mismos cables en juego, <1.5s), se avanza al
    // siguiente de la pila en vez de quedarse siempre con el primero
    // -- mismo gesto que "click de nuevo para seleccionar lo de
    // abajo" de Figma/Illustrator. Un click en cualquier otro punto
    // (o con otro conjunto de cables debajo) reinicia el ciclo solo,
    // sin hacer falta ningún reset explícito en otro lado.
    //
    // Les demás zonas de click de un cable (manejadores de arrastre
    // de tramo/borrado de esquina) NO necesitan esto: esas solo
    // existen para el cable YA seleccionado (ver renderAll() más
    // abajo, "Mostrar manejadores solo cuando el cable está
    // seleccionado"), así que nunca hay ambigüedad entre dos cables
    // distintos ahí -- esta es la ÚNICA zona de click que coexiste
    // para TODOS los cables del lienzo a la vez.
    //------------------------------------------------------

    _pickOverlappingWireSegment(e) {

        const fallback = e.target.closest(".wire-segment");

        let stack;
        try {
            stack = document.elementsFromPoint(e.clientX, e.clientY);
        } catch (err) {
            this._overlapCycle = null;
            return fallback;
        }

        const matches = [];
        const seenIds = new Set();
        for (const el of stack) {
            const hit = el.closest?.(".wire-segment");
            if (!hit) continue;
            const id = hit.getAttribute("data-wire-id");
            if (!id || seenIds.has(id)) continue;
            seenIds.add(id);
            matches.push(hit);
        }

        // Cualquier click que NO sea sobre 2+ cables superpuestos
        // reinicia el ciclo -- sin esto, un click afuera (que no toca
        // ningún "wire-segment", matches.length===0) no borraba el
        // estado viejo, y volver a clickear el mismo punto ambiguo de
        // antes seguía el ciclo donde había quedado en vez de arrancar
        // de nuevo por el de más arriba (resultado raro: dos clicks
        // bien separados en el tiempo "recordaban" uno al otro).
        if (matches.length <= 1) {
            this._overlapCycle = null;
            return matches[0] || fallback;
        }

        const currentIds = matches.map((el) => el.getAttribute("data-wire-id"));
        const currentSet = new Set(currentIds);

        const now = Date.now();
        const prev = this._overlapCycle;
        // Mismo CONJUNTO de cables (sin importar el orden) -- el orden
        // SÍ puede cambiar entre un click y el siguiente sin que el
        // usuario haya hecho nada raro: el cable seleccionado se
        // redibuja último a propósito (ver el comentario grande en
        // renderAll(), "arriba en el z-order" para que sus manejadores
        // se vean), así que ciclar a un cable lo manda arriba, y el
        // PRÓXIMO click en el mismo punto vería ese orden invertido. Si
        // comparáramos el orden exacto acá, ese cambio de z-order por
        // sí solo reiniciaba el ciclo en vez de seguir avanzando.
        const samePoint = !!prev &&
            Math.abs(prev.x - e.clientX) <= 3 &&
            Math.abs(prev.y - e.clientY) <= 3 &&
            (now - prev.time) < 1500 &&
            prev.ids.length === currentIds.length &&
            prev.ids.every((id) => currentSet.has(id));

        // Si es el mismo click ambiguo de antes, seguimos LA MISMA
        // secuencia ya fijada la primera vez (prev.ids) -- no la
        // recalculamos del z-order actual, que es justo lo que puede
        // haber cambiado. Si es un click nuevo, arrancamos de cero con
        // el de más arriba AHORA MISMO primero (comportamiento de
        // siempre: el primer click agarra lo que se ve encima).
        const ids = samePoint ? prev.ids : currentIds;
        const index = samePoint ? (prev.index + 1) % ids.length : 0;

        this._overlapCycle = { x: e.clientX, y: e.clientY, time: now, ids, index };

        const chosenId = ids[index];
        return matches.find((el) => el.getAttribute("data-wire-id") === chosenId) || fallback;

    }

    //------------------------------------------------------
    // Doble click en cable
    //------------------------------------------------------

    onWireLayerDblClick(e) {

        if (this.locked) return;   // ← BLOQUEADO

        const handle = e.target.closest(".wire-node-hit");

        if (handle) {
            const wireId     = handle.getAttribute("data-wire-id");
            const pointIndex = parseInt(handle.getAttribute("data-point-index"), 10);
            const wire = this.wires.find(w => w.id === wireId);
            if (wire && wire.points[pointIndex]) {
                const before = WireManager.clonePoints(wire.points);
                wire.points.splice(pointIndex, 1);
                this.setSelectedPoint(null);
                this.pushPointsChange(wire, before, wire.points);
            }
            return;
        }

        const segment = e.target.closest(".wire-segment");

        if (segment) {
            const wireId = segment.getAttribute("data-wire-id");
            this.setSelectedWire(wireId);
            this.setSelectedPoint(null);
            return;
        }

    }

    //------------------------------------------------------
    // Mover el mouse
    //------------------------------------------------------

    onPointerMove(e) {

        if (this.draggingPoint) {
            if (!this.locked) {
                const wire = this.wires.find(w => w.id === this.draggingPoint.wireId);
                if (wire) {
                    const point = Utils.getCanvasPoint(this.simulator.componentLayer, e.clientX, e.clientY);

                    if (this.draggingPoint.segmentDrag) {
                        this.moveSegmentWithConstraint(wire, this.draggingPoint, point);
                    } else {
                        this.movePointWithConstraint(wire, this.draggingPoint.pointIndex, point, this.draggingPoint.freeAxis);
                    }
                }
            }
            return;
        }

        if (this.pendingSegmentClick) {
            const p = this.pendingSegmentClick;
            const moved = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
            const wire  = this.wires.find(w => w.id === p.wireId);
            if (!wire) return;

            if (!p.inserted) {
                if (moved < 4) return;
                if (!this.locked) {
                    const point = Utils.getCanvasPoint(this.simulator.componentLayer, e.clientX, e.clientY);
                    // Misma guardia -- un point con NaN/undefined
                    // spliced adentro de wire.points contamina el state
                    // igual que en los move*() de arriba.
                    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
                        wire.points.splice(p.segmentIndex, 0, point);
                        p.inserted      = true;
                        p.insertedIndex = p.segmentIndex;
                        this.renderAll();
                    }
                }
                return;
            }

            if (!this.locked) {
                const point = Utils.getCanvasPoint(this.simulator.componentLayer, e.clientX, e.clientY);
                // Idem: solo actualizamos si el point es válido.
                if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
                    wire.points[p.insertedIndex] = point;
                    this.renderAll();
                }
            }
            return;
        }

        if (!this.pendingFrom) return;

        const start = this.getPinAbsolutePosition(this.pendingFrom);
        if (!start) return;

        const end = Utils.getCanvasPoint(this.simulator.componentLayer, e.clientX, e.clientY);

        // Si el cursor está sobre un pin destino válido, el color de
        // vista previa ya considera ambos extremos (igual que el cable
        // final); si no, se basa solo en el pin de origen.
        const hoverPinEl = e.target.closest(".pin");
        const pinFrom    = this.getPinDefinition(this.pendingFrom);
        const pinTo       = hoverPinEl
            ? this.getPinDefinition({
                  componentId: hoverPinEl.getAttribute("data-component-id"),
                  pinId:       hoverPinEl.getAttribute("data-pin-id")
              })
            : null;

        const previewColor = WireManager.colorForPins(pinFrom, pinTo);

        this.drawTempLine([start, ...this.pendingPoints], end, previewColor);

    }

    onPointerUp(e) {

        if (this.draggingPoint) {

            const drag = this.draggingPoint;

            const moved = this.dragStartPos
                ? Math.hypot(e.clientX - this.dragStartPos.x, e.clientY - this.dragStartPos.y)
                : 999;

            // ── Arrastre de un TRAMO completo (manejador de en medio) ──
            if (drag.segmentDrag) {

                const wire = this.wires.find(w => w.id === drag.wireId);

                if (wire) {

                    if (moved < 4) {

                        // No hubo arrastre real: el cable vuelve exactamente
                        // a como estaba (sin nodos fantasma ni codos bakeados).
                        wire.points = WireManager.clonePoints(drag.beforePoints);

                        this.setSelectedWire(wire.id);
                        this.setSelectedPoint(null);

                    } else {

                        this.pushPointsChange(wire, drag.beforePoints, wire.points);

                    }

                }

                this.renderAll();
                this.releasePointer();
                this.draggingPoint = null;
                this.dragStartPos  = null;
                return;

            }

            // ── Arrastre de un punto individual (manejador existente,
            //    o el punto de respaldo del caso "codo no alineado") ──
            const { wireId, pointIndex, startPoint, isNew } = drag;
            const wire = this.wires.find(w => w.id === wireId);

            if (moved < 4) {

                if (isNew && wire) {

                    // Punto creado al hacer click en el manejador de en
                    // medio (caso de respaldo) pero sin arrastre real:
                    // se descarta para no dejar un nodo fantasma.
                    wire.points.splice(pointIndex, 1);
                    this.renderAll();
                    this.setSelectedWire(wireId);
                    this.setSelectedPoint(null);

                } else {

                    this.setSelectedPoint({ wireId, pointIndex });

                }

            } else if (wire && startPoint) {

                const endPoint = { ...wire.points[pointIndex] };

                if (endPoint.x !== startPoint.x || endPoint.y !== startPoint.y) {

                    if (isNew) {

                        this.simulator.history.push({
                            undo: () => { wire.points.splice(pointIndex, 1);              this.renderAll(); },
                            redo: () => { wire.points.splice(pointIndex, 0, endPoint);     this.renderAll(); }
                        });

                    } else {

                        this.simulator.history.push({
                            undo: () => { wire.points[pointIndex] = startPoint; this.renderAll(); },
                            redo: () => { wire.points[pointIndex] = endPoint;   this.renderAll(); }
                        });

                    }

                }

            }

            this.releasePointer();
            this.draggingPoint = null;
            this.dragStartPos  = null;
            return;
        }

        if (this.pendingSegmentClick) {

            const p = this.pendingSegmentClick;

            if (!p.inserted) {
                this.setSelectedWire(p.wireId);
                this.setSelectedPoint(null);
            } else {

                const wire = this.wires.find(w => w.id === p.wireId);

                if (wire) {

                    const index      = p.insertedIndex;
                    const finalPoint = { ...wire.points[index] };

                    this.simulator.history.push({
                        undo: () => { wire.points.splice(index, 1);           this.renderAll(); },
                        redo: () => { wire.points.splice(index, 0, finalPoint); this.renderAll(); }
                    });

                }

            }

            this.releasePointer();
            this.pendingSegmentClick = null;
        }

    }

    //------------------------------------------------------
    // Selección
    //------------------------------------------------------

    setSelectedPoint(point) { this.selectedPoint = point; this.renderAll(); }

    setSelectedWire(wireId) {
        this.selectedWire = wireId;
        if (wireId) this.simulator.selectionManager.clearSilent();
        this.renderAll();
        this.simulator.eventBus.emit("wire:selected", wireId);
    }

    //------------------------------------------------------
    // Captura de puntero
    //------------------------------------------------------

    capturePointer(pointerId) {
        try { this.simulator.canvas.setPointerCapture(pointerId); this.capturedPointerId = pointerId; } catch (e) {}
    }

    releasePointer() {
        if (this.capturedPointerId === null) return;
        try { this.simulator.canvas.releasePointerCapture(this.capturedPointerId); } catch (e) {}
        this.capturedPointerId = null;
    }

    //------------------------------------------------------
    // Movimiento por teclado de un cable seleccionado
    //------------------------------------------------------

    handleKeyboardNudge(e) {

        if (this.locked) return;

        const key = e.key;
        if (!(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key))) return;

        const target = e.target;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;

        const step = e.shiftKey ? 20 : 10;
        let dx = 0;
        let dy = 0;

        if (key === "ArrowLeft")  dx = -step;
        if (key === "ArrowRight") dx = step;
        if (key === "ArrowUp")    dy = -step;
        if (key === "ArrowDown")  dy = step;

        if (dx === 0 && dy === 0) return;

        const selectedPoint = this.selectedPoint;
        const selectedWireId = this.selectedWire;

        if (selectedPoint) {
            e.preventDefault();

            const wire = this.wires.find(w => w.id === selectedPoint.wireId);
            if (!wire || !wire.points[selectedPoint.pointIndex]) return;

            const beforePoints = WireManager.clonePoints(wire.points);
            const before = wire.points[selectedPoint.pointIndex];
            wire.points[selectedPoint.pointIndex] = {
                ...before,
                x: Utils.snapToGrid(before.x + dx, this.simulator.gridSize, this.snapEnabled),
                y: Utils.snapToGrid(before.y + dy, this.simulator.gridSize, this.snapEnabled)
            };
            this.renderAll();
            this.pushPointsChange(wire, beforePoints, wire.points);
            return;
        }

        if (selectedWireId) {
            e.preventDefault();

            const wire = this.wires.find(w => w.id === selectedWireId);
            if (!wire) return;

            const beforePoints = WireManager.clonePoints(wire.points);
            wire.points = wire.points.map(p => ({
                ...p,
                x: Utils.snapToGrid(p.x + dx, this.simulator.gridSize, this.snapEnabled),
                y: Utils.snapToGrid(p.y + dy, this.simulator.gridSize, this.snapEnabled)
            }));
            this.renderAll();
            // Copias (no los mismos arrays): antes deshacer dejaba en el
            // cable el MISMO array guardado en el historial, y el
            // siguiente arrastre lo modificaba "por dentro".
            this.pushPointsChange(wire, beforePoints, wire.points);
            return;
        }

        // Sin cable/punto seleccionado: nudgear los componentes
        // seleccionados (mismo criterio de movimiento que arrastrarlos
        // con el mouse, ver DragManager.updateDrag/endDrag).
        if (this._nudgeSelectedComponents(dx, dy)) {
            e.preventDefault();
        }

    }

    //------------------------------------------------------
    // Mover por teclado el/los componente(s) actualmente
    // seleccionados -- un solo comando de historial para todo el
    // grupo, así Ctrl+Z deshace el nudge completo de una vez, no
    // uno por componente.
    //------------------------------------------------------

    _nudgeSelectedComponents(dx, dy) {

        if (this.simulator.isRunning) return false;

        const components = this.simulator.selectionManager
            .getSelectedComponents()
            .filter(c => !c.locked);

        if (components.length === 0) return false;

        const gridSize    = this.simulator.gridSize || 20;
        const snapEnabled = !!this.simulator.gridSize;

        const moves = components.map(component => ({
            component,
            startX: component.x,
            startY: component.y,
            endX: Utils.snapToGrid(component.x + dx, gridSize, snapEnabled),
            endY: Utils.snapToGrid(component.y + dy, gridSize, snapEnabled)
        }));

        const applyEnd   = () => moves.forEach(({ component, endX, endY }) => component.setPosition(endX, endY));
        const applyStart = () => moves.forEach(({ component, startX, startY }) => component.setPosition(startX, startY));

        const refresh = () => {
            this.renderAll();
            this.simulator.selectionManager.renderHighlight();
        };

        applyEnd();
        refresh();
        this.simulator.eventBus.emit("component:dragend", moves[0].component);

        this.simulator.history.push({
            undo: () => { applyStart(); refresh(); },
            redo: () => { applyEnd(); refresh(); }
        });

        return true;

    }

    //------------------------------------------------------
    // Línea de vista previa
    //------------------------------------------------------

    drawTempLine(fixedPoints, end, color) {
        if (!this.tempLine) {
            this.tempLine = document.createElementNS(Utils.SVG_NS, "path");
            this.tempLine.setAttribute("class", "wire-segment wire-temp");
            this.simulator.wireLayer.appendChild(this.tempLine);
        }

        // Dirección del pin de origen (this.pendingFrom sigue activo
        // mientras se dibuja esta vista previa) -- sin endDir, el cursor
        // no es un pin real y no tiene una dirección "natural" propia.
        const startDir = this.pendingFrom ? this.getPinExitDirectionFor(this.pendingFrom) : null;
        const allPoints = Utils.buildOrthogonalPoints([...fixedPoints, end], startDir, null);
        const d = allPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" ");

        this.tempLine.setAttribute("d", d);
        this.tempLine.style.stroke = color || "#4da3ff";
        this.tempLine.style.fill = "none"; // ver el comentario en el <path> "wire-visual" de arriba
    }

    cancelWire() {
        this.pendingFrom   = null;
        this.pendingPoints = [];
        if (this.tempLine) { this.tempLine.remove(); this.tempLine = null; }
        this.releasePointer();
    }

    //------------------------------------------------------
    // Crear / eliminar cables
    //------------------------------------------------------

    // Reparar colisiones de id de cable que hayan quedado guardadas de
    // antes de este fix (ver el comentario largo en addWire()). Se llama
    // desde ProjectManager.deserialize() después de restaurar los
    // cables, tanto en el auto-guardado de localStorage como al
    // importar un JSON exportado con la versión vieja.
    ensureUniqueWireIds() {
        const seen = new Set();
        for (const wire of this.wires) {
            if (seen.has(wire.id)) {
                wire.id = Utils.generateId("wire");
            }
            seen.add(wire.id);
        }
    }

    addWire(from, to) {

        const pinFrom = this.getPinDefinition(from);
        const pinTo   = this.getPinDefinition(to);

        // Codos que el usuario fijó a mano con click mientras dibujaba
        // (estilo Wokwi), en el orden en que los fue poniendo.
        const manualPoints = [...this.pendingPoints];

        const startPos = this.getPinAbsolutePosition(from);
        const endPos   = this.getPinAbsolutePosition(to);

        const points = [...manualPoints];

        const wire = {
            // Antes: `wire_${this.counter++}`. Ese contador arranca de
            // nuevo en 1 en cada carga de página, pero ProjectManager
            // (auto-guardado/auto-carga por localStorage) restaura los
            // cables guardados con SUS ids originales sin tocar este
            // contador -- entonces un cable nuevo podía terminar con el
            // MISMO id que uno ya cargado (ej. los dos "wire_1"). Como
            // la selección compara por id, seleccionar cualquiera de
            // los dos marcaba a AMBOS como seleccionados a la vez --
            // ese era el bug de "se seleccionan 2 cables juntos". Con
            // Utils.generateId (sufijo aleatorio) el id no depende de
            // ningún contador ni del orden de carga, así que no puede
            // volver a colisionar.
            id: Utils.generateId("wire"),
            from, to,
            points,
            // Ver DragManager.startDrag() -- mientras el usuario no
            // haya clickeado codos a mano dibujando este cable
            // (pendingPoints vacío, el caso más común: un cable
            // derecho de pin a pin), queda "auto-ruteado": mover
            // cualquiera de los dos componentes lo puede reconstruir
            // limpio de vuelta en vez de arrastrar codos viejos que ya
            // no tienen sentido con la nueva posición.
            autoRouted: manualPoints.length === 0,
            color: WireManager.colorForPins(pinFrom, pinTo),
            // Tipo de conector real para armar el circuito FÍSICO (ver
            // PropertyPanel._renderWire() -- el usuario lo puede
            // cambiar en cualquier momento, esto es solo el valor
            // inicial). Casi todo acá son pines tipo header (macho),
            // la propia ESP32 incluida, así que un jumper entre dos de
            // ellos por default es hembra-hembra; las excepciones son
            // batería/clavija, que van a un borne/terminal en vez de
            // un header.
            connectorType: WireManager.defaultConnectorType(this.simulator, from, to),
        };
        this.wires.push(wire);
        this.renderAll();
        this.simulator.eventBus.emit("wire:added", wire);

        // Aviso INMEDIATO (no hace falta abrir "Validar" y acordarse de
        // mirarlo) si este cable en particular ata GND a un pin de
        // alimentación -- ver ValidationEngine._groundPowerMismatch()
        // (misma lógica que usa el chequeo completo bajo demanda, para
        // no repetirla). Encontrado en la práctica: pasó desapercibido
        // varias veces porque nada avisaba en el momento del cableado.
        const mismatch = this.simulator.validationEngine?._groundPowerMismatch(wire);
        if (mismatch) {
            this.simulator.eventBus.emit("wire:invalidPolarity", { wire, message: mismatch.message });
        }

        return wire;
    }

    // Buscar la definición del pin (del .json del componente) a
    // partir de una referencia { componentId, pinId }
    getPinDefinition(ref) {
        const component = this.simulator.componentManager.get(ref.componentId);
        if (!component) return null;
        return component.pins.find(p => p.id === ref.pinId) || null;
    }

    removeWire(id) {
        this.wires = this.wires.filter(w => w.id !== id);
        this.sanitizeSelection();
        this.renderAll();
        this.simulator.eventBus.emit("wire:removed", id);
    }

    removeWiresForComponent(componentId) {
        const removed = this.wires.filter(w =>
            w.from.componentId === componentId || w.to.componentId === componentId
        );
        this.wires = this.wires.filter(w => !removed.includes(w));
        this.sanitizeSelection();
        this.renderAll();
        // Antes no avisaba: el motor de señales seguía viendo los cables
        // de un componente ya borrado hasta el próximo cambio.
        removed.forEach(w => this.simulator.eventBus.emit("wire:removed", w.id));
    }

    // Volver a poner un cable borrado (deshacer un borrado / rehacer una
    // creación). Es el MISMO objeto, así los demás pasos del historial
    // que lo referencian siguen apuntando a él. Si ya está, no se
    // duplica (antes un deshacer repetido podía dejar dos copias del
    // mismo cable, que se seleccionaban y borraban juntas).
    restoreWire(wire) {
        if (!wire || this.wires.includes(wire)) return;
        if (!Array.isArray(wire.points)) wire.points = [];
        this.wires.push(wire);
        this.ensureUniqueWireIds();
        this.renderAll();
        this.simulator.eventBus.emit("wire:added", wire);
    }

    // Copia profunda de los codos de un cable.
    static clonePoints(points) {
        return (points || [])
            .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
            .map(p => ({ ...p }));
    }

    // Registrar en el historial un cambio en la forma de un cable
    // guardando la lista COMPLETA de codos antes y después.
    //
    // Antes cada acción guardaba solo "el punto número N": si después el
    // cable se reacomodaba (al arrastrar un tramo se materializan los
    // codos automáticos y cambia la cantidad de puntos), deshacer
    // escribía en el índice equivocado -> zigzags, o directamente un
    // error que dejaba el historial a medias. Con la lista completa,
    // deshacer siempre deja el cable exactamente como estaba.
    pushPointsChange(wire, before, after) {
        const b = WireManager.clonePoints(before);
        const a = WireManager.clonePoints(after);
        if (JSON.stringify(a) === JSON.stringify(b)) return;
        const apply = (pts) => {
            wire.points = WireManager.clonePoints(pts);
            this.sanitizeSelection();
            this.renderAll();
        };
        this.simulator.history.push({
            undo: () => apply(b),
            redo: () => apply(a),
        });
    }

    // Quitar de la selección cables/codos que ya no existen (por ej.
    // después de deshacer). Sin esto, apretar Supr con un codo
    // "fantasma" seleccionado metía un punto vacío en el cable y el
    // dibujo de todos los cables fallaba.
    sanitizeSelection() {
        const sp = this.selectedPoint;
        if (sp) {
            const w = this.wires.find(x => x.id === sp.wireId);
            if (!w || !w.points[sp.pointIndex]) this.selectedPoint = null;
        }
        if (this.selectedWire && !this.wires.find(w => w.id === this.selectedWire)) {
            this.selectedWire = null;
            this.simulator.eventBus.emit("wire:selected", null);
        }
    }

    //------------------------------------------------------
    // Posición absoluta de un pin
    //------------------------------------------------------

    getPinAbsolutePosition(ref) {
        const component = this.simulator.componentManager.get(ref.componentId);
        if (!component) return null;
        return component.getPinPosition(ref.pinId);
    }

    // Dirección "natural" de salida de un pin (ver
    // Component.getPinExitDirection) -- usada por buildOrthogonalPoints
    // para que el primer/último tramo de cada cable salga derecho del
    // pin en vez de doblar hacia el lado equivocado.
    getPinExitDirectionFor(ref) {
        const component = this.simulator.componentManager.get(ref.componentId);
        if (!component) return null;
        return component.getPinExitDirection(ref.pinId);
    }

    //------------------------------------------------------
    // Redibujar cables
    //------------------------------------------------------

    renderAll() {

        this.simulator.wireLayer.innerHTML = "";

        const isLocked = this.locked;

        // Helper: descarta cualquier punto con coordenadas NaN/undefined.
        // Aunque ya pusimos guards en movePointWithConstraint /
        // moveSegmentWithConstraint / pendingSegmentClick, puede haber
        // cables cuyo `wire.points` quedó contaminado de ANTES del fix
        // (sesiones guardadas, drags interrumpidos, etc). Si dejamos
        // pasar esos NaN, renderAll los mete en <line x1/y1/x2/y2> y
        // en <path d> y revienta el SVG con "Expected length, 'NaN'"
        // o "Expected number, '...NaN...'".
        const validPoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

        // El cable SELECCIONADO se dibuja último a propósito -- en SVG,
        // "después" en el DOM significa "arriba" en el z-order. Sin
        // esto, si el cable seleccionado aparece ANTES que otro en
        // this.wires (ej. es más viejo) y los dos se superponen en
        // algún tramo, el trazo del otro cable (dibujado encima) tapaba
        // por completo los manejadores de arrastre/los puntos del
        // seleccionado -- quedaban ahí, clickeables, pero invisibles,
        // así que no había forma de agarrarlos a simple vista (reportado
        // en vivo con captura: "no se muestran los tiradores porque
        // aparece el otro cable por encima"). El orden entre los DEMÁS
        // cables (ninguno es el seleccionado) no cambia.
        const orderedWires = this.selectedWire
            ? [
                ...this.wires.filter(w => w.id !== this.selectedWire),
                ...this.wires.filter(w => w.id === this.selectedWire),
            ]
            : this.wires;

        orderedWires.forEach(wire => {

            const start = this.getPinAbsolutePosition(wire.from);
            const end   = this.getPinAbsolutePosition(wire.to);
            if (!validPoint(start) || !validPoint(end)) return;

            // Sanitiza los puntos intermedios: descarta cualquier
            // entrada corrupta antes de pasársela a buildOrthogonalPoints.
            // (belt + suspenders: buildOrthogonalPoints ya recibe coords
            // válidas, pero por si mete NaN en algún caso borde, también
            // filtramos el resultado final antes de dibujar).
            const cleanMidPoints = (wire.points || []).filter(validPoint);
            const startDir = this.getPinExitDirectionFor(wire.from);
            const endDir   = this.getPinExitDirectionFor(wire.to);
            const allPoints      = Utils
                .buildOrthogonalPoints([start, ...cleanMidPoints, end], startDir, endDir)
                .filter(validPoint);

            const isSelectedWire  = this.selectedWire === wire.id;

            // ── Zona de click invisible (una <line> por segmento, igual
            //    que antes -- así toda la lógica de click/doble-click/
            //    arrastre de puntos sigue funcionando sin tocarla) ────────
            for (let i = 0; i < allPoints.length - 1; i++) {
                const line = document.createElementNS(Utils.SVG_NS, "line");
                let cls = "wire-segment";
                if (isLocked) cls += " wire-locked";
                line.setAttribute("class", cls);
                line.setAttribute("data-wire-id", wire.id);
                line.setAttribute("data-segment-index", i);
                line.setAttribute("x1", allPoints[i].x);
                line.setAttribute("y1", allPoints[i].y);
                line.setAttribute("x2", allPoints[i + 1].x);
                line.setAttribute("y2", allPoints[i + 1].y);
                // Forzado por JS (no depender de simulator.css, que puede no
                // declarar esto): sin un stroke real + pointer-events:"stroke"
                // explícito, una <line> invisible NO es clickeable -- por
                // default el navegador usa pointer-events:visiblePainted, que
                // ignora cualquier trazo con alpha 0 / sin pintar. Con
                // pointer-events:"stroke" el hit-test usa la geometría del
                // trazo sin importar que sea transparente, así que el click
                // SIEMPRE llega acá sin importar lo que diga (o no diga) el CSS.
                if (!isLocked) {
                    line.style.stroke = "transparent";
                    line.style.strokeWidth = "14";
                    line.style.pointerEvents = "stroke";
                    line.style.cursor = "pointer";
                } else {
                    line.style.pointerEvents = "none";
                }
                this.simulator.wireLayer.appendChild(line);
            }

            // ── Trazo visual real: UN solo <path> con todos los puntos,
            //    con esquinas redondeadas (stroke-linejoin/linecap solo
            //    funcionan dentro de un mismo path) -- estilo Wokwi ──────
            const path = document.createElementNS(Utils.SVG_NS, "path");
            let visualCls = `wire-visual${isSelectedWire ? " selected" : ""}`;
            if (isLocked) visualCls += " wire-locked";
            path.setAttribute("class", visualCls);
            path.setAttribute("data-wire-id", wire.id);
            path.setAttribute("d", allPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" "));
            path.style.stroke = wire.color;
            // fill:none YA está en .wire-visual (simulator.css), pero
            // repetido acá inline a propósito: un <path> sin fill
            // explícito lo defaultea a NEGRO SÓLIDO (relleno del área
            // que encierra el trazo, no solo el trazo), y ese CSS
            // externo no viaja cuando este layer se clona/serializa
            // para exportarlo a PNG (captura de circuito, reporte) --
            // ahí el cable se veía como un cuadrilátero negro enorme
            // en vez de una línea fina de su color real.
            path.style.fill = "none";
            // Mismo motivo que fill:none arriba: stroke-width/linejoin/
            // linecap viven en .wire-visual (simulator.css, hoja
            // externa) y tampoco viajan al clonar/serializar este layer
            // para exportar (captura de circuito, reporte) -- el cable
            // caía al default de SVG (stroke-width:1) y se veía como una
            // línea finita, casi invisible, en la imagen exportada aunque
            // en el lienzo en vivo se viera bien grueso.
            path.style.strokeWidth = "2.3";
            path.style.strokeLinejoin = "round";
            path.style.strokeLinecap = "round";
            // El path visual NUNCA debe capturar clicks: es puramente
            // decorativo y va DIBUJADO ENCIMA de las <line class="wire-segment">
            // invisibles (zona de click ancha). Si no le sacamos pointer-events,
            // el navegador le entrega el click a él (por estar arriba en el
            // z-order) en vez de a la línea invisible, y como onWireLayerDown()
            // no reconoce ".wire-visual", el click terminaba deseleccionando todo
            // en vez de seleccionar/arrastrar el cable -- este era el motivo por
            // el que los cables no se podían mover.
            path.style.pointerEvents = "none";
            this.simulator.wireLayer.appendChild(path);

            // ── Efecto "corriente circulando" estilo Wokwi ──────────────
            // Un segundo <path> con el mismo trazado, dibujado ENCIMA del
            // cable real, con guiones blancos que se animan vía CSS
            // (@keyframes wireCurrentFlow en simulator.css). Puramente
            // decorativo -- por eso pointer-events:none y por eso solo se
            // agrega cuando el cable está seleccionado (si se agregara
            // siempre, con muchos cables la animación de todos a la vez
            // sería un quilombo visual y un gasto de rendimiento).
            if (isSelectedWire && !isLocked) {
                const flow = document.createElementNS(Utils.SVG_NS, "path");
                flow.setAttribute("class", "wire-flow");
                flow.setAttribute("data-wire-id", wire.id);
                flow.setAttribute("d", path.getAttribute("d"));
                this.simulator.wireLayer.appendChild(flow);
            }

            // Mostrar manejadores solo cuando el cable está seleccionado.
            if (!isLocked && isSelectedWire) {
                for (let i = 0; i < allPoints.length - 1; i++) {
                    const a = allPoints[i];
                    const b = allPoints[i + 1];
                    const midX = (a.x + b.x) / 2;
                    const midY = (a.y + b.y) / 2;
                    const segHandle = document.createElementNS(Utils.SVG_NS, "circle");
                    // Clase "-hit" NUEVA a propósito: no la usa ninguna
                    // regla de simulator.css. Antes reusábamos ".wire-seg-
                    // handle" acá, y cualquier estilo que ese CSS le pusiera
                    // (pensado para un punto de 4px) se veía ENORME al
                    // agrandar el radio real de click -- por eso aparecían
                    // esos círculos negros gigantes. Ahora el look de este
                    // círculo lo controla 100% el inline style de abajo.
                    segHandle.setAttribute("class", "wire-seg-handle-hit");
                    segHandle.setAttribute("data-wire-id", wire.id);
                    segHandle.setAttribute("data-seg-index", i);
                    segHandle.setAttribute("cx", midX);
                    segHandle.setAttribute("cy", midY);
                    segHandle.setAttribute("r", 6);
                    segHandle.setAttribute("fill", "transparent");
                    segHandle.setAttribute("stroke", "none");
                    segHandle.style.pointerEvents = "all";
                    const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
                    segHandle.style.cursor = horiz ? "row-resize" : "col-resize";
                    this.simulator.wireLayer.appendChild(segHandle);

                    // Punto violeta visible (puramente decorativo, no debe
                    // interceptar el click -- por eso pointer-events:none;
                    // el click real lo recibe siempre el círculo de arriba).
                    const segHandleVisual = document.createElementNS(Utils.SVG_NS, "circle");
                    segHandleVisual.setAttribute("class", "wire-seg-handle-visual");
                    segHandleVisual.setAttribute("cx", midX);
                    segHandleVisual.setAttribute("cy", midY);
                    segHandleVisual.setAttribute("r", 4);
                    segHandleVisual.setAttribute("stroke", "none");
                    segHandleVisual.style.fill = "#9c27b0";
                    segHandleVisual.style.opacity = 0.6;
                    segHandleVisual.style.pointerEvents = "none";
                    this.simulator.wireLayer.appendChild(segHandleVisual);
                }

                wire.points.forEach((pt, index) => {
                    // Re-chequeamos acá también: aunque arriba filtramos
                    // cleanMidPoints / allPoints, ESTE loop itera sobre
                    // wire.points crudo, y si quedó algún NaN de arrastre
                    // bugueado previo al fix, setAttribute("cx", NaN)
                    // tira "Expected length, 'NaN'" en consola. Mismo
                    // helper validPoint que usamos al inicio del forEach.
                    if (!validPoint(pt)) return;

                    const handle = document.createElementNS(Utils.SVG_NS, "circle");
                    const isSel  = this.selectedPoint?.wireId === wire.id && this.selectedPoint?.pointIndex === index;
                    // "wire-node-hit": a propósito NO se llama "...-handle..."
                    // ni la reconoce onWireLayerDown() para arrancar un drag --
                    // las esquinas ya no se pueden arrastrar (ver comentario
                    // grande en onWireLayerDown). Solo sirve para el doble-click
                    // que borra el codo (onWireLayerDblClick). El cursor "pointer"
                    // (no "move") es a propósito, para no sugerir que se puede
                    // agarrar y arrastrar.
                    handle.setAttribute("class", `wire-node-hit${isSel ? " selected" : ""}`);
                    handle.setAttribute("data-wire-id", wire.id);
                    handle.setAttribute("data-point-index", index);
                    handle.setAttribute("cx", pt.x);
                    handle.setAttribute("cy", pt.y);
                    handle.setAttribute("r", 6);
                    handle.setAttribute("fill", "transparent");
                    handle.setAttribute("stroke", "none");
                    handle.style.pointerEvents = "all";
                    handle.style.cursor = "pointer";
                    this.simulator.wireLayer.appendChild(handle);

                    // Puntito bien discreto: solo para que se note POR DÓNDE
                    // dobla el cable, sin parecer "agarrable". Antes tenía el
                    // mismo tamaño/color vivo que el tirador de tramo (violeta),
                    // lo que invitaba a arrastrarlo -- ahora es chico, gris y
                    // semitransparente.
                    const handleVisual = document.createElementNS(Utils.SVG_NS, "circle");
                    handleVisual.setAttribute("class", `wire-node-visual${isSel ? " selected" : ""}`);
                    handleVisual.setAttribute("cx", pt.x);
                    handleVisual.setAttribute("cy", pt.y);
                    handleVisual.setAttribute("r", isSel ? 4 : 2.5);
                    handleVisual.setAttribute("stroke", "none");
                    handleVisual.style.fill = isSel ? "#4da3ff" : "#8a8f98";
                    handleVisual.style.opacity = isSel ? 0.9 : 0.5;
                    handleVisual.style.pointerEvents = "none";
                    this.simulator.wireLayer.appendChild(handleVisual);
                });
            }

        });

        // Si había una vista previa de un cable en curso, se re-adjunta
        // (por si renderAll() se disparó por otro motivo -- ej. mover un
        // componente -- mientras se está dibujando un cable nuevo; sin
        // esto, wireLayer.innerHTML="" la deja huérfana e invisible).
        if (this.tempLine) {
            this.simulator.wireLayer.appendChild(this.tempLine);
        }

    }

}