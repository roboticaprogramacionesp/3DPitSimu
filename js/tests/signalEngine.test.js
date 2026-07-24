const test = require("node:test");
const assert = require("node:assert/strict");

// SignalEngine.js real usa "window.PIT_DEBUG" en algunos métodos (_dbg) --
// en Node no existe "window", así que le damos un shim mínimo antes de
// cargar el archivo. Esto es normal al testear código pensado para
// navegador desde Node: no cambia nada del código real, solo rellena lo
// que el navegador provee automáticamente.
global.window = global.window || { PIT_DEBUG: false };

const SignalEngineCore = require("../simulator/SignalEngine"); // <- archivo REAL del proyecto, ya no la copia congelada
const { makeSimulator, wire, makeLed, makeDriver, makeButton, makeI2cModule } = require("./fixtures");

// ============================================================
// getNet — BFS sobre cables
// ============================================================

test("getNet: pin sin ningún cable devuelve solo a sí mismo", () => {
  const led = makeLed("led1");
  const sim = makeSimulator([led], []);
  const eng = new SignalEngineCore(sim);

  const net = eng.getNet("led1:anodo");
  assert.deepEqual(net, ["led1:anodo"]);
});

test("getNet: dos componentes unidos por un cable quedan en la misma net", () => {
  const led = makeLed("led1");
  const drv = makeDriver("esp1");
  const sim = makeSimulator([led, drv], [wire("led1", "anodo", "esp1", "io2")]);
  const eng = new SignalEngineCore(sim);

  const net = eng.getNet("led1:anodo");
  assert.equal(net.length, 2);
  assert.ok(net.includes("esp1:io2"));
});

test("getNet: transitividad -- A-B-C conectados en cadena quedan todos en la misma net", () => {
  const a = makeLed("a");
  const b = makeLed("b");
  const c = makeLed("c");
  const wires = [
    wire("a", "anodo", "b", "anodo"),
    wire("b", "anodo", "c", "anodo"),
  ];
  const sim = makeSimulator([a, b, c], wires);
  const eng = new SignalEngineCore(sim);

  const net = eng.getNet("a:anodo");
  assert.deepEqual(new Set(net), new Set(["a:anodo", "b:anodo", "c:anodo"]));
});

test("getNet: un botón NO presionado no conecta sus pressPins", () => {
  const btn = makeButton("btn1");
  const sim = makeSimulator([btn], []);
  const eng = new SignalEngineCore(sim);

  const net = eng.getNet("btn1:sw");
  assert.deepEqual(net, ["btn1:sw"]); // gnd NO debería aparecer
});

test("getNet: un botón presionado SÍ conecta sus pressPins", () => {
  const btn = makeButton("btn1");
  btn.pressed = true;
  const sim = makeSimulator([btn], []);
  const eng = new SignalEngineCore(sim);

  const net = eng.getNet("btn1:sw");
  assert.deepEqual(new Set(net), new Set(["btn1:sw", "btn1:gnd"]));
});

// ============================================================
// isKeyConnectedToHighDriver / isKeyConnectedToGnd
// ============================================================

test("isKeyConnectedToHighDriver: true si algún pin de la net tiene driverState=1", () => {
  const led = makeLed("led1");
  const drv = makeDriver("esp1");
  const sim = makeSimulator([led, drv], [wire("led1", "anodo", "esp1", "io2")]);
  const eng = new SignalEngineCore(sim);

  eng.driverStates["esp1:io2"] = 1;
  assert.equal(eng.isKeyConnectedToHighDriver("led1:anodo"), true);
});

test("isKeyConnectedToHighDriver: false si el driver está en 0", () => {
  const led = makeLed("led1");
  const drv = makeDriver("esp1");
  const sim = makeSimulator([led, drv], [wire("led1", "anodo", "esp1", "io2")]);
  const eng = new SignalEngineCore(sim);

  eng.driverStates["esp1:io2"] = 0;
  assert.equal(eng.isKeyConnectedToHighDriver("led1:anodo"), false);
});

test("isKeyConnectedToGnd: false para un pin flotante (sin cables)", () => {
  const led = makeLed("led1");
  const sim = makeSimulator([led], []);
  const eng = new SignalEngineCore(sim);

  assert.equal(eng.isKeyConnectedToGnd("led1:catodo"), false);
});

test("isKeyConnectedToGnd: true si la net incluye un pin type=ground", () => {
  const led = makeLed("led1");
  const drv = makeDriver("esp1");
  const sim = makeSimulator([led, drv], [wire("led1", "catodo", "esp1", "gnd_0")]);
  const eng = new SignalEngineCore(sim);

  assert.equal(eng.isKeyConnectedToGnd("led1:catodo"), true);
});

test("isKeyConnectedToGnd: false si está cableado pero a algo que NO es GND", () => {
  const ledA = makeLed("ledA");
  const ledB = makeLed("ledB");
  const sim = makeSimulator([ledA, ledB], [wire("ledA", "catodo", "ledB", "anodo")]);
  const eng = new SignalEngineCore(sim);

  assert.equal(eng.isKeyConnectedToGnd("ledA:catodo"), false);
});

// ============================================================
// evaluateLed — integración de las dos condiciones de arriba
// ============================================================

test("evaluateLed: prende solo cuando ánodo=HIGH Y cátodo=GND", () => {
  const led = makeLed("led1");
  const drv = makeDriver("esp1");
  const wires = [
    wire("led1", "anodo", "esp1", "io2"),
    wire("led1", "catodo", "esp1", "gnd_0"),
  ];
  const sim = makeSimulator([led, drv], wires);
  // evaluateLed() no devuelve nada -- reporta el estado llamando a
  // renderer.applyLedState(component, isOn). Para testearlo sin DOM,
  // espiamos esa llamada en vez de leer un valor de retorno.
  const calls = [];
  sim.renderer.applyLedState = (component, isOn) => calls.push(isOn);
  const eng = new SignalEngineCore(sim);

  eng.driverStates["esp1:io2"] = 1;
  eng.evaluateLed(led);
  assert.equal(calls.at(-1), true, "con anodo HIGH y catodo a GND el LED debe prender");

  eng.driverStates["esp1:io2"] = 0;
  eng.evaluateLed(led);
  assert.equal(calls.at(-1), false, "con anodo LOW el LED debe apagarse aunque el catodo siga a GND");
});

test("evaluateLed: NO prende si el cátodo no llega a GND, aunque el ánodo esté en HIGH (circuito incompleto)", () => {
  const led = makeLed("led1");
  const drv = makeDriver("esp1");
  const sim = makeSimulator([led, drv], [wire("led1", "anodo", "esp1", "io2")]); // catodo suelto
  const calls = [];
  sim.renderer.applyLedState = (component, isOn) => calls.push(isOn);
  const eng = new SignalEngineCore(sim);

  eng.driverStates["esp1:io2"] = 1;
  eng.evaluateLed(led);
  assert.equal(calls.at(-1), false);
});

// ============================================================
// isComponentPowered
// ============================================================

test("isComponentPowered: componente sin pines power/gnd/datos siempre está OK", () => {
  const comp = { id: "x", pins: [] };
  const sim = makeSimulator([comp], []);
  const eng = new SignalEngineCore(sim);
  assert.equal(eng.isComponentPowered(comp), true);
});

test("isComponentPowered: false si falta VCC, GND o alguna señal de datos", () => {
  const mod = makeI2cModule("oled1");
  const sim = makeSimulator([mod], []); // nada cableado
  const eng = new SignalEngineCore(sim);
  assert.equal(eng.isComponentPowered(mod), false);
});

test("isComponentPowered: true solo cuando VCC, GND, y TODOS los pines de datos están cableados", () => {
  const mod = makeI2cModule("oled1");
  const drv = makeDriver("esp1");
  drv.pins.push({ id: "3v3", type: "power" });
  const wires = [
    wire("oled1", "vcc", "esp1", "3v3"),
    wire("oled1", "gnd", "esp1", "gnd_0"),
    wire("oled1", "sda", "esp1", "io2"), // cualquier pin sirve, solo se exige "algo conectado"
    // scl queda SIN cablear a propósito
  ];
  const sim = makeSimulator([mod, drv], wires);
  const eng = new SignalEngineCore(sim);

  assert.equal(eng.isComponentPowered(mod), false, "scl sin cablear debe bloquear isComponentPowered");

  wires.push(wire("oled1", "scl", "esp1", "io2"));
  assert.equal(eng.isComponentPowered(mod), true, "con los 4 pines cableados debe quedar OK");
});

// ============================================================
// HALLAZGO (no es un bug de código -- es un comportamiento no
// decidido a propósito): dos drivers distintos empujando la
// misma net a valores opuestos (cortocircuito real en hardware
// real) no se detecta ni se reporta -- isKeyConnectedToHighDriver
// devuelve true con que UNO solo de los pines de la net esté en
// HIGH, sin mirar si otro pin de esa misma net está en LOW al
// mismo tiempo. Documentamos el comportamiento ACTUAL con un test
// (no decimos que esté "mal": es una decisión de diseño que hoy
// nadie tomó explícitamente) para que quede a la vista y el equipo
// decida si vale la pena que ValidationEngine lo detecte como
// advertencia.
// ============================================================

test("[hallazgo] dos drivers en conflicto sobre la misma net: hoy no se detecta el cortocircuito", () => {
  const led = makeLed("led1");
  const drvA = makeDriver("espA", "io2");
  const drvB = makeDriver("espB", "io4");
  const wires = [
    wire("led1", "anodo", "espA", "io2"),
    wire("led1", "anodo", "espB", "io4"), // MISMO nodo que arriba -- dos salidas juntas
  ];
  const sim = makeSimulator([led, drvA, drvB], wires);
  const eng = new SignalEngineCore(sim);

  eng.driverStates["espA:io2"] = 1; // un driver en HIGH...
  eng.driverStates["espB:io4"] = 0; // ...y otro en LOW, misma net -- cortocircuito real

  // Comportamiento actual: se reporta HIGH igual, sin ninguna señal de conflicto.
  assert.equal(eng.isKeyConnectedToHighDriver("led1:anodo"), true);
});
