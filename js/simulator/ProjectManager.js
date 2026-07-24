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
        // asigna exportJSON() la primera vez que el usuario elige dónde
        // guardar, para que después Ctrl+S / "Guardar" puedan
        // sobreescribir ESE MISMO archivo (ver saveToLinkedFile()).
        this.fileHandle = null;

        this.autoSaveInterval = null;
        this.autoSaveDelay = 5000; // 5 segundos

        this.bindEvents();
        this.startAutoSave();
        this.loadFromLocalStorage();

    }

    //------------------------------------------------------
    // Vincular eventos para auto-guardar
    //------------------------------------------------------

    bindEvents() {

        this.simulator.eventBus.on("wire:added", () => this.markDirty());
        this.simulator.eventBus.on("wire:removed", () => this.markDirty());
        this.simulator.eventBus.on("component:moved", () => this.markDirty());
        this.simulator.eventBus.on("component:dragend", () => this.markDirty());
        // Antes esto envolvía (monkey-patch) HistoryManager.push() para
        // marcar "sucio" el proyecto en cada comando nuevo -- pero
        // undo()/redo() NO pasan por push() (empujan directo a sus
        // propias pilas), así que Ctrl+Z/Ctrl+Y cambiaban el canvas
        // pero nunca disparaban el auto-guardado. Ahora HistoryManager
        // emite "history:changed" para los tres casos (push/undo/redo),
        // así que alcanza con escuchar el evento -- más simple y ya no
        // depende de parchear un método ajeno.
        this.simulator.eventBus.on("history:changed", () => this.markDirty());

    }

    markDirty() {

        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }

        this.autoSaveTimeout = setTimeout(() => {
            this.saveToLocalStorage();
        }, this.autoSaveDelay);

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

        if (askConfirm) {

            const ok = confirm(
                "¿Crear un proyecto nuevo?\n\nSe perderán los cambios de este proyecto que todavía no se hayan guardado."
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

        this.simulator.eventBus.emit("project:new");

        return true;

    }

    //------------------------------------------------------
    // Abrir: descartar los cambios en memoria y volver a
    // la última versión guardada del proyecto (localStorage)
    //------------------------------------------------------

    async openProject({ askConfirm = true } = {}) {

        try {

            const saved = localStorage.getItem(this.storageKey);

            if (!saved) {
                alert("Todavía no se guardó nada -- no hay ningún proyecto para abrir.");
                return false;
            }

            if (askConfirm) {

                const ok = confirm(
                    "¿Abrir el último proyecto guardado?\n\nSe perderán los cambios hechos desde el último guardado."
                );

                if (!ok) return false;

            }

            const data = JSON.parse(saved);
            return await this.deserialize(data);

        } catch (err) {

            console.warn("[ProjectManager] No se pudo abrir el proyecto guardado:", err);
            return false;

        }

    }

    //------------------------------------------------------
    // Export / Import JSON
    //------------------------------------------------------

    async exportJSON() {

        const data = this.serialize();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const suggestedName = `proyecto_${new Date().toISOString().slice(0, 10)}.json`;

        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName,
                    types: [{
                        description: "Archivos JSON",
                        accept: { "application/json": [".json"] }
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();

                // Recordar este archivo (nombre/ubicación ya elegidos por
                // el usuario) para que, de ahora en más, Ctrl+S / el botón
                // "Guardar" (ver saveToLinkedFile más abajo) puedan
                // sobreescribirlo directamente -- sin volver a mostrar el
                // selector del sistema operativo cada vez. Solo dura
                // mientras esta pestaña siga abierta: el navegador no deja
                // persistir el handle en sí entre recargas de página sin
                // pedir permiso de nuevo, así que tras un F5 el primer
                // Ctrl+S vuelve a guardar solo en el navegador hasta que
                // se elija un archivo otra vez acá.
                this.fileHandle = handle;

                return;
            } catch (err) {

                // BUGFIX: antes, si el usuario cancelaba el selector
                // (AbortError), el catch se limitaba a no loguear el
                // error pero DEJABA CONTINUAR la ejecución hacia el
                // fallback de <a download> de más abajo -- es decir,
                // "cancelar" terminaba igual descargando el archivo
                // solo, sin que this.fileHandle quedara vinculado (por
                // eso además Ctrl+S nunca tenía un archivo real al cual
                // escribir después: como nunca se completó el "Guardar
                // como archivo...", cada Ctrl+S solo guardaba en
                // localStorage y el usuario sentía que tenía que volver
                // a abrir la ventana y ponerle nombre siempre).
                // Cancelar debe cancelar de verdad: no se guarda nada
                // ni se descarga nada.
                if (err?.name === "AbortError") {
                    return;
                }

                // Cualquier otro error (ej. de permisos) sí cae al
                // fallback de descarga de abajo, para no dejar al
                // usuario sin ninguna forma de guardar.
                console.warn("No se pudo abrir el selector de guardado", err);
            }
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedName;
        a.click();
        URL.revokeObjectURL(url);

    }

    //------------------------------------------------------
    // Sobreescribir directamente el archivo vinculado (si existe),
    // sin mostrar ningún selector -- lo usan Ctrl+S y el botón
    // "Guardar" del deslizador de Proyecto, además del guardado
    // normal en localStorage. Si todavía no se vinculó ningún
    // archivo (nunca se hizo "Guardar como archivo...") o el
    // navegador no soporta la File System Access API (Firefox,
    // Safari), no hace nada y devuelve false -- el guardado en
    // localStorage sigue funcionando igual en ambos casos.
    //------------------------------------------------------

    async saveToLinkedFile() {

        if (!this.fileHandle) return false;

        try {

            // El navegador puede haber revocado el permiso de escritura
            // (ej. pasó mucho tiempo, o el archivo se movió/borró) --
            // se re-pide antes de intentar escribir.
            if ((await this.fileHandle.queryPermission({ mode: "readwrite" })) !== "granted") {

                const perm = await this.fileHandle.requestPermission({ mode: "readwrite" });

                if (perm !== "granted") {
                    // Antes esto devolvía false y dejaba this.fileHandle
                    // intacto -- como el permiso sigue sin estar
                    // otorgado, CADA Ctrl+S futuro repetía el mismo
                    // pedido silencioso y volvía a fallar sin avisar
                    // nada, dando la sensación de que "no se puede
                    // guardar en el archivo nunca más" sin pista de por
                    // qué. Ahora se desvincula el archivo explícitamente
                    // -- el próximo intento de reconectar requiere
                    // "Guardar como archivo..." de nuevo, en vez de
                    // reintentar en silencio para siempre.
                    this.fileHandle = null;
                    return false;
                }

            }

            const data = this.serialize();
            const json = JSON.stringify(data, null, 2);

            const writable = await this.fileHandle.createWritable();
            await writable.write(json);
            await writable.close();

            return true;

        } catch (err) {

            console.warn("[ProjectManager] No se pudo guardar en el archivo vinculado:", err);

            // Si el archivo ya no existe o se movió, dejamos de intentar
            // escribirle hasta que el usuario elija uno nuevo con
            // "Guardar como archivo...".
            this.fileHandle = null;

            return false;

        }

    }

    async importJSON(file = null) {

        const readFile = async (selectedFile) => {
            const reader = new FileReader();
            return await new Promise((resolve, reject) => {
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
                reader.readAsText(selectedFile);
            });
        };

        try {
            let selectedFile = file;

            if (!selectedFile && window.showOpenFilePicker) {
                const [handle] = await window.showOpenFilePicker({
                    multiple: false,
                    types: [{
                        description: "Archivos JSON",
                        accept: { "application/json": [".json"] }
                    }]
                });
                selectedFile = await handle.getFile();
            }

            if (!selectedFile) {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".json";
                selectedFile = await new Promise((resolve) => {
                    input.onchange = () => resolve(input.files?.[0] || null);
                    input.click();
                });
            }

            if (!selectedFile) return;

            const text = await readFile(selectedFile);
            const data = JSON.parse(text);
            if (await this.deserialize(data)) {
                alert("✅ Proyecto cargado correctamente");
            } else {
                alert("❌ No se pudo cargar el proyecto");
            }
        } catch (err) {
            if (err?.name !== "AbortError") {
                alert("❌ Error leyendo el archivo: " + err.message);
            }
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