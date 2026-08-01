// Simulador falso mínimo: solo lo que getNet/isComponentPowered/etc.
// necesitan tocar (componentManager.get/getAll, wireManager.wires).
// Nada de DOM, nada de SVG -- por diseño, ya que SignalEngine nunca
// debería necesitar el navegador para razonar sobre el circuito
// (si lo necesitara, sería una señal de acoplamiento a arreglar).

function makeSimulator(components, wires) {
  return {
    componentManager: {
      get: (id) => components.find((c) => c.id === id) || null,
      getAll: () => components,
    },
    wireManager: {
      wires,
    },
    renderer: {
      applyLedState: () => {}, // se sobreescribe por test cuando hace falta espiar la llamada
    },
    eventBus: {
      on: () => {},   // el SignalEngine real se suscribe a "wire:added"/"wire:removed" en su constructor
      emit: () => {},
    },
  };
}

function wire(fromCompId, fromPinId, toCompId, toPinId) {
  return {
    from: { componentId: fromCompId, pinId: fromPinId },
    to: { componentId: toCompId, pinId: toPinId },
  };
}

// LED genérico: 2 pines, ánodo y cátodo (sin power/gnd propios --
// como cualquier LED discreto real en este proyecto).
function makeLed(id) {
  return {
    id,
    type: "led",
    pins: [
      { id: "anodo", type: "signal" },
      { id: "catodo", type: "signal" },
    ],
  };
}

// "Driver" simplificado tipo ESP32: un pin GPIO cualquiera + GND.
function makeDriver(id, gpioPinId = "io2") {
  return {
    id,
    type: "esp32_wroom",
    // El ESP32 real declara esto en esp32_wroom.json (ver
    // SignalEngine._isPowerSourceComponent) -- sin esto,
    // isKeyConnectedToGnd/isKeyConnectedToPower ya no reconocen sus
    // pines gnd_0/3v3 como una fuente real.
    properties: { isPowerSource: true },
    pins: [
      { id: gpioPinId, type: "gpio" },
      { id: "gnd_0", type: "ground" },
    ],
  };
}

// Botón momentáneo tipo KY-040/KY-004: puentea pressPins solo si pressed=true.
function makeButton(id, pinA = "sw", pinB = "gnd") {
  return {
    id,
    type: "ky_040",
    pressed: false,
    pressPins: [pinA, pinB],
    pins: [
      { id: pinA, type: "signal" },
      { id: pinB, type: "ground" },
    ],
  };
}

// Componente con pines de power/gnd/datos, para probar isComponentPowered.
function makeI2cModule(id) {
  return {
    id,
    type: "oled",
    pins: [
      { id: "vcc", type: "power" },
      { id: "gnd", type: "ground" },
      { id: "sda", type: "signal" },
      { id: "scl", type: "signal" },
    ],
  };
}

module.exports = { makeSimulator, wire, makeLed, makeDriver, makeButton, makeI2cModule };
