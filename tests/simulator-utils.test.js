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

  assert.equal(points.length, 5);
  assert.equal(points[0].x, 0);
  assert.equal(points[0].y, 0);
  assert.equal(points[1].x, 100);
  assert.equal(points[1].y, 0);
  assert.equal(points[2].x, 100);
  assert.equal(points[2].y, 50);
  assert.equal(points[3].x, 100);
  assert.equal(points[3].y, 150);
  assert.equal(points[4].x, 150);
  assert.equal(points[4].y, 150);
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
