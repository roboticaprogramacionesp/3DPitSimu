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
       evaluate(component, engine) { ... }        // reemplaza evaluateXxx()
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

        await Promise.all(entries.map(entry => ComponentBehaviorRegistry._loadOne(entry.type)));

    }

    static _loadOne(type) {

        return new Promise((resolve) => {

            const script = document.createElement("script");
            script.src = `components/${type}/${type}.behavior.js`;

            script.onload = () => resolve();

            script.onerror = () => {
                // No es un error real -- este type simplemente no
                // tiene behavior.js todavía. Se quita el <script>
                // fallido del DOM para no dejar basura acumulándose
                // ahí (no afecta nada funcionalmente, es solo prolijidad).
                script.remove();
                resolve();
            };

            document.head.appendChild(script);

        });

    }

}
if (typeof module !== "undefined") module.exports = ComponentBehaviorRegistry;
