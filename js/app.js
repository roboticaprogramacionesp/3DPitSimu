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

    // 3. QemuBridge (se inicializa aquí, después de que los componentes
    //    ya están en el canvas para que pueda encontrar el ESP32)
    sim.qemuBridge = new QemuBridge(sim);

    // 4. Toolbar (botones superiores: eliminar, zoom)
    const toolbar = new Toolbar(sim);

    // 5. Toolbox (panel izquierdo: lista de componentes arrastrables)
    const toolbox = new Toolbox(sim);

    // 6. PropertyPanel (panel derecho: propiedades del componente seleccionado)
    const propertyPanel = new PropertyPanel(sim);

    // 7. Exponer globalmente para debug en consola del navegador
    window.sim         = sim;
    window.replPanel   = replPanel;

    console.log("✅ PitSimulator listo. REPL panel activo.");
    console.log("   Atajo: Ctrl+` para abrir/cerrar el REPL");

})();