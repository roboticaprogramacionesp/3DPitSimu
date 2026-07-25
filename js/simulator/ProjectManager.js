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
        this.loadFromLocalStorage();

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
            color: wire.color
        }));

        return {
            version: "1.0",
            timestamp: Date.now(),
            components,
            wires
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

        try {

            // Limpiar canvas actual
            this.simulator.componentManager.clear();
            this.simulator.wireManager.wires = [];
            this.simulator.selectionManager.clear();
            this.simulator.wireLayer.innerHTML = "";
            this.simulator.componentLayer.innerHTML = "";

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
                    this.simulator.renderer.renderComponent(component);
                }
            }

            // Restaurar cables
            for (const wireData of data.wires) {
                const wire = {
                    id: wireData.id,
                    from: wireData.from,
                    to: wireData.to,
                    points: wireData.points,
                    color: wireData.color
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

    loadFromLocalStorage() {

        (async () => {
            try {

                // Migración: además de la clave actual, se revisa la
                // clave legacy de versiones muy anteriores de
                // PitSimulator -- así nadie pierde su circuito guardado
                // al actualizar.
                const saved = localStorage.getItem(this.storageKey)
                    || localStorage.getItem(this.legacyStorageKey);

                if (!saved) return;

                const data = JSON.parse(saved);
                await this.deserialize(data);

                if (window?.location?.search?.includes("debug=1")) {
                    console.log("[ProjectManager] ✅ Cargado desde localStorage");
                }

            } catch (err) {

                console.warn("[ProjectManager] No se pudo cargar de localStorage:", err);

            }
        })();

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

        if (this.dirty) {

            const ok = confirm(
                "Hay cambios sin guardar.\n\n¿Abrir otro proyecto de todas formas? Se perderán los cambios que todavía no guardaste."
            );

            if (!ok) return false;

        }

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

        if (this.fileHandle) {

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