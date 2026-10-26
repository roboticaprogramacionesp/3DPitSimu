/**
 * ============================================================================
 *  boardPins.js — pines disponibles por tarjeta para los bloques de Blockly
 *  Cargar DESPUÉS de blockly_compressed.js y ANTES de blocks.js.
 *
 *  Antes cada bloque traía su propia lista fija de pines (ej. el puente H
 *  solo ofrecía 26/25/17/16), pensada para la WROOM. Ahora un bloque puede
 *  usar el campo "field_pin" y la lista sale de la tarjeta activa:
 *
 *    { type: "field_pin", name: "IN1", pin: 26 }               // salida (default)
 *    { type: "field_pin", name: "SIG", pin: 34, kind: "input" } // incluye solo-entrada
 *    { type: "field_pin", name: "POT", pin: 34, kind: "adc" }
 *
 *  "pin" es el default pensado para la WROOM; en otra tarjeta se traduce
 *  con BOARDS[x].defaults (si ese GPIO no existe ahí).
 *
 *  Tarjeta activa: la que eligió el usuario en el selector del panel de
 *  bloques, o -- en "auto" -- la primera ESP32 que haya en el lienzo.
 * ============================================================================
 */
(function () {
  "use strict";

  function range(a, b) {
    const out = [];
    for (let i = a; i <= b; i++) out.push(i);
    return out;
  }

  // output: GPIO que pueden ser salida (y PWM -- en ESP32 cualquier
  // salida puede ser PWM vía LEDC). inputOnly: solo entrada. adc: ADC1
  // (ADC2 no anda con WiFi activo, por eso no se ofrece).
  // Se excluyen los pines de la flash/PSRAM interna (6-11 en WROOM,
  // 11-17 en C3, 26-34 en S3) y el USB nativo de la C3 (18/19).
  const BOARDS = {
    esp32_wroom: {
      label: "ESP32 WROOM (D1 R32)",
      output: [0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33],
      inputOnly: [34, 35, 36, 39],
      adc: [32, 33, 34, 35, 36, 39],
      defaults: {},
    },
    esp32_s3: {
      label: "ESP32-S3",
      output: range(0, 21).concat(range(35, 48)),
      inputOnly: [],
      adc: range(1, 10),
      // Los defaults de la WROOM (25/26/27/14/16/17...) no existen todos acá.
      defaults: { 25: 4, 26: 5, 27: 15, 14: 16, 32: 1, 33: 2, 34: 3, 35: 8, 36: 9, 39: 10, 22: 9, 23: 11, 19: 13, 18: 12 },
    },
    esp32_c3: {
      label: "ESP32-C3",
      output: range(0, 10).concat([20, 21]),
      inputOnly: [],
      adc: range(0, 4),
      defaults: { 25: 2, 26: 3, 27: 10, 14: 7, 16: 5, 17: 4, 12: 6, 13: 7, 15: 1, 32: 0, 33: 1, 34: 2, 35: 3, 36: 4, 39: 0, 22: 9, 21: 8, 23: 7, 19: 5, 18: 4 },
    },
  };

  const STORAGE_KEY = "pitBlocklyBoard";
  let selected = "auto";
  try {
    selected = localStorage.getItem(STORAGE_KEY) || "auto";
  } catch (e) { /* sin storage: queda en auto */ }

  function detectFromCanvas() {
    const comps = window.sim?.componentManager?.getAll?.() || [];
    const esp = comps.find((c) => BOARDS[c.type]);
    return esp ? esp.type : null;
  }

  function currentBoard() {
    if (selected !== "auto" && BOARDS[selected]) return selected;
    return detectFromCanvas() || "esp32_wroom";
  }

  function pinsFor(boardType, kind) {
    const b = BOARDS[boardType];
    if (kind === "adc") return b.adc.slice();
    if (kind === "input") return b.output.concat(b.inputOnly).sort((x, y) => x - y);
    return b.output.slice();
  }

  function defaultFor(boardType, wroomPin, kind) {
    const pins = pinsFor(boardType, kind);
    if (pins.includes(wroomPin)) return wroomPin;
    const mapped = BOARDS[boardType].defaults[wroomPin];
    return pins.includes(mapped) ? mapped : pins[0];
  }

  window.PitBoards = {
    BOARDS,
    get selected() { return selected; },
    setSelected(value) {
      selected = BOARDS[value] ? value : "auto";
      try { localStorage.setItem(STORAGE_KEY, selected); } catch (e) { /* ignorar */ }
    },
    current: currentBoard,
    detectFromCanvas,
    pinsFor,
    defaultFor,
  };

  // ── field_pin: dropdown cuya lista sale de la tarjeta activa ──
  function FieldPin(wroomDefault, kind) {
    this.wroomDefault_ = Number(wroomDefault);
    this.kind_ = kind || "output";
    const self = this;
    Blockly.FieldDropdown.call(this, function () { return self.pinOptions_(); });
  }
  Blockly.utils.object.inherits(FieldPin, Blockly.FieldDropdown);

  FieldPin.prototype.pinOptions_ = function () {
    const board = currentBoard();
    const def = defaultFor(board, this.wroomDefault_, this.kind_);
    const pins = [def].concat(pinsFor(board, this.kind_).filter((p) => p !== def));
    const options = pins.map((p) => [String(p), String(p)]);
    // Un pin elegido antes (otra tarjeta, o un .xml viejo) se conserva
    // tal cual en vez de cambiarlo en silencio -- solo se marca.
    const cur = this.value_;
    if (cur != null && !pins.includes(Number(cur))) {
      options.unshift([cur + " ⚠ no existe en " + BOARDS[board].label, String(cur)]);
    }
    return options;
  };

  // Blockly 6 rechaza (y descarta) un valor que no esté en el menú al
  // cargar un .xml -- acá cualquier número de GPIO es válido.
  FieldPin.prototype.doClassValidation_ = function (newValue) {
    if (newValue == null) return null;
    return /^\d+$/.test(String(newValue)) ? String(newValue) : null;
  };

  FieldPin.fromJson = function (options) {
    return new FieldPin(options.pin, options.kind);
  };

  Blockly.fieldRegistry.register("field_pin", FieldPin);
})();
