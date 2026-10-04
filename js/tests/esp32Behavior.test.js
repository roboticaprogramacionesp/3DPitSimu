const test = require("node:test");
const assert = require("node:assert/strict");

// Mismos shims que signalEngine.test.js: esp32_wroom.behavior.js se
// auto-registra contra ComponentBehaviorRegistry al cargarlo (así es
// como lo consume el navegador vía ComponentBehaviorRegistry.loadAll()).
global.window = global.window || { PIT_DEBUG: false };
global.ComponentBehaviorRegistry = require("../simulator/ComponentBehaviorRegistry");
require("../../components/esp32_wroom/esp32_wroom.behavior.js");

const { makeSimulator, makeDriver } = require("./fixtures");

const MAC_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

function initialState(component, simulator) {
  const renderer = { simulator };
  ComponentBehaviorRegistry.get("esp32_wroom").render.initialState(component, renderer);
}

test("esp32_wroom.behavior: genera una MAC con formato AA:BB:CC:DD:EE:FF si el componente no trae una", () => {
  const esp = makeDriver("esp1");
  delete esp.properties.macAddress;
  const sim = makeSimulator([esp], []);

  initialState(esp, sim);

  assert.ok(MAC_RE.test(esp.properties.macAddress), `MAC inválida: ${esp.properties.macAddress}`);
});

test("esp32_wroom.behavior: no pisa una MAC ya asignada (ej. proyecto guardado y recargado)", () => {
  const esp = makeDriver("esp1");
  esp.properties.macAddress = "11:22:33:44:55:66";
  const sim = makeSimulator([esp], []);

  initialState(esp, sim);

  assert.equal(esp.properties.macAddress, "11:22:33:44:55:66");
});

test("esp32_wroom.behavior: con dos ESP32 en el proyecto, nunca genera la misma MAC dos veces", () => {
  const espA = makeDriver("espA");
  espA.properties.macAddress = "11:22:33:44:55:66";
  const espB = makeDriver("espB");
  delete espB.properties.macAddress;
  const sim = makeSimulator([espA, espB], []);

  initialState(espB, sim);

  assert.ok(MAC_RE.test(espB.properties.macAddress));
  assert.notEqual(espB.properties.macAddress, espA.properties.macAddress);
});
