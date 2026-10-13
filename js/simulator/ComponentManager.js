/*
==========================================================
 PitSimulator
 Archivo: ComponentManager.js
 Administrador de Componentes
==========================================================
*/

class ComponentManager {

    constructor(simulator) {

        this.simulator = simulator;

        // Lista de componentes

        this.components = [];

        // Contadores para IDs automáticos

        this.counters = {};

    }

    //------------------------------------------------------
    // Generar ID
    //------------------------------------------------------

    generateId(type) {

        // Antes: `${type}_${this.counters[type]++}`. Ese contador por
        // tipo NUNCA se sincroniza cuando se restaura un proyecto
        // guardado (ver add() más abajo: si el componente ya trae un
        // id del JSON guardado, jamás se llama a generateId(), así que
        // el contador se queda atrás) -- el resultado es el mismo bug
        // que ya apareció con los cables: un componente nuevo del mismo
        // tipo podía terminar con el MISMO id que uno ya cargado (ej.
        // dos "motor_1"), y como todo se busca por id (DragManager,
        // selección, etc.), mover el segundo terminaba moviendo al
        // primero mientras el segundo quedaba quieto.
        //
        // Ahora se usa un sufijo aleatorio (Utils.generateId, ya
        // existente en el proyecto) MÁS una verificación explícita
        // contra los ids ya presentes -- no depende de ningún contador
        // ni del orden en que se cargan/crean los componentes.
        let id;

        do {
            id = Utils.generateId(type);
        } while (this.components.some(c => c.id === id));

        return id;

    }

    //------------------------------------------------------
    // Agregar componente
    //------------------------------------------------------

    add(component) {

        // Se regenera el id si falta O si ya existe otro componente con
        // ese mismo id -- este segundo caso es el que antes se pasaba
        // por alto (pasa al restaurar un proyecto guardado con ids que
        // colisionan con los de un componente recién agregado). Se hace
        // ACÁ, antes de empujarlo a this.components y antes de que
        // Renderer.renderComponent() lo dibuje, para que el "data-id"
        // del SVG y el id en memoria nunca queden desincronizados.
        if (!component.id || this.components.some(c => c.id === component.id)) {

            component.id = this.generateId(component.type);

        }

        this.components.push(component);

        console.log("Componente agregado:", component.id);

        this.simulator.eventBus.emit("component:added", { componentId: component.id, type: component.type });

        return component;

    }

    //------------------------------------------------------
    // Crear componente a partir de su definición JSON
    //
    // Busca automáticamente en: components/<type>/<type>.json
    // y usa components/<type>/<type>.svg si el JSON no
    // especifica una ruta de SVG distinta.
    //------------------------------------------------------

    async createFromDefinition(type, overrides = {}) {

        const path = `components/${type}/${type}.json`;

        const definition = await Utils.loadJSON(path);

        if (!definition) {

            console.error(`No se encontró la definición del componente "${type}" en ${path}`);
            return null;

        }

        const data = Utils.buildComponentDefinition(definition, { ...overrides, type });

        const component = new Component(data);

        return this.add(component);

    }

    //------------------------------------------------------
    // Eliminar componente
    //------------------------------------------------------

    remove(id) {

        const component = this.get(id);

        this.components = this.components.filter(c => c.id !== id);

        if (component) {
            this.simulator.eventBus.emit("component:removed", { componentId: id, type: component.type });
        }

    }

    //------------------------------------------------------
    // Buscar componente
    //------------------------------------------------------

    get(id) {

        return this.components.find(c => c.id === id);

    }

    //------------------------------------------------------
    // Obtener todos
    //------------------------------------------------------

    getAll() {

        return this.components;

    }

    //------------------------------------------------------
    // Etiqueta amigable de un ESP32 para mostrar en ventanas REPL/
    // selector -- pedido explícito del usuario: con 2-3 ESP32 en el
    // lienzo (ESP-NOW), TODAS traen el mismo nombre genérico de
    // fábrica ("ESP32 WeMos D1 R32", ver esp32_wroom.json) salvo que
    // el alumno las haya renombrado a mano, así que el nombre solo no
    // alcanza para distinguirlas -- se antepone "#N" (N = orden de
    // creación entre los ESP32 del proyecto, estable mientras no se
    // borre ninguno de en medio) para que CADA ventana/selector sea
    // identificable de un vistazo, se haya renombrado o no. Con 0-1
    // ESP32 en el proyecto no hace falta numerar nada -- mismo criterio
    // de visibilidad que ya usa ReplPanel._refreshDeviceSelector()
    // para el selector/popout/locate (ver ahí).
    //------------------------------------------------------

    getEsp32DisplayLabel(esp32Id) {

        const esp32s = this.components.filter(c => c.type.startsWith("esp32"));
        const index = esp32s.findIndex(c => c.id === esp32Id);
        if (index === -1) return null;

        const esp32 = esp32s[index];
        return esp32s.length > 1 ? `#${index + 1} ${esp32.name}` : esp32.name;

    }

    //------------------------------------------------------
    // Limpiar simulador
    //------------------------------------------------------

    clear() {

        this.components = [];

        this.counters = {};

    }

}