/*
==========================================================
 PitSimulator
 Archivo: app.js
 Punto de entrada — arranca el simulador y todos los módulos UI
==========================================================
*/

(async () => {

    // Precalienta en segundo plano la descarga del runtime WASM de
    // MicroPython (~480kB comprimido) ni bien arranca la página --
    // antes se pedía recién al apretar "▶ Simular" (ver
    // Simulator.spawnBridgesForAllEsp32() -> WasmBridge -> wasmWorker.js
    // -> assets/wasm/micropython.mjs), y en vivo (GitHub Pages,
    // Cache-Control: max-age=600 + posible MISS de CDN) eso tardaba
    // 9-20s en frío -- confirmado con el waterfall real que mandó el
    // usuario. fetch() sin opciones = misma cache key que el fetch
    // interno real del loader de Emscripten, así que para cuando el
    // usuario llega a apretar Simular ya está en la cache HTTP del
    // navegador. Fire-and-forget: si falla (sin conexión, etc.) el
    // loader real de más adelante reintenta solo y reporta el error
    // como siempre -- esto es optimización pura, no hace falta nada
    // en modo QEMU (#modo=qemu), que no usa este runtime.
    if (location.hash !== "#modo=qemu") {
        fetch("assets/wasm/micropython.wasm").catch(() => {});
    }

    // Flag global de debug -- apagado por default. En vez de andar
    // buscando console.log comentados en 3-4 archivos distintos cada
    // vez que hace falta diagnosticar algo (escaneo de teclado,
    // cambios de GPIO, etc.), alcanza con esto en la consola del
    // navegador y volver a correr el circuito:
    //   window.PIT_DEBUG = true
    // No pisa nada si ya estaba seteado antes de que cargara este
    // script (ej. alguien lo puso a mano ANTES de F5 para que quede
    // prendido desde el arranque).
    window.PIT_DEBUG = window.PIT_DEBUG || false;

    // 0. Cargar el behavior custom (señal/render/panel) de cada
    //    componente declarado en components/manifest.json, ANTES de
    //    crear el Simulator -- SignalEngine/Renderer/PropertyPanel
    //    consultan ComponentBehaviorRegistry durante su propio
    //    arranque, así que el registro tiene que estar poblado antes.
    //    Ver ComponentBehaviorRegistry.js.
    await ComponentBehaviorRegistry.loadAll();

    // 1. Crear e inicializar el simulador (canvas, componentes, managers)
    const sim = new Simulator();
    await sim.start();

    // Micrófono real (INMP441, ver inmp441.hal.py/SignalEngine.js) --
    // se instancia acá pero NO pide permiso todavía, eso recién pasa
    // al primer I2S(mode=I2S.RX) que construya el firmware (ver
    // MicCapture.start(), llamado desde SignalEngine.requestMicCapture()).
    sim.micCapture = new MicCapture(sim);

    // 1b. Si se entró con un link compartido (botón 🔗, ver
    //     ShareProject.js), reemplaza lo que acaba de restaurar
    //     sim.start() desde localStorage por el proyecto que viajó en
    //     el hash -- TIENE que pasar antes de crear ReplPanel: éste
    //     busca el código guardado del ESP32 activo apenas arranca, y
    //     ese código tiene que ser ya el del proyecto compartido, no
    //     el viejo de localStorage.
    await ShareProject.tryLoadFromHash(sim);

    // 2. Panel REPL (parte inferior — MicroPython / QEMU)
    //    QemuBridge se crea dentro de Simulator.start() → initializeManagers()
    //    ReplPanel se suscribe al EventBus para recibir output del bridge
    const replPanel = new ReplPanel(sim);

    // 2a. Ventanas REPL flotantes, una por ESP32 (ver Fase 2.5 del plan
    //     ESP-NOW/multi-ESP32) -- botón 🗗 junto al selector de
    //     dispositivo de replPanel (oculto salvo con 2+ ESP32, mismo
    //     criterio que el selector). Se asigna DESPUÉS de construir
    //     replPanel porque su botón 🗗 llama a replPanel.windowManager
    //     recién al hacer click (closure, no al construirse) -- no hay
    //     problema de orden real, pero se deja este mismo acá al lado
    //     para que quede claro que van juntos.
    const replWindowManager = new ReplWindowManager(sim);
    replPanel.windowManager = replWindowManager;

    // 2b. Teléfono virtual BLE (ver plan ESP-NOW→WiFi→BLE, última fase)
    //     -- panel aparte, no depende de ReplPanel, solo del eventBus.
    const blePanel = new BlePanel(sim);

    // 2c. Control remoto virtual IR (KY-022) -- mismo criterio que
    //     blePanel, panel aparte, no depende de ReplPanel.
    const irRemotePanel = new IrRemotePanel(sim);

    // 3. WasmBridge (modo 100% navegador, sin QEMU/servidor -- ver plan
    //    "PitSimulator en GitHub Pages") -- AHORA EL DEFAULT. Desde que
    //    el modo navegador llegó a cubrir prácticamente todo el
    //    catálogo de componentes (ver los commits de esta sesión), se
    //    decidió dejar de incorporar QEMU en el uso normal de la app
    //    -- no se borra nada de QemuBridge.js/server.js (sigue andando
    //    tal cual para quien lo necesite), pero ya no es lo que se
    //    arranca por default. Para volver a QEMU explícitamente (ej.
    //    para probar ese camino, o un componente que el modo navegador
    //    todavía no cubra), entrar con el hash "#modo=qemu" -- mismo
    //    mecanismo de siempre, invertido.
    //    Se decide UNA sola vez acá, antes de que exista cualquier
    //    bridge -- nunca se reemplaza en caliente (evita el problema
    //    real que encontramos de un QemuBridge viejo quedando con su
    //    propio listener de "simulation:start" todavía activo).
    //    Cambiar de modo = recargar la página con el hash puesto o
    //    sacado.
    //    Hash y no query string a propósito -- confirmado en la
    //    práctica que el dev server (`serve`) redirige /index.html a
    //    /index y en el camino pierde el query string; un hash nunca
    //    se manda al servidor, así que ningún redirect lo puede tocar.
    //
    //    Multi-ESP32 (ver plan ESP-NOW): en modo navegador ya no se crea
    //    UN WasmBridge fijo acá -- Simulator.spawnBridgesForAllEsp32()
    //    crea uno POR CADA ESP32 presente en el lienzo recién al recibir
    //    "simulation:start" (▶ Simular), porque antes de eso no se sabe
    //    cuántos va a haber (el usuario puede agregar/cargar componentes
    //    después de este punto). QemuBridge sigue siendo la única
    //    instancia global de siempre (multi-instancia de QEMU queda
    //    fuera de alcance del plan) -- se sigue creando acá mismo, sin
    //    pasar por el Simulator.
    const qemuMode = location.hash === "#modo=qemu";
    if (qemuMode) {
        sim.qemuBridge = new QemuBridge(sim);
    } else {
        sim.eventBus.on("simulation:start", () => sim.spawnBridgesForAllEsp32());
        sim.eventBus.on("simulation:stop",  () => sim.teardownAllBridges());
    }

    // 4. Toolbar (botones superiores: eliminar, zoom)
    const toolbar = new Toolbar(sim);

    // 5. Toolbox (panel izquierdo: lista de componentes arrastrables)
    const toolbox = new Toolbox(sim);

    // 6. PropertyPanel (panel derecho: propiedades del componente seleccionado)
    const propertyPanel = new PropertyPanel(sim);

    // 7. Selector de tutoriales + modal flotante paso a paso (botón 🎓
    //    junto al logo) -- necesita replPanel para el último paso
    //    ("abrí el editor y escribí tu código"), por eso se crea
    //    después de él.
    const tutorialManager = new TutorialManager(sim, replPanel);

    // 7b. Tutoriales importados por docentes (archivo .json o link
    //     #tutorial=...) -- ver TutorialImport.js / TutorialFormat.js.
    const tutorialImport = new TutorialImport(tutorialManager);

    // 8. Generador de reporte de la práctica (botón 📄 junto al nombre
    //    del proyecto) -- necesita toolbar (captura del circuito) y
    //    replPanel (código del editor), por eso se crea después de ambos.
    const reportGenerator = new ReportGenerator(sim, replPanel, toolbar);

    // 8b. Compartir proyecto (botón 🔗, junto al 📄 de arriba) -- link +
    //     QR autocontenidos, sin backend (ver ShareProject.js). Necesita
    //     replPanel para volcar el código del editor al ESP32 activo
    //     justo antes de armar el link (_persistActiveDeviceCode()).
    const shareProject = new ShareProject(sim, replPanel);

    // 9. Editor de bloques (botón 🧩 junto al nombre del proyecto) --
    //    overlay a pantalla completa, portado de AppBlock3 (ver plan
    //    de este cambio). Necesita replPanel para meter el Python
    //    generado en el editor que ya existe (codeMirror.setValue +
    //    switchTab("editor")), por eso se crea después de él.
    const blocklyPanel = new BlocklyPanel(sim, replPanel);

    // 10. Exponer globalmente para debug en consola del navegador
    window.sim             = sim;
    window.replPanel       = replPanel;
    window.replWindowManager = replWindowManager;
    window.blePanel        = blePanel;
    window.irRemotePanel   = irRemotePanel;
    window.tutorialManager = tutorialManager;
    window.tutorialImport  = tutorialImport;
    window.toolbar         = toolbar;
    window.reportGenerator = reportGenerator;
    window.shareProject    = shareProject;
    window.blocklyPanel    = blocklyPanel;
    window.propertyPanel   = propertyPanel;

    // 11. Tutorial de bienvenida -- pedido del usuario: que se vea
    //     "Conocé la interfaz" SIEMPRE que se abre la app (no solo la
    //     primera vez), para que cualquiera -- alumno nuevo o
    //     recurrente -- tenga a mano el recorrido completo de dónde
    //     está cada cosa. Mismo tutorial que dispara el botón 🎓
    //     (TutorialManager.start(), ver su propio archivo) -- acá se
    //     llama solo, sin que el usuario haga clic en nada. Al final
    //     del IIFE a propósito: necesita que TODO lo de arriba (DOM
    //     del toolbox/projectDrawer/replPanel/etc.) ya exista, aunque
    //     el tutorial en sí solo resalta elementos del DOM estático
    //     (no depende de ningún otro objeto JS de los de arriba).
    //     "pdReload" (botón Recargar del menú Archivo) hace
    //     location.reload() -- una recarga completa de página, así
    //     que vuelve a pasar por acá solo, sin necesitar ningún código
    //     aparte en Toolbar.js para el caso "recargar".
    tutorialManager.start("recorrido_interfaz");

    // 12. Si se entró con un link de tutorial (#tutorial=...), mostrar
    //     qué contiene y pedir confirmación -- nunca se agrega solo.
    await tutorialImport.tryLoadFromHash();

    console.log("✅ 3DPitSimu listo. REPL panel activo.");
    console.log("   Atajo: Ctrl+` para abrir/cerrar el REPL");

})();