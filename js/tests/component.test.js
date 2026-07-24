const test = require("node:test");
const assert = require("node:assert/strict");
const Component = require("../simulator/Component");

function approxEqual(a, b, msg, eps = 1e-9) {
  assert.ok(Math.abs(a - b) < eps, msg || `esperaba ~${b}, dio ${a}`);
}

test("getPinPosition: sin rotación/flip, el pin queda en x+pin.x, y+pin.y", () => {
  const c = new Component({
    x: 100, y: 100, width: 50, height: 50,
    pins: [{ id: "p1", x: 10, y: 20 }],
  });
  const pos = c.getPinPosition("p1");
  approxEqual(pos.x, 110);
  approxEqual(pos.y, 120);
});

test("getPinPosition: rotación de 90° gira el pin alrededor del origen del componente", () => {
  const c = new Component({
    x: 0, y: 0, width: 100, height: 100, rotation: 90,
    pins: [{ id: "p1", x: 10, y: 0 }],
  });
  const pos = c.getPinPosition("p1");
  // rotar (10,0) 90° -> (0,10)
  approxEqual(pos.x, 0);
  approxEqual(pos.y, 10);
});

test("getPinPosition: flipX refleja la X local respecto al centro del ancho ANTES de rotar", () => {
  const c = new Component({
    x: 0, y: 0, width: 100, height: 100, flipX: true,
    pins: [{ id: "p1", x: 10, y: 5 }],
  });
  const pos = c.getPinPosition("p1");
  // localX = width - pin.x = 90
  approxEqual(pos.x, 90);
  approxEqual(pos.y, 5);
});

test("getPinPosition: flip + rotación combinados (orden: flip primero, luego rotar)", () => {
  const c = new Component({
    x: 0, y: 0, width: 100, height: 100, flipX: true, rotation: 90,
    pins: [{ id: "p1", x: 10, y: 0 }],
  });
  const pos = c.getPinPosition("p1");
  // flip: localX = 100-10 = 90 -> punto local (90, 0)
  // rotar 90°: (90,0) -> (0,90)
  approxEqual(pos.x, 0);
  approxEqual(pos.y, 90);
});

test("getPinPosition: devuelve null si el pin no existe (no debe tirar excepción)", () => {
  const c = new Component({ pins: [] });
  assert.equal(c.getPinPosition("no-existe"), null);
});

test("getPinPosition: respeta scale", () => {
  const c = new Component({ x: 0, y: 0, scale: 2, pins: [{ id: "p1", x: 10, y: 10 }] });
  const pos = c.getPinPosition("p1");
  approxEqual(pos.x, 20);
  approxEqual(pos.y, 20);
});

test("setPosition/move actualizan x,y sin tocar el DOM cuando element es null (no debe tirar excepción)", () => {
  const c = new Component({ x: 0, y: 0 });
  c.setPosition(50, 60);
  assert.equal(c.x, 50);
  assert.equal(c.y, 60);
  c.move(5, -5);
  assert.equal(c.x, 55);
  assert.equal(c.y, 55);
});

test("Component en x=0,y=0 explícito NO debe saltar al default (bug de '||' vs '??' ya corregido -- test de regresión)", () => {
  const c = new Component({ x: 0, y: 0 });
  assert.equal(c.x, 0);
  assert.equal(c.y, 0);
});