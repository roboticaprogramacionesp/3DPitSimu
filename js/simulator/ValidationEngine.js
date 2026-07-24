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

        return { valid: errors.length === 0, errors, warnings };

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