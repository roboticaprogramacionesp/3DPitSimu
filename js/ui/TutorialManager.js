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

        // ====================================================
        // Demo visual (GIF) como "Paso 0" -- pedido del usuario: antes
        // de arrancar el recorrido paso a paso, mostrar primero "esto
        // es lo que vas a lograr" (el circuito ya armado y funcionando
        // en el simulador), así el alumno sabe hacia dónde va antes de
        // empezar a armar nada. Se arma UNA sola vez acá (no en cada
        // start(), que reinsertaría el paso cada vez que se abre el
        // mismo tutorial) insertando un step sintético al principio de
        // tutorial.steps, en vez de tocar a mano cada tutorial.steps
        // existente (evita renumerar "Paso 1, 2, 3..." de los que ya
        // había). Son .gif reales del propio simulador (no fotos/video
        // de hardware físico -- ver assets/tutorial-demos/), generados
        // armando el circuito con Playwright y capturando el resultado
        // -- se van sumando de a poco, no todos los tutoriales tienen
        // demoGif todavía.
        this.tutorials.forEach((tutorial) => {
            if (!tutorial.demoGif || tutorial._demoStepInserted) return;
            tutorial._demoStepInserted = true; // TUTORIALS es static (compartido) -- sin esto, una 2ª instancia de TutorialManager duplicaría el paso
            tutorial.steps.unshift({
                title: "🎬 Esto es lo que vas a lograr",
                text: tutorial.demoCaption || `Así se ve "${tutorial.title}" funcionando en el simulador -- segui los pasos de abajo para armarlo vos mismo.`,
                media: tutorial.demoGif,
                highlight: () => {},
                isDone: () => true,
            });
        });

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
            demoGif: "assets/tutorial-demos/led_basico.gif",
            demoCaption: "El LED integrado de la ESP32 (GPIO2) parpadea encendiéndose y apagándose -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes (izquierda) hasta el lienzo. No hace falta agregar ni cablear ningún LED externo -- la propia placa ya trae uno integrado en el pin GPIO2, el mismo que vas a prender y apagar en este tutorial.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 4 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 5 — Escribe o carga tu código",
                    text: "Se abrió el panel MicroPython, pestaña Editor -- escribe tu código ahí o ábrelo con 📂 Abrir (usa Pin(2, Pin.OUT) para controlar el LED integrado). Después dale clic al botón verde ▶ Ejecutar (abajo a la derecha del Editor) para correrlo -- cargar el código solo no alcanza.",
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
            demoGif: "assets/tutorial-demos/led_resistencia.gif",
            demoCaption: "El LED parpadea encendiéndose y apagándose -- la resistencia en serie lo protege de una corriente excesiva.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes (izquierda) hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma un LED",
                    text: "Arrastra el LED desde el panel de componentes hasta el lienzo, cerca de la ESP32.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("led"),
                    isDone: (tm) => tm.hasComponent("led"),
                },
                {
                    title: "Paso 4 — Toma una resistencia",
                    text: "Arrastra la Resistencia (categoría Componentes básicos) hasta el lienzo. Sin ella, un GPIO conectado directo al LED deja pasar más corriente de la que el LED soporta -- en hardware real esto lo daña o lo quema. Déjala en 220 Ω, el valor más común para un LED con un GPIO de 3.3V.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("resistencia"),
                    isDone: (tm) => tm.hasComponent("resistencia"),
                },
                {
                    title: "Paso 5 — Conecta el GND al cátodo",
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
                    title: "Paso 6 — Conecta un GPIO a la resistencia",
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
                    title: "Paso 7 — Conecta la resistencia al ánodo",
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
                    title: "Paso 8 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 9 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 10 — Escribe o carga tu código",
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
            demoGif: "assets/tutorial-demos/semaforo.gif",
            demoCaption: "El semáforo cicla verde → amarillo → rojo -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el semáforo",
                    text: "Arrastra el Semáforo (categoría LEDs) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("semaforo"),
                    isDone: (tm) => tm.hasComponent("semaforo"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
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
                    title: "Paso 5 — Conecta R, Y y G",
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
                    title: "Paso 6 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
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
            id: "neopixel_ring",
            title: "Anillo NeoPixel con ESP32",
            icon: "🌈",
            category: "💡 LEDs · Salidas digitales",
            demoGif: "assets/tutorial-demos/neopixel_ring.gif",
            demoCaption: "Una luz roja recorre el anillo, LED por LED -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el anillo NeoPixel",
                    text: "Arrastra el Anillo de NeoPixel desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("neopixel_ring"),
                    isDone: (tm) => tm.hasComponent("neopixel_ring"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
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
                    title: "Paso 5 — Conecta la alimentación",
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
                    title: "Paso 6 — Conecta el dato (DIN)",
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
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "display7",
            title: "Display 7 segmentos con ESP32",
            icon: "🔢",
            category: "💡 LEDs · Salidas digitales",
            demoGif: "assets/tutorial-demos/display7.gif",
            demoCaption: "El display va mostrando los números del 0 al 9, prendiendo la combinación de segmentos correcta para cada uno -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el Display 7 Segmentos",
                    text: "Arrastra el Display 7 Segmentos desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("display7"),
                    isDone: (tm) => tm.hasComponent("display7"),
                },
                {
                    title: "Paso 4 — Conecta el común (COM)",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta cualquiera de los dos pines comunes (COM) del display -- por defecto es cátodo común, así que va a GND.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "display7", match: (p) => ["com1", "com2"].includes(p.id) },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "display7" && ["com1", "com2"].includes(pin.id),
                    ),
                },
                {
                    title: "Paso 5 — Conecta los 8 segmentos",
                    text: "Conecta cada segmento (A, B, C, D, E, F, G y el punto decimal DP) a un pin GPIO distinto de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "display7", match: (p) => ["a", "b", "c", "d", "e", "f", "g", "dp"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["a", "b", "c", "d", "e", "f", "g", "dp"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "display7" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 6 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
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
            id: "ky_009",
            title: "KY-009 LED RGB (SMD) con ESP32",
            icon: "🎨",
            category: "💡 LEDs · Salidas digitales",
            demoGif: "assets/tutorial-demos/ky_009.gif",
            demoCaption: "El LED cicla entre rojo, verde y azul -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el KY-009",
                    text: "Arrastra el KY-009 LED RGB (SMD) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ky-009"),
                    isDone: (tm) => tm.hasComponent("ky-009"),
                },
                {
                    title: "Paso 4 — Conecta el común (COM)",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el común (–) del KY-009 -- es cátodo común.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "ky-009", match: (p) => p.id === "com" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "ky-009" && pin.id === "com",
                    ),
                },
                {
                    title: "Paso 5 — Conecta R, G y B",
                    text: "Conecta los pines R (rojo), G (verde) y B (azul) del KY-009 cada uno a un pin GPIO distinto de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "ky-009", match: (p) => ["r", "g", "b"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["r", "g", "b"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "ky-009" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 6 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
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
            id: "ky_011",
            title: "KY-011 LED Bicolor con ESP32",
            icon: "🟢",
            category: "💡 LEDs · Salidas digitales",
            demoGif: "assets/tutorial-demos/ky_011.gif",
            demoCaption: "El LED cicla entre rojo y verde -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el KY-011",
                    text: "Arrastra el KY-011 LED Bicolor (Rojo/Verde) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ky-011"),
                    isDone: (tm) => tm.hasComponent("ky-011"),
                },
                {
                    title: "Paso 4 — Conecta el común (COM)",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el común (–) del KY-011 -- es cátodo común.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "ky-011", match: (p) => p.id === "com" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "ky-011" && pin.id === "com",
                    ),
                },
                {
                    title: "Paso 5 — Conecta R y G",
                    text: "Conecta los pines R (rojo) y G (verde) del KY-011 cada uno a un pin GPIO distinto de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "ky-011", match: (p) => ["r", "g"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["r", "g"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "ky-011" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 6 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
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
            id: "ky_016",
            title: "KY-016 LED RGB con ESP32",
            icon: "🌟",
            category: "💡 LEDs · Salidas digitales",
            demoGif: "assets/tutorial-demos/ky_016.gif",
            demoCaption: "El LED cambia de rojo a verde, azul y blanco combinando los 3 canales -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el KY-016",
                    text: "Arrastra el KY-016 LED RGB (orificio pasante) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ky-016"),
                    isDone: (tm) => tm.hasComponent("ky-016"),
                },
                {
                    title: "Paso 4 — Conecta el común (COM)",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el común (–) del KY-016 -- es cátodo común.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "ky-016", match: (p) => p.id === "com" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "ky-016" && pin.id === "com",
                    ),
                },
                {
                    title: "Paso 5 — Conecta R, G y B",
                    text: "Conecta los pines R (rojo), G (verde) y B (azul) del KY-016 cada uno a un pin GPIO distinto de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "ky-016", match: (p) => ["r", "g", "b"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["r", "g", "b"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "ky-016" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 6 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
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
            id: "max7219",
            title: "Matriz MAX7219 con ESP32",
            icon: "🔲",
            category: "💡 LEDs · Salidas digitales",
            demoGif: "assets/tutorial-demos/max7219.gif",
            demoCaption: "La matriz dibuja un carácter y después una figura -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma la Matriz MAX7219",
                    text: "Arrastra la Matriz MAX7219 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("max7219"),
                    isDone: (tm) => tm.hasComponent("max7219"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND de la matriz.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "max7219", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "max7219" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC de la matriz.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "max7219", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "max7219" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta DIN, CS y CLK",
                    text: "Conecta DIN, CS y CLK de la matriz cada uno a un pin GPIO distinto de la ESP32 (los mismos que uses en tu código con machine.SPI o bit-banging).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "max7219", match: (p) => ["din", "cs", "clk"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["din", "cs", "clk"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "max7219" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "neopixel_matrix",
            title: "Matriz NeoPixel con ESP32",
            icon: "🎆",
            category: "💡 LEDs · Salidas digitales",
            demoGif: "assets/tutorial-demos/neopixel_matrix.gif",
            demoCaption: "Primero muestra un carácter fijo y después un texto con scroll -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma la Matriz NeoPixel",
                    text: "Arrastra la Matriz de NeoPixel desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("neopixel_matrix"),
                    isDone: (tm) => tm.hasComponent("neopixel_matrix"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND de la matriz.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "neopixel_matrix", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "neopixel_matrix" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC de la matriz.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "neopixel_matrix", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "neopixel_matrix" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta el dato (DIN)",
                    text: "Elige un pin GPIO libre de la ESP32 y conéctalo al DIN (dato) de la matriz.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "neopixel_matrix", match: (p) => p.id === "din" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "neopixel_matrix" && pin.id === "din",
                    ),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            demoGif: "assets/tutorial-demos/boton.gif",
            demoCaption: "Al presionarlo se pone rojo -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el botón",
                    text: "Arrastra el botón KY-004 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ky_004"),
                    isDone: (tm) => tm.hasComponent("ky_004"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
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
                    title: "Paso 5 — Conecta la alimentación",
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
                    title: "Paso 6 — Conecta la señal",
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
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            demoGif: "assets/tutorial-demos/tcrt5000.png",
            demoCaption: "Este sensor no tiene ningún indicador visual en el lienzo -- lee la línea/el obstáculo y manda el resultado por el pin Do, que vas a leer desde tu código (ver el checkbox \"Objeto/línea detectado\" en su panel de propiedades para simular distintos casos).",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el TCRT5000",
                    text: "Arrastra el sensor infrarrojo TCRT5000 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("tcrt5000"),
                    isDone: (tm) => tm.hasComponent("tcrt5000"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
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
                    title: "Paso 5 — Conecta la alimentación",
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
                    title: "Paso 6 — Conecta la salida Do",
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
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            demoGif: "assets/tutorial-demos/fc_51.png",
            demoCaption: "Este sensor no tiene ningún indicador visual en el lienzo -- detecta el obstáculo y manda el resultado por el pin OUT, que vas a leer desde tu código (ver el checkbox \"Objeto detectado\" en su panel de propiedades para simular distintos casos).",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el FC-51",
                    text: "Arrastra el sensor infrarrojo de obstáculos FC-51 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("fc-51"),
                    isDone: (tm) => tm.hasComponent("fc-51"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
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
                    title: "Paso 5 — Conecta la alimentación",
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
                    title: "Paso 6 — Conecta la salida OUT",
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
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            demoGif: "assets/tutorial-demos/buzzer.gif",
            demoCaption: "Cuando el firmware le manda PWM, el buzzer suena de verdad en tu navegador (subí el volumen) y además muestra ondas de sonido saliendo del disco -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el buzzer",
                    text: "Arrastra el Buzzer desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("buzzer"),
                    isDone: (tm) => tm.hasComponent("buzzer"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
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
                    title: "Paso 5 — Conecta la alimentación",
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
                    title: "Paso 6 — Conecta la señal",
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
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            demoGif: "assets/tutorial-demos/servo.gif",
            demoCaption: "El brazo del servo gira a la posición que le mandes por PWM -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el servo",
                    text: "Arrastra el Servo SG90 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("sg90"),
                    isDone: (tm) => tm.hasComponent("sg90"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
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
                    title: "Paso 5 — Conecta la alimentación",
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
                    title: "Paso 6 — Conecta la señal",
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
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            demoGif: "assets/tutorial-demos/motor_reductor.gif",
            demoCaption: "Con el interruptor cerrado, el puente H hace girar el motor -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma la batería 18650",
                    text: "Arrastra el portapilas de baterías 18650 (alimentación del motor) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("battery_18650"),
                    isDone: (tm) => tm.hasComponent("battery_18650"),
                },
                {
                    title: "Paso 4 — Toma el interruptor",
                    text: "Arrastra el interruptor ON/OFF desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("switch"),
                    isDone: (tm) => tm.hasComponent("switch"),
                },
                {
                    title: "Paso 5 — Conecta la batería al interruptor",
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
                    title: "Paso 6 — Toma el puente H (L298N)",
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
                    title: "Paso 7 — Conecta el interruptor al puente H",
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
                    title: "Paso 8 — Conecta la batería al GND del puente H",
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
                    title: "Paso 9 — Conecta el GND del puente H a la ESP32",
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
                    title: "Paso 10 — Conecta IN1 e IN2",
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
                    title: "Paso 11 — Toma el motor",
                    text: "Arrastra el motor DC (reductora) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("motor"),
                    isDone: (tm) => tm.hasComponent("motor"),
                },
                {
                    title: "Paso 12 — Conecta el motor",
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
                    title: "Paso 13 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 14 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 15 — Escribe o carga tu código",
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
            id: "28byj",
            title: "28BYJ-48 Motor Paso a Paso con ESP32",
            icon: "🔁",
            category: "🔧 Entradas · Actuadores",
            demoGif: "assets/tutorial-demos/28byj.gif",
            demoCaption: "Con el interruptor cerrado, el eje gira hasta la posición que le pidas -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    // BUG REAL corregido (reportado por el usuario): el
                    // driver ULN2003 del 28BYJ-48 NO se alimenta con
                    // 3V3 de la ESP32 -- necesita su propia fuente
                    // (batería + interruptor), igual que el puente H
                    // del motor reductor (ver tutorial "motor_reductor",
                    // mismo patrón de pasos acá abajo).
                    title: "Paso 3 — Toma la batería 18650",
                    text: "Arrastra el portapilas de baterías 18650 (alimentación del motor) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("battery_18650"),
                    isDone: (tm) => tm.hasComponent("battery_18650"),
                },
                {
                    title: "Paso 4 — Toma el interruptor",
                    text: "Arrastra el interruptor ON/OFF desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("switch"),
                    isDone: (tm) => tm.hasComponent("switch"),
                },
                {
                    title: "Paso 5 — Toma el 28BYJ-48",
                    text: "Arrastra el 28BYJ-48 Motor Paso a Paso + Driver ULN2003 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("28byj"),
                    isDone: (tm) => tm.hasComponent("28byj"),
                },
                {
                    title: "Paso 6 — Conecta la batería al interruptor",
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
                    title: "Paso 7 — Conecta el interruptor al VCC del driver",
                    text: "Conecta la otra pata del interruptor (la que no usaste para la batería) al VCC del driver ULN2003.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "switch", match: () => true },
                        { type: "28byj", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        () => true,
                        (comp, pin) => comp.type === "28byj" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 8 — Conecta la batería al GND del driver",
                    text: "Conecta el – de la batería al GND del driver ULN2003.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "battery_18650", match: (p) => p.id === "gnd" },
                        { type: "28byj", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetweenComponents(
                        (comp, pin) => comp.type === "battery_18650" && pin.id === "gnd",
                        (comp, pin) => comp.type === "28byj" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 9 — Conecta el GND del driver a la ESP32",
                    text: "Conecta ese mismo GND del driver a un GND de la ESP32 -- necesario para que la ESP32 pueda controlarlo.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "28byj", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetweenComponents(
                        (comp, pin) => comp.type === "esp32_wroom" && pin.type === "ground",
                        (comp, pin) => comp.type === "28byj" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 10 — Conecta IN1, IN2, IN3 e IN4",
                    text: "Conecta IN1, IN2, IN3 e IN4 del driver cada uno a un pin GPIO distinto de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "28byj", match: (p) => ["in1", "in2", "in3", "in4"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["in1", "in2", "in3", "in4"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "28byj" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 11 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
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
            id: "ky_008",
            title: "KY-008 Módulo Láser con ESP32",
            icon: "🔴",
            category: "🔧 Entradas · Actuadores",
            demoGif: "assets/tutorial-demos/ky_008.gif",
            demoCaption: "El láser parpadea encendiéndose y apagándose -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el KY-008",
                    text: "Arrastra el KY-008 Módulo Láser desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ky-008"),
                    isDone: (tm) => tm.hasComponent("ky-008"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del KY-008.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "ky-008", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "ky-008" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del KY-008.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "ky-008", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "ky-008" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta la señal",
                    text: "Elige un pin GPIO libre de la ESP32 y conéctalo al pin S (señal) del KY-008.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "ky-008", match: (p) => p.id === "s" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "ky-008" && pin.id === "s",
                    ),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "ky_019",
            title: "KY-019 Módulo Relevador con ESP32",
            icon: "🔌",
            category: "🔧 Entradas · Actuadores",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el KY-019",
                    text: "Arrastra el KY-019 Módulo Relevador 5V desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ky-019"),
                    isDone: (tm) => tm.hasComponent("ky-019"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del relevador.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "ky-019", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "ky-019" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del relevador.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "ky-019", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "ky-019" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta la señal",
                    text: "Elige un pin GPIO libre de la ESP32 y conéctalo al pin S (señal) del relevador. NC/COM/NO son el lado que el relevador enciende/apaga (ej. un foco o un motor) -- no van a la ESP32, quedan fuera de este tutorial.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "ky-019", match: (p) => p.id === "s" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "ky-019" && pin.id === "s",
                    ),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "clavija_127v",
            title: "Foco 127V controlado con relevador",
            icon: "⚡",
            category: "🔧 Entradas · Actuadores",
            demoGif: "assets/tutorial-demos/clavija_127v.gif",
            demoCaption: "El relevador cambia de estado y enciende/apaga el foco de 127V -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el relevador KY-019",
                    text: "Arrastra el KY-019 Módulo Relevador 5V desde el panel de componentes hasta el lienzo -- es el que va a separar la parte segura (ESP32, 3.3V) de la parte de 127V.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ky-019"),
                    isDone: (tm) => tm.hasComponent("ky-019"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del relevador.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "ky-019", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "ky-019" && pin.id === "gnd",
                    ),
                },
                {
                    // BUG REAL corregido (reportado por el usuario): el
                    // relevador KY-019 necesita 5V para activar la
                    // bobina de verdad -- 3V3 queda al límite/no
                    // alcanza en el módulo real. A diferencia del
                    // 3V3 (un solo pin "3v3"), la ESP32 trae DOS pines
                    // 5V ("5v_1"/"5v_2") -- se acepta cualquiera de los
                    // dos.
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 5V de la ESP32 al VCC del relevador -- el KY-019 necesita 5V para activar la bobina, 3.3V no alcanza.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "5v_1" || p.id === "5v_2" },
                        { type: "ky-019", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "5v_1" || pin.id === "5v_2",
                        (comp, pin) => comp.type === "ky-019" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta la señal",
                    text: "Elige un pin GPIO libre de la ESP32 y conéctalo al pin S (señal) del relevador -- este es el que vas a prender/apagar desde tu código.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "ky-019", match: (p) => p.id === "s" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "ky-019" && pin.id === "s",
                    ),
                },
                {
                    title: "Paso 7 — Toma la clavija 127V",
                    text: "Arrastra la Clavija 127V (Toma de corriente) desde el panel de componentes hasta el lienzo -- es una fuente de alimentación real, como la batería.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("clavija_127v"),
                    isDone: (tm) => tm.hasComponent("clavija_127v"),
                },
                {
                    title: "Paso 8 — Toma el foco",
                    text: "Arrastra el Foco / Bombillo desde el panel de componentes hasta el lienzo -- es lo que el relevador va a prender y apagar.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("bombillo"),
                    isDone: (tm) => tm.hasComponent("bombillo"),
                },
                {
                    title: "Paso 9 — Conecta la fase al COM del relevador",
                    text: "Conecta la Fase de la clavija al COM del relevador.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "clavija_127v", match: (p) => p.id === "fase" },
                        { type: "ky-019", match: (p) => p.id === "com" },
                    ]),
                    isDone: (tm) => tm.hasWireBetweenComponents(
                        (comp, pin) => comp.type === "clavija_127v" && pin.id === "fase",
                        (comp, pin) => comp.type === "ky-019" && pin.id === "com",
                    ),
                },
                {
                    title: "Paso 10 — Conecta el NO del relevador al foco",
                    text: "Conecta el NO (Normal Abierto) del relevador a cualquiera de los dos terminales del foco -- el relevador deja pasar la corriente por acá solo cuando lo activás desde tu código.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "ky-019", match: (p) => p.id === "no" },
                        { type: "bombillo", match: () => true },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        () => true,
                        (comp, pin) => comp.type === "ky-019" && pin.id === "no",
                    ),
                },
                {
                    title: "Paso 11 — Cierra el circuito: Neutro al foco",
                    text: "Conecta el Neutro de la clavija al otro terminal del foco (el que no usaste en el paso anterior) -- así se cierra el circuito de 127V.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "clavija_127v", match: (p) => p.id === "neutro" },
                        { type: "bombillo", match: () => true },
                    ]),
                    isDone: (tm) => tm.hasWireBetweenComponents(
                        (comp, pin) => comp.type === "clavija_127v" && pin.id === "neutro",
                        (comp, pin) => comp.type === "bombillo",
                    ),
                },
                {
                    title: "Paso 12 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 13 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 14 — Escribe o carga tu código",
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
            demoGif: "assets/tutorial-demos/dht11.gif",
            demoCaption: "El panel de propiedades simula temperatura y humedad con una barra de colores -- así vas a probar tu código sin esperar a que cambie el clima de verdad.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el DHT11",
                    text: "Arrastra el sensor DHT11 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("dht11"),
                    isDone: (tm) => tm.hasComponent("dht11"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
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
                    title: "Paso 5 — Conecta la alimentación",
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
                    title: "Paso 6 — Conecta el DATA",
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
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            demoGif: "assets/tutorial-demos/ky_001.gif",
            demoCaption: "El panel de propiedades simula la temperatura con una barra de colores -- así vas a probar tu código sin esperar a que cambie el clima de verdad.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el KY-001",
                    text: "Arrastra el sensor de temperatura KY-001 (DS18B20) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ky_001"),
                    isDone: (tm) => tm.hasComponent("ky_001"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
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
                    title: "Paso 5 — Conecta la alimentación",
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
                    title: "Paso 6 — Conecta la señal",
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
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            demoGif: "assets/tutorial-demos/adkey.gif",
            demoCaption: "Al presionar un botón se ilumina -- así vas a leer cuál está presionado desde tu código.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el ADKEY",
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
                    title: "Paso 4 — Conecta el GND",
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
                    title: "Paso 5 — Conecta la alimentación",
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
                    title: "Paso 6 — Conecta la salida analógica",
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
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "joystick",
            title: "Joystick analógico con ESP32",
            icon: "🕹️",
            category: "🎚️ Sensores · Analógicos",
            demoGif: "assets/tutorial-demos/joystick.gif",
            demoCaption: "Al arrastrar la palanca con el mouse, el stick se mueve en X e Y y la ESP32 lee esa posición -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el joystick",
                    text: "Arrastra el Joystick Analógico desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("joystick"),
                    isDone: (tm) => tm.hasComponent("joystick"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del joystick.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "joystick", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "joystick" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del joystick.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "joystick", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "joystick" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta VRx y VRy",
                    text: "Conecta VRx y VRy cada uno a un pin ADC de la ESP32 (ej. GPIO32, GPIO33, GPIO25). VN/VP/GPIO34-39 son SOLO de entrada -- sirven para leer, pero no los sugerimos para no mezclarlos con otras conexiones de este tutorial.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.signal === "analog" && !p.inputOnly },
                        { type: "joystick", match: (p) => ["vrx", "vry"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["vrx", "vry"].every((id) => tm.hasWireBetween(
                        (pin) => pin.signal === "analog" && !pin.inputOnly,
                        (comp, pin) => comp.type === "joystick" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "ky_023",
            title: "KY-023 Joystick con ESP32",
            icon: "🎮",
            category: "🎚️ Sensores · Analógicos",
            demoGif: "assets/tutorial-demos/ky_023.gif",
            demoCaption: "Al arrastrar la palanca con el mouse, el stick se mueve en X e Y y la ESP32 lee esa posición -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el KY-023",
                    text: "Arrastra el KY-023 Joystick Analógico (X/Y + botón) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ky-023"),
                    isDone: (tm) => tm.hasComponent("ky-023"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del KY-023.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "ky-023", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "ky-023" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del KY-023.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "ky-023", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "ky-023" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta VRx y VRy",
                    text: "Conecta VRx y VRy cada uno a un pin ADC de la ESP32 (ej. GPIO32, GPIO33, GPIO25).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.signal === "analog" && !p.inputOnly },
                        { type: "ky-023", match: (p) => ["vrx", "vry"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["vrx", "vry"].every((id) => tm.hasWireBetween(
                        (pin) => pin.signal === "analog" && !pin.inputOnly,
                        (comp, pin) => comp.type === "ky-023" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "pot_rotary",
            title: "Potenciómetro rotativo con ESP32",
            icon: "🎚️",
            category: "🎚️ Sensores · Analógicos",
            demoGif: "assets/tutorial-demos/pot_rotary.gif",
            demoCaption: "Al arrastrar la perilla con el mouse, gira de un tope al otro y la ESP32 lee ese valor por el ADC -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el potenciómetro",
                    text: "Arrastra el Potenciómetro Rotativo 10K desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("pot_rotary"),
                    isDone: (tm) => tm.hasComponent("pot_rotary"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del potenciómetro.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "pot_rotary", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "pot_rotary" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del potenciómetro.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "pot_rotary", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "pot_rotary" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta la señal (SIG)",
                    text: "Elige un pin ADC libre de la ESP32 (ej. GPIO32, GPIO33, GPIO25) y conéctalo al SIG del potenciómetro.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.signal === "analog" && !p.inputOnly },
                        { type: "pot_rotary", match: (p) => p.id === "sig" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.signal === "analog" && !pin.inputOnly,
                        (comp, pin) => comp.type === "pot_rotary" && pin.id === "sig",
                    ),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "pot_slider",
            title: "Potenciómetro deslizante con ESP32",
            icon: "🔅",
            category: "🎚️ Sensores · Analógicos",
            demoGif: "assets/tutorial-demos/pot_slider.gif",
            demoCaption: "Al arrastrar la palanca con el mouse, se desliza de un extremo al otro y la ESP32 lee ese valor por el ADC -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el potenciómetro",
                    text: "Arrastra el Potenciómetro Deslizante 10K desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("pot_slider"),
                    isDone: (tm) => tm.hasComponent("pot_slider"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del potenciómetro.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "pot_slider", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "pot_slider" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del potenciómetro.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "pot_slider", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "pot_slider" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta la señal (OUT1 u OUT2)",
                    text: "Elige un pin ADC libre de la ESP32 (ej. GPIO32, GPIO33, GPIO25) y conéctalo a OUT1 o a OUT2 del potenciómetro -- los dos llevan la misma señal, con uno alcanza.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.signal === "analog" && !p.inputOnly },
                        { type: "pot_slider", match: (p) => ["out1", "out2"].includes(p.id) },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.signal === "analog" && !pin.inputOnly,
                        (comp, pin) => comp.type === "pot_slider" && ["out1", "out2"].includes(pin.id),
                    ),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "ky040",
            title: "KY-040 Encoder Rotativo con ESP32",
            icon: "🔄",
            category: "🎚️ Sensores · Analógicos",
            demoGif: "assets/tutorial-demos/ky040.gif",
            demoCaption: "Con las flechas (o arrastrando la perilla) el eje gira paso a paso, y tu código cuenta cada paso -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el KY-040",
                    text: "Arrastra el KY-040 Encoder Rotativo desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ky040"),
                    isDone: (tm) => tm.hasComponent("ky040"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del KY-040.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "ky040", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "ky040" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del KY-040.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "ky040", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "ky040" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta CLK, DT y SW",
                    text: "A diferencia de un potenciómetro, el encoder se lee por pulsos digitales -- conecta CLK, DT y SW cada uno a un pin GPIO digital distinto de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "ky040", match: (p) => ["clk", "dt", "sw"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["clk", "dt", "sw"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "ky040" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "ky_018",
            title: "KY-018 Fotorresistor (LDR) con ESP32",
            icon: "🔆",
            category: "🎚️ Sensores · Analógicos",
            demoGif: "assets/tutorial-demos/ky_018.png",
            demoCaption: "Este sensor no tiene animación visual propia en el simulador, pero así se ve correctamente conectado -- lo vas a usar para leer el nivel de luz en la terminal (ver el slider \"Nivel de luz\" en su panel de propiedades para simular distintos casos).",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el KY-018",
                    text: "Arrastra el KY-018 Fotorresistor (LDR) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ky-018"),
                    isDone: (tm) => tm.hasComponent("ky-018"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del KY-018.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "ky-018", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "ky-018" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del KY-018.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "ky-018", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "ky-018" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta la señal (S)",
                    text: "Elige un pin ADC libre de la ESP32 (ej. GPIO32, GPIO33, GPIO25) y conéctalo al S (señal) del KY-018.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.signal === "analog" && !p.inputOnly },
                        { type: "ky-018", match: (p) => p.id === "s" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.signal === "analog" && !pin.inputOnly,
                        (comp, pin) => comp.type === "ky-018" && pin.id === "s",
                    ),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            demoGif: "assets/tutorial-demos/hcsr04.gif",
            demoCaption: "El panel de propiedades simula la distancia con una barra de colores -- así vas a probar tu código sin necesitar un objeto real moviéndose.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el HC-SR04",
                    text: "Arrastra el sensor ultrasónico HC-SR04 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("hcsr04"),
                    isDone: (tm) => tm.hasComponent("hcsr04"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
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
                    title: "Paso 5 — Conecta la alimentación",
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
                    title: "Paso 6 — Conecta TRIG y ECHO",
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
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "gps",
            title: "Módulo GPS NEO-6M con ESP32",
            icon: "🛰️",
            category: "📡 Sensores",
            demoGif: "assets/tutorial-demos/gps.gif",
            demoCaption: "El LED del módulo pasa de rojo a verde cuando el GPS tiene señal (fix) -- a la derecha, ampliado. Esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el GPS",
                    text: "Arrastra el Módulo GPS NEO-6M desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("gps"),
                    isDone: (tm) => tm.hasComponent("gps"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del GPS.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "gps", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "gps" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del GPS.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "gps", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "gps" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta TX y RX (cruzados)",
                    text: "El GPS habla por UART -- conecta su TX al RX0 de la ESP32, y su RX al TX0 (cruzados: lo que uno transmite, el otro lo tiene que recibir). Usá machine.UART(0, ...) en tu código con esos mismos pines.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.signal === "uart" },
                        { type: "gps", match: (p) => ["tx", "rx"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["tx", "rx"].every((id) => tm.hasWireBetween(
                        (pin) => pin.signal === "uart",
                        (comp, pin) => comp.type === "gps" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "pir",
            title: "Sensor PIR de Movimiento con ESP32",
            icon: "🚶",
            category: "📡 Sensores",
            demoGif: "assets/tutorial-demos/pir.gif",
            demoCaption: "El LED del sensor se pone rojo cuando detecta movimiento -- a la derecha, ampliado. Esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el PIR",
                    text: "Arrastra el Sensor PIR de Movimiento (HC-SR501) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("pir"),
                    isDone: (tm) => tm.hasComponent("pir"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del PIR.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "pir", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "pir" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del PIR.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "pir", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "pir" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta la salida (OUT)",
                    text: "Elige un pin GPIO libre de la ESP32 y conéctalo al OUT del PIR -- se pone en ALTO al detectar movimiento.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "pir", match: (p) => p.id === "out" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "pir" && pin.id === "out",
                    ),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            demoGif: "assets/tutorial-demos/oled.png",
            demoCaption: "La pantalla OLED muestra el texto que le envías por código -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el OLED",
                    text: "Arrastra el display OLED 128x64 I2C desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("oled"),
                    isDone: (tm) => tm.hasComponent("oled"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
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
                    title: "Paso 5 — Conecta la alimentación",
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
                    title: "Paso 6 — Conecta SDA y SCK",
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
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            demoGif: "assets/tutorial-demos/lcd_16x2_i2c.png",
            demoCaption: "La pantalla LCD muestra el texto que le envías por código, usando solo 2 cables de datos (I2C) -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el LCD 16x2 I2C",
                    text: "Arrastra el LCD 16x2 I2C desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("lcd_16x2_i2c"),
                    isDone: (tm) => tm.hasComponent("lcd_16x2_i2c"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
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
                    title: "Paso 5 — Conecta la alimentación",
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
                    title: "Paso 6 — Conecta SDA y SCL",
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
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            demoGif: "assets/tutorial-demos/lcd16x2.png",
            demoCaption: "La pantalla LCD muestra el texto que le envías por código -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el LCD 16x2",
                    text: "Arrastra el LCD 16x2 paralelo (HD44780) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("lcd16x2"),
                    isDone: (tm) => tm.hasComponent("lcd16x2"),
                },
                {
                    // Antes era un solo paso ("Conecta la alimentación")
                    // que pedía 5 cables distintos de una -- se separó
                    // en 5 pasos, uno por pin, más fácil de seguir para
                    // enseñar (aunque sean más pasos en total).
                    title: "Paso 4 — Conecta VSS (GND)",
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
                    title: "Paso 5 — Conecta VDD (3V3)",
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
                    title: "Paso 6 — Conecta V0 (contraste)",
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
                    title: "Paso 7 — Conecta A (luz de fondo)",
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
                    title: "Paso 8 — Conecta K",
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
                    title: "Paso 9 — Conecta RW a GND",
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
                    title: "Paso 10 — Conecta RS y E",
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
                    title: "Paso 11 — Conecta D4-D7 (modo 4 bits)",
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
                    title: "Paso 12 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 13 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 14 — Escribe o carga tu código",
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
            id: "tft_st7789",
            title: "TFT 1.54\" ST7789 con ESP32",
            icon: "🖼️",
            category: "🖥️ Pantallas y Módulos",
            demoGif: "assets/tutorial-demos/tft_st7789.png",
            demoCaption: "La pantalla TFT a color dibuja formas y colores que le envías por código -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma la pantalla TFT",
                    text: "Arrastra la TFT 1.54\" 240x240 (ST7789) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("tft_st7789"),
                    isDone: (tm) => tm.hasComponent("tft_st7789"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND de la pantalla.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "tft_st7789", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "tft_st7789" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC de la pantalla.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "tft_st7789", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "tft_st7789" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta SCL, SDA, RES, DC, CS y BLK",
                    text: "Conecta SCL, SDA, RES, DC, CS y BLK de la pantalla, cada uno a un pin GPIO distinto de la ESP32 (6 cables en total).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "tft_st7789", match: (p) => ["scl", "sda", "res", "dc", "cs", "blk"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["scl", "sda", "res", "dc", "cs", "blk"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "tft_st7789" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "tm1637",
            title: "TM1637 4 Dígitos con ESP32",
            icon: "🕐",
            category: "🖥️ Pantallas y Módulos",
            demoGif: "assets/tutorial-demos/tm1637.gif",
            demoCaption: "El display muestra un contador que sube de a uno -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el TM1637",
                    text: "Arrastra el TM1637 4 Dígitos desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("tm1637"),
                    isDone: (tm) => tm.hasComponent("tm1637"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del TM1637.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "tm1637", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "tm1637" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del TM1637.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "tm1637", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "tm1637" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta CLK y DIO",
                    text: "Conecta CLK y DIO del TM1637 cada uno a un pin GPIO distinto de la ESP32.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "tm1637", match: (p) => ["clk", "dio"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["clk", "dio"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "tm1637" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "keypad3x4",
            title: "Teclado matricial 3x4 con ESP32",
            icon: "⌨️",
            category: "🖥️ Pantallas y Módulos",
            demoGif: "assets/tutorial-demos/keypad3x4.gif",
            demoCaption: "Al presionar una tecla se ilumina -- así vas a leer cuál está presionada desde tu código.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el teclado 3x4",
                    text: "Arrastra el Teclado matricial 3x4 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("keypad3x4"),
                    isDone: (tm) => tm.hasComponent("keypad3x4"),
                },
                {
                    title: "Paso 4 — Conecta las 4 filas y 3 columnas",
                    text: "Este teclado no necesita GND ni VCC -- conecta R1-R4 (filas) y C1-C3 (columnas), cada uno a un pin GPIO distinto de la ESP32 (7 cables en total).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "keypad3x4", match: (p) => ["r1", "r2", "r3", "r4", "c1", "c2", "c3"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["r1", "r2", "r3", "r4", "c1", "c2", "c3"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "keypad3x4" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 5 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
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
            id: "keypad4x4",
            title: "Teclado matricial 4x4 con ESP32",
            icon: "#️⃣",
            category: "🖥️ Pantallas y Módulos",
            demoGif: "assets/tutorial-demos/keypad4x4.gif",
            demoCaption: "Al presionar una tecla se ilumina -- así vas a leer cuál está presionada desde tu código.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el teclado 4x4",
                    text: "Arrastra el Teclado matricial 4x4 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("keypad4x4"),
                    isDone: (tm) => tm.hasComponent("keypad4x4"),
                },
                {
                    title: "Paso 4 — Conecta las 4 filas y 4 columnas",
                    text: "Este teclado no necesita GND ni VCC -- conecta R1-R4 (filas) y C1-C4 (columnas), cada uno a un pin GPIO distinto de la ESP32 (8 cables en total).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "keypad4x4", match: (p) => ["r1", "r2", "r3", "r4", "c1", "c2", "c3", "c4"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["r1", "r2", "r3", "r4", "c1", "c2", "c3", "c4"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "keypad4x4" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 5 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
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
            id: "keypad4x4_i2c",
            title: "Teclado 4x4 I2C con ESP32",
            icon: "🔣",
            category: "🖥️ Pantallas y Módulos",
            demoGif: "assets/tutorial-demos/keypad4x4_i2c.gif",
            demoCaption: "Al presionar una tecla se ilumina -- así vas a leer cuál está presionada desde tu código, usando solo 2 cables de datos (I2C).",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el teclado 4x4 I2C",
                    text: "Arrastra el Teclado matricial 4x4 (I2C, PCF8574) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("keypad4x4_i2c"),
                    isDone: (tm) => tm.hasComponent("keypad4x4_i2c"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del teclado.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "keypad4x4_i2c", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "keypad4x4_i2c" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del teclado.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "keypad4x4_i2c", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "keypad4x4_i2c" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta SDA y SCL",
                    text: "Conecta SDA y SCL del teclado cada uno a un pin GPIO distinto de la ESP32 (los mismos que uses en tu código con I2C(sda=.., scl=..)).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "keypad4x4_i2c", match: (p) => ["sda", "scl"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["sda", "scl"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "keypad4x4_i2c" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "rc522",
            title: "Lector RFID RC522 con ESP32",
            icon: "💳",
            category: "🖥️ Pantallas y Módulos",
            demoGif: "assets/tutorial-demos/rc522.png",
            demoCaption: "Este sensor no tiene animación visual propia en el simulador, pero así se ve correctamente conectado -- lo vas a usar para leer el UID de una tarjeta en la terminal.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el RC522",
                    text: "Arrastra el Lector RFID RC522 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("rc522_real"),
                    isDone: (tm) => tm.hasComponent("rc522_real"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del RC522.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "rc522_real", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "rc522_real" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al 3.3V del RC522 -- OJO, este módulo NO tolera 5V.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "rc522_real", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "rc522_real" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta SDA, SCK, MOSI, MISO y RST",
                    text: "Conecta SDA (SS), SCK, MOSI, MISO y RST del RC522, cada uno a un pin GPIO distinto de la ESP32 (5 cables en total). IRQ no hace falta para este tutorial.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "rc522_real", match: (p) => ["sda", "sck", "mosi", "miso", "rst"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["sda", "sck", "mosi", "miso", "rst"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "rc522_real" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "bh1750",
            title: "BH1750 Sensor de Luz con ESP32",
            icon: "☀️",
            category: "🖥️ Pantallas y Módulos",
            demoGif: "assets/tutorial-demos/bh1750.gif",
            demoCaption: "El panel de propiedades simula el nivel de luz (lux) con un slider -- así vas a probar tu código sin necesitar una fuente de luz real.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el BH1750",
                    text: "Arrastra el BH1750 Sensor de Luz Ambiental desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("bh1750"),
                    isDone: (tm) => tm.hasComponent("bh1750"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del BH1750.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "bh1750", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "bh1750" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del BH1750.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "bh1750", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "bh1750" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta SDA y SCL",
                    text: "Conecta SDA y SCL del BH1750 cada uno a un pin GPIO distinto de la ESP32 (los mismos que uses en tu código con I2C(sda=.., scl=..)).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "bh1750", match: (p) => ["sda", "scl"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["sda", "scl"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "bh1750" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "bmp280",
            title: "BMP280 Presión y Temperatura con ESP32",
            icon: "🌦️",
            category: "🖥️ Pantallas y Módulos",
            demoGif: "assets/tutorial-demos/bmp280.gif",
            demoCaption: "El panel de propiedades simula presión y temperatura con sliders -- así vas a probar tu código sin esperar a que cambie el clima de verdad.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el BMP280",
                    text: "Arrastra el BMP280 Sensor de Presión y Temperatura desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("bmp280"),
                    isDone: (tm) => tm.hasComponent("bmp280"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del BMP280.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "bmp280", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "bmp280" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VIN del BMP280.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "bmp280", match: (p) => p.id === "vin" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "bmp280" && pin.id === "vin",
                    ),
                },
                {
                    title: "Paso 6 — Conecta SDA y SCL",
                    text: "Conecta SDA (SDI) y SCL (SCK) del BMP280 cada uno a un pin GPIO distinto de la ESP32 (los mismos que uses en tu código con I2C(sda=.., scl=..)).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "bmp280", match: (p) => ["sda", "scl"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["sda", "scl"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "bmp280" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "ds3231",
            title: "DS3231 Reloj de Tiempo Real con ESP32",
            icon: "⏰",
            category: "🖥️ Pantallas y Módulos",
            demoGif: "assets/tutorial-demos/ds3231.gif",
            demoCaption: "Desde el panel de propiedades podés saltar a cualquier fecha/hora -- así vas a probar tu código sin esperar a que pase el tiempo de verdad.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el DS3231",
                    text: "Arrastra el DS3231 Reloj de Tiempo Real (RTC) desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ds3231"),
                    isDone: (tm) => tm.hasComponent("ds3231"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del DS3231.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "ds3231", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "ds3231" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del DS3231.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "ds3231", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "ds3231" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta SDA y SCL",
                    text: "Conecta SDA y SCL del DS3231 cada uno a un pin GPIO distinto de la ESP32 (los mismos que uses en tu código con I2C(sda=.., scl=..)).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "ds3231", match: (p) => ["sda", "scl"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["sda", "scl"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "ds3231" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "mpu6050",
            title: "MPU6050 Acelerómetro y Giroscopio con ESP32",
            icon: "🌀",
            category: "🖥️ Pantallas y Módulos",
            demoGif: "assets/tutorial-demos/mpu6050.gif",
            demoCaption: "El panel de propiedades simula aceleración y giro con sliders -- así vas a probar tu código sin necesitar mover la placa de verdad.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el MPU6050",
                    text: "Arrastra el MPU6050 Acelerómetro + Giroscopio desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("mpu6050"),
                    isDone: (tm) => tm.hasComponent("mpu6050"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del MPU6050.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "mpu6050", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "mpu6050" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del MPU6050.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "mpu6050", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "mpu6050" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta SDA y SCL",
                    text: "Conecta SDA y SCL del MPU6050 cada uno a un pin GPIO distinto de la ESP32 (los mismos que uses en tu código con I2C(sda=.., scl=..)). Los pines XDA/XCL/AD0/INT son avanzados, no hacen falta para esto.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "mpu6050", match: (p) => ["sda", "scl"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["sda", "scl"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "mpu6050" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "qmc5883l",
            title: "QMC5883L Brújula con ESP32",
            icon: "🧲",
            category: "🖥️ Pantallas y Módulos",
            demoGif: "assets/tutorial-demos/qmc5883l.gif",
            demoCaption: "La aguja de la brújula gira según el rumbo -- a la derecha, ampliada. Esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el QMC5883L",
                    text: "Arrastra el QMC5883L Magnetómetro/Brújula desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("qmc5883l"),
                    isDone: (tm) => tm.hasComponent("qmc5883l"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del QMC5883L.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "qmc5883l", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "qmc5883l" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VCC del QMC5883L.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "qmc5883l", match: (p) => p.id === "vcc" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "qmc5883l" && pin.id === "vcc",
                    ),
                },
                {
                    title: "Paso 6 — Conecta SDA y SCL",
                    text: "Conecta SDA y SCL del QMC5883L cada uno a un pin GPIO distinto de la ESP32 (los mismos que uses en tu código con I2C(sda=.., scl=..)).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "qmc5883l", match: (p) => ["sda", "scl"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["sda", "scl"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "qmc5883l" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "tcs34725",
            title: "TCS34725 Sensor de Color con ESP32",
            icon: "👁️",
            category: "🖥️ Pantallas y Módulos",
            demoGif: "assets/tutorial-demos/tcs34725.gif",
            demoCaption: "El sensor muestra el color que está \"viendo\" -- a la derecha, ampliado. Esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el TCS34725",
                    text: "Arrastra el TCS34725 Sensor de Color desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("tcs34725"),
                    isDone: (tm) => tm.hasComponent("tcs34725"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el GND del TCS34725.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "ground" },
                        { type: "tcs34725", match: (p) => p.id === "gnd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.type === "ground",
                        (comp, pin) => comp.type === "tcs34725" && pin.id === "gnd",
                    ),
                },
                {
                    title: "Paso 5 — Conecta la alimentación",
                    text: "Conecta un pin de 3V3 de la ESP32 al VDD del TCS34725 -- OJO: el pin marcado \"3V3\" en el módulo es una SALIDA de su regulador interno, no sirve para alimentarlo.",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.id === "3v3" },
                        { type: "tcs34725", match: (p) => p.id === "vdd" },
                    ]),
                    isDone: (tm) => tm.hasWireBetween(
                        (pin) => pin.id === "3v3",
                        (comp, pin) => comp.type === "tcs34725" && pin.id === "vdd",
                    ),
                },
                {
                    title: "Paso 6 — Conecta SDA y SCL",
                    text: "Conecta SDA y SCL del TCS34725 cada uno a un pin GPIO distinto de la ESP32 (los mismos que uses en tu código con I2C(sda=.., scl=..)).",
                    highlight: (tm) => tm.highlightPins([
                        { type: "esp32_wroom", match: (p) => p.type === "gpio" && !p.inputOnly && p.signal !== "uart" },
                        { type: "tcs34725", match: (p) => ["sda", "scl"].includes(p.id) },
                    ]),
                    isDone: (tm) => ["sda", "scl"].every((id) => tm.hasWireBetween(
                        (pin) => pin.type === "gpio" && !pin.inputOnly && pin.signal !== "uart",
                        (comp, pin) => comp.type === "tcs34725" && pin.id === id,
                    )),
                },
                {
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación y correr el firmware.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe o carga tu código",
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
            id: "espnow_led",
            title: "ESP-NOW: control remoto de un LED",
            icon: "📡",
            category: "📡 Comunicación inalámbrica",
            demoGif: "assets/tutorial-demos/espnow_led.gif",
            demoCaption: "Dos ESP32 hablando por ESP-NOW: al presionar el botón de uno, el LED del otro se enciende -- sin ningún cable entre ambas placas.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la primera ESP32",
                    text: "Vamos a usar DOS ESP32: una manda la orden (con un botón) y la otra prende un LED al recibirla -- así se ve, sin dudas, que el mensaje de verdad llegó. Arrastra la primera ESP32 al lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Coloca una segunda ESP32",
                    text: "Arrastra OTRA ESP32 al lienzo, aparte de la primera -- con 2 o más ESP32 presentes va a aparecer un selector de dispositivo arriba del panel MicroPython, para elegir cuál estás mirando/programando en cada momento.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponentCount("esp32_wroom", 2),
                },
                {
                    title: "Paso 4 — Toma un botón",
                    text: "Arrastra el botón KY-004 desde el panel de componentes hasta el lienzo -- va a ser el control remoto.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("ky_004"),
                    isDone: (tm) => tm.hasComponent("ky_004"),
                },
                {
                    title: "Paso 5 — Conecta el GND del botón",
                    text: "Traza un cable desde un pin GND de CUALQUIERA de las dos ESP32 hasta el GND del botón -- esa va a ser la ESP32 \"emisora\".",
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
                    title: "Paso 6 — Conecta la alimentación del botón",
                    text: "Conecta un pin 3V3 de la MISMA ESP32 que usaste en el paso anterior al VCC del botón.",
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
                    title: "Paso 7 — Conecta la señal del botón",
                    text: "Elige un pin GPIO libre de esa misma ESP32 y conéctalo a la S (señal) del botón.",
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
                    title: "Paso 8 — Toma un LED",
                    text: "Arrastra un LED hasta el lienzo -- lo vamos a conectar a la OTRA ESP32 (la que NO tiene el botón), la \"receptora\".",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("led"),
                    isDone: (tm) => tm.hasComponent("led"),
                },
                {
                    title: "Paso 9 — Conecta el GND del LED",
                    text: "Conecta un GND de la ESP32 que NO tiene el botón al cátodo (–, la pata corta) del LED.",
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
                    title: "Paso 10 — Conecta el ánodo del LED",
                    text: "Elige un pin GPIO libre de esa misma ESP32 (la que NO tiene el botón) y conéctalo al ánodo (+, la pata larga) del LED.",
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
                    title: "Paso 11 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 12 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para arrancar las DOS ESP32 a la vez.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 13 — Elige la ESP32 del LED y programa el receptor",
                    text: "Usa el selector de arriba del panel MicroPython para elegir la ESP32 que tiene el LED. Pega este código (fijate la MAC que imprime -- la vas a necesitar en el paso siguiente) y dale ▶ Ejecutar:\n\nimport network, espnow\nfrom machine import Pin\n\nled = Pin(2, Pin.OUT)  # cambia el 2 por el numero de tu GPIO\n\nsta = network.WLAN(network.WLAN.IF_STA)\nsta.active(True)\nprint('Mi MAC:', sta.config('mac').hex())\n\ne = espnow.ESPNow()\ne.active(True)\n\ndef on_recv(e):\n    mac, msg = e.recv()\n    if msg == b'on':\n        led.value(1)\n    elif msg == b'off':\n        led.value(0)\n\ne.irq(on_recv)\nprint('Esperando ordenes...')",
                    highlight: (tm) => tm.highlightElements(["#replDeviceSelect", "#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                },
                {
                    title: "Paso 14 — Elige la ESP32 del botón y programa el emisor",
                    text: "Ahora cambia el selector a la OTRA ESP32 (la del botón) y pega este código -- reemplaza AABBCCDDEEFF por la MAC que te imprimió el receptor en el paso anterior (sin los \":\"):\n\nimport network, espnow\nfrom machine import Pin\nimport time\n\nboton = Pin(4, Pin.IN, Pin.PULL_DOWN)  # cambia el 4 por tu GPIO de señal\n\nsta = network.WLAN(network.WLAN.IF_STA)\nsta.active(True)\n\ne = espnow.ESPNow()\ne.active(True)\npeer = bytes.fromhex('AABBCCDDEEFF')\ne.add_peer(peer)\n\nestado = False\nwhile True:\n    if boton.value():\n        estado = not estado\n        e.send(peer, b'on' if estado else b'off')\n        print('Mandado:', 'on' if estado else 'off')\n        time.sleep(0.3)  # evita mandar muchas veces de un solo apreton\n    time.sleep(0.05)\n\nDale ▶ Ejecutar, apreta el botón del lienzo, y volvé a elegir la otra ESP32 en el selector para ver el LED prendido.",
                    highlight: (tm) => tm.highlightElements(["#replDeviceSelect", "#replPanel .repl-header", "#replBtnRun"]),
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                    isLast: true,
                },
],
        },
        {
            id: "wifi_led",
            title: "WiFi: prender un LED desde internet",
            icon: "🌐",
            category: "📡 Comunicación inalámbrica",
            demoGif: "assets/tutorial-demos/wifi_led.gif",
            demoCaption: "Cuando llega la orden \"on\" u \"off\" desde internet, el LED se prende o se apaga -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma un LED",
                    text: "Arrastra un LED desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("led"),
                    isDone: (tm) => tm.hasComponent("led"),
                },
                {
                    title: "Paso 4 — Conecta el GND del LED",
                    text: "Traza un cable desde un pin GND de la ESP32 hasta el cátodo (–, la pata corta) del LED.",
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
                    title: "Paso 5 — Conecta el ánodo del LED",
                    text: "Elige un pin GPIO libre de la ESP32 y conéctalo al ánodo (+, la pata larga) del LED.",
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
                    title: "Paso 6 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 7 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 8 — Escribe tu código",
                    text: "Elegí un nombre de canal único (ej. tuNombre-123) y pegá este código, cambiando CANAL por el tuyo:\n\nimport network, time, requests, json\nfrom machine import Pin\n\nled = Pin(2, Pin.OUT)  # cambia el 2 por tu GPIO\n\nwlan = network.WLAN(network.WLAN.IF_STA)\nwlan.active(True)\nwlan.connect('CualquierNombre', 'CualquierClave')\nwhile not wlan.isconnected():\n    time.sleep(0.1)\nprint('Conectado!')\n\nCANAL = 'tuNombre-123'\nvisto = set()\n\nwhile True:\n    r = requests.get('https://ntfy.sh/' + CANAL + '/json?poll=1')\n    for linea in r.text.strip().split('\\n'):\n        if not linea:\n            continue\n        msg = json.loads(linea)\n        if msg['id'] not in visto:\n            visto.add(msg['id'])\n            if msg['message'] == 'on':\n                led.value(1)\n            elif msg['message'] == 'off':\n                led.value(0)\n            print('Recibido:', msg['message'])\n    time.sleep(2)",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                },
                {
                    title: "Paso 9 — Probalo mandando un mensaje real",
                    text: "Con tu código corriendo (▶ Ejecutar), abrí https://ntfy.sh/tuNombre-123 (tu mismo canal) en OTRA pestaña del navegador -- o desde tu celular, abriendo telefono_virtual.html (está en la carpeta del proyecto). Mandá el texto \"on\" o \"off\" y mirá la terminal: el LED del lienzo tiene que prender o apagar en un par de segundos.",
                    highlight: (tm) => tm.highlightElements(["#workspace"]),
                    isDone: () => true,
                    isLast: true,
                },
],
        },
        {
            id: "ble_servo",
            title: "Bluetooth (BLE): mover un servo desde el teléfono virtual",
            icon: "📱",
            category: "📡 Comunicación inalámbrica",
            demoGif: "assets/tutorial-demos/ble_servo.gif",
            demoCaption: "Cada comando que mandás desde el teléfono virtual (0, 90 o 180) mueve el servo a esa posición -- esto es lo que vas a armar y programar en los pasos de abajo.",
            steps: [
                {
                    title: "Paso 1 — Crea un proyecto nuevo",
                    text: "Antes de empezar, hace clic en \"🆕 Nuevo\" (menú 📁 Archivo) para arrancar con el lienzo vacío -- si no, el circuito de otro tutorial o proyecto anterior puede quedar mezclado con el que vas a armar ahora.",
                    highlight: (tm) => tm.highlightElements(["#pdNewProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => tm.simulator.componentManager.getAll().length === 0,
                },
                {
                    title: "Paso 2 — Coloca la ESP32",
                    text: "Arrastra la placa ESP32 WeMos D1 R32 desde el panel de componentes hasta el lienzo.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("esp32_wroom"),
                    isDone: (tm) => tm.hasComponent("esp32_wroom"),
                },
                {
                    title: "Paso 3 — Toma el servo",
                    text: "Arrastra el Servo SG90 desde el panel de componentes hasta el lienzo -- lo vamos a mover a control remoto por Bluetooth.",
                    highlight: (tm) => tm.highlightToolboxAndCanvas("sg90"),
                    isDone: (tm) => tm.hasComponent("sg90"),
                },
                {
                    title: "Paso 4 — Conecta el GND",
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
                    title: "Paso 5 — Conecta la alimentación",
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
                    title: "Paso 6 — Conecta la señal",
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
                    title: "Paso 7 — Guarda tu proyecto",
                    text: "Antes de simular, guarda tu proyecto (💾 Guardar, en el menú 📁 Archivo) -- así no perdés el circuito que armaste si la página se recarga o algo falla a mitad de la simulación.",
                    highlight: (tm) => tm.highlightElements(["#pdSaveProject"]),
                    onEnter: () => {
                        document.getElementById("projectDrawer")?.classList.remove("hidden");
                        document.getElementById("btnProjectMenu")?.classList.add("active");
                    },
                    isDone: (tm) => !tm.simulator.projectManager.dirty,
                },
                {
                    title: "Paso 8 — Simula el circuito",
                    text: "Presiona ▶ Simular, arriba a la derecha, para iniciar la simulación.",
                    highlight: (tm) => tm.highlightElements(["#btnSimToggle"]),
                    isDone: (tm) => !!tm.simulator.isRunning,
                },
                {
                    title: "Paso 9 — Escribe tu código",
                    text: "Pega este código (usa la librería BLEUART, la forma más simple de BLE) y dale ▶ Ejecutar:\n\nfrom BLE import BLEUART\nfrom machine import Pin, PWM\nimport bluetooth\n\nservo = PWM(Pin(13), freq=50)  # cambia el 13 por tu GPIO de señal\n\nble = bluetooth.BLE()\nuart = BLEUART(ble, 'MiServo')\n\ndef datos_recibidos():\n    msg = uart.read().decode().strip()\n    print('Recibido:', msg)\n    if msg == '0':\n        servo.duty(26)    # ~0 grados\n    elif msg == '90':\n        servo.duty(74)    # ~90 grados\n    elif msg == '180':\n        servo.duty(123)   # ~180 grados\n\nuart.irq(handler=datos_recibidos)\nprint('Esperando conexion BLE...')",
                    highlight: (tm) => tm.highlightElements(["#replPanel .repl-header", "#replBtnRun"]),
                    onEnter: (tm) => {
                        if (tm.replPanel && !tm.replPanel.open) tm.replPanel.toggle();
                        tm.replPanel?.switchTab("editor");
                    },
                    isDone: (tm) => !!tm.replPanel?.editor?.value?.trim(),
                },
                {
                    title: "Paso 10 — Abre el teléfono virtual y conectá",
                    text: "Abrí el panel 📱 (arriba a la derecha) -- tu ESP32 (\"MiServo\") debería aparecer en la lista apenas corriste el código. Elegila y dale \"Conectar\".",
                    highlight: (tm) => tm.highlightElements(["#btnBlePanelToggle"]),
                    onEnter: () => {
                        const panel = document.getElementById("blePanel");
                        if (panel?.classList.contains("ble-closed")) {
                            document.getElementById("btnBlePanelToggle")?.click();
                        }
                    },
                    isDone: () => !document.getElementById("blePanel")?.classList.contains("ble-closed"),
                },
                {
                    title: "Paso 11 — Mandá \"0\", \"90\" o \"180\"",
                    text: "Escribí uno de esos tres números en el teléfono virtual y dale Enviar -- el servo del lienzo tiene que girar al ángulo que mandaste. Probá los tres para confirmar que el control remoto funciona de punta a punta.",
                    highlight: (tm) => tm.highlightElements(["#blePanel"]),
                    isDone: () => true,
                    isLast: true,
                },
],
        },
    ];

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
                    <img class="tutorial-modal-media hidden" alt="Demostración animada del resultado esperado" />
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
            media:       this.modal.querySelector(".tutorial-modal-media"),
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

        // Demo visual (GIF) -- ver el "Paso 0" sintético armado en el
        // constructor. Solo ese paso trae "media"; el resto del modal
        // sigue sin imagen, como siempre.
        if (step.media) {
            this._els.media.src = step.media;
            this._els.media.classList.remove("hidden");
        } else {
            this._els.media.classList.add("hidden");
            this._els.media.removeAttribute("src"); // no seguir descargando/mostrando el gif anterior de fondo
        }

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

    // Para pasos tipo "coloca una SEGUNDA ESP32" (tutoriales de
    // comunicación inalámbrica, ver categoría "📡 Comunicación
    // inalámbrica") -- hasComponent() de arriba no alcanza porque ya
    // da true con la PRIMERA.
    hasComponentCount(type, min) {
        return this.simulator.componentManager.getAll().filter((c) => c.type === type).length >= min;
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
