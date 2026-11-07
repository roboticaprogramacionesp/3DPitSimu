/*
==========================================================
 PitSimulator
 Archivo: DragManager.js
 Arrastrar componentes dentro del canvas con el mouse/touch
==========================================================
*/

class DragManager {

    constructor(simulator) {

        this.simulator = simulator;

        // Info del arrastre en curso (null si no hay ninguno)
        this.dragging = null;

        this.bindEvents();

    }

    //------------------------------------------------------
    // Eventos de mouse/touch
    //------------------------------------------------------

    bindEvents() {

        this.simulator.componentLayer.addEventListener("pointerdown", (e) => {

            this.startDrag(e);

        });

        this.simulator.componentLayer.addEventListener("pointermove", (e) => {

            this.updateDrag(e);

        });

        // El "pointerup" se escucha en window por si el mouse
        // se suelta fuera del canvas.
        window.addEventListener("pointerup", (e) => {

            this.endDrag(e);

        });

    }

    //------------------------------------------------------
    // Iniciar arrastre
    //------------------------------------------------------

    startDrag(e) {

        // Bloqueado por completo mientras la simulación está corriendo
        // (igual que WireManager bloquea los cables durante la simulación)
        if (this.simulator.isRunning) return;

        // No arrastrar si el click fue sobre un pin
        // (esos, más adelante, servirán para dibujar cables)
        if (e.target.closest(".pin")) return;

        const group = e.target.closest(".component");

        if (!group) return;

        const id = group.getAttribute("data-id");
        const component = this.simulator.componentManager.get(id);

        if (!component || component.locked) return;

        const point = Utils.getCanvasPoint(this.simulator.componentLayer, e.clientX, e.clientY);

        // Arrastre en GRUPO: si el componente clickeado es parte de una
        // selección múltiple (2+, ver SelectionManager), se arrastran
        // TODOS los seleccionados juntos, preservando sus posiciones
        // relativas -- si no, es un arrastre de uno solo, como siempre
        // (de hecho el resto de este método/updateDrag/endDrag ya no
        // distingue los dos casos: "grupo de 1" se comporta idéntico a
        // como se comportaba antes).
        const selMgr = this.simulator.selectionManager;
        const groupIds = (selMgr && selMgr.selected.length > 1 && selMgr.selected.includes(id))
            ? selMgr.selected
            : [id];

        const members = groupIds
            .map(mid => this.simulator.componentManager.get(mid))
            .filter(c => c && !c.locked)
            .map(c => ({ component: c, startX: c.x, startY: c.y }));

        // Codos manuales (wire.points, coordenadas ABSOLUTAS -- ver
        // WireManager.renderAll) de cualquier cable con AL MENOS UN
        // extremo en el grupo que se arrastra: se mueven con el mismo
        // delta que el grupo. Si no se hacen, el cable se "estira" raro
        // -- la punta sigue al pin (auto, vía component:moved) pero los
        // codos intermedios quedan clavados en su posición vieja.
        //
        // ANTES solo cubría el caso "AMBOS extremos en el grupo" (ej.
        // mover 2 componentes seleccionados juntos, cable entre ellos).
        // El caso MÁS COMÚN -- mover UN componente cuyo cable va a OTRO
        // que se queda quieto (ej. un LED cableado a una ESP32 fija) --
        // quedaba afuera: el cable se deformaba en zigzag cada vez que
        // el componente se alejaba de donde estaban los codos viejos.
        // Trasladar TODO el cable por el mismo delta no es "perfecto"
        // (el tramo cercano al extremo quieto también se corre un poco),
        // pero mantiene la forma del cable intacta en vez de estirarla
        // -- mejora clara sin tocar el resto del mecanismo (updateDrag/
        // endDrag ya aplican este mismo delta compartido, sin cambios).
        const memberIds = new Set(groupIds);
        const wireManager = this.simulator.wireManager;
        const wires = wireManager
            ? wireManager.wires.filter(w =>
                (memberIds.has(w.from.componentId) || memberIds.has(w.to.componentId)) &&
                Array.isArray(w.points) && w.points.length > 0)
            : [];

        // BUG REAL reportado en vivo con captura: con AMBOS extremos
        // del cable en el grupo (ej. los dos componentes seleccionados
        // juntos) trasladar TODO por el mismo delta es correcto -- pero
        // con UN SOLO extremo en el grupo (el caso más común: un
        // sensor cableado a una ESP32 fija), mover TODOS los codos por
        // el delta completo empuja incluso los codos que están pegados
        // al extremo que NO se movió, y el tramo final queda con un
        // quiebre feo ("como si se empujara el cable") en vez de seguir
        // limpio hasta el pin fijo.
        //
        // Investigado en vivo (agente aparte) cómo lo resuelven Wokwi/
        // Tinkercad/Fritzing -- ninguno hace ruteo automático "de
        // verdad" (pathfinding/esquivar otros componentes): Fritzing
        // directamente deja los bendpoints clavados donde estaban, el
        // usuario los re-arregla a mano. La diferencia real está en
        // CUÁNDO tirar esos codos viejos: un cable que el usuario nunca
        // tocó a mano (ver wire.autoRouted, WireManager.addWire()) no
        // tiene ninguna razón para conservar una forma vieja que ya no
        // tiene sentido con la posición nueva -- en vez de trasladar
        // esos codos (aunque sea con peso), se tiran del todo acá y
        // Utils.buildOrthogonalPoints() arma un trazado limpio de pin a
        // pin de vuelta en el próximo renderAll() (el mismo camino que
        // ya usa cualquier cable recién dibujado sin codos). Un cable
        // que el usuario SÍ reacomodó a mano (ver WireManager.
        // onWireLayerDown(), el tirador del tramo pone
        // autoRouted=false) nunca se toca así -- sigue con el peso por
        // codo de siempre, para no pisar una forma elegida a propósito.
        //
        // Con los DOS extremos en el grupo, la geometría relativa entre
        // los dos pines NO cambia (se mueven juntos) -- ahí da igual si
        // es auto-ruteado o no, el peso sigue siendo 1 en todos los
        // codos como siempre: tirar la forma en ESE caso sería peor
        // (no hace falta, nada "dejó de tener sentido").
        const wireSnapshots = wires.map(w => {
            const fromMoved = memberIds.has(w.from.componentId);
            const toMoved   = memberIds.has(w.to.componentId);
            const bothMoved = fromMoved && toMoved;
            const resetToClean = !bothMoved && w.autoRouted !== false;
            const n = w.points.length;
            const weights = resetToClean ? null : w.points.map((_, i) => {
                if (bothMoved) return 1;
                if (fromMoved) return 1 - (i + 1) / (n + 1);   // codo[0] (cerca de "from", que se mueve) -> casi 1
                if (toMoved)   return (i + 1) / (n + 1);       // codo[n-1] (cerca de "to", que se mueve) -> casi 1
                return 1; // no debería pasar (wires ya exige que alguno esté en el grupo), red de seguridad
            });
            return {
                wire: w,
                startPoints: w.points.map(p => ({ x: p.x, y: p.y })),
                resetToClean,
                weights,
            };
        });

        this.dragging = {
            anchor: component,
            pointerId: e.pointerId,
            offsetX: point.x - component.x,
            offsetY: point.y - component.y,
            anchorStartX: component.x,
            anchorStartY: component.y,
            members,
            wireSnapshots,
        };

        // Capturamos el puntero: así, aunque el mouse se mueva muy
        // rápido y "se salga" del dibujo del componente, seguimos
        // recibiendo sus eventos hasta que se suelte el click.
        try {
            group.setPointerCapture(e.pointerId);
        } catch (err) {
            // Algunos navegadores/casos no lo permiten; no es crítico.
        }

        group.classList.add("dragging");

        this.simulator.canvas.style.cursor = "grabbing";

    }

    //------------------------------------------------------
    // Actualizar posición mientras se arrastra
    //------------------------------------------------------

    updateDrag(e) {

        if (!this.dragging) return;

        const point = Utils.getCanvasPoint(this.simulator.componentLayer, e.clientX, e.clientY);

        // Usar el mismo tamaño de cuadrícula que el selector del toolbar
        // (antes quedaba fijo en 20px sin importar lo que el usuario
        // eligiera ahí, a diferencia de los cables que sí lo respetaban).
        // gridSize === 0 -> "Sin ajuste": movimiento libre, sin snap.
        const gridSize    = this.simulator.gridSize || 20;
        const snapEnabled = !!this.simulator.gridSize;

        // El snap se calcula SOLO sobre el "ancla" (el componente bajo
        // el cursor) -- el resto del grupo se mueve por el MISMO delta
        // (newAnchor - anchorStart), no cada uno snapeado por separado.
        // Snapear cada uno individualmente los desalinearía entre sí
        // apenas alguno cayera cerca de un borde de cuadrícula distinto.
        const newAnchorX = Utils.snapToGrid(point.x - this.dragging.offsetX, gridSize, snapEnabled);
        const newAnchorY = Utils.snapToGrid(point.y - this.dragging.offsetY, gridSize, snapEnabled);

        const dx = newAnchorX - this.dragging.anchorStartX;
        const dy = newAnchorY - this.dragging.anchorStartY;

        this.dragging.members.forEach(m => {
            m.component.setPosition(m.startX + dx, m.startY + dy);
            this.simulator.eventBus.emit("component:moved", m.component);
        });

        // Codos de los cables internos al grupo: mismo delta que el
        // grupo, partiendo siempre del snapshot tomado en startDrag
        // (no acumular sobre el valor ya movido, para no arrastrar
        // error de redondeo del snap en cada pointermove). Los
        // "resetToClean" (ver el comentario grande en startDrag) ni
        // siquiera entran acá con codos -- quedan en [] y
        // Utils.buildOrthogonalPoints() arma la forma limpia sola en
        // el renderAll() de abajo, como un cable recién dibujado.
        this.dragging.wireSnapshots.forEach(ws => {
            if (ws.resetToClean) {
                if (ws.wire.points.length > 0) ws.wire.points = [];
                return;
            }
            ws.wire.points.forEach((p, i) => {
                const w = ws.weights[i];
                p.x = ws.startPoints[i].x + dx * w;
                p.y = ws.startPoints[i].y + dy * w;
            });
        });

        if (this.simulator.wireManager && this.dragging.wireSnapshots.length > 0) {
            this.simulator.wireManager.renderAll();
        }

        // Si el/los componente(s) arrastrados están seleccionados,
        // el marco de selección debe moverse con ellos.
        if (this.simulator.selectionManager) {
            this.simulator.selectionManager.renderHighlight();
        }

    }

    //------------------------------------------------------
    // Terminar arrastre
    //------------------------------------------------------

    endDrag(e) {

        if (!this.dragging) return;

        const { anchor, members, wireSnapshots } = this.dragging;

        if (anchor.element) {

            anchor.element.classList.remove("dragging");

            try {
                anchor.element.releasePointerCapture(this.dragging.pointerId);
            } catch (err) {
                // Ya se habrá liberado sola en la mayoría de los casos.
            }

        }

        this.simulator.canvas.style.cursor = "default";

        this.simulator.eventBus.emit("component:dragend", anchor);

        // Snapshot de posiciones final -- un solo undo/redo deshace o
        // rehace el movimiento de TODO el grupo junto, no uno por uno.
        const moves = members
            .filter(m => m.startX !== m.component.x || m.startY !== m.component.y)
            .map(m => ({ component: m.component, startX: m.startX, startY: m.startY, endX: m.component.x, endY: m.component.y }));

        // Mismo criterio que "moves": solo entra al historial si el
        // cable realmente se movió (el grupo pudo haberse soltado sin
        // arrastre real, o el cable pudo no tener codos que mover).
        // OJO -- el chequeo de longitud es a propósito: un cable
        // "resetToClean" (ver startDrag/updateDrag) puede pasar de N
        // codos a 0, y ".some()" sobre un array VACÍO siempre da falso
        // sin importar qué compare, así que sin esto ese caso nunca
        // entraba al historial -- deshacer el movimiento del
        // componente dejaba el cable con los codos tirados en vez de
        // devolverle también su forma vieja.
        const wireMoves = wireSnapshots
            .filter(ws =>
                ws.wire.points.length !== ws.startPoints.length ||
                ws.wire.points.some((p, i) => p.x !== ws.startPoints[i].x || p.y !== ws.startPoints[i].y))
            .map(ws => ({
                wire: ws.wire,
                startPoints: ws.startPoints,
                endPoints: ws.wire.points.map(p => ({ x: p.x, y: p.y })),
            }));

        if (moves.length > 0 || wireMoves.length > 0) {

            const wireManager = this.simulator.wireManager;

            this.simulator.history.push({
                undo: () => {
                    moves.forEach(m => {
                        m.component.setPosition(m.startX, m.startY);
                        this.simulator.eventBus.emit("component:moved", m.component);
                    });
                    // Lista completa, no punto por punto: si mientras tanto
                    // el cable cambió de cantidad de codos, el recorrido
                    // por índice fallaba (startPoints[i] undefined) y
                    // el deshacer se cortaba a medias.
                    wireMoves.forEach(wm => { wm.wire.points = WireManager.clonePoints(wm.startPoints); });
                    if (wireManager && wireMoves.length > 0) wireManager.renderAll();
                    this.simulator.selectionManager.renderHighlight();
                },
                redo: () => {
                    moves.forEach(m => {
                        m.component.setPosition(m.endX, m.endY);
                        this.simulator.eventBus.emit("component:moved", m.component);
                    });
                    wireMoves.forEach(wm => { wm.wire.points = WireManager.clonePoints(wm.endPoints); });
                    if (wireManager && wireMoves.length > 0) wireManager.renderAll();
                    this.simulator.selectionManager.renderHighlight();
                }
            });

        }

        this.dragging = null;

    }

}