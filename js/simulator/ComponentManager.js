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

        this.components = this.components.filter(c => c.id !== id);

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
    // Limpiar simulador
    //------------------------------------------------------

    clear() {

        this.components = [];

        this.counters = {};

    }

}