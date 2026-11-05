/*
==========================================================
 PitSimulator
 Archivo: HistoryManager.js
 Undo / Redo genérico basado en pila de comandos.

 Cualquier módulo que haga un cambio "deshacible" empuja un
 comando con dos funciones: undo() y redo().

 Ejemplo:
   this.simulator.history.push({
       undo: () => component.setPosition(oldX, oldY),
       redo: () => component.setPosition(newX, newY)
   });
==========================================================
*/

class HistoryManager {

    constructor(simulator) {

        this.simulator = simulator;

        this.undoStack = [];
        this.redoStack = [];

        this.limit = 100;

        this.bindKeys();

    }

    //------------------------------------------------------
    // Registrar un comando nuevo (limpia la pila de redo)
    //------------------------------------------------------

    push(command) {

        this.undoStack.push(command);

        if (this.undoStack.length > this.limit) {
            this.undoStack.shift();
        }

        this.redoStack = [];

        this.simulator.eventBus.emit("history:changed", { action: "push" });

    }

    //------------------------------------------------------
    // Deshacer / rehacer
    //------------------------------------------------------

    // Mientras la simulación corre el circuito está bloqueado (no se
    // pueden mover ni borrar cables/componentes): deshacer tampoco debe
    // poder cambiarlo por detrás, o la simulación queda con cables que
    // ya no existen.
    _blocked() {
        return !!this.simulator.isRunning;
    }

    // Ejecutar un paso sin que un error deje el historial a medias:
    // antes, si un undo() fallaba, el paso ya se había sacado de la
    // pila y no volvía a ninguna -- desde ahí Ctrl+Z/Ctrl+Y quedaban
    // desfasados del dibujo.
    _run(fn) {
        try {
            const r = fn();
            if (r && typeof r.then === "function") {
                r.catch(err => console.error("[Historial]", err))
                 .finally(() => this._afterStep());
            }
            return true;
        } catch (err) {
            console.error("[Historial]", err);
            return false;
        } finally {
            this._afterStep();
        }
    }

    _afterStep() {
        const wm = this.simulator.wireManager;
        if (!wm) return;
        wm.sanitizeSelection?.();
        wm.renderAll?.();
    }

    undo() {

        if (this._blocked()) return;

        const command = this.undoStack.pop();
        if (!command) return;

        if (this._run(() => command.undo())) this.redoStack.push(command);
        else this.undoStack.push(command);

        // Antes esto NO emitía nada, y ProjectManager solo escuchaba el
        // "push()" de arriba (vía un parche sobre este mismo método) --
        // resultado: Ctrl+Z cambiaba el canvas de verdad pero el
        // proyecto nunca se marcaba "sucio" para el auto-guardado. Si
        // el usuario cerraba el navegador antes del guardado periódico
        // de 30s (ver ProjectManager.startAutoSave), el Undo se perdía
        // al recargar la página.
        this.simulator.eventBus.emit("history:changed", { action: "undo" });

    }

    redo() {

        if (this._blocked()) return;

        const command = this.redoStack.pop();
        if (!command) return;

        if (this._run(() => command.redo())) this.undoStack.push(command);
        else this.redoStack.push(command);

        // Mismo motivo que en undo() de arriba.
        this.simulator.eventBus.emit("history:changed", { action: "redo" });

    }

    //------------------------------------------------------
    // Atajos de teclado: Ctrl+Z (deshacer), Ctrl+Y / Ctrl+Shift+Z (rehacer)
    //------------------------------------------------------

    bindKeys() {

        window.addEventListener("keydown", (e) => {

            const isTyping = e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA";
            if (isTyping) return;

            if (!e.ctrlKey && !e.metaKey) return;

            const key = e.key.toLowerCase();

            if (key === "z" && !e.shiftKey) {
                e.preventDefault();
                this.undo();
                return;
            }

            if (key === "y" || (key === "z" && e.shiftKey)) {
                e.preventDefault();
                this.redo();
                return;
            }

        });

    }

}