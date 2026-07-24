const test = require("node:test");
const assert = require("node:assert/strict");
const Utils = require("../simulator/Utils");

test("snapToGrid: size=0 (Hoja en blanco) nunca devuelve NaN sin importar 'enabled'", () => {
  // Este es EXACTAMENTE el bug que ya documentaron en un comentario propio
  // (división por cero cuando gridSize=0 y snapEnabled quedó en true) --
  // lo cubrimos con un test para que no vuelva a colarse en un refactor futuro.
  assert.equal(Utils.snapToGrid(37, 0, true), 37);
  assert.equal(Utils.snapToGrid(37, 0, false), 37);
  assert.ok(!Number.isNaN(Utils.snapToGrid(37, 0, true)));
});

test("snapToGrid: redondea al múltiplo más cercano cuando está habilitado", () => {
  assert.equal(Utils.snapToGrid(23, 20, true), 20);
  assert.equal(Utils.snapToGrid(31, 20, true), 40);
});

test("snapToGrid: sin cambios si enabled=false, aunque size>0", () => {
  assert.equal(Utils.snapToGrid(23, 20, false), 23);
});

test("computeElbow: null si los puntos ya están alineados horizontal o verticalmente", () => {
  assert.equal(Utils.computeElbow({ x: 0, y: 0 }, { x: 100, y: 0 }), null);
  assert.equal(Utils.computeElbow({ x: 0, y: 0 }, { x: 0, y: 100 }), null);
});

test("computeElbow: recorre primero el eje más largo", () => {
  // dx > dy -> horizontal primero (codo en (end.x, start.y))
  assert.deepEqual(Utils.computeElbow({ x: 0, y: 0 }, { x: 100, y: 10 }), { x: 100, y: 0 });
  // dy > dx -> vertical primero (codo en (start.x, end.y))
  assert.deepEqual(Utils.computeElbow({ x: 0, y: 0 }, { x: 10, y: 100 }), { x: 0, y: 100 });
});

test("normalizeHex: agrega '#', pasa a minúsculas, y expande la forma corta", () => {
  assert.equal(Utils.normalizeHex("ABC"), "#aabbcc");
  assert.equal(Utils.normalizeHex("#FF00FF"), "#ff00ff");
  assert.equal(Utils.normalizeHex(""), "");
});

test("lightenColor: amount=0 devuelve el mismo color, amount=1 da blanco puro", () => {
  assert.equal(Utils.lightenColor("#000000", 0), "#000000");
  assert.equal(Utils.lightenColor("#000000", 1), "#ffffff");
});

test("clamp: respeta los límites min/max", () => {
  assert.equal(Utils.clamp(5, 0, 10), 5);
  assert.equal(Utils.clamp(-5, 0, 10), 0);
  assert.equal(Utils.clamp(50, 0, 10), 10);
});

test("generateId: siempre incluye el prefijo pedido", () => {
  const id = Utils.generateId("led");
  assert.ok(id.startsWith("led_"));
});