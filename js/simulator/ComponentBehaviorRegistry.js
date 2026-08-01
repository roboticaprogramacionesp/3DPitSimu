/*
==========================================================
 PitSimulator
 Archivo: ComponentBehaviorRegistry.js

 Registro de comportamiento por tipo de componente.

 Por qué existe: antes de este archivo, agregar un componente
 nuevo obligaba a tocar tres archivos centrales a mano
 (SignalEngine.evaluateAll(), Renderer.renderComponent() y
 PropertyPanel.show()), cada uno con un if/else que enumeraba
 cada component.type. Con este registro, un componente declara
 su propio comportamiento (señal / render / panel de
 propiedades) en components/<type>/<type>.behavior.js -- un
 archivo que se auto-registra llamando a
 ComponentBehaviorRegistry.register(...) -- y los tres
 dispatchers centrales solo consultan el registro en vez de
 conocer cada tipo de antemano.

 Un componente puede registrar solo los ganchos que necesita.
 Si no hay behavior registrado para un type, el motor sigue el
 camino genérico (sin evaluate custom, .svg normal sin tag
 especial, panel genérico) -- esto es lo que YA pasa hoy con la
 mayoría de sensores simples.

 Forma de un behavior:
   {
     signal: {
       evaluate(component, engine) { ... },        // reemplaza evaluateXxx()
       resync(component, engine) { ... }           // ver nota "resync" abajo
     },
     render: {
       usesCodeGraphic: false,                      // true = se dibuja por código (sin .svg), ej. neopixel_matrix/max7219
       tag(component, graphic, renderer) { ... },     // reemplaza tagXxxElements()
       initialState(component, renderer) { ... },     // reemplaza el bloque "estado inicial" al crear el componente
     },
     propertyPanel: {
       render(component, panel) { ... }    // reemplaza _renderXxx() -- "panel" es la instancia de PropertyPanel (panel.content, panel.simulator, etc.)
     },
   }

 "resync" (opcional, gancho "signal"): para componentes cuyo
 estado se manda al firmware SOLO en el momento de una
 interacción puntual (ej. RC522: setRc522PresentedCard() solo
 se llama desde el click del toggle Hold/TAP en el panel de
 propiedades) -- ese estado NUNCA se re-envía solo si la
 conexión a QEMU se reinicia (server.js reinicia el proceso, o
 el usuario recarga la página) o si viene de un proyecto
 recién cargado (properties.holding=true restaurado desde
 disco, pero jamás enviado de verdad). SignalEngine.
 resyncAllComponents() llama este gancho para cada componente
 del canvas después de reconectar a QEMU (ver "qemu:connected"
 en ReplPanel.js, después de preloadHal()) -- el behavior debe
 revisar su propio estado persistido (component.properties) y
 volver a llamar al setter correspondiente si corresponde.

 Ver README.md -- sección "Cómo agregar un componente nuevo".
==========================================================
*/

class ComponentBehaviorRegistry {

    static _behaviors = {};

    //------------------------------------------------------
    // Registrar el comportamiento de uno o más tipos.
    //
    // "types" puede ser un string o un array de strings --
    // esto último es para tipos que comparten EXACTAMENTE el
    // mismo comportamiento (ej. "lcd16x2" y "lcd_16x2_i2c",
    // mismo criterio que ya usa Renderer.isLcd() para agrupar
    // ambos tipos concretos bajo un solo helper).
    //------------------------------------------------------

    static register(types, behavior) {

        const list = Array.isArray(types) ? types : [types];

        list.forEach(type => {

            if (ComponentBehaviorRegistry._behaviors[type]) {
                console.warn(`[ComponentBehaviorRegistry] "${type}" ya tenía un behavior registrado -- se sobreescribe.`);
            }

            ComponentBehaviorRegistry._behaviors[type] = behavior;

        });

    }

    //------------------------------------------------------
    // Consultar el behavior de un tipo (null si no tiene --
    // caso normal para la mayoría de los componentes).
    //------------------------------------------------------

    static get(type) {

        return ComponentBehaviorRegistry._behaviors[type] || null;

    }

    //------------------------------------------------------
    // Cargar dinámicamente components/<type>/<type>.behavior.js
    // para cada entrada de components/manifest.json.
    //
    // Un 404 acá es el caso NORMAL y esperado (la mayoría de los
    // componentes todavía no tienen behavior custom) -- por eso
    // _loadOne() nunca rechaza la promesa, solo resuelve. Se
    // llama UNA vez al arrancar la app (ver app.js), antes de
    // crear el Simulator, para que el registro ya esté poblado
    // cuando SignalEngine/Renderer/PropertyPanel lo consulten.
    //------------------------------------------------------

    static async loadAll() {

        const raw = await Utils.loadJSON("components/manifest.json") || [];

        // Mismo criterio de compatibilidad de formato que ya usa
        // Toolbox.js (ver Toolbox.init()): array plano legacy, o
        // { components: [...] } nuevo.
        let entries;

        if (Array.isArray(raw)) {
            entries = raw.map(type => ({ type }));
        } else if (raw.components && Array.isArray(raw.components)) {
            entries = raw.components;
        } else {
            entries = [];
        }

        await Promise.all(entries.map(entry => ComponentBehaviorRegistry._loadOne(entry)));

    }

    // FIX real (a pedido: "esto como lo solucionamos" sobre el ruido
    // de 404 en consola): antes esto probaba directo con un <script
    // src="...">, y un <script> que falla en cargar SIEMPRE queda
    // logueado por el navegador en la consola (net::ERR_ABORTED 404)
    // sin importar que el onerror de acá abajo lo maneje bien -- el
    // catch de JS no puede suprimir ese log, es el propio navegador
    // reportando la carga de un recurso fallida, a nivel de red, no
    // a nivel de excepción. La mayoría de los componentes de este
    // catálogo NO tienen behavior.js (nunca lo necesitaron), así que
    // esto se veía en CADA carga de página, para prácticamente todos
    // los tipos.
    //
    // Primer intento (revertido): probar antes con fetch(...,
    // {method:"HEAD"}) para chequear existencia sin <script>. NO
    // funcionó -- confirmado en la práctica que Chrome loguea
    // "Failed to load resource: ... 404" en la consola IGUAL para un
    // fetch() con status 404, no solo para <script>/<img> -- la
    // premisa de que fetch() era "silencioso" para HTTP no-2xx
    // estaba mal.
    //
    // Fix real: en vez de PREGUNTARLE al servidor si el archivo
    // existe (con cualquier método), el propio manifest.json ya
    // DECLARA qué tipos tienen behavior.js (campo "hasBehavior":
    // true) -- so acá simplemente no se intenta ninguna carga de
    // red para los que no lo tienen, cero requests, cero 404s
    // posibles. Si un componente nuevo agrega su behavior.js, hay
    // que sumar "hasBehavior": true a su entrada del manifest (un
    // recordatorio de esto vive en el comentario de manifest.json
    // si hace falta agregarlo).
    static _loadOne(entry) {

        if (!entry.hasBehavior) return Promise.resolve();

        const type = entry.type;

        return new Promise((resolve) => {

            const script = document.createElement("script");
            script.src = `components/${type}/${type}.behavior.js`;

            script.onload = () => resolve();

            script.onerror = () => {
                // Esto significaría que el manifest miente (dice
                // hasBehavior:true pero el archivo no está) -- avisar
                // en vez de fallar en silencio, para que se note el
                // manifest desactualizado en vez de un componente que
                // "no hace nada" sin ninguna pista de por qué.
                console.warn(`[ComponentBehaviorRegistry] manifest.json dice hasBehavior:true para "${type}" pero components/${type}/${type}.behavior.js no cargó.`);
                script.remove();
                resolve();
            };

            document.head.appendChild(script);

        });

    }

}
if (typeof module !== "undefined") module.exports = ComponentBehaviorRegistry;
