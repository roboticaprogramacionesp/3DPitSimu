/*
==========================================================
 PitSimulator — ReplWindowManager.js
 Dueño de las ventanas REPL flotantes (una por ESP32) -- ver Fase 2.5
 del plan ESP-NOW/multi-ESP32. Cada ventana es un ReplPanel más,
 construido con { fixedEsp32Id }, que nunca toca simulator.qemuBridge
 (a diferencia del panel acoplado de siempre) -- puede convivir con
 él y con otras ventanas sin pisarse (ver ReplPanel.get bridge()).
==========================================================
*/

class ReplWindowManager {

    // Separación entre ventanas nuevas para que no se apilen EXACTO
    // una sobre otra al abrir varias seguidas.
    static STAGGER_PX = 32;
    static INITIAL_LEFT = 420;
    static INITIAL_TOP  = 80;

    constructor(simulator) {

        this.simulator = simulator;
        this.windows = new Map(); // esp32Id -> ReplPanel (modo flotante)

        // Si se borra del lienzo el ESP32 que una ventana flotante
        // está mostrando, esa ventana ya no tiene sentido -- mismo
        // criterio que BlePanel.js usa para su propia lista de
        // dispositivos conectados.
        this.simulator.eventBus.on("component:removed", ({ componentId }) => {
            if (this.windows.has(componentId)) this.close(componentId);
        });

    }

    open(esp32Id) {

        const existing = this.windows.get(esp32Id);
        if (existing) {
            // Ya está abierta -- traerla al frente en vez de abrir una
            // segunda (z-index compartido entre todas las ventanas
            // flotantes, ver repl-window.css; subir el z-index de ESTA
            // alcanza para que quede por encima de las demás).
            existing.panel.style.zIndex = String(ReplWindowManager._nextZIndex());
            return existing;
        }

        const panel = new ReplPanel(this.simulator, { fixedEsp32Id: esp32Id, windowManager: this });

        // Posición inicial escalonada -- la primera ventana cae en el
        // mismo punto de siempre, cada una siguiente un poco más abajo
        // y a la derecha, para que abrir 2-3 de una no las deje
        // exactamente superpuestas.
        const offset = this.windows.size * ReplWindowManager.STAGGER_PX;
        panel.panel.style.left = `${ReplWindowManager.INITIAL_LEFT + offset}px`;
        panel.panel.style.top  = `${ReplWindowManager.INITIAL_TOP  + offset}px`;
        panel.panel.style.zIndex = String(ReplWindowManager._nextZIndex());

        this.windows.set(esp32Id, panel);

        return panel;

    }

    close(esp32Id) {

        const panel = this.windows.get(esp32Id);
        if (!panel) return;

        panel.destroy();
        this.windows.delete(esp32Id);

    }

    // z-index creciente compartido entre todas las ventanas flotantes
    // de esta clase -- "traer al frente" simplemente le da a la
    // ventana elegida un número más alto que cualquier otra ya abierta.
    static _zCounter = 230; // arriba de #blePanel (220), ver repl-window.css
    static _nextZIndex() {
        return ++ReplWindowManager._zCounter;
    }

}
