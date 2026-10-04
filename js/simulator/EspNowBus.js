/*
==========================================================
 PitSimulator — EspNowBus.js

 Bus simulado de ESP-NOW (ver plan multi-ESP32/ESP-NOW, Fase 3) --
 instanciado UNA sola vez en Simulator.start() (sim.espNowBus),
 independiente del ciclo de vida de los bridges (sobrevive a
 Simular/Detener, igual que componentManager): un ESP32 puede
 "mandar" ESP-NOW a otro aunque ninguno de los dos esté conectado en
 ese momento, el mensaje simplemente se pierde (igual que ESP-NOW
 real sin ack -- send() con sync=False no garantiza entrega).

 A diferencia del GPIO digital (Fase 1, resolveEsp32()+getNet()),
 ESP-NOW es inalámbrico: no hay ningún cable que caminar. El único
 criterio para decidir destino es la MAC (esp32.properties.macAddress,
 generada por esp32_wroom.behavior.js), no la topología del lienzo.
==========================================================
*/

class EspNowBus {

    constructor(simulator) {
        this.simulator = simulator;
    }

    // fromEsp32Id: id del ESP32 que mandó (para no entregárselo a sí
    // mismo en un broadcast). dstMacHex/payloadHex: hex SIN ":", tal
    // cual los manda _espnow_wasm.py por "ESPNOW_TX:...".
    send(fromEsp32Id, dstMacHex, payloadHex) {

        const dst = (dstMacHex || "").toLowerCase();
        const isBroadcast = dst === "ffffffffffff";

        const esp32s = this.simulator.componentManager
            .getAll()
            .filter((c) => c.type.startsWith("esp32") && c.id !== fromEsp32Id);

        const targets = isBroadcast
            ? esp32s
            : esp32s.filter((c) => EspNowBus._normalizeMac(c.properties?.macAddress) === dst);

        if (targets.length === 0) return;

        const fromEsp32 = this.simulator.componentManager.get(fromEsp32Id);
        const srcMacHex = EspNowBus._normalizeMac(fromEsp32?.properties?.macAddress) || "000000000000";

        targets.forEach((esp32) => {
            const bridge = this.simulator.bridges.get(esp32.id);
            // sendData() ya resuelve en silencio sin conectar (ver su
            // propio guard) -- este chequeo extra es solo para no
            // mandar el postMessage al Worker si total nadie lo va a
            // leer, mismo criterio que el resto de SignalEngine.js.
            if (bridge?.connected) {
                bridge.sendData(`ESPNOW_RX:${srcMacHex}:${payloadHex}`);
            }
        });

    }

    static _normalizeMac(mac) {
        return mac ? mac.replace(/:/g, "").toLowerCase() : null;
    }

}
