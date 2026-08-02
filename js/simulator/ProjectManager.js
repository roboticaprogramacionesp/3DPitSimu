/*
==========================================================
 PitSimulator — ProjectManager.js
 Persistencia: guardar/cargar proyectos en localStorage
 + export/import como JSON
==========================================================
*/

class ProjectManager {

    constructor(simulator) {

        this.simulator = simulator;

        // Un solo proyecto "activo" en localStorage -- se trabaja de a
        // uno (según lo pedido), así que no hace falta ningún registro
        // con nombres: guardar siempre pisa este mismo slot.
        this.storageKey = "pit_project_data";

        // Clave legacy de versiones muy anteriores de PitSimulator
        // (antes de que este archivo tuviera siquiera "storageKey") --
        // se usa solo para migrar datos viejos, ver loadFromLocalStorage().
        this.legacyStorageKey = "pit-project_data";

        // Handle del archivo vinculado (File System Access API) -- lo
        // asigna saveProjectAs() la primera vez que el usuario elige
        // dónde guardar (o openProject() al abrir uno existente), para
        // que después Ctrl+S / "Guardar" puedan sobreescribir ESE MISMO
        // archivo sin volver a preguntar (ver saveProject()).
        this.fileHandle = null;

        // Nombre del archivo actualmente "abierto", solo para mostrar
        // en la UI (ver currentFileLabel en index.html/Toolbar.js) --
        // null = "Sin guardar" todavía. Independiente de fileHandle:
        // en navegadores sin File System Access API (Firefox, Safari)
        // igual queremos mostrar el nombre después de abrir/exportar,
        // aunque no haya vínculo real para sobreescribir en silencio.
        this.currentFileName = null;

        // Cambios sin guardar EN EL ARCHIVO actual (no en localStorage,
        // que se sigue actualizando solo de fondo como red de
        // seguridad) -- lo que un editor de texto normal mostraría como
        // el punto/asterisco al lado del nombre del archivo.
        this.dirty = false;

        this.autoSaveInterval = null;
        this.autoSaveDelay = 5000; // 5 segundos

        this.bindEvents();
        this.startAutoSave();

        // Restaurado desde acá, NO desde el constructor -- ver el
        // comentario grande en loadFromLocalStorage() sobre la
        // condición de carrera real que esto evitaba antes.

    }

    //------------------------------------------------------
    // Vincular eventos para auto-guardar + marcar "sucio"
    //------------------------------------------------------

    bindEvents() {

        const onChange = () => this.markDirty();

        this.simulator.eventBus.on("wire:added", onChange);
        this.simulator.eventBus.on("wire:removed", onChange);
        this.simulator.eventBus.on("component:moved", onChange);
        this.simulator.eventBus.on("component:dragend", onChange);
        // Antes esto envolvía (monkey-patch) HistoryManager.push() para
        // marcar "sucio" el proyecto en cada comando nuevo -- pero
        // undo()/redo() NO pasan por push() (empujan directo a sus
        // propias pilas), así que Ctrl+Z/Ctrl+Y cambiaban el canvas
        // pero nunca disparaban el auto-guardado. Ahora HistoryManager
        // emite "history:changed" para los tres casos (push/undo/redo),
        // así que alcanza con escuchar el evento -- más simple y ya no
        // depende de parchear un método ajeno.
        this.simulator.eventBus.on("history:changed", onChange);

    }

    // "Sucio" respecto del ARCHIVO (fileHandle/descarga), no de
    // localStorage -- localStorage se sigue actualizando solo cada
    // vez que esto se llama, sin importar el estado de "dirty".
    markDirty() {

        this._setDirty(true);

        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }

        this.autoSaveTimeout = setTimeout(() => {
            this.saveToLocalStorage();
        }, this.autoSaveDelay);

    }

    _setDirty(value) {

        if (this.dirty === value) return;
        this.dirty = value;
        this.simulator.eventBus.emit("project:dirty-changed", value);

    }

    _setCurrentFile(name) {

        this.currentFileName = name;
        this.simulator.eventBus.emit("project:file-changed", name);

    }

    //------------------------------------------------------
    // Renombrar el proyecto activo desde el input junto al logo
    // (ver Toolbar.bindCurrentFileLabel()). No toca fileHandle --
    // el File System Access API no permite renombrar un archivo ya
    // vinculado in situ -- así que un nombre distinto al del
    // archivo actualmente vinculado hace que el PRÓXIMO "Guardar"
    // se comporte como "Guardar como" (ver saveProject()) en vez de
    // sobreescribir en silencio el archivo viejo con el nombre
    // nuevo puesto encima.
    //------------------------------------------------------

    setProjectName(rawName) {

        let name = (rawName || "").trim();

        if (!name) {
            name = this.currentFileName || `proyecto_${new Date().toISOString().slice(0, 10)}.json`;
        } else if (!/\.json$/i.test(name)) {
            name += ".json";
        }

        if (name === this.currentFileName) return;

        this._setCurrentFile(name);
        this.markDirty();

    }

    startAutoSave() {

        this.autoSaveInterval = setInterval(() => {
            if (this.simulator.componentManager.getAll().length > 0) {
                this.saveToLocalStorage();
            }
        }, 30000); // Guardar cada 30 segundos

    }

    //------------------------------------------------------
    // Serializar estado completo
    //------------------------------------------------------

    serialize() {

        const components = this.simulator.componentManager.getAll().map(comp => ({
            id: comp.id,
            type: comp.type,
            name: comp.name,
            x: comp.x,
            y: comp.y,
            width: comp.width,
            height: comp.height,
            rotation: comp.rotation,
            scale: comp.scale,
            flipX: comp.flipX,
            properties: { ...comp.properties },
            locked: comp.locked,
            showName: comp.showName
        }));

        const wires = this.simulator.wireManager.wires.map(wire => ({
            id: wire.id,
            from: { ...wire.from },
            to: { ...wire.to },
            points: wire.points.map(p => ({ ...p })),
            color: wire.color,
            connectorType: wire.connectorType
        }));

        const annotations = this.simulator.annotationManager?.serialize() || [];

        return {
            version: "1.0",
            timestamp: Date.now(),
            components,
            wires,
            annotations
        };

    }

    //------------------------------------------------------
    // Deserializar y restaurar estado (async)
    //------------------------------------------------------

    async deserialize(data) {

        if (!data || data.version !== "1.0") {
            console.warn("[ProjectManager] Formato de proyecto inválido o versión no soportada");
            return false;
        }

        // BUG REAL encontrado (2026-08-01, "fantasmas" de componentes
        // reportados por el usuario): deserialize() no tenía ninguna
        // traba de reentrancia -- si algo llegaba a dispararlo una
        // segunda vez mientras una primera pasada todavía estaba en
        // curso (ej. clickear "Abrir proyecto" durante la restauración
        // automática al arrancar la página, ver loadFromLocalStorage()),
        // las dos corrían en paralelo y se pisaban entre sí: el
        // clear()/innerHTML="" de la SEGUNDA llegaba a mitad de la
        // PRIMERA, que seguía teniendo createFromDefinition()/
        // renderComponent() en vuelo -- esos terminaban agregando de
        // todos modos un <g> real al DOM (y hasta un componente real a
        // componentManager) por encima del estado ya limpiado por la
        // segunda pasada. Ahora una llamada mientras otra sigue en
        // curso espera a que esa termine antes de arrancar la suya
        // (en fila, nunca en paralelo) -- ninguna corre a mitad de la
        // otra, así que ningún clear()/innerHTML="" puede pisar trabajo
        // ajeno todavía en vuelo.
        if (this._deserializing) {
            await this._deserializing.catch(() => {});
        }

        let releaseLock;
        this._deserializing = new Promise((resolve) => { releaseLock = resolve; });

        try {

            // Limpiar canvas actual
            this.simulator.componentManager.clear();
            this.simulator.wireManager.wires = [];
            this.simulator.selectionManager.clear();
            this.simulator.wireLayer.innerHTML = "";
            this.simulator.componentLayer.innerHTML = "";
            this.simulator.annotationManager?.clear();

            // Restaurar componentes (usar createFromDefinition para cargar SVG)
            for (const compData of data.components) {
                const component = await this.simulator.componentManager.createFromDefinition(
                    compData.type,
                    {
                        id: compData.id,
                        name: compData.name,
                        x: compData.x,
                        y: compData.y,
                        width: compData.width,
                        height: compData.height,
                        rotation: compData.rotation,
                        scale: compData.scale,
                        flipX: compData.flipX,
                        properties: compData.properties,
                        locked: compData.locked,
                        showName: compData.showName
                    }
                );
                if (component) {
                    // await -- a diferencia de TODOS los demás call sites
                    // de renderComponent() (Renderer.renderAll(),
                    // Simulator.js:625/644), a este le faltaba (ver el
                    // comentario grande sobre la traba de reentrancia más
                    // arriba, en deserialize()).
                    await this.simulator.renderer.renderComponent(component);
                }
            }

            // Restaurar cables
            for (const wireData of data.wires) {
                const wire = {
                    id: wireData.id,
                    from: wireData.from,
                    to: wireData.to,
                    points: wireData.points,
                    color: wireData.color,
                    // Campo nuevo -- proyectos guardados antes de que
                    // existiera simplemente no lo traen, ahí se le
                    // asigna el mismo default sensato que un cable
                    // recién dibujado usaría.
                    connectorType: wireData.connectorType
                        || WireManager.defaultConnectorType(this.simulator, wireData.from, wireData.to),
                };
                this.simulator.wireManager.wires.push(wire);
            }

            // Reparar posibles ids de cable duplicados heredados de
            // proyectos guardados antes de este fix (ver WireManager.
            // ensureUniqueWireIds() -- si dos cables comparten id, al
            // seleccionar uno se seleccionaban los dos a la vez).
            this.simulator.wireManager.ensureUniqueWireIds();

            // Redibujar todo
            this.simulator.wireManager.renderAll();

            // Notas del lienzo -- campo nuevo, proyectos guardados antes
            // de que existiera simplemente no lo traen (data.annotations
            // === undefined), restore() ya maneja ese caso como lista
            // vacía sin romper nada.
            this.simulator.annotationManager?.restore(data.annotations);

            // Centrar la vista sobre lo que se acaba de cargar -- el
            // pan (offsetX/offsetY) no se guarda en el archivo, así
            // que sin esto el circuito aparecía desplazado según
            // dónde había quedado paneada la vista la última vez
            // (ver el comentario grande en Simulator.centerViewOnComponents).
            this.simulator.centerViewOnComponents();

            return true;

        } catch (err) {

            console.error("[ProjectManager] Error restaurando proyecto:", err);
            return false;

        } finally {

            releaseLock();
            this._deserializing = null;

        }

    }

    //------------------------------------------------------
    // Guardar el proyecto activo (auto-guardado y botón "Guardar")
    //------------------------------------------------------

    saveToLocalStorage() {

        try {

            const data = this.serialize();
            localStorage.setItem(this.storageKey, JSON.stringify(data));

            if (window?.location?.search?.includes("debug=1")) {
                console.log("[ProjectManager] ✅ Guardado en localStorage");
            }

        } catch (err) {

            console.warn("[ProjectManager] No se pudo guardar en localStorage:", err);

        }

    }

    //------------------------------------------------------
    // Cargar, al iniciar la página, el proyecto guardado
    //------------------------------------------------------

    // BUG REAL encontrado (2026-07-28): esto vivía en el constructor
    // como una IIFE "fire and forget" (sin await), y Simulator.start()
    // agregaba la ESP32 default de forma INCONDICIONAL un par de líneas
    // más abajo. Como un async arrow function corre en SÍNCRONO hasta
    // su primer await real, "deserialize()" alcanzaba a hacer
    // componentManager.clear() (síncrono, al principio de su propio
    // try) y arrancar el primer createFromDefinition() del proyecto
    // guardado ANTES de que el control volviera a start() -- pero
    // start() seguía ejecutando SU PROPIO createFromDefinition("esp32_
    // wroom", ...) inmediatamente después, sin saber que ya había un
    // restore en curso. Resultado: cada refresh con un proyecto
    // guardado en localStorage (o sea, casi siempre, por el auto-
    // guardado) terminaba con la ESP32 default de start() SUMADA a la
    // ESP32 que traía el proyecto restaurado -- 2 ESP32, sin que el
    // usuario hiciera nada raro. Si esa duplicación llegaba a
    // persistirse (cualquier interacción que dispare markDirty()) antes
    // del PRÓXIMO refresh, se repetía sobre un guardado ya duplicado --
    // de ahí "si le doy clic varias veces se duplica más".
    //
    // Fix: ahora es un método async normal que Simulator.start() espera
    // (await) ANTES de decidir si hace falta la ESP32 default -- ver
    // ese archivo. Devuelve true si de verdad restauró un proyecto
    // guardado (para que start() sepa que NO hace falta la default).
    async loadFromLocalStorage() {

        try {

            // Migración: además de la clave actual, se revisa la
            // clave legacy de versiones muy anteriores de
            // PitSimulator -- así nadie pierde su circuito guardado
            // al actualizar.
            const saved = localStorage.getItem(this.storageKey)
                || localStorage.getItem(this.legacyStorageKey);

            if (!saved) return false;

            const data = JSON.parse(saved);
            const restored = await this.deserialize(data);

            if (restored && window?.location?.search?.includes("debug=1")) {
                console.log("[ProjectManager] ✅ Cargado desde localStorage");
            }

            return !!restored;

        } catch (err) {

            console.warn("[ProjectManager] No se pudo cargar de localStorage:", err);
            return false;

        }

    }

    //------------------------------------------------------
    // Nuevo proyecto (hoja en blanco)
    //------------------------------------------------------

    async newProject({ askConfirm = true } = {}) {

        if (askConfirm && this.dirty) {

            const ok = confirm(
                "¿Crear un proyecto nuevo?\n\nSe perderán los cambios que todavía no guardaste."
            );

            if (!ok) return false;

        }

        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }

        // No tiene sentido dejar QEMU corriendo contra un circuito que
        // ya no va a existir en el canvas.
        if (this.simulator.isRunning) {
            this.simulator.stopSimulation();
        }

        this.simulator.componentManager.clear();
        this.simulator.wireManager.wires = [];
        this.simulator.selectionManager.clear();
        this.simulator.wireLayer.innerHTML = "";
        this.simulator.componentLayer.innerHTML = "";
        this.simulator.annotationManager?.clear();

        // Limpiar también el historial de undo/redo -- si no, un Ctrl+Z
        // después de "Nuevo proyecto" podría "revivir" componentes del
        // proyecto anterior sobre un canvas que ya se supone vacío.
        this.simulator.history.undoStack = [];
        this.simulator.history.redoStack = [];

        // Resetea zoom/pan a los valores por defecto -- sin esto, un
        // "Nuevo proyecto" pedido después de haber paneado/zoomeado
        // el circuito anterior arrancaba el canvas vacío en ESE mismo
        // pan, en vez del origen (ver Simulator.centerViewOnComponents,
        // que con 0 componentes hace exactamente este reset).
        this.simulator.centerViewOnComponents();

        // "Nuevo proyecto" no está vinculado a ningún archivo todavía --
        // el próximo "Guardar" tiene que preguntar dónde, igual que en
        // cualquier editor (Word, VSCode, etc.) al arrancar un documento
        // en blanco.
        this.fileHandle = null;
        this._setCurrentFile(null);
        this._setDirty(false);

        this.simulator.eventBus.emit("project:new");

        return true;

    }

    //------------------------------------------------------
    // Abrir: SIEMPRE un archivo real elegido por el usuario (patrón
    // estándar de "Abrir" en cualquier editor -- ya no existe la
    // distinción anterior entre "Abrir" (volvía a la última versión en
    // localStorage) y "Abrir desde archivo..." -- localStorage queda
    // reservado para la recuperación automática al recargar la página,
    // nunca como una acción explícita del menú).
    //------------------------------------------------------

    async openProject() {

        try {

            let selectedFile = null;
            let handle = null;

            if (window.showOpenFilePicker) {

                [handle] = await window.showOpenFilePicker({
                    multiple: false,
                    types: [{
                        description: "Archivos JSON",
                        accept: { "application/json": [".json"] }
                    }]
                });
                selectedFile = await handle.getFile();

            } else {

                // Fallback para navegadores sin File System Access API
                // (Firefox, Safari) -- no hay "handle" para vincular
                // futuros guardados, así que el próximo "Guardar" se
                // comporta como "Guardar como" (ver saveProject()).
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".json";
                selectedFile = await new Promise((resolve) => {
                    input.onchange = () => resolve(input.files?.[0] || null);
                    input.click();
                });

            }

            if (!selectedFile) return false;

            // El chequeo de "cambios sin guardar" va ACÁ (después de
            // elegir el archivo, no antes) -- un confirm() disparado
            // ANTES de showOpenFilePicker() le come el "user gesture"
            // del click al navegador (falla con "Must be handling a
            // user gesture to show a file picker"), reportado por el
            // usuario. Bonus: tampoco tiene sentido preguntar esto si
            // el usuario termina cancelando el picker.
            if (this.dirty) {

                const ok = confirm(
                    "Hay cambios sin guardar.\n\n¿Abrir este proyecto de todas formas? Se perderán los cambios que todavía no guardaste."
                );

                if (!ok) return false;

            }

            const text = await selectedFile.text();
            const data = JSON.parse(text);

            if (!(await this.deserialize(data))) {
                alert("❌ No se pudo abrir el proyecto (formato inválido).");
                return false;
            }

            // Abrir otro archivo corta cualquier simulación en curso --
            // mismo criterio que "Nuevo proyecto".
            if (this.simulator.isRunning) {
                this.simulator.stopSimulation();
            }

            this.simulator.history.undoStack = [];
            this.simulator.history.redoStack = [];

            this.fileHandle = handle; // null si vino del <input> fallback
            this._setCurrentFile(selectedFile.name);
            this._setDirty(false);

            return true;

        } catch (err) {

            if (err?.name !== "AbortError") {
                alert("❌ Error abriendo el archivo: " + err.message);
            }
            return false;

        }

    }

    //------------------------------------------------------
    // Guardar (Ctrl+S / botón "Guardar"): siempre actualiza
    // localStorage (red de seguridad silenciosa) y además, si hay un
    // archivo vinculado (por haber abierto o guardado uno antes),
    // lo sobreescribe en silencio -- sin mostrar ningún selector,
    // exactamente como Ctrl+S en cualquier editor de texto.
    //
    // Si todavía no hay ningún archivo vinculado (primera vez, o el
    // navegador no soporta File System Access API, o se perdió el
    // vínculo), se comporta como "Guardar como": pide ubicación.
    //------------------------------------------------------

    async saveProject() {

        this.saveToLocalStorage();

        // Si el usuario escribió un nombre nuevo en el input (ver
        // setProjectName()) desde la última vez que se vinculó este
        // archivo, "Guardar" no puede simplemente sobreescribirlo en
        // silencio bajo su nombre viejo -- no hay forma de renombrar
        // un FileSystemFileHandle in situ, así que esto cae a
        // "Guardar como" para que el nombre nuevo realmente aplique.
        if (this.fileHandle && this.fileHandle.name === this.currentFileName) {

            const ok = await this._writeToHandle(this.fileHandle);

            if (ok) {
                this._setDirty(false);
                return { savedToFile: true, fileName: this.currentFileName };
            }

            // Se perdió el vínculo (permiso revocado, archivo movido/
            // borrado) -- cae a "Guardar como" para no dejar al usuario
            // sin ninguna forma de guardar en disco.
        }

        return await this.saveProjectAs();

    }

    //------------------------------------------------------
    // Guardar como...: SIEMPRE pide ubicación (o dispara una
    // descarga, en navegadores sin File System Access API), y
    // vincula ese archivo para que los próximos "Guardar" lo
    // sobreescriban en silencio.
    //------------------------------------------------------

    async saveProjectAs() {

        this.saveToLocalStorage();

        const data = this.serialize();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const suggestedName = this.currentFileName || `proyecto_${new Date().toISOString().slice(0, 10)}.json`;

        if (window.showSaveFilePicker) {

            try {

                const handle = await window.showSaveFilePicker({
                    suggestedName,
                    types: [{
                        description: "Archivos JSON",
                        accept: { "application/json": [".json"] }
                    }]
                });

                const ok = await this._writeToHandle(handle, blob);

                if (ok) {
                    this.fileHandle = handle;
                    this._setCurrentFile(handle.name);
                    this._setDirty(false);
                    return { savedToFile: true, fileName: handle.name };
                }

                return { savedToFile: false };

            } catch (err) {

                // Cancelar debe cancelar de verdad: no se guarda nada
                // ni se descarga nada (ver bugfix histórico: antes esto
                // caía igual al fallback de <a download> de abajo).
                if (err?.name === "AbortError") {
                    return { savedToFile: false, cancelled: true };
                }

                console.warn("[ProjectManager] No se pudo abrir el selector de guardado:", err);

            }

        }

        // Fallback sin File System Access API (Firefox, Safari): no
        // hay forma de obtener un handle reutilizable, así que esto
        // dispara una descarga nueva cada vez -- "Guardar" y "Guardar
        // como" se comportan igual en estos navegadores.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedName;
        a.click();
        URL.revokeObjectURL(url);

        this._setCurrentFile(suggestedName);
        this._setDirty(false);

        return { savedToFile: true, fileName: suggestedName, downloaded: true };

    }

    //------------------------------------------------------
    // Escribir en un FileSystemFileHandle ya obtenido (por
    // showOpenFilePicker o showSaveFilePicker) -- usado tanto por
    // saveProject() (vínculo existente) como por saveProjectAs()
    // (vínculo recién creado). "blob" es opcional -- si no se pasa,
    // serializa el estado actual (caso normal de saveProject()).
    //------------------------------------------------------

    async _writeToHandle(handle, blob = null) {

        try {

            // El navegador puede haber revocado el permiso de escritura
            // (ej. pasó mucho tiempo, o el archivo se movió/borró) --
            // se re-pide antes de intentar escribir.
            if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted") {

                const perm = await handle.requestPermission({ mode: "readwrite" });

                if (perm !== "granted") {
                    // Antes esto devolvía false y dejaba this.fileHandle
                    // intacto -- como el permiso sigue sin estar
                    // otorgado, CADA Ctrl+S futuro repetía el mismo
                    // pedido silencioso y volvía a fallar sin avisar
                    // nada. Ahora se desvincula el archivo explícitamente
                    // -- el próximo intento de reconectar requiere
                    // "Guardar como..." de nuevo, en vez de reintentar
                    // en silencio para siempre.
                    if (handle === this.fileHandle) this.fileHandle = null;
                    return false;
                }

            }

            const writable = await handle.createWritable();
            await writable.write(blob || JSON.stringify(this.serialize(), null, 2));
            await writable.close();

            return true;

        } catch (err) {

            console.warn("[ProjectManager] No se pudo escribir en el archivo:", err);

            // Si el archivo ya no existe o se movió, dejamos de intentar
            // escribirle hasta que el usuario elija uno nuevo con
            // "Guardar como...".
            if (handle === this.fileHandle) this.fileHandle = null;

            return false;

        }

    }

    //------------------------------------------------------
    // Limpiar y destruir
    //------------------------------------------------------

    destroy() {

        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }

    }

}