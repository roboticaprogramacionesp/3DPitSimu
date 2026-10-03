/*
==========================================================
 PitSimulator
 Archivo: app.js
 Punto de entrada — arranca el simulador y todos los módulos UI
==========================================================
*/

(async () => {

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

    // 2. Panel REPL (parte inferior — MicroPython / QEMU)
    //    QemuBridge se crea dentro de Simulator.start() → initializeManagers()
    //    ReplPanel se suscribe al EventBus para recibir output del bridge
    const replPanel = new ReplPanel(sim);

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
    const qemuMode = location.hash === "#modo=qemu";
    sim.qemuBridge = qemuMode ? new QemuBridge(sim) : new WasmBridge(sim);

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

    // 8. Generador de reporte de la práctica (botón 📄 junto al nombre
    //    del proyecto) -- necesita toolbar (captura del circuito) y
    //    replPanel (código del editor), por eso se crea después de ambos.
    const reportGenerator = new ReportGenerator(sim, replPanel, toolbar);

    // 9. Editor de bloques (botón 🧩 junto al nombre del proyecto) --
    //    overlay a pantalla completa, portado de AppBlock3 (ver plan
    //    de este cambio). Necesita replPanel para meter el Python
    //    generado en el editor que ya existe (codeMirror.setValue +
    //    switchTab("editor")), por eso se crea después de él.
    const blocklyPanel = new BlocklyPanel(sim, replPanel);

    // 10. Exponer globalmente para debug en consola del navegador
    window.sim             = sim;
    window.replPanel       = replPanel;
    window.tutorialManager = tutorialManager;
    window.toolbar         = toolbar;
    window.reportGenerator = reportGenerator;
    window.blocklyPanel    = blocklyPanel;
    window.propertyPanel   = propertyPanel;

    console.log("✅ 3DPitSimu listo. REPL panel activo.");
    console.log("   Atajo: Ctrl+` para abrir/cerrar el REPL");

})();