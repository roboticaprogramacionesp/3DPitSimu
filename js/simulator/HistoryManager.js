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

    undo() {

        const command = this.undoStack.pop();
        if (!command) return;

        command.undo();
        this.redoStack.push(command);

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

        const command = this.redoStack.pop();
        if (!command) return;

        command.redo();
        this.undoStack.push(command);

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