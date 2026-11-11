const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadUtils() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'simulator', 'Utils.js'), 'utf8');
  const context = {
    console,
    Math,
    DOMPoint: class DOMPoint {
      constructor(x, y) {
        this.x = x;
        this.y = y;
      }
      matrixTransform() {
        return this;
      }
    }
  };
  context.global = context;
  vm.createContext(context);
  vm.runInContext(code + '\nthis.Utils = Utils;', context);
  return context.Utils;
}

const Utils = loadUtils();

test('buildOrthogonalPoints convierte diagonales en esquinas rectas', () => {
  const points = Utils.buildOrthogonalPoints([{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 150, y: 150 }]);

  // Misma forma que antes; el codo (100,50) queda en medio de la recta
  // vertical (100,0)->(100,150) y la limpieza lo quita.
  assert.deepEqual(plain(points), [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 150 }, { x: 150, y: 150 },
  ]);
});

const plain = (v) => JSON.parse(JSON.stringify(v));
const isOrtho = (pts) => pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y);
const DOWN = { dx: 0, dy: 1 }, UP = { dx: 0, dy: -1 };

test('enrutado pin a pin: semáforo encima de la ESP32 -> un solo escalón a mitad de camino', () => {
  // Pin del semáforo (sale hacia abajo) a un pin de la ESP32 (sale hacia arriba), corridos 3.5 en X
  const pts = Utils.buildOrthogonalPoints([{ x: 346.8, y: 131.9 }, { x: 350.3, y: 170 }], DOWN, UP);
  assert.ok(isOrtho(pts));
  assert.equal(pts.length, 4);
  assert.equal(pts[1].x, 346.8);            // baja derecho
  assert.ok(pts[1].y > 131.9 && pts[1].y < 170);
  assert.equal(pts[2].x, 350.3);            // y entra derecho al pin
});

test('enrutado pin a pin: pines casi alineados -> línea recta, sin escaloncito', () => {
  const pts = Utils.buildOrthogonalPoints([{ x: 330.8, y: 131.9 }, { x: 330.3, y: 170 }], DOWN, UP);
  assert.equal(pts.length, 2);
});

test('enrutado pin a pin: rodea un componente en vez de pasar por encima', () => {
  // De un pin de abajo de una placa (sale hacia abajo) a un pin que está ARRIBA de la placa
  const board = { x1: 0, y1: 0, x2: 200, y2: 100 };
  const pts = Utils.buildOrthogonalPoints([{ x: 100, y: 100 }, { x: 100, y: -60 }], DOWN, DOWN,
    { obstacles: [board], endBoxes: [board] });
  assert.ok(isOrtho(pts));
  for (let i = 1; i < pts.length; i++) {
    assert.equal(Utils._overlapLength(pts[i - 1], pts[i], board, -2), 0, 'ningún tramo cruza por dentro de la placa');
  }
});

test('codos manuales: se quitan los rulos (tramo que va y vuelve por la misma línea)', () => {
  // codo guardado (346.8,170) más abajo que el tiro de entrada al pin -> antes hacía un rulo
  const pts = Utils.buildOrthogonalPoints(
    [{ x: 346.8, y: 131.9 }, { x: 346.8, y: 170 }, { x: 350.3, y: 170 }], DOWN, UP);
  assert.ok(isOrtho(pts));
  for (let i = 2; i < pts.length; i++) {
    const a = pts[i - 2], b = pts[i - 1], c = pts[i];
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    assert.ok(!collinear, 'sin puntos que vuelvan sobre la misma recta');
  }
});

test('dirección de salida: fila de pines en componente angosto sale perpendicular a la fila', () => {
  const pins = [{ id: 'r', x: 9, y: 81 }, { id: 'y', x: 17, y: 81 }, { id: 'g', x: 25, y: 81 }, { id: 'gnd', x: 33, y: 81 }];
  for (const p of pins) assert.deepEqual(plain(Utils.pinExitLocal(p, pins, 40, 100)), DOWN);
  // pin pegado al borde (terminal de resistencia) sale por ese borde
  const res = [{ id: 't1', x: 1.14, y: 5.39 }, { id: 't2', x: 47.87, y: 5.39 }];
  assert.deepEqual(plain(Utils.pinExitLocal(res[0], res, 49, 10.79)), { dx: -1, dy: 0 });
  assert.deepEqual(plain(Utils.pinExitLocal(res[1], res, 49, 10.79)), { dx: 1, dy: 0 });
  // "exit" declarado en el .json manda
  assert.deepEqual(plain(Utils.pinExitLocal({ x: 9, y: 81, exit: 'left' }, pins, 40, 100)), { dx: -1, dy: 0 });
});

test('buildComponentDefinition aplica overrides y resuelve svgPath', () => {
  const definition = {
    type: 'led',
    name: 'Led',
    svgPath: 'components/led/led.svg'
  };

  const built = Utils.buildComponentDefinition(definition, { x: 20, y: 30, svgPath: '' });

  assert.equal(built.type, 'led');
  assert.equal(built.x, 20);
  assert.equal(built.y, 30);
  assert.equal(built.svgPath, 'components/led/led.svg');
});

test('snapToGrid alinea coordenadas a la cuadrícula', () => {
  assert.equal(Utils.snapToGrid(17, 20), 20);
  assert.equal(Utils.snapToGrid(23, 20), 20);
  assert.equal(Utils.snapToGrid(40, 20), 40);
});

test('snapToGrid puede desactivarse para mover libremente', () => {
  assert.equal(Utils.snapToGrid(17, 20, false), 17);
  assert.equal(Utils.snapToGrid(23, 20, false), 23);
});
