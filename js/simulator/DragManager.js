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

        // Cables "internos" al grupo: si AMBOS extremos de un cable son
        // componentes que se están arrastrando juntos, sus codos
        // manuales (wire.points, coordenadas ABSOLUTAS -- ver
        // WireManager.renderAll) deben moverse con el mismo delta que
        // el grupo. Si no se hacen, el cable se "estira" raro: sus
        // puntas siguen al pin (auto, vía component:moved) pero los
        // codos intermedios quedan clavados en su posición vieja.
        const memberIds = new Set(groupIds);
        const wireManager = this.simulator.wireManager;
        const wires = wireManager
            ? wireManager.wires.filter(w =>
                memberIds.has(w.from.componentId) && memberIds.has(w.to.componentId) &&
                Array.isArray(w.points) && w.points.length > 0)
            : [];

        const wireSnapshots = wires.map(w => ({
            wire: w,
            startPoints: w.points.map(p => ({ x: p.x, y: p.y })),
        }));

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
        // error de redondeo del snap en cada pointermove).
        this.dragging.wireSnapshots.forEach(ws => {
            ws.wire.points.forEach((p, i) => {
                p.x = ws.startPoints[i].x + dx;
                p.y = ws.startPoints[i].y + dy;
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
        const wireMoves = wireSnapshots
            .filter(ws => ws.wire.points.some((p, i) => p.x !== ws.startPoints[i].x || p.y !== ws.startPoints[i].y))
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
                    wireMoves.forEach(wm => {
                        wm.wire.points.forEach((p, i) => {
                            p.x = wm.startPoints[i].x;
                            p.y = wm.startPoints[i].y;
                        });
                    });
                    if (wireManager && wireMoves.length > 0) wireManager.renderAll();
                    this.simulator.selectionManager.renderHighlight();
                },
                redo: () => {
                    moves.forEach(m => {
                        m.component.setPosition(m.endX, m.endY);
                        this.simulator.eventBus.emit("component:moved", m.component);
                    });
                    wireMoves.forEach(wm => {
                        wm.wire.points.forEach((p, i) => {
                            p.x = wm.endPoints[i].x;
                            p.y = wm.endPoints[i].y;
                        });
                    });
                    if (wireManager && wireMoves.length > 0) wireManager.renderAll();
                    this.simulator.selectionManager.renderHighlight();
                }
            });

        }

        this.dragging = null;

    }

}