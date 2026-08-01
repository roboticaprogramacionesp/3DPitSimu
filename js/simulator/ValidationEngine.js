/*
==========================================================
 PitSimulator — ValidationEngine.js
 Validación de circuitos y conexiones
==========================================================
*/

class ValidationEngine {

    constructor(simulator) {

        this.simulator = simulator;

    }

    //------------------------------------------------------
    // Validar que todas las conexiones sean válidas
    //------------------------------------------------------

    validateCircuit() {

        const errors = [];
        const warnings = [];

        // 1. Verificar que todos los cables conecten pines válidos
        for (const wire of this.simulator.wireManager.wires) {

            const fromComp = this.simulator.componentManager.get(wire.from.componentId);
            const toComp = this.simulator.componentManager.get(wire.to.componentId);

            if (!fromComp) {
                errors.push(`Cable conecta componente inexistente: ${wire.from.componentId}`);
                continue;
            }

            if (!toComp) {
                errors.push(`Cable conecta componente inexistente: ${wire.to.componentId}`);
                continue;
            }

            if (!fromComp.getPin(wire.from.pinId)) {
                errors.push(`Pin inexistente en ${fromComp.name}: ${wire.from.pinId}`);
            }

            if (!toComp.getPin(wire.to.pinId)) {
                errors.push(`Pin inexistente en ${toComp.name}: ${wire.to.pinId}`);
            }

        }

        // 1b. GND cableado directo a un pin de alimentación (o viceversa)
        // -- a diferencia del chequeo de VOLTAJE de más abajo (que solo
        // compara pin-de-poder contra pin-de-poder y es una advertencia
        // "puede estar mal"), esto es un ERROR: nunca es correcto atar
        // tierra a un riel de alimentación. Encontrado en la práctica:
        // un cable de GND terminó en el pin "5v_2" del ESP32 por
        // confusión visual (dos ESP32 superpuestos en la misma
        // posición, ver el chequeo 6 más abajo) y el sensor nunca se
        // detectaba como alimentado, sin ningún aviso que lo señalara.
        for (const wire of this.simulator.wireManager.wires) {
            const msg = this._groundPowerMismatch(wire);
            if (msg) errors.push(msg);
        }

        // 2. Verificar que hay al menos un componente
        if (this.simulator.componentManager.getAll().length === 0) {
            warnings.push("No hay componentes en el circuito");
        }

        // 3. Verificar que hay al menos un cable (si hay más de 1 componente)
        if (this.simulator.componentManager.getAll().length > 1 && this.simulator.wireManager.wires.length === 0) {
            warnings.push("Hay múltiples componentes pero ningún cable los conecta");
        }

        // 4. Advertencias sobre componentes no conectados
        const connectedComponents = new Set();
        for (const wire of this.simulator.wireManager.wires) {
            connectedComponents.add(wire.from.componentId);
            connectedComponents.add(wire.to.componentId);
        }

        for (const comp of this.simulator.componentManager.getAll()) {
            if (comp.type === "esp32_wroom") continue; // ESP32 es central
            if (!connectedComponents.has(comp.id) && this.simulator.componentManager.getAll().length > 1) {
                warnings.push(`${comp.name || comp.type} no está conectado a nada`);
            }
        }

        // 5. Advertencias de VOLTAJE (NO bloqueantes): un componente
        // puede estar cableado a un pin de alimentación real, pero
        // a un voltaje distinto del que declara necesitar (ej. un
        // sensor de 3.3V conectado al pin de 5V del ESP32). Esto
        // nunca invalida el circuito -- solo avisa, la simulación
        // sigue funcionando igual (ver SignalEngine.getVoltageWarnings).
        if (this.simulator.signalEngine?.getVoltageWarnings) {
            for (const comp of this.simulator.componentManager.getAll()) {
                warnings.push(...this.simulator.signalEngine.getVoltageWarnings(comp));
            }
        }

        // 6. Componentes del mismo tipo superpuestos en la posición
        // EXACTA (mismo x,y) -- no es un error (a veces es intencional,
        // ej. apilar dos LEDs para un efecto visual), pero es la causa
        // de fondo más probable de un cableado accidental al pin
        // equivocado (dos componentes idénticos en el mismo lugar hacen
        // muy fácil arrastrar un cable al que NO querías, ver el
        // chequeo 1b de arriba -- así se originó ese bug con dos ESP32
        // superpuestos).
        const byPosition = new Map();
        for (const comp of this.simulator.componentManager.getAll()) {
            const key = `${comp.type}:${comp.x}:${comp.y}`;
            if (!byPosition.has(key)) byPosition.set(key, []);
            byPosition.get(key).push(comp);
        }
        for (const group of byPosition.values()) {
            if (group.length > 1) {
                const name = group[0].name || group[0].type;
                warnings.push(
                    `Hay ${group.length} componentes "${name}" superpuestos en la misma posición -- si no es intencional, revisá que no sea un duplicado accidental (fácil de cablear al equivocado)`,
                );
            }
        }

        return { valid: errors.length === 0, errors, warnings };

    }

    //------------------------------------------------------
    // GND <-> pin de alimentación en el MISMO cable -- reutilizado
    // tanto por validateCircuit() (revisión completa bajo demanda)
    // como por WireManager.addWire() (aviso inmediato al trazar un
    // cable nuevo, ver ese archivo).
    //------------------------------------------------------

    _groundPowerMismatch(wire) {

        const fromComp = this.simulator.componentManager.get(wire.from.componentId);
        const toComp = this.simulator.componentManager.get(wire.to.componentId);
        if (!fromComp || !toComp) return null;

        const pinFrom = fromComp.getPin(wire.from.pinId);
        const pinTo = toComp.getPin(wire.to.pinId);
        if (!pinFrom || !pinTo) return null;

        const isGround = (p) => p.type === "ground" || p.signal === "ground";
        const isPower = (p) => p.type === "power" || p.signal === "power";

        const groundSide = isGround(pinFrom) ? { comp: fromComp, pin: pinFrom } : isGround(pinTo) ? { comp: toComp, pin: pinTo } : null;
        const powerSide = isPower(pinFrom) ? { comp: fromComp, pin: pinFrom } : isPower(pinTo) ? { comp: toComp, pin: pinTo } : null;

        if (!groundSide || !powerSide || groundSide.comp === powerSide.comp) return null;

        const groundName = groundSide.comp.name || groundSide.comp.type;
        const powerName = powerSide.comp.name || powerSide.comp.type;
        return `GND de ${groundName} (${groundSide.pin.name || groundSide.pin.id}) está conectado a un pin de ALIMENTACIÓN en ${powerName} (${powerSide.pin.name || powerSide.pin.id}) -- nunca es correcto, revisá ese cable`;

    }

    //------------------------------------------------------
    // Obtener reporte legible
    //------------------------------------------------------

    getReport() {

        const result = this.validateCircuit();
        let text = "";

        if (result.errors.length > 0) {
            text += "❌ Errores:\n";
            result.errors.forEach(e => text += `  - ${e}\n`);
        }

        if (result.warnings.length > 0) {
            text += (result.errors.length > 0 ? "\n" : "") + "⚠️ Advertencias:\n";
            result.warnings.forEach(w => text += `  - ${w}\n`);
        }

        if (result.errors.length === 0 && result.warnings.length === 0) {
            text = "✅ Circuito válido";
        }

        return text;

    }

}