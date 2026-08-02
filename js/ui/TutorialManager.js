/*
==========================================================
 PitSimulator
 Archivo: TutorialManager.js
 Selector de tutoriales (botón 🎓 junto al logo) + modal
 flotante que va guiando paso a paso, resaltando en el
 lienzo/toolbox/toolbar el elemento del que habla cada paso.

 Cada paso puede declarar isDone(tm) -- una condición que se
 revisa sola (polling liviano, cada 500ms mientras el modal
 está abierto) para detectar que el usuario YA hizo lo que
 pedía el paso y avanzar solo, mostrando un check breve antes
 de pasar al siguiente. Los botones Anterior/Siguiente siguen
 funcionando igual para moverse a mano en cualquier momento.
==========================================================
*/

class TutorialManager {

    constructor(simulator, replPanel) {

        this.simulator = simulator;
        this.replPanel = replPanel;

        this.tutorials = TutorialManager.TUTORIALS;

        this.activeTutorial = null;
        this.stepIndex = -1;

        // Elementos DOM que tienen la clase .tutorial-highlight puesta
        // AHORA MISMO -- se limpia por completo en cada cambio de paso
        // (ver _clearHighlights), así nunca queda un resaltado viejo
        // pegado si el elemento en cuestión se borró del canvas.
        this._highlighted = [];

        // Solo refresca el ✓ del paso actual (ver _startPolling) --
        // el tutorial nunca navega solo, así que no hace falta ningún
        // timer/guardia de "avance pendiente" acá.
        this._pollTimer = null;

        // Minimizado (ver _toggleMinimize) -- colapsa todo menos la
        // cabecera, para dejar ver el lienzo sin cerrar el tutorial.
        this._minimized = false;

        this.buildDOM();
        this.bindEvents();

    }

    // ====================================================
    // Definición de tutoriales -- agregar uno nuevo es sumar una
    // entrada acá, con sus pasos; no hace falta tocar el resto de
    // esta clase (ver highlightToolboxAndCanvas/highlightPins/
    // highlightElements/hasComponent/hasWireBetween más abajo, son
    // los "bloques" reutilizables para armar steps nuevos).
    // ====================================================

    static TUTORIALS = [
        {
            id: "recorrido_interfaz",
            title: "Recorrido por la interfaz",
            icon: "🧭",
            category: "🧭 Conocé la interfaz",
            steps: [
                {
                    title: "Paso 1 — Panel de componentes",
                    text: "Aquí están todos los componentes disponibles, agrupados por categoría. Haz clic en cualquiera para ver sus propiedades y pines antes de usarlo, o arrástralo directo hasta el lienzo para empezar a armar tu circuito.",
                    highlight: (tm) => tm.highlightElements(["#toolbox"]),
                    isDone: () => true,
                },
                {
                    title: "Paso 2 — Nuevo, guardar, abrir, validar y recargar",
                    text: "Desde aquí creas un proyecto nuevo (en blanco), abres o guardas el que tienes abierto, validas que el circuito esté bien cableado antes de simular, y puedes recargar el simulador para reiniciarlo sin salir del navegador.",
                    highlight: (tm) => tm.highlightElements([
                        "#pdNewProject", "#pdSaveProject", "#pdSaveAsProject", "#pdOpenProject", "#pdValidate", "#pdReload",
                    ]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: () => true,
                },
                {
                    title: "Paso 3 — Tutoriales",
                    text: "Este mismo botón abre la lista de tutoriales -- incluido este recorrido -- en cualquier momento.",
                    highlight: (tm) => tm.highlightElements(["#btnTutorial"]),
                    isDone: () => true,
                },
                {
                    title: "Paso 4 — Nombre del proyecto",
                    text: "Aquí se muestra (y se puede editar) el nombre de tu proyecto -- el que se usa al Guardar.",
                    highlight: (tm) => tm.highlightElements(["#currentFileLabel"]),
                    isDone: () => true,
                },
                {
                    title: "Paso 5 — Editor de bloques",
                    text: "Arma tu programa arrastrando bloques en vez de escribir Python a mano -- útil si recién estás empezando. Cuando termines, un botón manda el código generado directo a la pestaña Editor de abajo.",
                    highlight: (tm) => tm.highlightElements(["#btnBlockly"]),
                    isDone: () => true,
                },
                {
                    title: "Paso 6 — Reporte de la práctica",
                    text: "Genera un reporte imprimible de la práctica: título, qué van a aprender, lista de componentes (con materiales adicionales y costo si hace falta), captura del circuito y el código.",
                    highlight: (tm) => tm.highlightElements(["#btnGenerateReport"]),
                    isDone: () => true,
                },
                {
                    title: "Paso 7 — Simular",
                    text: "Inicia la simulación y corre el firmware sobre el circuito que armaste -- necesitas una ESP32 en el lienzo para poder simular.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: () => true,
                },
                {
                    title: "Paso 8 — Captura, deshacer, rehacer y notas",
                    text: "La cámara guarda una imagen del circuito completo. Las flechas deshacen/rehacen cualquier cambio (también con Ctrl+Z / Ctrl+Y). La etiqueta agrega una nota de color al lienzo -- azul para info, verde para un tip, roja para algo importante que no hay que pasar por alto, y amarilla para una advertencia.",
                    highlight: (tm) => tm.highlightElements(["#btnScreenshot", "#btnUndo", "#btnRedo", "#btnAddAnnotation"]),
                    isDone: () => true,
                },
                {
                    title: "Paso 9 — Panel MicroPython",
                    text: "Aquí abajo está la consola REPL (para escribir comandos sueltos y ver la salida en vivo) y la pestaña Editor, donde escribes o cargas el código que se ejecuta en la ESP32.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                    },
                    isDone: () => true,
                },
                {
                    title: "Paso 10 — Lienzo de trabajo",
                    text: "Y aquí es donde armas todo: sueltas los componentes, los conectas con cables, y ves el circuito cobrar vida al simular. ¡Ya puedes empezar!",
                    highlight: (tm) => tm.highlightElements(["#workspace"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && tm.replPanel.open) tm.replPanel.toggle();
                    },
                    isDone: () => true,
                    isLast: true,
                },
            ],
        },
        {
            id: "led_basico",
            title: "LED básico con ESP32",
            icon: "💡",
            category: "💡 LEDs · Salidas digitales",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes (izquierda) hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma un LED",
                    text: "Arrastra el LED desde el panel de componentes hasta el lienzo, cerca de la ESP32.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("led"),
                    isDone: (tm) => tm.hasComponent("led"),
                },
                {
                    title: "Paso 3 — Conecta el GND al cátodo",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el cátodo (–) del LED, la pata más corta.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "led", match: (p) => p.id === "catodo" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "led" && pin.id === "catodo",
                    ),
                },
                {
                    title: "Paso 4 — Conecta un pin al ánodo",
                    text: "Elige cualquier pin GPIO libre de la ESP32 y conéctalo al ánodo (+) del LED, la pata más larga.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "led", match: (p) => p.id === "anodo" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "led" && pin.id === "anodo",
                    ),
                },
                {
                    title: "Paso 5 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 6 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    // A diferencia de los pasos anteriores (que solo resaltan
                    // algo que el usuario tiene que hacer), este paso hace la
                    // acción por él: "levantar" el panel MicroPython -- ver
                    // onEnter más abajo, no solo lo señala con el glow.
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    // OJO: NO puede ser "el panel/la pestaña Editor están
                    // abiertos" -- onEnter de acá arriba ya deja eso true
                    // en el mismo instante en que se entra al paso, así que
                    // con esa condición el check ✓ aparecía y desaparecía
                    // el modal casi al toque, sin darle tiempo real al
                    // usuario a leer la instrucción. En cambio, se espera
                    // a que realmente haya código propio en el editor.
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "led_resistencia",
            title: "LED con resistencia (protegido)",
            icon: "Ω",
            category: "💡 LEDs · Salidas digitales",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes (izquierda) hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma un LED",
                    text: "Arrastra el LED desde el panel de componentes hasta el lienzo, cerca de la ESP32.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("led"),
                    isDone: (tm) => tm.hasComponent("led"),
                },
                {
                    title: "Paso 3 — Toma una resistencia",
                    text: "Arrastra la Resistencia (categoría Componentes básicos) hasta el lienzo. Sin ella, un GPIO conectado directo al LED deja pasar más corriente de la que el LED soporta -- en hardware real esto lo daña o lo quema. Déjala en 220 Ω, el valor más común para un LED con un GPIO de 3.3V.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("resistencia"),
                    isDone: (tm) => tm.hasComponent("resistencia"),
                },
                {
                    title: "Paso 4 — Conecta el GND al cátodo",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el cátodo (–) del LED, la pata más corta.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "led", match: (p) => p.id === "catodo" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "led" && pin.id === "catodo",
                    ),
                },
                {
                    title: "Paso 5 — Conecta un GPIO a la resistencia",
                    text: "Elige cualquier pin GPIO libre de la ESP32 y conéctalo a cualquiera de los dos terminales de la resistencia -- no importa cuál, no tiene polaridad.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "resistencia", match: () => true },
                    ]),
                    isDone: (tm) => tm.hasWireBetweenComponents(
                        (comp, pin) => comp.type === "esp32_wroom" && pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp) => comp.type === "resistencia",
                    ),
                },
                {
                    title: "Paso 6 — Conecta la resistencia al ánodo",
                    text: "Ahora conecta el otro terminal de la resistencia (el que quedó libre) al ánodo (+) del LED, la pata más larga.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "resistencia", match: () => true },
                        { type: "led", match: (p) => p.id === "anodo" },
                    ]),
                    isDone: (tm) => tm.hasWireBetweenComponents(
                        (comp) => comp.type === "resistencia",
                        (comp, pin) => comp.type === "led" && pin.id === "anodo",
                    ),
                },
                {
                    title: "Paso 7 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 8 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "semaforo",
            title: "Semáforo con ESP32",
            icon: "🚦",
            category: "💡 LEDs · Salidas digitales",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma el semáforo",
                    text: "Arrastra el Semáforo (categoría LEDs) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("semaforo"),
                    isDone: (tm) => tm.hasComponent("semaforo"),
                },
                {
                    title: "Paso 3 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del semáforo.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "semaforo", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "semaforo" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 4 — Conecta R, Y y G",
                    text: "Conecta los pines R (rojo), Y (amarillo) y G (verde) del semáforo cada uno a un pin GPIO distinto de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "semaforo", match: (p) => ["r", "y", "g"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["r", "y", "g"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "semaforo" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 5 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 6 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "neopixel_ring",
            title: "Anillo NeoPixel con ESP32",
            icon: "🌈",
            category: "💡 LEDs · Salidas digitales",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma el anillo NeoPixel",
                    text: "Arrastra el Anillo de NeoPixel desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("neopixel_ring"),
                    isDone: (tm) => tm.hasComponent("neopixel_ring"),
                },
                {
                    title: "Paso 3 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del anillo.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "neopixel_ring", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "neopixel_ring" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 4 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del anillo.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "neopixel_ring", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "neopixel_ring" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 5 — Conecta el dato (DIN)",
                    text: "Elige un pin GPIO libre de la ESP32 y conéctalo al DIN (dato) del anillo.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "neopixel_ring", match: (p) => p.id === "din" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "neopixel_ring" && pin.id === "din",
                    ),
                },
                {
                    title: "Paso 6 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 7 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "boton",
            title: "Botón (KY-004) con ESP32",
            icon: "🔘",
            category: "🔧 Entradas · Actuadores",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma el botón",
                    text: "Arrastra el botón KY-004 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ky_004"),
                    isDone: (tm) => tm.hasComponent("ky_004"),
                },
                {
                    title: "Paso 3 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del botón.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "ky_004", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "ky_004" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 4 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del botón.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "ky_004", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "ky_004" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la señal",
                    text: "Elige un pin GPIO libre de la ESP32 y conéctalo a la S (señal) del botón.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "ky_004", match: (p) => p.id === "senal" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "ky_004" && pin.id === "senal",
                    ),
                },
                {
                    title: "Paso 6 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 7 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "tcrt5000",
            title: "TCRT5000 — Infrarrojo (línea/obstáculo)",
            icon: "⬛",
            category: "🔧 Entradas · Actuadores",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma el TCRT5000",
                    text: "Arrastra el sensor infrarrojo TCRT5000 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("tcrt5000"),
                    isDone: (tm) => tm.hasComponent("tcrt5000"),
                },
                {
                    title: "Paso 3 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del sensor.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "tcrt5000", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "tcrt5000" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 4 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al Vcc del sensor.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "tcrt5000", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "tcrt5000" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la salida Do",
                    text: "Elige un pin GPIO libre de la ESP32 y conéctalo al pin Do (salida digital) del sensor -- se activa en BAJO al detectar la línea u obstáculo.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "tcrt5000", match: (p) => p.id === "do" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "tcrt5000" && pin.id === "do",
                    ),
                },
                {
                    title: "Paso 6 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 7 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "fc_51",
            title: "FC-51 — Infrarrojo de obstáculos",
            icon: "🚧",
            category: "🔧 Entradas · Actuadores",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma el FC-51",
                    text: "Arrastra el sensor infrarrojo de obstáculos FC-51 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("fc-51"),
                    isDone: (tm) => tm.hasComponent("fc-51"),
                },
                {
                    title: "Paso 3 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del sensor.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "fc-51", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "fc-51" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 4 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del sensor.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "fc-51", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "fc-51" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la salida OUT",
                    text: "Elige un pin GPIO libre de la ESP32 y conéctalo al pin OUT del sensor -- se activa en BAJO al detectar un objeto.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "fc-51", match: (p) => p.id === "out" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "fc-51" && pin.id === "out",
                    ),
                },
                {
                    title: "Paso 6 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 7 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "buzzer",
            title: "Buzzer con ESP32",
            icon: "🔊",
            category: "🔧 Entradas · Actuadores",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma el buzzer",
                    text: "Arrastra el Buzzer desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("buzzer"),
                    isDone: (tm) => tm.hasComponent("buzzer"),
                },
                {
                    title: "Paso 3 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el pin (-) del buzzer.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "buzzer", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "buzzer" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 4 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al pin (+) del buzzer.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "buzzer", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "buzzer" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la señal",
                    text: "Elige un pin GPIO libre de la ESP32 y conéctalo al pin S (señal) del buzzer.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "buzzer", match: (p) => p.id === "s" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "buzzer" && pin.id === "s",
                    ),
                },
                {
                    title: "Paso 6 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 7 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "servo",
            title: "Servo motor con ESP32",
            icon: "⚙️",
            category: "🔧 Entradas · Actuadores",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma el servo",
                    text: "Arrastra el Servo SG90 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("sg90"),
                    isDone: (tm) => tm.hasComponent("sg90"),
                },
                {
                    title: "Paso 3 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el cable café/negro (GND) del servo.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "sg90", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "sg90" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 4 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al cable rojo (VCC) del servo.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "sg90", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "sg90" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la señal",
                    text: "Elige un pin GPIO libre de la ESP32 y conéctalo al cable naranja/amarillo (SIGNAL) del servo.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "sg90", match: (p) => p.id === "signal" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "sg90" && pin.id === "signal",
                    ),
                },
                {
                    title: "Paso 6 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 7 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "motor_reductor",
            title: "Motor reductor (pilas + interruptor + puente H)",
            icon: "🔧",
            category: "🔧 Entradas · Actuadores",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma la batería 18650",
                    text: "Arrastra el portapilas de baterías 18650 (alimentación del motor) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("battery_18650"),
                    isDone: (tm) => tm.hasComponent("battery_18650"),
                },
                {
                    title: "Paso 3 — Toma el interruptor",
                    text: "Arrastra el interruptor ON/OFF desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("switch"),
                    isDone: (tm) => tm.hasComponent("switch"),
                },
                {
                    title: "Paso 4 — Conecta la batería al interruptor",
                    text: "Conecta el + de la batería a una de las patas del interruptor -- el interruptor corta o deja pasar la corriente que va a mover el motor.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "battery_18650", match: (p) => p.id === "vcc" },
                        { type: "switch", match: () => true },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "power",
                        (comp) => comp.type === "switch",
                    ),
                },
                {
                    title: "Paso 5 — Toma el puente H (L298N)",
                    text: "Arrastra el módulo L298N (puente H) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("l298n"),
                    isDone: (tm) => tm.hasComponent("l298n"),
                },
                {
                    // Antes era un solo paso ("Conecta la alimentación
                    // del puente H") que pedía 3 cables distintos de
                    // una -- se separó en 3 pasos, uno por cable, más
                    // fácil de seguir para enseñar (aunque sean más
                    // pasos en total). También se agregó el resaltado
                    // de los pines del interruptor (antes solo
                    // resaltaba ESP32/L298N, no el interruptor en sí,
                    // aunque el texto SÍ mencionaba conectarlo).
                    title: "Paso 6 — Conecta el interruptor al puente H",
                    text: "Conecta la otra pata del interruptor (la que no usaste para la batería) al +12V del puente H.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "switch", match: () => true },
                        { type: "l298n", match: (p) => p.id === "power_12v" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        () => true,
                        (comp, pin) => comp.type === "l298n" && pin.id === "power_12v",
                    ),
                },
                {
                    title: "Paso 7 — Conecta la batería al GND del puente H",
                    text: "Conecta el – de la batería al GND del puente H.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "battery_18650", match: (p) => p.id === "gnd" },
                        { type: "l298n", match: (p) => p.id === "power_gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetweenComponents(
                        (comp, pin) => comp.type === "battery_18650" && pin.id === "gnd",
                        (comp, pin) => comp.type === "l298n" && pin.id === "power_gnd",
                    ),
                },
                {
                    title: "Paso 8 — Conecta el GND del puente H a la ESP32",
                    text: "Conecta ese mismo GND del puente H a un GND de la ESP32 -- necesario para que la ESP32 pueda controlarlo.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "l298n", match: (p) => p.id === "power_gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetweenComponents(
                        (comp, pin) => comp.type === "esp32_wroom" && pin.type === "ground",
                        (comp, pin) => comp.type === "l298n" && pin.id === "power_gnd",
                    ),
                },
                {
                    title: "Paso 9 — Conecta IN1 e IN2",
                    text: "Conecta IN1 e IN2 del puente H cada uno a un pin GPIO distinto de la ESP32 -- son los pines que usas desde tu código para controlar el sentido de giro (este puente H trae el jumper de ENA puesto, así que no hace falta cablearlo aparte).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "l298n", match: (p) => ["in1", "in2"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["in1", "in2"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "l298n" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 10 — Toma el motor",
                    text: "Arrastra el motor DC (reductora) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("motor"),
                    isDone: (tm) => tm.hasComponent("motor"),
                },
                {
                    title: "Paso 11 — Conecta el motor",
                    text: "Conecta el motor a OUT1 y OUT2 del puente H (salida del canal A).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "l298n", match: (p) => ["out1", "out2"].includes(p.id) },
                        { type: "motor", match: () => true },
                    ]),
                    isDone: (tm) => ["out1", "out2"].every((id) => tm.hasWireBetween(
                        () => true,
                        (comp, pin) => comp.type === "l298n" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 12 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 13 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "dht11",
            title: "DHT11 — Temperatura y humedad",
            icon: "💧",
            category: "🌡️ Temperatura · Humedad",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma el DHT11",
                    text: "Arrastra el sensor DHT11 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("dht11"),
                    isDone: (tm) => tm.hasComponent("dht11"),
                },
                {
                    title: "Paso 3 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del sensor.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "dht11", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "dht11" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 4 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del sensor.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "dht11", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "dht11" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 5 — Conecta el DATA",
                    text: "Elige un pin GPIO libre de la ESP32 y conéctalo al pin DATA del sensor.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "dht11", match: (p) => p.id === "signal" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "dht11" && pin.id === "signal",
                    ),
                },
                {
                    title: "Paso 6 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 7 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "ky_001",
            title: "Sensor de temperatura KY-001",
            icon: "🌡️",
            category: "🌡️ Temperatura · Humedad",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma el KY-001",
                    text: "Arrastra el sensor de temperatura KY-001 (DS18B20) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ky_001"),
                    isDone: (tm) => tm.hasComponent("ky_001"),
                },
                {
                    title: "Paso 3 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del sensor.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "ky_001", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "ky_001" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 4 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del sensor.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "ky_001", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "ky_001" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la señal",
                    text: "Elige un pin GPIO libre de la ESP32 y conéctalo a la S (señal, OneWire) del sensor.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "ky_001", match: (p) => p.id === "signal" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "ky_001" && pin.id === "signal",
                    ),
                },
                {
                    title: "Paso 6 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 7 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "adkey",
            title: "Teclado analógico ADKEY",
            icon: "🎛️",
            category: "🎚️ Sensores · Analógicos",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma el ADKEY",
                    text: "Arrastra el teclado analógico ADKEY (5 botones) desde el panel de componentes hasta el lienzo.",
                    // OJO: el tipo real es "adkey_real" -- "adkey" a
                    // secas existe en components/ pero está marcado
                    // "hidden": true en manifest.json (versión vieja,
                    // superada), así que nunca aparece en el toolbox.
                    // Apuntar a "adkey" acá buscaba una tarjeta que
                    // JAMÁS se renderiza -- el resaltado no hacía nada
                    // visible (bug real, reportado).
                    highlight: (tm) => tm.highlightToolboxAndCanvas("adkey_real"),
                    isDone: (tm) => tm.hasComponent("adkey_real"),
                },
                {
                    title: "Paso 3 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del ADKEY.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "adkey_real", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "adkey_real" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 4 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del ADKEY.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "adkey_real", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "adkey_real" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la salida analógica",
                    text: "El ADKEY manda un voltaje distinto por cada botón -- conecta su OUT a un pin ADC de la ESP32 (ej. GPIO32, GPIO33, GPIO25). VN/VP/GPIO34-39 son SOLO de entrada -- se pueden leer pero no sirven para las demás conexiones de este tutorial, así que no los sugerimos aquí tampoco.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.signal === "analog" && !p.inputOnly },
                        { type: "adkey_real", match: (p) => p.id === "out" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.signal === "analog" && !pin.inputOnly,
                        (comp, pin) => comp.type === "adkey_real" && pin.id === "out",
                    ),
                },
                {
                    title: "Paso 6 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 7 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "hcsr04",
            title: "Sensor ultrasónico HC-SR04",
            icon: "📡",
            category: "📡 Sensores",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma el HC-SR04",
                    text: "Arrastra el sensor ultrasónico HC-SR04 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("hcsr04"),
                    isDone: (tm) => tm.hasComponent("hcsr04"),
                },
                {
                    title: "Paso 3 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del sensor.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "hcsr04", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "hcsr04" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 4 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del sensor.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "hcsr04", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "hcsr04" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 5 — Conecta TRIG y ECHO",
                    text: "Conecta TRIG y ECHO del sensor cada uno a un pin GPIO distinto de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "hcsr04", match: (p) => ["trig", "echo"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["trig", "echo"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "hcsr04" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 6 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 7 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "oled",
            title: "Display OLED 128x64",
            icon: "🖥️",
            category: "🖥️ Pantallas y Módulos",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma el OLED",
                    text: "Arrastra el display OLED 128x64 I2C desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("oled"),
                    isDone: (tm) => tm.hasComponent("oled"),
                },
                {
                    title: "Paso 3 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del OLED.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "oled", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "oled" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 4 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VDD del OLED.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "oled", match: (p) => p.id === "vdd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "oled" && pin.id === "vdd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta SDA y SCK",
                    text: "Conecta SDA y SCK del OLED cada uno a un pin GPIO distinto de la ESP32 (los mismos que uses en tu código con I2C(sda=.., scl=..)).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "oled", match: (p) => ["sda", "sck"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["sda", "sck"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "oled" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 6 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 7 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "lcd_16x2_i2c",
            title: "LCD 16x2 I2C",
            icon: "📟",
            category: "🖥️ Pantallas y Módulos",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma el LCD 16x2 I2C",
                    text: "Arrastra el LCD 16x2 I2C desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("lcd_16x2_i2c"),
                    isDone: (tm) => tm.hasComponent("lcd_16x2_i2c"),
                },
                {
                    title: "Paso 3 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del LCD.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "lcd_16x2_i2c", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "lcd_16x2_i2c" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 4 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del LCD.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "lcd_16x2_i2c", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "lcd_16x2_i2c" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 5 — Conecta SDA y SCL",
                    text: "Conecta SDA y SCL del LCD cada uno a un pin GPIO distinto de la ESP32 (los mismos que uses en tu código con I2C(sda=.., scl=..)).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "lcd_16x2_i2c", match: (p) => ["sda", "scl"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["sda", "scl"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "lcd_16x2_i2c" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 6 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 7 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },
        {
            id: "lcd16x2",
            title: "LCD 16x2 (paralelo)",
            icon: "📺",
            category: "🖥️ Pantallas y Módulos",
            steps: [
                {
                    title: "Paso 1 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 2 — Toma el LCD 16x2",
                    text: "Arrastra el LCD 16x2 paralelo (HD44780) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("lcd16x2"),
                    isDone: (tm) => tm.hasComponent("lcd16x2"),
                },
                {
                    // Antes era un solo paso ("Conecta la alimentación")
                    // que pedía 5 cables distintos de una -- se separó
                    // en 5 pasos, uno por pin, más fácil de seguir para
                    // enseñar (aunque sean más pasos en total).
                    title: "Paso 3 — Conecta VSS (GND)",
                    text: "Conecta VSS del LCD a un GND de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "lcd16x2", match: (p) => p.id === "vss" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "lcd16x2" && pin.id === "vss",
                    ),
                },
                {
                    title: "Paso 4 — Conecta VDD (3V3)",
                    text: "Conecta VDD del LCD a un pin 3V3 de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "lcd16x2", match: (p) => p.id === "vdd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "lcd16x2" && pin.id === "vdd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta V0 (contraste)",
                    text: "Conecta V0 del LCD (ajuste de contraste) a un GND de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "lcd16x2", match: (p) => p.id === "v0" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "lcd16x2" && pin.id === "v0",
                    ),
                },
                {
                    title: "Paso 6 — Conecta A (luz de fondo)",
                    text: "Conecta A del LCD (ánodo de la luz de fondo) a un pin 3V3 de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "lcd16x2", match: (p) => p.id === "a" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "lcd16x2" && pin.id === "a",
                    ),
                },
                {
                    title: "Paso 7 — Conecta K",
                    text: "Conecta K del LCD (cátodo de la luz de fondo) a un GND de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "lcd16x2", match: (p) => p.id === "k" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "lcd16x2" && pin.id === "k",
                    ),
                },
                {
                    // Antes este paso pedía RS+RW+E+D0-D7 (8 pines de
                    // datos, modo 8 bits) de una sola vez -- eso no es
                    // como se cablea en la práctica: RW casi nunca hace
                    // falta (el código típico solo ESCRIBE al LCD,
                    // nunca lee su estado) así que se ata directo a
                    // GND en vez de a un GPIO, y la enorme mayoría del
                    // código real (ej. la librería lcd_api/CharLCD) usa
                    // modo de 4 bits -- solo D4-D7, D0-D3 quedan sin
                    // conectar. Se separó en 3 pasos más chicos,
                    // reflejando ese cableado real.
                    title: "Paso 8 — Conecta RW a GND",
                    text: "Conecta RW del LCD a un GND de la ESP32 -- el código típico solo ESCRIBE al LCD (nunca lee su estado), así que RW se deja fijo en modo escritura atándolo a GND en vez de a un GPIO.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "lcd16x2", match: (p) => p.id === "rw" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "lcd16x2" && pin.id === "rw",
                    ),
                },
                {
                    title: "Paso 9 — Conecta RS y E",
                    text: "Conecta RS y E del LCD, cada uno a su propio pin GPIO de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "lcd16x2", match: (p) => ["rs", "e"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["rs", "e"].every((id) => tm.hasWireBetween(
                        () => true,
                        (comp, pin) => comp.type === "lcd16x2" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 10 — Conecta D4-D7 (modo 4 bits)",
                    text: "Conecta D4, D5, D6 y D7 del LCD, cada uno a su propio pin GPIO de la ESP32 -- este es el modo de 4 bits, el que usa la enorme mayoría del código real (ej. la librería lcd_api/CharLCD). D0-D3 no hace falta conectarlos.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "lcd16x2", match: (p) => ["d4", "d5", "d6", "d7"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["d4", "d5", "d6", "d7"].every((id) => tm.hasWireBetween(
                        () => true,
                        (comp, pin) => comp.type === "lcd16x2" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 11 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 12 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir. Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
            ],
        },    ];

    // ====================================================
    // DOM: botón selector (dropdown) + modal flotante
    // ====================================================

    buildDOM() {

        this.trigger = document.getElementById("btnTutorial");
        this.menu    = document.getElementById("tutorialMenu");

        if (this.menu) {

            // Agrupados por categoría (mismo orden/nombres que el
            // <select id="tutorialSelect"> de referencia en Blocks/
            // AppBlock3) -- se apoya en que TUTORIALS ya viene
            // ordenado por categoría (ver el campo category de cada
            // tutorial), así que alcanza con detectar el cambio de
            // valor para saber cuándo insertar un encabezado nuevo.
            let lastCategory = null;

            this.tutorials.forEach((tutorial) => {

                if (tutorial.category && tutorial.category !== lastCategory) {
                    lastCategory = tutorial.category;
                    const label = document.createElement("div");
                    label.className = "tutorial-menu-category";
                    label.textContent = tutorial.category;
                    this.menu.appendChild(label);
                }

                const item = document.createElement("button");
                item.className = "tutorial-menu-item project-drawer-item";
                item.textContent = `${tutorial.icon} ${tutorial.title}`;
                item.addEventListener("click", () => {
                    this.menu.classList.add("hidden");
                    this.start(tutorial.id);
                });

                this.menu.appendChild(item);

            });

        }

        this.modal = document.createElement("div");
        this.modal.className = "tutorial-modal hidden";
        this.modal.innerHTML = `
            <div class="tutorial-modal-header">
                <span class="tutorial-modal-title"></span>
                <button class="tutorial-modal-minimize" title="Minimizar">−</button>
                <button class="tutorial-modal-close" title="Cerrar tutorial">✕</button>
            </div>
            <div class="tutorial-modal-collapsible">
                <div class="tutorial-font-size-row" title="Tamaño de letra de los pasos">
                    <span class="tutorial-font-size-label">Aa</span>
                    <div class="tutorial-font-size-group">
                        <button class="tutorial-font-btn" data-size="S">S</button>
                        <button class="tutorial-font-btn" data-size="M">M</button>
                        <button class="tutorial-font-btn" data-size="L">L</button>
                        <button class="tutorial-font-btn" data-size="XL">XL</button>
                    </div>
                </div>
                <div class="tutorial-modal-body">
                    <div class="tutorial-modal-progress"></div>
                    <div class="tutorial-modal-step-title"></div>
                    <div class="tutorial-modal-text"></div>
                    <div class="tutorial-modal-actions">
                        <button class="tutorial-modal-prev">← Anterior</button>
                        <button class="tutorial-modal-next">Siguiente →</button>
                    </div>
                </div>
                <div class="tutorial-modal-complete hidden">
                    <div class="tutorial-modal-complete-icon">🎉</div>
                    <h3 class="tutorial-modal-complete-title">¡Tutorial completado!</h3>
                    <p class="tutorial-modal-complete-text"></p>
                    <button class="tutorial-modal-restart">Repetir</button>
                </div>
            </div>
        `;

        (document.getElementById("workspace") || document.body).appendChild(this.modal);

        this._els = {
            header:      this.modal.querySelector(".tutorial-modal-header"),
            title:       this.modal.querySelector(".tutorial-modal-title"),
            minimize:    this.modal.querySelector(".tutorial-modal-minimize"),
            close:       this.modal.querySelector(".tutorial-modal-close"),
            collapsible: this.modal.querySelector(".tutorial-modal-collapsible"),
            body:        this.modal.querySelector(".tutorial-modal-body"),
            progress:    this.modal.querySelector(".tutorial-modal-progress"),
            stepTitle:   this.modal.querySelector(".tutorial-modal-step-title"),
            text:        this.modal.querySelector(".tutorial-modal-text"),
            prev:        this.modal.querySelector(".tutorial-modal-prev"),
            next:        this.modal.querySelector(".tutorial-modal-next"),
            complete:      this.modal.querySelector(".tutorial-modal-complete"),
            completeText:  this.modal.querySelector(".tutorial-modal-complete-text"),
            restart:       this.modal.querySelector(".tutorial-modal-restart"),
        };

        this._fontSizeBtns = Array.from(this.modal.querySelectorAll(".tutorial-font-btn"));

    }

    // ====================================================
    // Tamaño de letra de los pasos (S/M/L/XL) -- mismo control (y
    // mismas etiquetas) que ya tiene el panel MicroPython (ver
    // ReplPanel._applyFontSize), acá aplicado al propio modal en vez
    // de la terminal/editor. Aumenta también el ancho del modal en
    // L/XL para que el texto más grande no se apriete en las mismas
    // 300px de siempre. Persistido aparte del tamaño del panel
    // MicroPython -- son dos controles independientes.
    // ====================================================

    static MODAL_FONT_SIZES = ["S", "M", "L", "XL"];

    _applyModalFontSize(size) {

        const resolved = TutorialManager.MODAL_FONT_SIZES.includes(size) ? size : "M";

        TutorialManager.MODAL_FONT_SIZES.forEach((s) => {
            this.modal.classList.toggle(`tutorial-font-${s}`, s === resolved);
        });

        this._fontSizeBtns?.forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.size === resolved);
        });

        localStorage.setItem("pit_tutorial_font_size", resolved);

    }

    bindEvents() {

        this.trigger?.addEventListener("click", (e) => {
            e.stopPropagation();
            this.menu?.classList.toggle("hidden");
        });

        // Cerrar el dropdown al clickear afuera -- mismo criterio que
        // el deslizador de Proyecto (ver Toolbar.bindProjectDrawer).
        document.addEventListener("pointerdown", (e) => {
            if (!this.menu || this.menu.classList.contains("hidden")) return;
            if (this.menu.contains(e.target) || this.trigger?.contains(e.target)) return;
            this.menu.classList.add("hidden");
        });

        this._els.close.addEventListener("click", () => this.stop());
        this._els.prev.addEventListener("click", () => this.goTo(this.stepIndex - 1));
        this._els.next.addEventListener("click", () => {
            // En el último paso, "Siguiente" se convierte en "Finalizar".
            if (this.activeTutorial?.steps[this.stepIndex]?.isLast) {
                this._finish();
                return;
            }
            this.goTo(this.stepIndex + 1);
        });

        this._els.restart.addEventListener("click", () => {
            if (this.activeTutorial) this.start(this.activeTutorial.id);
        });

        this._els.minimize.addEventListener("click", () => this._toggleMinimize());

        this._fontSizeBtns.forEach((btn) => {
            btn.addEventListener("click", () => this._applyModalFontSize(btn.dataset.size));
        });
        this._applyModalFontSize(localStorage.getItem("pit_tutorial_font_size"));

        this._bindDrag();

    }

    // ====================================================
    // Arrastrar el modal libremente por el lienzo, agarrando desde la
    // cabecera (igual que cualquier ventana de escritorio) -- se
    // mueve pasando de la posición por defecto (top/right fijos por
    // CSS) a un left/top explícito calculado en cada drag, con
    // pointer capture para que no se "suelte" si el cursor se va de
    // la cabecera a mitad de camino.
    // ====================================================

    _bindDrag() {

        const header = this._els.header;
        const workspaceEl = document.getElementById("workspace") || document.body;

        let dragging = false;
        let startX = 0, startY = 0, startLeft = 0, startTop = 0;

        header.addEventListener("pointerdown", (e) => {

            if (e.target.closest(".tutorial-modal-close, .tutorial-modal-minimize")) return;

            dragging = true;

            const modalRect = this.modal.getBoundingClientRect();
            const parentRect = workspaceEl.getBoundingClientRect();

            startX = e.clientX;
            startY = e.clientY;
            startLeft = modalRect.left - parentRect.left;
            startTop  = modalRect.top  - parentRect.top;

            header.setPointerCapture(e.pointerId);
            this.modal.classList.add("dragging");

        });

        header.addEventListener("pointermove", (e) => {

            if (!dragging) return;

            const parentRect = workspaceEl.getBoundingClientRect();

            let newLeft = startLeft + (e.clientX - startX);
            let newTop  = startTop  + (e.clientY - startY);

            // No dejar que se arrastre totalmente fuera de vista --
            // siempre queda al menos un margen chico visible.
            const maxLeft = Math.max(4, parentRect.width  - this.modal.offsetWidth  - 4);
            const maxTop  = Math.max(4, parentRect.height - this.modal.offsetHeight - 4);

            newLeft = Utils.clamp(newLeft, 4, maxLeft);
            newTop  = Utils.clamp(newTop,  4, maxTop);

            this.modal.style.left  = `${newLeft}px`;
            this.modal.style.top   = `${newTop}px`;
            this.modal.style.right = "auto";

        });

        header.addEventListener("pointerup", (e) => {
            dragging = false;
            this.modal.classList.remove("dragging");
            try { header.releasePointerCapture(e.pointerId); } catch (err) { /* ya liberado */ }
        });

        // BUG REAL encontrado (usuario reportó que el modal de tutorial
        // se solapa con el panel de propiedades al seleccionar un
        // componente): una vez que el usuario arrastra el modal AUNQUE
        // sea una vez, su posición pasa de "right: 12px" (CSS, relativo
        // al ancho ACTUAL de #workspace en cada repintado) a un
        // left/top en píxeles FIJO, calculado en ese momento -- nunca
        // se vuelve a recalcular. Si en ese momento el panel de
        // propiedades estaba colapsado (#workspace más ancho, ver
        // props-collapsed en simulator.css -- PropertyPanel.show()/
        // clear() lo togglean solo con la selección, no hace falta que
        // el usuario haga nada más) y después se selecciona un
        // componente (el panel se expande, #workspace se angosta), ese
        // left fijo puede terminar más allá del nuevo borde derecho de
        // #workspace -- ahí es donde se ve "meterse" en el panel.
        //
        // Fix: re-clampear cada vez que #workspace cambia de tamaño
        // (ResizeObserver cubre CUALQUIER causa -- resize de ventana,
        // colapsar/expandir el panel de propiedades, lo que sea) --
        // mismo cálculo que ya usa pointermove(), solo que sin moverlo
        // si ya entra bien (Utils.clamp no cambia nada si ya está
        // dentro de rango).
        const reclamp = () => {

            if (this.modal.style.left === "" || this.modal.classList.contains("hidden")) return;

            const parentRect = workspaceEl.getBoundingClientRect();
            const maxLeft = Math.max(4, parentRect.width  - this.modal.offsetWidth  - 4);
            const maxTop  = Math.max(4, parentRect.height - this.modal.offsetHeight - 4);

            const curLeft = parseFloat(this.modal.style.left) || 0;
            const curTop  = parseFloat(this.modal.style.top)  || 0;

            this.modal.style.left = `${Utils.clamp(curLeft, 4, maxLeft)}px`;
            this.modal.style.top  = `${Utils.clamp(curTop,  4, maxTop)}px`;

        };

        new ResizeObserver(reclamp).observe(workspaceEl);

    }

    // ====================================================
    // Minimizar/restaurar -- colapsa todo salvo la cabecera (título +
    // botones), para poder seguir viendo el lienzo sin tener que
    // cerrar el tutorial del todo.
    // ====================================================

    _toggleMinimize() {

        this._minimized = !this._minimized;

        this._els.collapsible.classList.toggle("tutorial-modal-collapsed", this._minimized);
        this._els.minimize.textContent = this._minimized ? "□" : "−";
        this._els.minimize.title = this._minimized ? "Restaurar" : "Minimizar";

    }

    // ====================================================
    // Arrancar / parar un tutorial
    // ====================================================

    start(tutorialId) {

        const tutorial = this.tutorials.find((t) => t.id === tutorialId);
        if (!tutorial) return;

        this._stopPolling();
        this._clearHighlights();

        this.activeTutorial = tutorial;
        this.modal.classList.remove("hidden");
        this._els.complete.classList.add("hidden");
        this._els.body.classList.remove("hidden");

        // Un tutorial nuevo arranca siempre expandido -- minimizado es
        // una elección del usuario DURANTE este tutorial puntual, no
        // algo que deba sobrevivir a "Empezar de nuevo"/otro tutorial.
        if (this._minimized) this._toggleMinimize();

        // Animación de entrada -- ver el comentario grande en
        // tutorial.css sobre por qué vive en su propia clase, puesta
        // una sola vez acá y sacada apenas termina (así una vez
        // abierto el modal, arrastrarlo nunca vuelve a tocar
        // "animation" -- ver _bindDrag()).
        this.modal.classList.add("opening");
        this.modal.addEventListener(
            "animationend",
            () => this.modal.classList.remove("opening"),
            { once: true }
        );

        this.goTo(0);
        this._startPolling();

    }

    // Fin NATURAL del tutorial (se completó el último paso) --
    // a diferencia de stop(), no cierra el modal: lo deja abierto
    // mostrando la pantalla de "completaste el tutorial" con la
    // opción de repetirlo desde el principio.
    _finish() {

        this._clearHighlights();
        this._stopPolling();

        this._els.body.classList.add("hidden");
        this._els.complete.classList.remove("hidden");

        // "Terminaste <título>. Prueba modificar valores o elige otro
        // tutorial." -- armado con nodos (no innerHTML) para que el
        // título del tutorial (texto propio, pero por las dudas)
        // nunca se interprete como HTML.
        this._els.completeText.textContent = "";
        this._els.completeText.appendChild(document.createTextNode("Terminaste "));
        const strong = document.createElement("strong");
        strong.textContent = this.activeTutorial?.title || "";
        this._els.completeText.appendChild(strong);
        this._els.completeText.appendChild(document.createTextNode(". Prueba modificar valores o elige otro tutorial."));

    }

    stop() {

        this._clearHighlights();
        this._stopPolling();

        this.modal.classList.add("hidden");
        this.activeTutorial = null;
        this.stepIndex = -1;

    }

    // ====================================================
    // Navegación entre pasos
    // ====================================================
    //
    // A PEDIDO: el tutorial NUNCA navega solo. Antes, si la condición
    // de un paso ya estaba cumplida al entrar (típico: "poné la
    // ESP32" cuando ya estaba puesta de entrada), se marcaba hecho y
    // saltaba sola al siguiente paso a los pocos milisegundos -- eso
    // hacía imposible quedarte leyendo el paso 1 aunque quisieras.
    // Ahora goTo() SOLO cambia de paso cuando lo pide el usuario
    // (Anterior/Siguiente/Finalizar) -- isDone() se sigue usando,
    // pero nada más que para pintar el ✓ (ver _updateDoneIndicator),
    // nunca para mover el paso actual.
    // ====================================================

    goTo(index) {

        if (!this.activeTutorial) return;

        const steps = this.activeTutorial.steps;

        if (index < 0 || index >= steps.length) return;

        this._clearHighlights();

        this.stepIndex = index;
        const step = steps[index];

        this._els.title.textContent    = `${this.activeTutorial.icon} ${this.activeTutorial.title}`;
        this._els.progress.textContent = `Paso ${index + 1} de ${steps.length}`;
        this._els.text.textContent      = step.text;
        this._els.prev.disabled = index === 0;
        this._els.next.textContent = step.isLast ? "Finalizar" : "Siguiente →";

        step.highlight?.(this);
        step.onEnter?.(this);

        this._updateDoneIndicator(step);

    }

    // Pinta (o saca) el ✓ del título del paso actual según isDone(),
    // SIN navegar a ningún lado -- puramente informativo, para que el
    // usuario sepa que ya puede avanzar cuando quiera, sin que el
    // modal decida por él.
    _updateDoneIndicator(step) {

        const done = !!step.isDone?.(this);
        this._els.stepTitle.textContent = done ? `✓ ${step.title}` : step.title;
        this._els.stepTitle.classList.toggle("done", done);

    }

    _startPolling() {

        this._stopPolling();

        this._pollTimer = setInterval(() => {

            if (!this.activeTutorial) return;

            const step = this.activeTutorial.steps[this.stepIndex];
            if (!step) return;

            this._updateDoneIndicator(step);

        }, 500);

    }

    _stopPolling() {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
    }

    // ====================================================
    // Resaltado -- agrega/saca .tutorial-highlight (ver tutorial.css)
    // de los elementos que le correspondan a cada paso. Se limpia
    // TODO en cada cambio de paso (goTo), nunca queda nada pegado.
    // ====================================================

    _clearHighlights() {
        this._highlighted.forEach((el) => el.classList.remove("tutorial-highlight"));
        this._highlighted = [];
    }

    _addHighlight(el) {
        if (!el) return;
        el.classList.add("tutorial-highlight");
        this._highlighted.push(el);
    }

    highlightElements(selectors) {
        selectors.forEach((sel) => this._addHighlight(document.querySelector(sel)));
    }

    // Resalta la tarjeta de ese tipo en el toolbox (por si hay que
    // volver a agregarlo) Y, si ya hay uno o más en el canvas,
    // también el/los componente(s) puestos.
    highlightToolboxAndCanvas(type) {

        const toolboxItem = document.querySelector(`#componentList .toolbox-item[data-type="${type}"]`);
        this._addHighlight(toolboxItem);

        // Si la tarjeta quedó fuera de vista (el toolbox tiene su
        // propio scroll vertical -- categorías como Actuadores/
        // Pantallas suelen caer bien abajo), desplazar el panel para
        // que quede visible sin que el usuario tenga que ir a
        // buscarla a ciegas. "nearest" no mueve nada si ya está
        // visible -- solo actúa cuando hace falta.
        toolboxItem?.scrollIntoView({ block: "nearest", behavior: "smooth" });

        this.simulator.componentManager.getAll()
            .filter((c) => c.type === type)
            .forEach((c) => this._addHighlight(c.element));

    }

    // entries: [{ type, match(pin) }] -- por cada componente de ese
    // "type" presente en el canvas, resalta todos sus pines que
    // cumplan match(pin).
    highlightPins(entries) {

        entries.forEach(({ type, match }) => {

            this.simulator.componentManager.getAll()
                .filter((c) => c.type === type)
                .forEach((c) => {

                    c.pins.filter(match).forEach((pin) => {

                        const el = document.querySelector(
                            `.pin[data-component-id="${c.id}"][data-pin-id="${pin.id}"]`
                        );
                        this._addHighlight(el);

                    });

                });

        });

    }

    // ====================================================
    // Condiciones reutilizables para isDone()
    // ====================================================

    hasComponent(type) {
        return this.simulator.componentManager.getAll().some((c) => c.type === type);
    }

    // Busca, entre TODOS los cables, uno cuyos dos extremos matcheen
    // pinTypeMatch(pin) de un lado y otherMatch(componente, pin) del
    // otro -- revisa los dos sentidos (from/to), porque el usuario
    // puede trazar el cable empezando desde cualquiera de las dos
    // puntas.
    hasWireBetween(pinTypeMatch, otherMatch) {

        const cm = this.simulator.componentManager;

        const endInfo = (ref) => {
            const comp = cm.get(ref.componentId);
            const pin  = comp?.pins.find((p) => p.id === ref.pinId);
            return { comp, pin };
        };

        return this.simulator.wireManager.wires.some((wire) => {

            const a = endInfo(wire.from);
            const b = endInfo(wire.to);
            if (!a.comp || !b.comp || !a.pin || !b.pin) return false;

            if (pinTypeMatch(a.pin) && otherMatch(b.comp, b.pin)) return true;
            if (pinTypeMatch(b.pin) && otherMatch(a.comp, a.pin)) return true;

            return false;

        });

    }

    // Igual que hasWireBetween(), pero los DOS extremos son
    // component-aware (comp, pin) -- hace falta cuando dos fuentes
    // distintas (ej. batería y ESP32) pueden terminar cableadas al
    // MISMO pin del otro lado (ej. el único GND del L298N), y
    // hasWireBetween() por sí sola no puede distinguir cuál de las
    // dos generó el cable (solo conoce el TIPO del pin de un lado,
    // no su componente).
    hasWireBetweenComponents(matchA, matchB) {

        const cm = this.simulator.componentManager;

        const endInfo = (ref) => {
            const comp = cm.get(ref.componentId);
            const pin  = comp?.pins.find((p) => p.id === ref.pinId);
            return { comp, pin };
        };

        return this.simulator.wireManager.wires.some((wire) => {

            const a = endInfo(wire.from);
            const b = endInfo(wire.to);
            if (!a.comp || !b.comp || !a.pin || !b.pin) return false;

            if (matchA(a.comp, a.pin) && matchB(b.comp, b.pin)) return true;
            if (matchA(b.comp, b.pin) && matchB(a.comp, a.pin)) return true;

            return false;

        });

    }

}
