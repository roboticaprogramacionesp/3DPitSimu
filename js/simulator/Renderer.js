/*
==========================================================
 PitSimulator — Renderer.js
==========================================================
*/

class Renderer {
  // Color por defecto si el LED no trae "properties.color" todavía
  static LED_DEFAULT_COLOR = "#e60000";

  static isLed(type) {
    return type === "led";
  }

  // isServo/isOled/isDisplay7/isMotor/isLcd/isNeopixelMatrix/isMax7219/
  // isTm1637/isTft/isSemaforo se borraron de acá -- esos 10 tipos ya
  // migraron su lógica de render a components/<type>/<type>.behavior.js
  // (ver ComponentBehaviorRegistry.js), y ninguna otra parte del código
  // los llamaba ya. isLed sigue porque className/PropertyPanel todavía
  // la usan fuera del dispatch de render.

  // Joystick KY-023: el único componente de este proyecto con una
  // entrada ANALÓGICA continua (X/Y), no solo digital -- ver
  // bindJoystick() más abajo y joystick_hal.py (primer machine.ADC
  // del proyecto). El botón SW no necesita nada especial acá: es
  // el mismo mecanismo genérico de botón momentáneo que ya usan
  // otros componentes (ver bindPressButton/component.pressPins).
  static isJoystick(type) {
    return type === "joystick";
  }

  // Teclado analógico ADKEY (5 botones sobre un único pin ADC):
  // a diferencia de TODOS los demás botones de este proyecto, acá
  // las teclas no bridgean pines del JSON (no hay pin por tecla)
  // -- son puramente virtuales, así que usan su propio bind
  // (bindAdKey) en vez de bindPressButton/component.pressPins.
  static isAdKey(type) {
    return type === "adkey";
  }

  // Teclado matricial (4x4, 3x4, o cualquier NxM futuro): 8 (o
  // menos) pines digitales comunes, sin ningún HAL nuevo (ver
  // keypad4x4.json/keypad3x4.json), pero la interacción tampoco es
  // un simple bridge de 2 pines -- N*M teclas virtuales sobre una
  // matriz de filas/columnas, resuelta por
  // SignalEngine.evaluateKeypadMatrix() en tiempo real según qué
  // columna esté escaneando el firmware. Ver bindKeypadMatrix().
  // Cualquier "type" que empiece con "keypad" entra acá -- no hace
  // falta tocar este archivo de nuevo para un futuro keypad2x2,
  // keypad4x3, etc, siempre que el .svg use el mismo esquema de
  // data-keypad-role="r{fila}c{col}".
  static isKeypadMatrix(type) {
    return typeof type === "string" && type.startsWith("keypad");
  }

  // Potenciómetro deslizante: análogo de 1 solo eje (ver
  // bindSlider() más abajo) -- reutiliza el mismo machine.ADC que
  // el joystick (ver pot_slider_hal.py), pero SIN resorte de
  // centrado: al soltar el mouse, la perilla se queda donde
  // quedó, no vuelve sola a ningún lado.
  static isSlider(type) {
    return type === "pot_slider";
  }

  // Encoder rotativo KY-040: a diferencia del joystick/slider, NO
  // es analógico -- CLK/DT son pines DIGITALES (protocolo "IN:",
  // igual que un botón), solo que en vez de un único valor fijo se
  // manda una SECUENCIA de niveles por cada "click" del eje (ver
  // bindEncoder()/SignalEngine.setEncoderStep). El giro en sí no
  // tiene tope (a diferencia de bindSlider, que sí tiene
  // min/maxTravel): el usuario puede girar indefinidamente.
  static isEncoder(type) {
    // Acepta "ky_040" (como lo tenía mi ky040.json de referencia) Y
    // "ky040" (como resultó estar en el manifest real del proyecto,
    // confirmado por el id "ky040_xxxxx" en los logs) -- el mismatch
    // entre estos dos nombres era la causa real de que bindEncoder()
    // nunca hiciera nada: la primera línea de la función ya
    // cortaba en falso antes de llegar a ningún console.warn/log.
    return type === "ky_040" || type === "ky040";
  }

  // Buzzer piezo pasivo (KY-006): el único componente de este
  // proyecto que produce SONIDO de verdad (Web Audio API), no solo
  // feedback visual -- ver playBuzzerTone()/stopBuzzerTone() más
  // abajo y buzzer.hal.py (primer machine.PWM del proyecto).
  static isBuzzer(type) {
    return type === "buzzer";
  }

  constructor(simulator) {
    this.simulator = simulator;
    this.svgCache = {};

    this.simulator.eventBus.on("net:changed", ({ keys, value }) => {
      this.applyNetVisual(keys, value);
      this.updateReactiveComponents(keys);
    });
  }

  applyNetVisual(keys, value) {
    keys.forEach((key) => {
      const [componentId, pinId] = key.split(":");
      const pinEl = this.simulator.componentLayer.querySelector(
        `.pin[data-component-id="${componentId}"][data-pin-id="${pinId}"]`,
      );
      if (!pinEl) return;
      pinEl.classList.toggle("pin-active", !!value);
    });
  }

  updateReactiveComponents(keys) {
    const componentIds = new Set(keys.map((k) => k.split(":")[0]));
    componentIds.forEach((id) => {
      const component = this.simulator.componentManager.get(id);
      if (!component) return;
      if (Renderer.isLed(component.type)) this.updateLedVisual(component);
    });
  }

  // Llamado desde SignalEngine.evaluateLed()
  applyLedState(component, isOn) {
    if (!component.element) return;
    component.element.classList.toggle("led-on", isOn);
    component.element.classList.toggle("led-off", !isOn);
    this.applyLedColor(component, isOn);
  }

  // Compatibilidad con código que llame updateLedVisual directamente
  updateLedVisual(component) {
    if (!component.element) return;
    const anodoHigh = !!this.simulator.signalEngine.getPinState(
      component.id,
      "anodo",
    );
    const catodoGrounded = this.simulator.signalEngine.isPinGrounded(
      component.id,
      "catodo",
    );
    this.applyLedState(component, anodoHigh && catodoGrounded);
  }

  applyLedColor(component, isOn) {
    if (!component.element) return;

    // El color siempre se muestra completo (como en Fritzing). Ojo:
    // NO tocamos el atributo "opacity" de cada capa -- el SVG de
    // Fritzing usa opacidades distintas por capa (0.25 a 0.9) a
    // propósito, para que las patitas internas (los polígonos grises
    // dibujados debajo) se sigan viendo a través del plástico. Forzar
    // opacity=1 en todas las capas las volvía opacas y tapaba las patas.
    const onColor = component.properties?.color || Renderer.LED_DEFAULT_COLOR;

    component.element.querySelectorAll("[data-led-role]").forEach((el) => {
      // Quitar / reemplazar style inline (el color_path32 lo tiene)
      const style = el.getAttribute("style") || "";
      if (style.includes("fill:")) {
        el.setAttribute(
          "style",
          style.replace(/fill\s*:\s*[^;"]*/gi, `fill:${onColor}`),
        );
      } else {
        el.setAttribute("fill", onColor);
      }

      // Glow solo cuando está encendido
      el.style.filter = isOn ? `drop-shadow(0 0 5px ${onColor})` : "none";
    });
  }

  async renderAll() {
    for (const component of this.simulator.componentManager.getAll()) {
      await this.renderComponent(component);
    }
  }

  async renderComponent(component) {
    if (component.element) {
      component.updateTransform();
      return component.element;
    }

    const group = document.createElementNS(Utils.SVG_NS, "g");
    let className = `component component-${component.type}`;
    if (Renderer.isLed(component.type)) className += " led-off";

    group.setAttribute("class", className);
    group.setAttribute("data-id", component.id);

    // Consultamos el registro UNA sola vez acá -- todos los tipos que
    // necesitan tag()/initialState() propios ya migraron a
    // ComponentBehaviorRegistry (ver ese archivo). Un tipo NUEVO que
    // solo necesite su .svg tal cual (sin decorar nada) no necesita
    // registrar nada acá -- usesCodeGraphic/tag/initialState son todos
    // opcionales.
    const behavior = ComponentBehaviorRegistry.get(component.type);

    if (behavior?.render?.usesCodeGraphic) {
      // A diferencia de todo lo demás, esta no depende de ningún
      // .svg externo -- el gráfico se genera por código (tag()), así
      // se acomoda a cualquier configuración elegida desde el
      // PropertyPanel sin tener que dibujar/exportar un .svg nuevo.

      const graphic = document.createElementNS(Utils.SVG_NS, "g");
      graphic.setAttribute("class", "component-graphic");

      behavior.render.tag?.(component, graphic, this);

      group.appendChild(graphic);
    } else if (component.svgPath) {
      const svgData = await this.loadSVG(component.svgPath);
      if (svgData) {
        const { inner, viewBox } = svgData;

        const graphic = document.createElementNS(Utils.SVG_NS, "g");
        graphic.setAttribute("class", "component-graphic");
        graphic.innerHTML = inner;

        const scaleX = viewBox.width ? component.width / viewBox.width : 1;
        const scaleY = viewBox.height ? component.height / viewBox.height : 1;
        graphic.setAttribute(
          "transform",
          `scale(${scaleX},${scaleY}) translate(${-viewBox.x},${-viewBox.y})`,
        );

        if (component.colorTargets && component.colorTargets.length > 0) {
          this.tagColorTargets(component, graphic);
        }

        behavior?.render?.tag?.(component, graphic, this);

        group.appendChild(graphic);
      } else {
        group.appendChild(this.createPlaceholder(component));
      }
    } else {
      group.appendChild(this.createPlaceholder(component));
    }

    this.renderPins(component, group);

    // Etiqueta con el nombre del componente (oculta por defecto,
    // se activa con "Mostrar el nombre del componente" del menú clic derecho)

    const nameLabel = document.createElementNS(Utils.SVG_NS, "text");
    nameLabel.setAttribute("class", "component-name-label");
    nameLabel.setAttribute("x", component.width / 2);
    nameLabel.setAttribute("y", component.height + 14);
    nameLabel.setAttribute("text-anchor", "middle");
    nameLabel.textContent = component.name;
    group.appendChild(nameLabel);

    if (component.showName) group.classList.add("show-name");
    if (component.locked) group.classList.add("locked");

    component.setElement(group);
    this.simulator.componentLayer.appendChild(group);

    // Botón momentáneo: si el SVG trae una zona [data-role="button-cap"]
    // y el .json define pressPins, la volvemos clickeable.
    this.bindPressButton(component, group);

    // Joystick KY-023: arrastre X/Y del stick (el mismo elemento
    // [data-role="button-cap"] de arriba también actúa como
    // knob arrastrable -- ambos binds escuchan el mismo
    // elemento sin pisarse, cada uno con sus propios listeners).
    this.bindJoystick(component, group);

    // Teclado analógico ADKEY: 5 teclas virtuales sobre un único
    // pin ADC, sin equivalente en pressPins/bindPressButton.
    this.bindAdKey(component, group);

    // Teclado matricial (4x4, 3x4, ...): N*M teclas virtuales
    // sobre una matriz de filas/columnas.
    this.bindKeypadMatrix(component, group);

    // Potenciómetro deslizante: arrastre en 1 eje, sin resorte.
    this.bindSlider(component, group);

    // Encoder rotativo KY-040: arrastre CIRCULAR sobre la perilla.
    // Igual patrón dual que bindJoystick/bindPressButton: reusa el
    // mismo elemento [data-role="button-cap"] para el SW, sin
    // pisarse (ver bindEncoder más abajo).
    this.bindEncoder(component, group);

    behavior?.render?.initialState?.(component, this);

    return group;
  }

  //------------------------------------------------------
  // Botón momentáneo: mientras se mantiene presionado el
  // "button-cap" del SVG, se puentean pressPins[0] y
  // pressPins[1] en el SignalEngine (ver SignalEngine.getNet).
  // Al soltar (o salir del elemento / cancelar el puntero) se
  // despuentea. No dispara el arrastre del componente (stopPropagation).
  //------------------------------------------------------

  bindPressButton(component, group) {
    if (!component.pressPins) return;

    const cap = group.querySelector('[data-role="button-cap"]');
    if (!cap) return;

    cap.classList.add("button-cap");

    // Círculo/zona que se pinta de rojo mientras está presionado
    // (si el SVG no trae uno marcado, usamos el propio cap)
    const indicator =
      cap.querySelector('[data-role="button-indicator"]') || cap;
    const originalFill = indicator.getAttribute("fill");

    const press = (e) => {
      if (component.locked) return;

      e.stopPropagation();
      e.preventDefault();

      component.pressed = true;
      group.classList.add("pressed");
      indicator.setAttribute("fill", "#ff0000");

      try {
        cap.setPointerCapture(e.pointerId);
      } catch (err) {}

      this.simulator.signalEngine.setPressed(component, true);
    };

    const release = (e) => {
      if (!component.pressed) return;

      component.pressed = false;
      group.classList.remove("pressed");

      if (originalFill !== null) {
        indicator.setAttribute("fill", originalFill);
      } else {
        indicator.removeAttribute("fill");
      }

      try {
        cap.releasePointerCapture(e.pointerId);
      } catch (err) {}

      this.simulator.signalEngine.setPressed(component, false);
    };

    cap.addEventListener("pointerdown", press);
    cap.addEventListener("pointerup", release);
    cap.addEventListener("pointercancel", release);
    cap.addEventListener("pointerleave", (e) => {
      // Si se sale del botón sin soltar el mouse, igual lo soltamos
      // (evita que quede "trabado" presionado)
      if (e.buttons === 0) release(e);
    });
  }

  // ─────────────────────────────────────────────────────
  // Joystick KY-023: arrastre X/Y del stick.
  //
  // Escucha el MISMO elemento [data-joystick-role="knob"] /
  // [data-role="button-cap"] que bindPressButton -- los pointerdown/
  // pointerup de acá y los de bindPressButton conviven sin pisarse
  // (son listeners independientes sobre el mismo evento), así que
  // arrastrar el stick TAMBIÉN mantiene presionado el SW mientras
  // se lo sostiene, y al soltar se suelta el botón Y el stick
  // vuelve solo al centro (resorte), como en el módulo real.
  //
  // Convierte la posición del mouse a coordenadas LOCALES del propio
  // <circle> (el mismo sistema de unidades en el que están escritos
  // sus cx/cy, 0..50/0..62 -- el viewBox del componente) usando
  // getScreenCTM().inverse() -- así no hace falta saber nada del
  // paneo/zoom del canvas ni de cómo Renderer arma el <g> del
  // componente: getScreenCTM ya incluye TODA la cadena de
  // transforms de los ancestros.
  // ─────────────────────────────────────────────────────

  bindJoystick(component, group) {
    if (!Renderer.isJoystick(component.type)) return;

    const knob = group.querySelector('[data-joystick-role="knob"]');
    const area = group.querySelector('[data-role="joystick-area"]');
    if (!knob || !area) return;

    const cx0 = parseFloat(knob.getAttribute("cx"));
    const cy0 = parseFloat(knob.getAttribute("cy"));
    const knobR = parseFloat(knob.getAttribute("r"));
    const areaR = parseFloat(area.getAttribute("r"));
    const maxTravel = Math.max(1, areaR - knobR);

    let dragging = false;

    const toLocalPoint = (e) => {
      const svg = knob.ownerSVGElement;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = knob.getScreenCTM();
      if (!ctm) return { x: cx0, y: cy0 };
      return pt.matrixTransform(ctm.inverse());
    };

    const applyOffset = (dx, dy) => {
      knob.setAttribute("cx", cx0 + dx);
      knob.setAttribute("cy", cy0 + dy);
    };

    const start = (e) => {
      if (component.locked) return;
      // Sin esto, el pointerdown se filtraba hacia arriba y
      // DISPARABA TAMBIÉN el arrastre del componente entero
      // (DragManager) -- como acá abajo capturamos el puntero
      // en el knob, el pointerup de ESE otro arrastre nunca le
      // llegaba a DragManager, y el componente se quedaba
      // "pegado" siguiendo el mouse para siempre después de
      // soltar. Igual fix que ya tenían bindPressButton/
      // bindAdKey/bindKeypadMatrix, que se me había pasado acá.
      e.stopPropagation();
      e.preventDefault();
      dragging = true;
      try {
        knob.setPointerCapture(e.pointerId);
      } catch (err) {}
    };

    const move = (e) => {
      if (!dragging || component.locked) return;
      e.stopPropagation();

      const p = toLocalPoint(e);
      let dx = p.x - cx0;
      let dy = p.y - cy0;

      const dist = Math.hypot(dx, dy);
      if (dist > maxTravel) {
        const scale = maxTravel / dist;
        dx *= scale;
        dy *= scale;
      }

      applyOffset(dx, dy);

      // Normalizado -1..1 -- se invierte el eje Y porque en
      // SVG "abajo" es +y, pero un joystick reporta "arriba"
      // como valor alto en VRy (convención más intuitiva;
      // si tu módulo real cablea al revés, es cuestión de
      // invertir en el propio código del firmware).
      const nx = Math.max(-1, Math.min(1, dx / maxTravel));
      const ny = Math.max(-1, Math.min(1, -dy / maxTravel));

      this.simulator.signalEngine.setJoystickPosition(component, nx, ny);
    };

    const end = (e) => {
      if (!dragging) return;
      e.stopPropagation();
      dragging = false;

      applyOffset(0, 0); // resorte: vuelve al centro

      try {
        knob.releasePointerCapture(e.pointerId);
      } catch (err) {}

      this.simulator.signalEngine.setJoystickPosition(component, 0, 0);
    };

    knob.addEventListener("pointerdown", start);
    knob.addEventListener("pointermove", move);
    knob.addEventListener("pointerup", end);
    knob.addEventListener("pointercancel", end);
  }

  // ─────────────────────────────────────────────────────
  // Teclado analógico ADKEY: 5 teclas virtuales sobre un único
  // pin ADC (ver adkey.svg/adkey.json/adkey_hal.py).
  //
  // A diferencia de bindPressButton (que bridgea 2 pines del
  // JSON), acá no hay pines de por medio -- cada tecla, al
  // apretarse, le dice directo a SignalEngine.setAdKeyState() qué
  // nivel de voltaje mandar por el pin "out" compartido. Se
  // mantiene una pila de teclas sostenidas (pressedStack) porque
  // el usuario podría, sin querer, tener más de una apretada a la
  // vez (ej. arrastrando el mouse de una tecla a otra sin soltar)
  // -- la ÚLTIMA que se apretó y sigue sostenida es la que manda
  // (ver el comentario en SignalEngine.setAdKeyState sobre por
  // qué no se intenta simular la mezcla real de voltajes).
  // ─────────────────────────────────────────────────────

  bindAdKey(component, group) {
    if (!Renderer.isAdKey(component.type)) return;

    const keys = group.querySelectorAll("[data-adkey-role]");
    if (!keys.length) return;

    let pressedStack = [];

    // ANTES: forzaba el fill a amarillo fijo (#ffe600) para TODAS las
    // teclas al presionar -- tapaba el color propio de cada botón
    // (magenta/verde/azul/oliva/amarillo en el SVG real). Cambiado a
    // pedido: mismo patrón que ya usa bindKeypadMatrix (filtro de
    // brillo + resplandor blanco, sin tocar el fill) -- se nota
    // clarísimo que está presionado sin perder de vista de qué color
    // es cada tecla.
    const setVisual = (el, isOn) => {
      el.style.filter = isOn
        ? "brightness(1.6) drop-shadow(0 0 4px #ffffff)"
        : "none";
    };

    keys.forEach((el) => {
      const keyId = el.getAttribute("data-adkey-role");

      const press = (e) => {
        if (component.locked) return;
        e.stopPropagation();

        if (!pressedStack.includes(keyId)) pressedStack.push(keyId);
        setVisual(el, true);

        try {
          el.setPointerCapture(e.pointerId);
        } catch (err) {}

        this.simulator.signalEngine.setAdKeyState(
          component,
          pressedStack[pressedStack.length - 1],
        );
      };

      const release = (e) => {
        pressedStack = pressedStack.filter((k) => k !== keyId);
        setVisual(el, false);

        try {
          el.releasePointerCapture(e.pointerId);
        } catch (err) {}

        this.simulator.signalEngine.setAdKeyState(
          component,
          pressedStack[pressedStack.length - 1] || null,
        );
      };

      el.addEventListener("pointerdown", press);
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
      el.addEventListener("pointerleave", (e) => {
        // Igual criterio que bindPressButton: si se sale de
        // la tecla sin soltar el mouse, la soltamos igual.
        if (e.buttons === 0) release(e);
      });
    });
  }

  // ─────────────────────────────────────────────────────
  // Teclado matricial (4x4, 3x4, ...): N*M teclas virtuales
  // [data-keypad-role="r{fila}c{col}"], sin equivalente en
  // pressPins -- cada tecla le avisa a
  // SignalEngine.setKeypadKeyPressed(component, fila, col,
  // presionada) y es SignalEngine.evaluateKeypadMatrix() quien
  // decide qué fila leer en bajo según qué columna esté escaneando
  // el firmware en ese momento (ver ese método para el porqué).
  // No hace falta saber acá cuántas filas/columnas tiene el
  // teclado -- se detectan solas por los data-keypad-role que
  // haya en el .svg.
  // ─────────────────────────────────────────────────────

  bindKeypadMatrix(component, group) {
    if (!Renderer.isKeypadMatrix(component.type)) return;

    const keys = group.querySelectorAll("[data-keypad-role]");
    if (!keys.length) return;

    const setVisual = (el, isOn) => {
      el.style.filter = isOn
        ? "brightness(1.5) drop-shadow(0 0 3px #ffffff)"
        : "none";
    };

    // Teclas de ESTE componente actualmente marcadas como
    // presionadas -- para la red de seguridad de más abajo, que
    // las suelta a todas si el mouse queda sin ningún botón
    // apretado en NINGÚN lado sin que el pointerup/pointerleave
    // propio de la tecla se haya disparado (pasa si
    // setPointerCapture falla en silencio más abajo, o el
    // navegador redirige el evento a otro elemento -- la tecla
    // queda "trabada" presionada para siempre, ver
    // SignalEngine.setKeypadKeyPressed, hasta recargar la página).
    const pressedEls = new Map(); // el -> {rowIndex, colIndex}

    // Track global del estado del mouse
    window.addEventListener("pointerdown", () => {
      window._pitLastPointerButtons = 1;
    });
    window.addEventListener("pointerup", () => {
      window._pitLastPointerButtons = 0;
    });

    keys.forEach((el) => {
      const keyChar = (row, col) => {
        const map = [
          "1",
          "2",
          "3",
          "A",
          "4",
          "5",
          "6",
          "B",
          "7",
          "8",
          "9",
          "C",
          "*",
          "0",
          "#",
          "D",
        ];
        return map[row * 4 + col];
      };
      const role = el.getAttribute("data-keypad-role"); // "r{fila}c{col}"
      const match = role.match(/^r(\d)c(\d)$/);
      if (!match) return;

      const rowIndex = parseInt(match[1], 10);
      const colIndex = parseInt(match[2], 10);
      
      const press = (e) => {
        if (component.locked) return;

        if (e.buttons === 0) {
          //console.log(`[click] fantasma en r${rowIndex}c${colIndex} → tecla ${keyChar(rowIndex, colIndex)} ignorada`,);
          return;
        }

        window._pitLastPointerButtons = 1;   // seteo directo, no depende de burbujeo

        e.stopPropagation();

        setVisual(el, true);

        pressedEls.set(el, { rowIndex, colIndex });

        try {
          el.setPointerCapture(e.pointerId);
        } catch (err) {}

        //console.log(`[click] APRETADA r${rowIndex}c${colIndex} → tecla "${keyChar(rowIndex, colIndex)}"`,);

        this.simulator.signalEngine.setKeypadKeyPressed(
          component,
          rowIndex,
          colIndex,
          true,
        );
      };

      const release = (e) => {

        window._pitLastPointerButtons = 0;

        setVisual(el, false);

        pressedEls.delete(el);

        try {
          el.releasePointerCapture(e.pointerId);
        } catch (err) {}

        //console.log(`[click] SOLTADA r${rowIndex}c${colIndex} → tecla "${keyChar(rowIndex, colIndex)}"`,);

        this.simulator.signalEngine.setKeypadKeyPressed(
          component,
          rowIndex,
          colIndex,
          false,
        );
      };

      el.addEventListener("pointerdown", press);
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
      el.addEventListener("pointerleave", (e) => {
        if (e.buttons === 0) release(e);
      });
    });

    // Red de seguridad global (una sola vez por componente, no
    // por tecla): en cualquier pointerup/pointercancel en TODA
    // la ventana, si el botón ya no está apretado en ningún
    // lado, soltamos cualquier tecla de este teclado que haya
    // quedado marcada como presionada. Es lo que evita el bug
    // de "tecla trabada" -- un click que arrastra el mouse fuera
    // del SVG o pierde la captura del puntero, sin esto, deja
    // esa fila/columna leyendo "presionada" para siempre.
    const releaseAllStuck = (e) => {
      if (e.buttons !== 0) return;
      pressedEls.forEach(({ rowIndex, colIndex }, el) => {
        setVisual(el, false);
        this.simulator.signalEngine.setKeypadKeyPressed(
          component,
          rowIndex,
          colIndex,
          false,
        );
      });
      pressedEls.clear();
    };

    window.addEventListener("pointerup", releaseAllStuck);
    window.addEventListener("pointercancel", releaseAllStuck);
  }

  // ─────────────────────────────────────────────────────
  // Potenciómetro deslizante: arrastre en UN SOLO eje
  // (horizontal), a diferencia de bindJoystick (2 ejes + resorte).
  // Acá NO hay resorte: al soltar el mouse, la perilla se queda
  // donde quedó -- simplemente no se llama a applyOffset(0,0) ni
  // se manda ningún valor extra en el pointerup, a diferencia de
  // bindJoystick.
  //
  // UNA sola perilla física: pot_slider trae 2 pines de salida
  // (out1/out2, ver pot_slider.json) pero son la MISMA señal del
  // módulo real sacada por 2 pads -- no dos rieles independientes.
  // SignalEngine.setSliderPosition() ya se encarga de mandar el
  // mismo valor a ambos pines.
  //
  // El recorrido se calcula de [data-role="slider-track"] (sus
  // extremos x/x+width) y el radio de la perilla, igual criterio
  // que bindJoystick usa el radio de [data-role="joystick-area"].
  // ─────────────────────────────────────────────────────

  bindSlider(component, group) {
    if (!Renderer.isSlider(component.type)) return;

    const knob = group.querySelector('[data-slider-role="knob"]');
    const track = group.querySelector('[data-role="slider-track"]');
    if (!knob || !track) return;

    const cy = parseFloat(knob.getAttribute("cy"));
    const knobR = parseFloat(knob.getAttribute("r"));
    const trackX = parseFloat(track.getAttribute("x"));
    const trackW = parseFloat(track.getAttribute("width"));

    const minX = trackX + knobR;
    const maxX = trackX + trackW - knobR;
    const span = Math.max(1, maxX - minX);

    let dragging = false;

    const toLocalPoint = (e) => {
      const svg = knob.ownerSVGElement;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = knob.getScreenCTM();
      if (!ctm) return { x: parseFloat(knob.getAttribute("cx")) };
      return pt.matrixTransform(ctm.inverse());
    };

    const start = (e) => {
      if (component.locked) return;
      // Mismo fix que bindJoystick: sin esto, el pointerdown
      // se filtraba hacia arriba y disparaba también el
      // arrastre del componente entero (DragManager), que se
      // quedaba "pegado" siguiendo el mouse después de soltar
      // porque el pointerup quedaba capturado acá y nunca le
      // llegaba a DragManager.
      e.stopPropagation();
      e.preventDefault();
      dragging = true;
      try {
        knob.setPointerCapture(e.pointerId);
      } catch (err) {}
    };

    const move = (e) => {
      if (!dragging || component.locked) return;
      e.stopPropagation();

      const p = toLocalPoint(e);
      const clampedX = Math.max(minX, Math.min(maxX, p.x));

      knob.setAttribute("cx", clampedX);
      knob.setAttribute("cy", cy);

      const n01 = (clampedX - minX) / span;

      this.simulator.signalEngine.setSliderPosition(component, n01);
    };

    const end = (e) => {
      if (!dragging) return;
      e.stopPropagation();
      dragging = false;
      // SIN resorte: la perilla se queda donde quedó, no se
      // manda ningún valor extra acá (a diferencia de
      // bindJoystick, que sí vuelve al centro).
      try {
        knob.releasePointerCapture(e.pointerId);
      } catch (err) {}
    };

    knob.addEventListener("pointerdown", start);
    knob.addEventListener("pointermove", move);
    knob.addEventListener("pointerup", end);
    knob.addEventListener("pointercancel", end);
  }

  // ─────────────────────────────────────────────────────
  // Encoder rotativo KY-040 (v2, a pedido): YA NO es arrastre
  // circular -- son dos BOTONES clickeables (las flechas del SVG,
  // [data-encoder-role="ccw-button"]/"cw-button"), un click = un
  // paso (stepDeg = 360/stepsPerRev), igual modelo que usa Wokwi.
  // Mucho más simple que el drag: no hay ángulo de mouse que
  // trackear, ni normalización de -180..180, ni distinción entre
  // "rotación visual continua" y "conteo de clicks eléctrico" --
  // acá las dos cosas son la MISMA acción, un click dispara ambas
  // a la vez.
  //
  // El pivote (cx/cy) se sigue leyendo de [data-encoder-role="area"]
  // (el cap) en vez de hardcodearlo -- ese elemento ya no recibe
  // ningún listener de drag, solo lo usamos para no repetir los
  // números en el JS. El SW sigue andando igual que siempre, sin
  // tocar nada: bindPressButton usa el mismo cap por su atributo
  // [data-role="button-cap"], sin pisarse con esto.
  //
  // knobAngle es un simple contador en closure por componente (no
  // hay "dragging" que trackear entre eventos) -- cada click suma o
  // resta stepDeg y aplica el rotate() de una, sin animación
  // intermedia (un click = un salto de un paso, como el detent de
  // un encoder real).
  // ─────────────────────────────────────────────────────

  bindEncoder(component, group) {
    if (!Renderer.isEncoder(component.type)) return;

    const knob = group.querySelector('[data-encoder-role="knob"]');
    const area = group.querySelector('[data-encoder-role="area"]');
    const ccwButton = group.querySelector('[data-encoder-role="ccw-button"]');
    const cwButton = group.querySelector('[data-encoder-role="cw-button"]');

    // Chequeos defensivos: antes esto simplemente hacía "return" en
    // silencio si algo no encajaba (típicamente porque el .svg
    // servido no es el que uno cree que es -- cache del navegador,
    // o el archivo en el proyecto quedó desactualizado). Preferible
    // que avise en la consola a que el botón parezca "no hacer
    // nada" sin ninguna pista de por qué.
    if (!knob || !area || !ccwButton || !cwButton) {
      console.warn(
        `[KY-040] bindEncoder: faltan elementos en el SVG de ${component.id} ` +
          `(knob=${!!knob}, area=${!!area}, ccwButton=${!!ccwButton}, cwButton=${!!cwButton}). ` +
          `¿El .svg servido tiene los data-encoder-role actualizados? Revisá cache del navegador.`
      );
      return;
    }

    const cx = parseFloat(area.getAttribute("cx"));
    const cy = parseFloat(area.getAttribute("cy"));

    if (Number.isNaN(cx) || Number.isNaN(cy)) {
      // Si esto pasa, applyRotation() generaría un transform tipo
      // "rotate(18 NaN NaN)" -- SVG lo ignora sin tirar error, así
      // que el eje simplemente nunca rota y no hay ninguna pista en
      // consola de por qué. Mejor cortar acá con un aviso explícito.
      console.warn(
        `[KY-040] bindEncoder: cx/cy inválidos en ${component.id} (cx="${area.getAttribute("cx")}", cy="${area.getAttribute("cy")}"). La perilla no va a rotar.`
      );
      return;
    }

    const stepsPerRev = component.properties?.stepsPerRev || 20;
    const stepDeg = 360 / stepsPerRev;

    // OJO, fix importante: antes esto era "let knobAngle = 0",
    // una variable puramente local al closure de este bind(). Si el
    // motor de render llega a reconstruir el <g> del componente en
    // algún momento (por ejemplo tras la propia llamada a
    // setEncoderStep, si dispara un re-render del estado global),
    // ese closure se pierde por completo y el próximo bindEncoder()
    // arranca de nuevo en knobAngle=0 -- el giro se aplicaría por un
    // instante y quedaría pisado sin que se note. Ahora el ángulo
    // vive en el propio `component` (persiste entre binds, sea
    // cual sea la causa), y se re-aplica al DOM ACÁ MISMO apenas se
    // bindea, para que un re-render no "resetee" visualmente lo que
    // ya se había girado.
    if (typeof component.encoderAngle !== "number") {
      component.encoderAngle = 0;
    }
    // Contador de PASOS, separado del ángulo visual: el ángulo tiene
    // que seguir siendo en grados (lo necesita el transform del
    // SVG/CSS para rotar), pero lo que el usuario quiere ver/loggear
    // es un entero simple que suba y baje de a 1 (1,2,3,4... y de
    // vuelta 4,3,2,1...), no el acumulado en grados (18,36,54...).
    if (typeof component.encoderStepCount !== "number") {
      component.encoderStepCount = 0;
    }

    const applyRotation = () => {
      // FIX real (a partir de lo que confirmaste: el log aparece
      // pero el eje nunca se mueve, ni un instante -- eso descarta
      // que algo lo pise DESPUÉS, y apunta a que el atributo SVG
      // "transform" nunca tuvo efecto visual desde el vamos). En
      // navegadores modernos, la propiedad CSS "transform" (de una
      // hoja de estilos, un reset, una transición, etc.) LE GANA al
      // atributo SVG "transform" -- el atributo queda perfectamente
      // seteado en el DOM (por eso el resto de la lógica anda bien)
      // pero no se pinta. Por eso cx/cy del slider/joystick sí
      // funcionan (no son atributos que CSS pise) y esto no.
      //
      // Fix: aplicar la rotación como estilo CSS inline con
      // "important", que gana contra cualquier regla de hoja de
      // estilos externa (solo pierde contra otro inline !important,
      // algo que no debería existir para este elemento). Hace falta
      // "transform-origin" en el mismo sistema de coordenadas
      // (unidades del viewBox) porque CSS transform NO acepta el
      // pivote como parámetro de rotate(), a diferencia del atributo
      // SVG -- por eso van dos declaraciones separadas.
      knob.style.setProperty("transform-origin", `${cx}px ${cy}px`);
      knob.style.setProperty("transform", `rotate(${component.encoderAngle}deg)`, "important");

      // Se deja también el atributo SVG como respaldo -- inofensivo,
      // y cubre el caso de que el diagnóstico de arriba esté
      // equivocado y en realidad SÍ se estuviera leyendo el
      // atributo en algún lado.
      knob.setAttribute("transform", `rotate(${component.encoderAngle} ${cx} ${cy})`);

      console.log(`[KY-040] ${component.id} step ->`, component.encoderStepCount);
    };

    // Restaurar la rotación visual actual apenas se bindea (cubre
    // el caso de que el <g> se haya reconstruido de cero).
    applyRotation();

    // Feedback visual rápido al click: la flecha clickeada se pone
    // blanca un instante y vuelve a su gris original -- sin esto el
    // click se siente "mudo" (el único cambio visible sería la
    // perilla saltando de a stepDeg°, que puede ser sutil si
    // stepsPerRev es alto).
    const flash = (arrow) => {
      if (!arrow) return;
      arrow.setAttribute("fill", "#ffffff");
      setTimeout(() => {
        arrow.setAttribute("fill", "#8c8c8c");
      }, 150);
    };

    const ccwArrow = group.querySelector('[data-encoder-role="ccw-arrow"]');
    const cwArrow = group.querySelector('[data-encoder-role="cw-arrow"]');

    const step = (direction, arrow) => (e) => {
      if (component.locked) return;
      // Mismo fix de siempre: sin esto el click se filtra hacia
      // DragManager/selección del componente.
      e.stopPropagation();
      e.preventDefault();

      component.encoderAngle += direction * stepDeg;
      component.encoderStepCount += direction;
      applyRotation();
      flash(arrow);

      this.simulator.signalEngine.setEncoderStep(component, direction);
    };

    ccwButton.addEventListener("pointerdown", step(-1, ccwArrow));
    cwButton.addEventListener("pointerdown", step(1, cwArrow));
  }

  // ─────────────────────────────────────────────────────
  // Buzzer piezo pasivo: reproduce el tono DE VERDAD con la Web
  // Audio API del navegador (no es un indicador cosmético) -- ver
  // buzzer.hal.py/SignalEngine.evaluateBuzzer.
  //
  // Un AudioContext solo se puede crear/arrancar dentro de un
  // gesto del usuario (política de autoplay de los navegadores) --
  // acá se crea perezosamente en el primer playBuzzerTone() y se
  // reutiliza uno solo para TODOS los buzzers del circuito (varias
  // instancias de AudioContext no hacen falta y son más pesadas).
  // Como para llegar a este punto el usuario ya tuvo que apretar
  // "Simular" (un click real), el gesto de usuario ya existe en la
  // página al momento de crearlo.
  // ─────────────────────────────────────────────────────

  _getAudioContext() {
    if (!this._audioContext) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      this._audioContext = new AudioContextClass();
    }

    if (this._audioContext.state === "suspended") {
      this._audioContext.resume().catch(() => {});
    }

    return this._audioContext;
  }

  playBuzzerTone(component, freq) {
    const ctx = this._getAudioContext();

    if (!component._buzzerAudio) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // "square" en vez de "sine": timbre más parecido a un
      // piezo real (más agudo/metálico) que una onda senoidal
      // pura.
      osc.type = "square";
      gain.gain.value = 0.06; // volumen moderado -- un piezo real tampoco es sutil, pero esto no debería sobresaltar a nadie

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      component._buzzerAudio = { osc, gain };
    }

    component._buzzerAudio.osc.frequency.setValueAtTime(freq, ctx.currentTime);

    if (component.element) {
      component.element
        .querySelectorAll('[data-buzzer-role^="wave"]')
        .forEach((w) => {
          w.style.opacity = "1";
        });
    }
  }

  stopBuzzerTone(component) {
    if (component._buzzerAudio) {
      try {
        component._buzzerAudio.osc.stop();
        component._buzzerAudio.osc.disconnect();
        component._buzzerAudio.gain.disconnect();
      } catch (err) {}
      component._buzzerAudio = null;
    }

    if (component.element) {
      component.element
        .querySelectorAll('[data-buzzer-role^="wave"]')
        .forEach((w) => {
          w.style.opacity = "0";
        });
    }
  }

  // Para cortar cualquier tono que haya quedado sonando al
  // desconectar/detener la simulación o resetear -- ver los
  // llamados a esto en QemuBridge.js (onClose/STATUS no-running) y
  // SignalEngine.reset().
  stopAllBuzzers() {
    this.simulator.componentManager.getAll().forEach((component) => {
      if (Renderer.isBuzzer(component.type)) {
        this.stopBuzzerTone(component);
      }
    });
  }

  // ─────────────────────────────────────────────────────
  // Marcar los elementos del cuerpo del LED.
  // Detecta cualquier elemento cuyo id empiece por "color_"
  // (convención de Fritzing) y le asigna data-led-role="body".
  // Elimina el id para evitar colisiones entre múltiples
  // instancias del mismo LED en el canvas.
  // ─────────────────────────────────────────────────────

  // tagLedElements()/tagServoElements() migraron a
  // components/led/led.behavior.js y components/sg90/sg90.behavior.js
  // (sin llamadores externos -- solo los usaba el dispatch de
  // renderComponent(), ahora vía ComponentBehaviorRegistry).

  // Pivote por defecto del eje del SG90 (centro del disco/horn,
  // medido en el espacio LOCAL del propio <g id="eje">, es decir,
  // antes de cualquier transform de sus grupos padres). Si el
  // .json del componente trae properties.shaftPivot se usa ese
  // en su lugar (para poder reutilizar este método con otros SVGs).
  static SERVO_DEFAULT_PIVOT = { x: 58.5, y: -49.5 };

  // Rotar el eje del servo. angle en grados (convención SG90: 0-180).
  setServoAngle(component, angle) {
    if (!component.element) return;

    const shaft = component.element.querySelector('[data-servo-role="shaft"]');
    if (!shaft) return;

    const pivot =
      component.properties?.shaftPivot || Renderer.SERVO_DEFAULT_PIVOT;

    shaft.setAttribute("transform", `rotate(${angle}, ${pivot.x}, ${pivot.y})`);
  }

  // tagMotorElements() migró a components/motor/motor.behavior.js
  // (sin llamadores externos).

  // ─────────────────────────────────────────────────────
  // LCD 16x2 (con o sin backpack I2C)
  //
  // Los dos .svg (lcd16x2.svg y lcd_16x2_i2c.svg) comparten la
  // misma paleta/estructura para la pantalla: un único <path
  // fill="#87AD34"> es el fondo, y los 32 <polygon fill="#1A1A1A">
  // (16x2 celdas) son la grilla de puntos apagados -- son
  // <polygon>, no <path>, así que se distinguen sin ambigüedad de
  // cualquier otro elemento oscuro del bisel/chip que también use
  // #1A1A1A.
  //
  // No hay renderizado de texto real todavía (necesitaría el
  // protocolo "LCD:" -- ver la nota que le dejamos a QemuBridge.js
  // para el OLED). Por ahora esto solo permite elegir el esquema
  // de color, calcado del selector que ya existe para el OLED.
  // ─────────────────────────────────────────────────────

  static LCD_COLOR_SCHEMES = {
    // La que ya traía el .svg original (LCD clásica verde/amarilla,
    // texto oscuro) -- la dejamos como default para no cambiarle
    // el aspecto a nadie que ya tenga LCDs puestos en su proyecto.
    yellow_green: {
      background: "#87AD34",
      dots: "#1A1A1A",
    },

    // La otra variante comercial más común: fondo azul, texto
    // blanco/celeste claro.
    blue: {
      background: "#2B4EA8",
      dots: "#EAF1FF",
    },
  };

  static getLcdScheme(component) {
    const key = component.properties?.colorScheme || "yellow_green";
    return (
      Renderer.LCD_COLOR_SCHEMES[key] || Renderer.LCD_COLOR_SCHEMES.yellow_green
    );
  }

  // ── Helpers de matriz afín (translate/scale/matrix) ─────────
  //
  // Por qué hacen falta: en lcd16x2.svg (el LCD paralelo), los 32
  // <polygon data-lcd-role="dot"> quedan envueltos en dos <g> con
  // su propio transform cada uno (ej. <g id="breadboard"
  // transform="translate(-11134.87,1)"><g id="icon-5"
  // transform="translate(590.56902)">...), a diferencia de
  // lcd_16x2_i2c.svg, donde esos mismos polígonos NO tienen ningún
  // <g> con transform de por medio. Si se leen los "points" crudos
  // sin componer esos transforms, el bounding box (y por lo tanto
  // el foreignObject del texto) sale corrido -- exactamente el
  // desfasaje hacia la derecha que se reportó en el LCD paralelo,
  // mientras que el I2C (sin wrappers) siempre calculaba bien.
  //
  // Estos helpers solo soportan translate()/scale()/matrix() --
  // los únicos tipos de transform que usan estos .svg. Si algún
  // .svg futuro necesitara rotate()/skewX()/skewY(), habría que
  // sumarlos acá.

  _parseTransformAttr(str) {
    const identity = [1, 0, 0, 1, 0, 0];
    if (!str) return identity;

    let m = identity;
    const re = /(\w+)\s*\(([^)]*)\)/g;
    let match;

    while ((match = re.exec(str)) !== null) {
      const fn = match[1];
      const args = match[2]
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      let part = identity;

      if (fn === "translate") {
        const tx = args[0] || 0;
        const ty = args.length > 1 ? args[1] : 0;
        part = [1, 0, 0, 1, tx, ty];
      } else if (fn === "scale") {
        const sx = args[0] !== undefined ? args[0] : 1;
        const sy = args.length > 1 ? args[1] : sx;
        part = [sx, 0, 0, sy, 0, 0];
      } else if (fn === "matrix" && args.length === 6) {
        part = args;
      }

      m = this._multiplyMatrix(m, part);
    }

    return m;
  }

  // Compone m1∘m2 (un punto se transforma primero por m2, después
  // por m1) -- misma convención que la composición de <g> anidados
  // en SVG: el <g> más INTERNO se aplica primero.
  _multiplyMatrix(m1, m2) {
    const [a1, b1, c1, d1, e1, f1] = m1;
    const [a2, b2, c2, d2, e2, f2] = m2;
    return [
      a1 * a2 + c1 * b2,
      b1 * a2 + d1 * b2,
      a1 * c2 + c1 * d2,
      b1 * c2 + d1 * d2,
      a1 * e2 + c1 * f2 + e1,
      b1 * e2 + d1 * f2 + f1,
    ];
  }

  _applyMatrix(m, x, y) {
    const [a, b, c, d, e, f] = m;
    return { x: a * x + c * y + e, y: b * x + d * y + f };
  }

  // Compone los transform de todos los <g> ancestros entre `node`
  // (sin incluirlo) y `ancestor` (sin incluirlo), de afuera hacia
  // adentro -- el resultado mapea coordenadas LOCALES de `node`
  // (las que trae points="...") a coordenadas del sistema de
  // `ancestor` (acá, siempre "graphic", el <g> del componente
  // entero -- que ya tiene SU PROPIO transform de escala/posición
  // en el canvas aplicado por fuera, así que no hace falta tocarlo
  // acá: el debugRect/foreignObject se agregan como hijos directos
  // de ese mismo `graphic`, así que quedan en el mismo sistema).
  _getLocalTransformUpTo(node, ancestor) {
    const chain = [];
    let el = node.parentNode;

    while (el && el !== ancestor && el.nodeType === 1) {
      chain.unshift(el);
      el = el.parentNode;
    }

    let m = [1, 0, 0, 1, 0, 0];
    chain.forEach((g) => {
      const part = this._parseTransformAttr(
        g.getAttribute && g.getAttribute("transform"),
      );
      m = this._multiplyMatrix(m, part);
    });

    return m;
  }

  // tagLcdElements() migró a components/lcd16x2/lcd16x2.behavior.js
  // (registrado para "lcd16x2" y "lcd_16x2_i2c", sin llamadores
  // externos -- applyLcdColorScheme()/_getLocalTransformUpTo()/
  // _applyMatrix() de abajo siguen viviendo acá, los llama vía
  // "renderer").

  // Tamaño de la matriz de puntos por carácter -- estándar HD44780
  // (5 columnas x 7 filas de "pixel"; la 8va fila real del chip es
  // para el cursor, no la simulamos).
  static LCD_CHAR_COLS = 5;
  static LCD_CHAR_ROWS = 7;

  // Fuente 5x7 de puntos, tabla fija -- no es la fuente del
  // navegador reducida (eso da letras amontonadas/irreconocibles,
  // una tipografía normal no está diseñada para verse bien a 5px
  // de ancho), es la misma tabla de bitmaps "dibujados a mano"
  // que usan la gran mayoría de simuladores de LCD/OLED (y el
  // hardware real). 5 bytes por carácter = 5 columnas, cada byte
  // es una columna de arriba hacia abajo (bit0 = fila de arriba).
  //
  // Si algún carácter puntual se ve raro, es cuestión de corregir
  // SOLO esa entrada acá -- decime cuál y la ajusto.
  static LCD_FONT_5X7 = {
    " ": [0x00, 0x00, 0x00, 0x00, 0x00],
    "!": [0x00, 0x00, 0x5f, 0x00, 0x00],
    '"': [0x00, 0x07, 0x00, 0x07, 0x00],
    "#": [0x14, 0x7f, 0x14, 0x7f, 0x14],
    $: [0x24, 0x2a, 0x7f, 0x2a, 0x12],
    "%": [0x23, 0x13, 0x08, 0x64, 0x62],
    "&": [0x36, 0x49, 0x55, 0x22, 0x50],
    "'": [0x00, 0x05, 0x03, 0x00, 0x00],
    "(": [0x00, 0x1c, 0x22, 0x41, 0x00],
    ")": [0x00, 0x41, 0x22, 0x1c, 0x00],
    "*": [0x14, 0x08, 0x3e, 0x08, 0x14],
    "+": [0x08, 0x08, 0x3e, 0x08, 0x08],
    ",": [0x00, 0x50, 0x30, 0x00, 0x00],
    "-": [0x08, 0x08, 0x08, 0x08, 0x08],
    ".": [0x00, 0x60, 0x60, 0x00, 0x00],
    "/": [0x20, 0x10, 0x08, 0x04, 0x02],
    0: [0x3e, 0x51, 0x49, 0x45, 0x3e],
    1: [0x00, 0x42, 0x7f, 0x40, 0x00],
    2: [0x42, 0x61, 0x51, 0x49, 0x46],
    3: [0x21, 0x41, 0x45, 0x4b, 0x31],
    4: [0x18, 0x14, 0x12, 0x7f, 0x10],
    5: [0x27, 0x45, 0x45, 0x45, 0x39],
    6: [0x3c, 0x4a, 0x49, 0x49, 0x30],
    7: [0x01, 0x71, 0x09, 0x05, 0x03],
    8: [0x36, 0x49, 0x49, 0x49, 0x36],
    9: [0x06, 0x49, 0x49, 0x29, 0x1e],
    ":": [0x00, 0x36, 0x36, 0x00, 0x00],
    ";": [0x00, 0x56, 0x36, 0x00, 0x00],
    "<": [0x00, 0x08, 0x14, 0x22, 0x41],
    "=": [0x14, 0x14, 0x14, 0x14, 0x14],
    ">": [0x41, 0x22, 0x14, 0x08, 0x00],
    "?": [0x02, 0x01, 0x51, 0x09, 0x06],
    "@": [0x32, 0x49, 0x79, 0x41, 0x3e],
    A: [0x7e, 0x11, 0x11, 0x11, 0x7e],
    B: [0x7f, 0x49, 0x49, 0x49, 0x36],
    C: [0x3e, 0x41, 0x41, 0x41, 0x22],
    D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
    E: [0x7f, 0x49, 0x49, 0x49, 0x41],
    F: [0x7f, 0x09, 0x09, 0x09, 0x01],
    G: [0x3e, 0x41, 0x49, 0x49, 0x7a],
    H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
    I: [0x00, 0x41, 0x7f, 0x41, 0x00],
    J: [0x20, 0x40, 0x41, 0x3f, 0x01],
    K: [0x7f, 0x08, 0x14, 0x22, 0x41],
    L: [0x7f, 0x40, 0x40, 0x40, 0x40],
    M: [0x7f, 0x02, 0x0c, 0x02, 0x7f],
    N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
    O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
    P: [0x7f, 0x09, 0x09, 0x09, 0x06],
    Q: [0x3e, 0x41, 0x51, 0x21, 0x5e],
    R: [0x7f, 0x09, 0x19, 0x29, 0x46],
    S: [0x46, 0x49, 0x49, 0x49, 0x31],
    T: [0x01, 0x01, 0x7f, 0x01, 0x01],
    U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
    V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
    W: [0x3f, 0x40, 0x38, 0x40, 0x3f],
    X: [0x63, 0x14, 0x08, 0x14, 0x63],
    Y: [0x07, 0x08, 0x70, 0x08, 0x07],
    Z: [0x61, 0x51, 0x49, 0x45, 0x43],
    "[": [0x00, 0x7f, 0x41, 0x41, 0x00],
    "\\": [0x02, 0x04, 0x08, 0x10, 0x20],
    "]": [0x00, 0x41, 0x41, 0x7f, 0x00],
    "^": [0x04, 0x02, 0x01, 0x02, 0x04],
    _: [0x40, 0x40, 0x40, 0x40, 0x40],
    "`": [0x00, 0x01, 0x02, 0x04, 0x00],
    a: [0x20, 0x54, 0x54, 0x54, 0x78],
    b: [0x7f, 0x48, 0x44, 0x44, 0x38],
    c: [0x38, 0x44, 0x44, 0x44, 0x20],
    d: [0x38, 0x44, 0x44, 0x48, 0x7f],
    e: [0x38, 0x54, 0x54, 0x54, 0x18],
    f: [0x08, 0x7e, 0x09, 0x01, 0x02],
    g: [0x0c, 0x52, 0x52, 0x52, 0x3e],
    h: [0x7f, 0x08, 0x04, 0x04, 0x78],
    i: [0x00, 0x44, 0x7d, 0x40, 0x00],
    j: [0x20, 0x40, 0x44, 0x3d, 0x00],
    k: [0x7f, 0x10, 0x28, 0x44, 0x00],
    l: [0x00, 0x41, 0x7f, 0x40, 0x00],
    m: [0x7c, 0x04, 0x18, 0x04, 0x78],
    n: [0x7c, 0x08, 0x04, 0x04, 0x78],
    o: [0x38, 0x44, 0x44, 0x44, 0x38],
    p: [0x7c, 0x14, 0x14, 0x14, 0x08],
    q: [0x08, 0x14, 0x14, 0x18, 0x7c],
    r: [0x7c, 0x08, 0x04, 0x04, 0x08],
    s: [0x48, 0x54, 0x54, 0x54, 0x20],
    t: [0x04, 0x3f, 0x44, 0x40, 0x20],
    u: [0x3c, 0x40, 0x40, 0x20, 0x7c],
    v: [0x1c, 0x20, 0x40, 0x20, 0x1c],
    w: [0x3c, 0x40, 0x30, 0x40, 0x3c],
    x: [0x44, 0x28, 0x10, 0x28, 0x44],
    y: [0x0c, 0x50, 0x50, 0x50, 0x3c],
    z: [0x44, 0x64, 0x54, 0x4c, 0x44],
    "{": [0x00, 0x08, 0x36, 0x41, 0x00],
    "|": [0x00, 0x00, 0x7f, 0x00, 0x00],
    "}": [0x00, 0x41, 0x36, 0x08, 0x00],
    "~": [0x08, 0x04, 0x08, 0x10, 0x08],
  };

  // Cache de bitmaps (booleanos) por carácter, ya convertidos de
  // los bytes de columna de arriba -- evita repetir el bit-shift
  // en cada frame para el mismo carácter repetido muchas veces.
  static _lcdFontCache = {};

  static getLcdCharBitmap(ch) {
    if (Renderer._lcdFontCache[ch] !== undefined) {
      return Renderer._lcdFontCache[ch];
    }

    const ROWS = Renderer.LCD_CHAR_ROWS;
    const cols = Renderer.LCD_FONT_5X7[ch] || Renderer.LCD_FONT_5X7["?"];

    const bitmap = [];
    for (let row = 0; row < ROWS; row++) {
      const r = [];
      for (let col = 0; col < cols.length; col++) {
        r.push(((cols[col] >> row) & 1) === 1);
      }
      bitmap.push(r);
    }

    Renderer._lcdFontCache[ch] = bitmap;
    return bitmap;
  }

  // Apariencia del panel cuando el backlight está apagado -- un
  // solo tono oscuro para background Y dots (a diferencia de los
  // esquemas normales, que contrastan fondo/puntos, acá buscamos
  // que se vea "apagado" parejo, sin importar qué esquema de
  // color tenía activo). No depende de LCD_COLOR_SCHEMES porque
  // no es un esquema elegible por el usuario, es un estado.
  static LCD_BACKLIGHT_OFF_APPEARANCE = {
    background: "#12140d",
    dots: "#12140d",
  };

  applyLcdColorScheme(component) {
    if (!component.element) return;

    // El esquema de color (yellow_green/blue) solo se ve si el
    // backlight está prendido -- si está apagado, mantenemos la
    // apariencia "apagada" en vez de pisarla con el esquema.
    // component._lcdBacklightOn arranca undefined (nunca llegó
    // ningún LCD: todavía) -- lo tratamos como prendido, mismo
    // default que trae LcdApi.__init__.
    this.setLcdBacklight(component, component._lcdBacklightOn !== false);
  }

  // Prende/apaga la luz de fondo del panel -- afecta el color del
  // rectángulo de fondo y de la grilla de puntos, INDEPENDIENTE
  // del texto (eso lo maneja drawLcdText/clearLcdText). Es lo que
  // distingue backlight_off() de display_off(): display_off() solo
  // apaga los caracteres pero el panel se ve igual de iluminado,
  // backlight_off() apaga el panel entero, tenga o no texto.
  setLcdBacklight(component, on) {
    if (!component.element) return;

    component._lcdBacklightOn = on;

    const scheme = on
      ? Renderer.getLcdScheme(component)
      : Renderer.LCD_BACKLIGHT_OFF_APPEARANCE;

    const bg = component.element.querySelector('[data-lcd-role="screen-bg"]');
    if (bg) bg.setAttribute("fill", scheme.background);

    component.element
      .querySelectorAll('[data-lcd-role="dot"]')
      .forEach((poly) => {
        poly.setAttribute("fill", scheme.dots);
      });

    // El texto ya dibujado también tiene que recolorearse -- si
    // no, cambiar de esquema (o prender/apagar el backlight)
    // mientras hay texto en pantalla deja el texto con el color
    // viejo hasta el próximo LCD:. Como ahora el texto es un
    // canvas rasterizado (no elementos SVG con fill), lo más
    // simple es re-dibujar con el último contenido conocido --
    // pero solo si el panel está prendido: con el backlight
    // apagado no tiene sentido dibujar texto con el mismo tono
    // oscuro que el fondo (quedaría invisible igual, y nos
    // ahorramos el trabajo).
    if (on && component._lcdLastRows) {
      this.drawLcdText(
        component,
        component._lcdLastRows,
        component._lcdLastCursor,
      );
    }
  }

  // Cada cuánto alterna el cursor entre visible/invisible cuando
  // blink_on está activo -- ritmo parecido al del HD44780 real
  // (aprox. medio segundo por fase, no es un valor del datasheet
  // exacto, solo "se ve como el original").
  static LCD_BLINK_MS = 430;

  // Frena el setInterval del parpadeo si había uno corriendo para
  // este componente -- hace falta llamarlo ANTES de arrancar uno
  // nuevo (si no, cada nuevo putstr()/move_to() apilaría un
  // interval encima del anterior) y también al limpiar la
  // pantalla (display_off(), reset de la simulación, etc.), para
  // no dejar un timer zombie dibujando sobre un canvas ya vacío.
  stopLcdBlink(component) {
    if (component._lcdBlinkInterval) {
      clearInterval(component._lcdBlinkInterval);
      component._lcdBlinkInterval = null;
    }
  }

  // Pintar el texto real que manda el firmware (ver
  // lcd_16x2_i2c.hal.py, protocolo "LCD:"). rows es un array de
  // strings (uno por fila, ya decodificado del hex), todas del
  // mismo largo (cols).
  //
  // cursorState = { displayOn, cursorOn, blinkOn, cursorCol, cursorRow }
  // (ver QemuBridge.js / SignalEngine.js) -- puede venir null para
  // los llamados viejos o cuando no hay info de cursor todavía.
  // displayOn ya se resuelve ANTES de llegar acá (SignalEngine
  // llama a clearLcdText en su lugar si el display está apagado),
  // así que esta función asume que hay que mostrar texto.
  drawLcdText(component, rows, cursorState = null) {
    if (!component.element) return;

    const canvas = component.element.querySelector(
      '[data-lcd-role="screen-canvas"]',
    );
    if (!canvas) return;

    // Para poder re-dibujar si cambia el esquema de color o si
    // toca el próximo tick del parpadeo.
    component._lcdLastRows = rows;
    component._lcdLastCursor = cursorState;

    this.stopLcdBlink(component);

    // Primer frame: si hay blink, arranca en fase "on" (bloque
    // visible), igual que el chip real al recién prenderlo.
    this.renderLcdFrame(component, true);

    if (cursorState && cursorState.blinkOn) {
      // El blink es independiente de cursor_on -- en el chip
      // real podés tener blink sin la rayita (cursor_on en 0),
      // aunque LcdApi no expone esa combinación por su cuenta
      // (blink_cursor_on() siempre prende los dos bits juntos).
      // Lo dejamos desacoplado igual, por si en el futuro se
      // arma ese comando a mano con hal_write_command().
      let visible = true;

      component._lcdBlinkInterval = setInterval(() => {
        visible = !visible;
        this.renderLcdFrame(component, visible);
      }, Renderer.LCD_BLINK_MS);
    }
  }

  // Dibuja un frame completo (glifos + cursor si corresponde) con
  // el último contenido conocido -- separado de drawLcdText() para
  // que el setInterval del parpadeo pueda llamar solo esto sin
  // reiniciar el timer cada vez.
  //
  // blinkVisibleNow es la fase actual del parpadeo de BLOQUE
  // (cursorState.blinkOn) -- la rayita de cursor_on NO parpadea,
  // se dibuja fija mientras cursor_on esté prendido (igual que el
  // chip real: show_cursor()/hide_cursor() y
  // blink_cursor_on()/blink_cursor_off() son conceptos distintos).
  renderLcdFrame(component, blinkVisibleNow) {
    const canvas = component.element.querySelector(
      '[data-lcd-role="screen-canvas"]',
    );
    if (!canvas) return;

    const rows = component._lcdLastRows || [];
    const cursorState = component._lcdLastCursor;

    const scheme = Renderer.getLcdScheme(component);
    const ctx = canvas.getContext("2d");

    const COLS = Renderer.LCD_CHAR_COLS;
    const ROWS = Renderer.LCD_CHAR_ROWS;

    const numColumns = rows[0] ? rows[0].length : 16;
    const numLines = rows.length || 2;

    const cellW = canvas.width / numColumns;
    const cellH = canvas.height / numLines;

    // Fracción fija de la celda que ocupa el carácter (ancho/alto)
    // -- volvimos acá después de probar medirla del .svg real de
    // cada componente: esa medición hacía que el LCD paralelo
    // (cuyos rectángulos de fondo dejan casi 0 margen, ~94%/98%)
    // se viera con las letras más grandes y más pegadas de lo
    // que se ve bien, mientras que esta proporción fija es la
    // que ya veníamos usando y se ve bien tanto en el I2C como
    // (antes de este experimento) en el paralelo.
    const fit = {
      wFrac: COLS / (COLS + 1),
      hFrac: ROWS / (ROWS + 2),
    };

    const glyphW = cellW * fit.wFrac;
    const glyphH = cellH * fit.hFrac;

    const marginX = (cellW - glyphW) / 2; // centrado horizontal en la celda
    const marginY = (cellH - glyphH) / 2; // centrado vertical en la celda

    const dotW = glyphW / COLS;
    const dotH = glyphH / ROWS;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = scheme.dots;

    for (let r = 0; r < numLines; r++) {
      const rowText = rows[r] || "";

      for (let c = 0; c < numColumns; c++) {
        const bitmap = Renderer.getLcdCharBitmap(rowText[c] || " ");
        const baseX = c * cellW + marginX;
        const baseY = r * cellH + marginY;

        for (let by = 0; by < ROWS; by++) {
          for (let bx = 0; bx < COLS; bx++) {
            if (!bitmap[by][bx]) continue;
            ctx.fillRect(
              baseX + bx * dotW,
              baseY + by * dotH,
              Math.max(1, dotW * 0.82),
              Math.max(1, dotH * 0.82),
            );
          }
        }
      }
    }

    if (!cursorState) return;

    const cursorInBounds =
      cursorState.cursorRow >= 0 &&
      cursorState.cursorRow < numLines &&
      cursorState.cursorCol >= 0 &&
      cursorState.cursorCol < numColumns;

    if (!cursorInBounds) return;

    const cellBaseX = cursorState.cursorCol * cellW + marginX;
    const cellBaseY = cursorState.cursorRow * cellH + marginY;

    // Rayita -- fija mientras cursor_on esté prendido, no
    // depende de la fase de blink. Va pegada al borde de abajo
    // del carácter, dentro del margen inferior de la celda.
    if (cursorState.cursorOn) {
      ctx.fillRect(
        cellBaseX,
        cellBaseY + glyphH,
        Math.max(1, glyphW * 0.9),
        Math.max(1, dotH * 0.82),
      );
    }

    // Bloque completo -- cubre el carácter Y el margen inferior
    // (donde va la rayita), para que se vea como una sola celda
    // sólida sin huequito, igual que antes -- ahora en base a la
    // proporción real medida en vez de un +1 de fila fijo. Solo
    // en la fase "visible" del parpadeo. Lo dibujamos ENCIMA del
    // carácter (y de la rayita, si estaba).
    if (cursorState.blinkOn && blinkVisibleNow) {
      ctx.fillRect(
        cellBaseX,
        cellBaseY,
        Math.max(1, glyphW * 0.9),
        Math.max(1, (glyphH + marginY) * 0.95),
      );
    }
  }

  // Apagar/limpiar el texto (reset de la simulación, backlight
  // apagado, o display_off()) -- deja el canvas vacío, la grilla
  // de puntos de fondo se ve como al arrancar (sin texto encima),
  // y frena cualquier parpadeo de cursor que estuviera corriendo.
  clearLcdText(component) {
    if (!component.element) return;

    this.stopLcdBlink(component);

    component._lcdLastRows = null;
    component._lcdLastCursor = null;

    const canvas = component.element.querySelector(
      '[data-lcd-role="screen-canvas"]',
    );
    if (!canvas) return;

    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  }

  // motorState = { state, enabled, in_a, in_b } -- el mismo objeto
  // que devuelve SignalEngine._computeL298nMotorState() para cada
  // puente (Motor A / Motor B).
  //
  // Color + dirección de giro juntos (no solo dirección): un
  // sentido de rotación es difícil de percibir a simple vista en
  // un ícono chico, así que cada sentido tiene su propio color --
  // se nota el estado incluso mirando un frame quieto.
  static MOTOR_FORWARD_COLOR = "#00ff88"; // verde  -- "adelante"
  static MOTOR_REVERSE_COLOR = "#ffaa00"; // ámbar  -- "atrás"
  static MOTOR_IDLE_COLOR = "#ffffff"; // blanco -- detenido (freno o sin girar)

  applyMotorState(component, motorState) {
    if (!component.element) return;

    const indicator = component.element.querySelector(
      '[data-motor-role="spin-indicator"]',
    );
    if (!indicator) return;

    const rotor = indicator.querySelector('[data-motor-role="rotor"]');
    const blades = indicator.querySelectorAll('[data-motor-role="blade"]');
    const hub = indicator.querySelector('[data-motor-role="hub"]');
    const tick = indicator.querySelector('[data-motor-role="tick"]');

    const { state, enabled } = motorState || {};
    const spinning = enabled && (state === "adelante" || state === "atrás");

    let color = Renderer.MOTOR_IDLE_COLOR;
    if (state === "adelante") color = Renderer.MOTOR_FORWARD_COLOR;
    else if (state === "atrás") color = Renderer.MOTOR_REVERSE_COLOR;

    blades.forEach((b) => b.setAttribute("fill", color));
    if (hub) hub.setAttribute("fill", color);
    if (tick) tick.setAttribute("fill", color);

    // El indicador queda visible mientras el puente esté
    // habilitado -- ya sea girando (color) o detenido (blanco) --
    // y solo desaparece del todo si el motor no tiene alimentación.
    indicator.style.opacity = enabled ? "1" : "0";

    if (component._motorAnim) {
      component._motorAnim.cancel();
      component._motorAnim = null;
    }

    if (!spinning || !rotor) return;

    // No tenemos % de PWM real desde el L298N (solo habilitado
    // sí/no por ahora), así que la velocidad de giro es fija.
    // Si más adelante ENA/ENB reportan duty real, este es el
    // lugar para escalar la duración según la velocidad.
    const direction = state === "adelante" ? "normal" : "reverse";

    component._motorAnim = rotor.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration: 700, iterations: Infinity, direction },
    );
  }

  // ─────────────────────────────────────────────────────
  // OLED I2C (SSD1306 128x64)
  //
  // El rectángulo de fondo de la pantalla en el .svg NO trae
  // id (es un <rect fill="#2E2D30" opacity="0.8">), así que lo
  // ubicamos por su color y le superponemos un <canvas> real
  // (vía <foreignObject>) del mismo tamaño y posición. Ese
  // canvas es lo que se pinta cada vez que llega un framebuffer
  // nuevo desde el firmware.
  // ─────────────────────────────────────────────────────

  // Esquemas de color disponibles para la pantalla OLED (elegible
  // desde PropertyPanel -> component.properties.colorScheme).
  // "blue_yellow" imita las pantallas SSD1306 físicas de dos
  // colores reales: una franja amarilla arriba (normalmente las
  // primeras 16 filas) y el resto celeste/azul -- es una división
  // física del panel, no algo que el firmware controle, por eso
  // se resuelve acá según la fila del pixel (splitRow) y no según
  // ningún dato que venga en el framebuffer.
  static OLED_COLOR_SCHEMES = {
    blue: {
      on: [127, 217, 255, 255], // celeste encendido
      off: [0, 8, 20, 255], // fondo apagado
    },

    white: {
      on: [235, 235, 235, 255],
      off: [12, 12, 12, 255],
    },

    yellow: {
      on: [255, 209, 64, 255],
      off: [22, 16, 0, 255],
    },

    blue_yellow: {
      splitRow: 16,
      top: { on: [255, 209, 64, 255], off: [22, 16, 0, 255] },
      bottom: { on: [127, 217, 255, 255], off: [0, 8, 20, 255] },
    },
  };

  static getOledScheme(component) {
    const key = component.properties?.colorScheme || "blue";
    return Renderer.OLED_COLOR_SCHEMES[key] || Renderer.OLED_COLOR_SCHEMES.blue;
  }

  // Colores default (compatibilidad con lo que ya hubiera usado
  // estas constantes directamente en vez de getOledScheme()).
  static OLED_ON_COLOR = Renderer.OLED_COLOR_SCHEMES.blue.on;
  static OLED_OFF_COLOR = Renderer.OLED_COLOR_SCHEMES.blue.off;

  // tagOledElements() migró a components/oled/oled.behavior.js (sin
  // llamadores externos -- clearOledScreen() de abajo sigue viviendo
  // acá, lo llama vía "renderer").

  // Pintar un framebuffer monocromo estilo SSD1306 (formato MONO_VLSB:
  // cada byte = 8 pixeles verticales de una columna, bit 0 = arriba).
  drawOledFramebuffer(component, bytes, width, height) {
    if (!component.element) return;

    const canvas = component.element.querySelector('[data-oled-role="screen"]');
    if (!canvas) return;

    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    // Se cachea para poder redibujar solo por un cambio de contraste
    // (ver setOledContrast) sin esperar al próximo display.show().
    component._oledLastBytes = bytes;
    component._oledLastWidth = width;
    component._oledLastHeight = height;

    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(width, height);
    const pages = Math.ceil(height / 8);

    const scheme = Renderer.getOledScheme(component);

    // Contraste real del SSD1306: 0-255, default 255 (máximo brillo)
    // -- solo escala los píxeles PRENDIDOS, igual que el hardware
    // real (los apagados son negro sin importar el contraste). Se
    // precalculan acá afuera del loop de píxeles (splitRow puede
    // necesitar los dos esquemas, top y bottom).
    const contrastFactor = (component._oledContrast ?? 255) / 255;
    const scaleOn = (on) => [
      Math.round(on[0] * contrastFactor),
      Math.round(on[1] * contrastFactor),
      Math.round(on[2] * contrastFactor),
      on[3],
    ];
    const scaledOn = scheme.splitRow !== undefined
      ? { top: scaleOn(scheme.top.on), bottom: scaleOn(scheme.bottom.on) }
      : scaleOn(scheme.on);

    for (let page = 0; page < pages; page++) {
      for (let x = 0; x < width; x++) {
        const byte = bytes[page * width + x] || 0;

        for (let bit = 0; bit < 8; bit++) {
          const py = page * 8 + bit;
          if (py >= height) continue;

          // blue_yellow tiene colores distintos según la
          // franja física (arriba/abajo); los demás
          // esquemas son un único par on/off para toda
          // la pantalla.
          const isTop = scheme.splitRow !== undefined && py < scheme.splitRow;
          const offColor =
            scheme.splitRow !== undefined
              ? (isTop ? scheme.top.off : scheme.bottom.off)
              : scheme.off;
          const onColor =
            scheme.splitRow !== undefined
              ? (isTop ? scaledOn.top : scaledOn.bottom)
              : scaledOn;

          const on = (byte >> bit) & 1;
          const color = on ? onColor : offColor;
          const idx = (py * width + x) * 4;

          img.data[idx] = color[0];
          img.data[idx + 1] = color[1];
          img.data[idx + 2] = color[2];
          img.data[idx + 3] = color[3];
        }
      }
    }

    ctx.putImageData(img, 0, 0);
  }

  // Llamado desde SignalEngine.applyOledContrast() (protocolo
  // "OLEDC:", ver oled_hal.py / display.contrast(v)). Redibuja al
  // toque con el último framebuffer conocido para que el cambio se
  // note sin esperar el próximo display.show().
  setOledContrast(component, value) {
    if (!component.element) return;

    component._oledContrast = value;

    if (component._oledLastBytes) {
      this.drawOledFramebuffer(
        component,
        component._oledLastBytes,
        component._oledLastWidth,
        component._oledLastHeight,
      );
    }
  }

  // Apagar/limpiar la pantalla (reset de la simulación)
  clearOledScreen(component) {
    if (!component.element) return;

    const canvas = component.element.querySelector('[data-oled-role="screen"]');
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const scheme = Renderer.getOledScheme(component);

    if (scheme.splitRow !== undefined) {
      const toRgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

      ctx.fillStyle = toRgb(scheme.top.off);
      ctx.fillRect(0, 0, canvas.width, scheme.splitRow);

      ctx.fillStyle = toRgb(scheme.bottom.off);
      ctx.fillRect(
        0,
        scheme.splitRow,
        canvas.width,
        canvas.height - scheme.splitRow,
      );
    } else {
      const [r, g, b] = scheme.off;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  // ─────────────────────────────────────────────────────
  // TFT ST7789 SPI (240x240, color real RGB565)
  //
  // El rect de pantalla en el .svg SÍ trae data-role="screen" (a
  // diferencia del OLED, donde hay que ubicarlo por color porque
  // ese .svg es de otro origen) -- más robusto, no depende de que
  // nadie cambie un fill más adelante.
  // ─────────────────────────────────────────────────────

  // tagTftElements() migró a components/tft_st7789/tft_st7789.behavior.js
  // (sin llamadores externos -- clearTftScreen() de abajo sigue
  // viviendo acá, lo llama vía "renderer").

  // Pinta SOLO el rectángulo (x,y,width,height) recibido -- no hace
  // falta mantener acá un framebuffer completo en JS: el <canvas>
  // ya conserva el resto de la pantalla tal cual quedó dibujada, y
  // putImageData en el offset (x,y) sobreescribe nada más que esa
  // región. bytes viene como RGB565 big-endian, 2 bytes por pixel,
  // fila por fila (mismo orden que manda tft_st7789_hal.py).
  drawTftRegion(component, bytes, x, y, width, height) {
    if (!component.element) return;

    const canvas = component.element.querySelector('[data-tft-role="screen"]');
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(width, height);

    for (let i = 0; i < width * height; i++) {
      const hi = bytes[i * 2] || 0;
      const lo = bytes[i * 2 + 1] || 0;
      const value = (hi << 8) | lo;
      const [r, g, b] = Renderer.rgb565to888(value);

      const idx = i * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = 255;
    }

    ctx.putImageData(img, x, y);
  }

  // RGB565 -> RGB888 (5 bits rojo, 6 bits verde, 5 bits azul,
  // reescalados a 0-255 en vez de solo correr los bits, para no
  // perder el brillo máximo -- ej. 0x1F (rojo a full) da 255, no
  // 248). Factorizado para reusar entre drawTftRegion (pixel a
  // pixel) y fillTftRegion (relleno sólido, ver más abajo).
  static rgb565to888(value) {
    const r5 = (value >> 11) & 0x1f;
    const g6 = (value >> 5) & 0x3f;
    const b5 = value & 0x1f;
    return [
      Math.round((r5 * 255) / 31),
      Math.round((g6 * 255) / 63),
      Math.round((b5 * 255) / 31),
    ];
  }

  // Relleno sólido rápido: fill()/fill_rect() de pantalla completa
  // (o de un área grande) llegan por un protocolo compacto propio
  // (ver tft_st7789.hal.py:_send_solid y QemuBridge.js) en vez del
  // hex pixel-por-pixel de drawTftRegion -- un fill(0) de 240x240
  // son 57.600 píxeles idénticos, no hace falta reconstruir un
  // ImageData pixel a pixel cuando un solo ctx.fillRect() pinta lo
  // mismo mucho más rápido.
  fillTftRegion(component, colorValue, x, y, width, height) {
    if (!component.element) return;

    const canvas = component.element.querySelector('[data-tft-role="screen"]');
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const [r, g, b] = Renderer.rgb565to888(colorValue);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, width, height);
  }

  // Apagar/limpiar la pantalla entera (reset de la simulación, o
  // antes del primer dibujo del firmware).
  clearTftScreen(component) {
    if (!component.element) return;

    const canvas = component.element.querySelector('[data-tft-role="screen"]');
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // ─────────────────────────────────────────────────────
  // Matriz de NeoPixel (WS2812) -- tamaño configurable (rows/cols)
  //
  // A diferencia del LCD/OLED, acá NO hay ningún .svg de fondo: el
  // bisel (el "PCB" oscuro) y la grilla de LEDs se dibujan enteros
  // por código, así que cualquier combinación de rows/cols elegida
  // desde el PropertyPanel funciona sin tener que dibujar/exportar
  // un .svg nuevo por cada tamaño posible -- mismo motivo por el
  // que NO reusamos los neopixel5x5.svg/neopixel8x8.svg de
  // referencia (esos vienen con cada LED dibujado a mano de forma
  // "realista", fijo para exactamente 5x5/8x8 -- no escalan).
  //
  // El framebuffer que llega por "NEO:" (ver QemuBridge.parseLine
  // / SignalEngine.applyNeopixelFramebuffer) ya viene en RGB888,
  // fila por fila, en el mismo orden lógico (x,y) en el que el
  // firmware dibujó con NeoMatrix/ezFBfont/ezFBmarquee -- no hace
  // falta reordenar nada acá por "layout" (progressive/zigzag) ni
  // por rotación: esos dos parámetros de np.py son pura lógica de
  // cableado físico de la tira, no cambian la imagen que el
  // usuario ve dibujada en el panel.
  // ─────────────────────────────────────────────────────

  // Wrapper delgado -- lógica real migrada a
  // components/neopixel_matrix/neopixel_matrix.behavior.js. Queda como
  // método real (no se borra) porque tiene llamadores externos
  // directos: PropertyPanel.js (al cambiar rows/cols a mano) y
  // drawNeopixelFrame() de abajo (cuando detecta un cambio de tamaño).
  tagNeopixelElements(component, graphic) {
    ComponentBehaviorRegistry.get(component.type)?.render?.tag?.(component, graphic, this);
  }

  // Pintar un frame completo de la matriz. rgbBytes es un
  // Uint8Array con 3 bytes (R,G,B) por pixel, fila por fila
  // (idéntico orden a framebuf: pixel(x,y) en el índice
  // (y*width+x)*3).
  drawNeopixelFrame(component, rgbBytes, width, height) {
    if (!component.element) return;

    // Si el tamaño no coincide con el que tiene armado ahora
    // mismo (cambiaron Rows/Cols desde el PropertyPanel, o llegó
    // un frame de otro tamaño), rearmamos bisel+canvas primero.
    if (
      component.properties?.cols !== width ||
      component.properties?.rows !== height
    ) {
      const graphic = component.element.querySelector(".component-graphic");
      if (!graphic) return;
      component.properties.cols = width;
      component.properties.rows = height;
      this.tagNeopixelElements(component, graphic);
    }

    const canvas = component.element.querySelector('[data-neo-role="grid"]');
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const CELL_PX = canvas.width / width;
    const shape = component.properties?.shape || "square";
    const gap = CELL_PX * 0.12;
    const size = CELL_PX - gap * 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, canvas.width, canvas.height); // "PCB" visible entre LEDs

    const drawCell = (cx, cy, r, g, b) => {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      if (shape === "circle") {
        ctx.beginPath();
        ctx.arc(cx + CELL_PX / 2, cy + CELL_PX / 2, size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(cx + gap, cy + gap, size, size);
      }
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 3;
        const r = rgbBytes[idx] || 0;
        const g = rgbBytes[idx + 1] || 0;
        const b = rgbBytes[idx + 2] || 0;

        const cx = x * CELL_PX;
        const cy = y * CELL_PX;

        drawCell(cx, cy, r, g, b);

        // Glow solo si el LED está prendido de verdad -- se
        // nota mucho más "NeoPixel real" que un cuadrado
        // plano, mismo truco que Renderer.applyLedColor().
        if (r + g + b > 10) {
          ctx.shadowColor = `rgb(${r},${g},${b})`;
          ctx.shadowBlur = CELL_PX * 0.4;
          drawCell(cx, cy, r, g, b);
          ctx.shadowBlur = 0;
        }
      }
    }
  }

  // Apagar/limpiar la matriz (reset de la simulación, o antes del
  // primer frame)
  clearNeopixelGrid(component) {
    if (!component.element) return;

    const canvas = component.element.querySelector('[data-neo-role="grid"]');
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // ─────────────────────────────────────────────────────
  // Matriz MAX7219 (1 bit por LED, monocromática) -- tamaño
  // encadenable (width x height en píxeles/LEDs)
  //
  // Mismo enfoque que tagNeopixelElements(): el bisel + la grilla
  // de LEDs se dibujan enteros por código, así que cualquier
  // combinación width x height (8x8, 16x8, 32x8, 8x16...) que
  // llegue por "MAX:" (o se configure desde el PropertyPanel)
  // funciona sin depender de un .svg fijo.
  //
  // A diferencia de la matriz de NeoPixel (RGB real por LED), acá
  // cada LED es de UN solo color -- los MAX7219 físicos casi
  // siempre vienen en rojo, así que solo prendemos/apagamos ese
  // único color por celda (properties.color, elegible desde el
  // panel).
  // ─────────────────────────────────────────────────────

  static MAX7219_DEFAULT_COLOR = "#ff2222";

  // Tamaño físico FIJO por LED, en unidades del componente/SVG
  // (mismo valor que CELL_PX de más abajo, adrede -- así el
  // tamaño por defecto 8x8 sigue dando exactamente 176x176, igual
  // que antes de este fix, y ningún proyecto viejo "salta" de
  // tamaño al abrirse).
  //
  // Antes, cambiar cols/rows solo tocaba la resolución interna
  // del <canvas> (CELL_PX) -- el bisel (component.width/height)
  // quedaba fijo, así que más LEDs = más píxeles apretados en el
  // mismo espacio en vez de una matriz físicamente más grande.
  static MAX7219_LED_UNIT_SIZE = 20;

  // Wrapper delgado -- lógica real migrada a
  // components/max7219/max7219.behavior.js. Queda como método real
  // (no se borra) por los mismos motivos que tagNeopixelElements()
  // más arriba: PropertyPanel.js y drawMax7219Framebuffer() de abajo
  // lo llaman directo por nombre.
  tagMax7219Elements(component, graphic) {
    ComponentBehaviorRegistry.get(component.type)?.render?.tag?.(component, graphic, this);
  }

  // Pintar un frame completo. bytes es un Uint8Array de 1 bit por
  // pixel, fila por fila, MSB primero (ver max7219_hal.py) -- width
  // y height acá son cantidad de LEDs (píxeles), no matrices.
  drawMax7219Framebuffer(component, bytes, width, height) {
    if (!component.element) return;

    if (
      component.properties?.cols !== width ||
      component.properties?.rows !== height
    ) {
      const graphic = component.element.querySelector(".component-graphic");
      if (!graphic) return;
      component.properties.cols = width;
      component.properties.rows = height;
      this.tagMax7219Elements(component, graphic);
    }

    const canvas = component.element.querySelector('[data-max-role="grid"]');
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const CELL_PX = canvas.width / width;
    const shape = component.properties?.shape || "circle";
    const color = component.properties?.color || Renderer.MAX7219_DEFAULT_COLOR;
    const [r, g, b] = Renderer._hexToRgb(color);
    const gap = CELL_PX * 0.12;
    const size = CELL_PX - gap * 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const bytesPerRow = Math.ceil(width / 8);

    const drawCell = (cx, cy) => {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      if (shape === "circle") {
        ctx.beginPath();
        ctx.arc(cx + CELL_PX / 2, cy + CELL_PX / 2, size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(cx + gap, cy + gap, size, size);
      }
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byteIndex = y * bytesPerRow + (x >> 3);
        const bitIndex = 7 - (x % 8);
        const on = (bytes[byteIndex] >> bitIndex) & 1;

        if (!on) continue;

        const cx = x * CELL_PX;
        const cy = y * CELL_PX;

        ctx.shadowColor = `rgb(${r},${g},${b})`;
        ctx.shadowBlur = CELL_PX * 0.35;
        drawCell(cx, cy);
        ctx.shadowBlur = 0;
      }
    }
  }

  // Apagar/limpiar la matriz (reset de la simulación, o antes del
  // primer frame)
  clearMax7219Grid(component) {
    if (!component.element) return;

    const canvas = component.element.querySelector('[data-max-role="grid"]');
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Fallback mínimo para convertir "#rrggbb" (o "#rgb") a [r,g,b]
  // 0-255 -- ver uso en drawMax7219Framebuffer().
  static _hexToRgb(hex) {
    const clean = (hex || "#ff2222").replace("#", "");
    const full =
      clean.length === 3
        ? clean
            .split("")
            .map((c) => c + c)
            .join("")
        : clean;
    const bigint = parseInt(full, 16) || 0xff2222;
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
  }

  // ─────────────────────────────────────────────────────
  // Display 7 segmentos
  //
  // El .svg de este componente SÍ trae un path independiente por
  // cada segmento (capa frontal "g16", ids autogenerados por
  // Fritzing) más una capa trasera "fantasma" (g24, opacity 0.29)
  // que queda fija como referencia visual del "8" apagado.
  //
  // Mapeamos cada id original de Fritzing al segmento real que
  // representa, para poder prender/apagar cada uno de verdad
  // (en vez de aproximar con el brillo del glifo completo).
  // ─────────────────────────────────────────────────────

  static DISPLAY7_SEGMENT_MAP = {
    path12: "a", // barra horizontal superior
    path11: "b", // vertical superior derecha
    path13: "c", // vertical inferior derecha
    path14: "d", // barra horizontal inferior
    path15: "e", // vertical inferior izquierda
    path16: "f", // vertical superior izquierda
    polygon12: "g", // barra horizontal central
    circle16: "dp", // punto decimal
  };

  static DISPLAY7_ON_COLOR = "#ff0033";
  static DISPLAY7_OFF_COLOR = "#3a0a10";

  // tagDisplay7Elements() migró a components/display7/display7.behavior.js
  // (sin llamadores externos).

  applyDisplay7State(component, segments, dp) {
    if (!component.element) return;

    const SEGMENT_IDS = ["a", "b", "c", "d", "e", "f", "g"];

    SEGMENT_IDS.forEach((id) => {
      const el = component.element.querySelector(
        `[data-display7-role="${id}"]`,
      );
      if (!el) return;

      const isOn = !!segments[id];

      el.style.fill = isOn
        ? Renderer.DISPLAY7_ON_COLOR
        : Renderer.DISPLAY7_OFF_COLOR;
      el.style.filter = isOn ? "drop-shadow(0 0 3px #ff0033)" : "none";
    });

    const dot = component.element.querySelector('[data-display7-role="dp"]');

    if (dot) {
      dot.style.fill = dp
        ? Renderer.DISPLAY7_ON_COLOR
        : Renderer.DISPLAY7_OFF_COLOR;
      dot.style.filter = dp ? "drop-shadow(0 0 3px #ff0033)" : "none";
    }
  }

  // ─────────────────────────────────────────────────────
  // Semáforo (3 LEDs, R/Y/G con GND común)
  //
  // A diferencia de Display7, acá cada foco tiene su propio color
  // "prendido" (no un único ON_COLOR para los 7 segmentos) -- rojo
  // enciende en rojo brillante, amarillo en amarillo, verde en
  // verde. El color "apagado" es el mismo tono oscuro que ya trae
  // el .svg como fill inicial (ver semaforo.svg), repetido acá
  // para poder volver a ese estado cuando se desconecta un cable.
  // ─────────────────────────────────────────────────────

  static SEMAFORO_COLORS = {
    r: { on: "#ff2020", off: "#3a0a0a", glow: "0 0 5px #ff2020" },
    y: { on: "#ffe600", off: "#3a330a", glow: "0 0 5px #ffe600" },
    g: { on: "#20ff40", off: "#0a3a12", glow: "0 0 5px #20ff40" },
  };

  applySemaforoState(component, lights) {
    if (!component.element) return;

    Object.entries(Renderer.SEMAFORO_COLORS).forEach(([id, colors]) => {
      const el = component.element.querySelector(
        `[data-semaforo-role="${id}"]`,
      );
      if (!el) return;

      const isOn = !!lights[id];

      el.style.fill = isOn ? colors.on : colors.off;
      el.style.filter = isOn ? `drop-shadow(${colors.glow})` : "none";
    });
  }

  // ─────────────────────────────────────────────────────
  // TM1637 (4 dígitos de 7 segmentos + colón ":")
  //
  // Mapa: id ORIGINAL del .svg (antes de tagearlo) -> rol lógico
  // (a-g por cada uno de los 4 dígitos, igual orden que
  // DISPLAY7_SEGMENT_MAP: top, sup-derecha, inf-derecha, bottom,
  // inf-izquierda, sup-izquierda, medio). Se determinó inspeccionando
  // las coordenadas de cada polígono en tm1637.svg -- cada dígito
  // repite el mismo patrón de 7 formas en el mismo orden.
  // ─────────────────────────────────────────────────────

  static TM1637_DIGIT_MAP = [
    {
      a: "polygon22",
      b: "polygon24",
      c: "polygon26",
      d: "polygon28",
      e: "polygon30",
      f: "polygon32",
      g: "polyline34",
    },
    {
      a: "polygon38",
      b: "polygon40",
      c: "polygon42",
      d: "polygon44",
      e: "polygon46",
      f: "polygon48",
      g: "polyline50",
    },
    {
      a: "polygon60",
      b: "polygon62",
      c: "polygon64",
      d: "polygon66",
      e: "polygon68",
      f: "polygon70",
      g: "polyline72",
    },
    {
      a: "polygon76",
      b: "polygon78",
      c: "polygon80",
      d: "polygon82",
      e: "polygon84",
      f: "polygon86",
      g: "polyline88",
    },
  ];

  // Los dos puntos ":" del medio -- físicamente están entre el
  // dígito 1 y el dígito 2 en el .svg, que es justo donde la
  // librería real (mcauser/micropython-tm1637) mete el bit del
  // colón: bit7 del byte de ÍNDICE 1 (ver tm1637_hal.py).
  static TM1637_COLON_IDS = ["circle54", "circle56"];

  // Bit por segmento, misma convención que el chip TM1637 real
  // (y que cualquier librería que lo controle): a=bit0 ... g=bit6.
  static TM1637_SEGMENT_BITS = {
    a: 0x01,
    b: 0x02,
    c: 0x04,
    d: 0x08,
    e: 0x10,
    f: 0x20,
    g: 0x40,
  };

  static TM1637_ON_COLOR = "#ff0033";
  static TM1637_OFF_COLOR = "#3a0a10";

  // tagTm1637Elements() migró a components/tm1637/tm1637.behavior.js
  // (sin llamadores externos).

  // bytes: array de 4 enteros (uno por dígito), tal cual los manda
  // tm1637_hal.py -- ya codificados bit a bit (a=bit0 ... g=bit6),
  // con el bit7 del byte de índice 1 controlando el colón ":".
  applyTm1637Segments(component, bytes) {
    if (!component.element) return;

    const ROLES = ["a", "b", "c", "d", "e", "f", "g"];

    for (let digitIndex = 0; digitIndex < 4; digitIndex++) {
      const byte = bytes[digitIndex] || 0;

      ROLES.forEach((role) => {
        const el = component.element.querySelector(
          `[data-tm1637-digit="${digitIndex}"][data-tm1637-role="${role}"]`,
        );
        if (!el) return;

        const isOn = !!(byte & Renderer.TM1637_SEGMENT_BITS[role]);

        el.style.fill = isOn
          ? Renderer.TM1637_ON_COLOR
          : Renderer.TM1637_OFF_COLOR;
        el.style.filter = isOn ? "drop-shadow(0 0 3px #ff0033)" : "none";
      });
    }

    const colonOn = !!((bytes[1] || 0) & 0x80);

    component.element
      .querySelectorAll('[data-tm1637-role="colon"]')
      .forEach((el) => {
        el.style.fill = colonOn
          ? Renderer.TM1637_ON_COLOR
          : Renderer.TM1637_OFF_COLOR;
        el.style.filter = colonOn ? "drop-shadow(0 0 3px #ff0033)" : "none";
      });
  }

  createPlaceholder(component) {
    const g = document.createElementNS(Utils.SVG_NS, "g");
    g.setAttribute("class", "component-placeholder");

    const rect = document.createElementNS(Utils.SVG_NS, "rect");
    rect.setAttribute("width", component.width);
    rect.setAttribute("height", component.height);
    rect.setAttribute("fill", "#888");
    rect.setAttribute("stroke", "#333");
    rect.setAttribute("rx", 4);

    const label = document.createElementNS(Utils.SVG_NS, "text");
    label.setAttribute("x", component.width / 2);
    label.setAttribute("y", component.height / 2);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("fill", "#fff");
    label.setAttribute("font-size", "12");
    label.textContent = component.name;

    g.appendChild(rect);
    g.appendChild(label);
    return g;
  }

  renderPins(component, group) {
    const size = component.pinSize || 8;
    const hitSize = size * 2.2;

    component.pins.forEach((pin) => {
      const pinGroup = document.createElementNS(Utils.SVG_NS, "g");
      pinGroup.setAttribute("class", `pin pin-${pin.type || "generic"}`);
      pinGroup.setAttribute("data-pin-id", pin.id);
      pinGroup.setAttribute("data-component-id", component.id);

      const hit = this.createPinShape(
        component.pinShape,
        pin.x,
        pin.y,
        hitSize,
      );
      hit.setAttribute("class", "pin-hit");

      const vis = this.createPinShape(component.pinShape, pin.x, pin.y, size);
      vis.setAttribute("class", "pin-visible");

      pinGroup.appendChild(hit);
      pinGroup.appendChild(vis);

      if (pin.name) {
        const title = document.createElementNS(Utils.SVG_NS, "title");
        title.textContent = pin.name;
        pinGroup.appendChild(title);
      }

      group.appendChild(pinGroup);
    });
  }

  createPinShape(shape, x, y, size) {
    if (shape === "square") {
      const rect = document.createElementNS(Utils.SVG_NS, "rect");
      rect.setAttribute("x", x - size / 2);
      rect.setAttribute("y", y - size / 2);
      rect.setAttribute("width", size);
      rect.setAttribute("height", size);
      return rect;
    }
    const circle = document.createElementNS(Utils.SVG_NS, "circle");
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", y);
    circle.setAttribute("r", size / 2);
    return circle;
  }

  tagColorTargets(component, graphic) {
    const targets = component.colorTargets.map((c) => Utils.normalizeHex(c));
    graphic.querySelectorAll("*").forEach((el) => {
      const fill = el.getAttribute("fill");
      const style = el.getAttribute("style");
      let elColor = null;
      if (fill) elColor = Utils.normalizeHex(fill);
      else if (style) {
        const m = style.match(/fill:\s*(#[0-9a-fA-F]{3,6})/i);
        if (m) elColor = Utils.normalizeHex(m[1]);
      }
      if (!elColor) return;
      const index = targets.indexOf(elColor);
      if (index !== -1) el.setAttribute("data-color-role", index);
    });
  }

  recolor(component, newColorHex) {
    if (!component.colorTargets?.length || !component.element) return;
    const graphic = component.element.querySelector(".component-graphic");
    if (!graphic) return;
    const lightVariant = Utils.lightenColor(newColorHex, 0.35);
    graphic.querySelectorAll("[data-color-role]").forEach((el) => {
      const index = parseInt(el.getAttribute("data-color-role"), 10);
      const replacement = index === 0 ? newColorHex : lightVariant;
      if (el.hasAttribute("fill")) {
        el.setAttribute("fill", replacement);
      } else {
        const s = el.getAttribute("style") || "";
        el.setAttribute(
          "style",
          s.replace(/fill:\s*[^;]+/i, `fill:${replacement}`),
        );
      }
    });
  }

  removeComponent(component) {
    if (component.element?.parentNode) {
      component.element.parentNode.removeChild(component.element);
    }
    component.element = null;
  }

  darkenColor(hex, amount) {
    const c = hex.replace("#", "");
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    const d = (ch) => Math.round(ch * (1 - amount));
    const h = (n) => n.toString(16).padStart(2, "0");
    return `#${h(d(r))}${h(d(g))}${h(d(b))}`;
  }

  // ====================================================
  // LEDs integrados en el PCB del ESP32
  // ====================================================

  // Helper: aplica color a un elemento SVG sin importar si usa
  // fill="" o style="fill:..." (ambos casos de Fritzing/Inkscape)
  _setElementColor(el, color, opacity, glowColor) {
    if (!el) return;

    // Manejar fill como atributo directo
    if (el.hasAttribute("fill")) {
      el.setAttribute("fill", color);
    }

    // Manejar fill dentro de style=""
    const style = el.getAttribute("style") || "";
    if (style.includes("fill:")) {
      el.setAttribute(
        "style",
        style.replace(/fill\s*:\s*[^;"]*/gi, `fill:${color}`),
      );
    } else if (!el.hasAttribute("fill")) {
      // No tiene fill ni en atributo ni en style — forzar fill directo
      el.setAttribute("fill", color);
    }

    // Aplicar también a todos los hijos (por si el id está en un <g>)
    el.querySelectorAll("*").forEach((child) => {
      if (child.hasAttribute("fill") && child.getAttribute("fill") !== "none") {
        child.setAttribute("fill", color);
      }
      const cs = child.getAttribute("style") || "";
      if (cs.includes("fill:")) {
        child.setAttribute(
          "style",
          cs.replace(/fill\s*:\s*[^;"]*/gi, `fill:${color}`),
        );
      }
    });

    el.setAttribute("opacity", opacity);
    el.style.filter = glowColor ? `drop-shadow(0 0 5px ${glowColor})` : "none";
  }

  // Encender/apagar el LED GPIO2 integrado del ESP32
  setEsp32GpioLed(component, isOn) {
    if (!component.element) return;

    const el = component.element.querySelector("#led_red_io2");
    if (!el) {
      console.warn("[Renderer] No se encontró #led_red_io2 en el ESP32");
      return;
    }

    this._setElementColor(
      el,
      isOn ? "#ff2222" : "#ffffff",
      isOn ? "1" : "0.5",
      isOn ? "#ff0000" : null,
    );
  }

  // Encender/apagar el LED Power integrado del ESP32
  setEsp32PowerLed(component, isOn) {
    if (!component.element) return;

    const el = component.element.querySelector("#led_power");
    if (!el) {
      console.warn("[Renderer] No se encontró #led_power en el ESP32");
      return;
    }

    this._setElementColor(
      el,
      isOn ? "#2979ff" : "#00001a",
      isOn ? "1" : "0.5",
      isOn ? "#0044ff" : null,
    );
  }

  async loadSVG(path) {
    if (this.svgCache[path] !== undefined) return this.svgCache[path];
    try {
      const response = await fetch(path);
      if (!response.ok) {
        console.warn(`No se pudo cargar el SVG: ${path}`);
        this.svgCache[path] = null;
        return null;
      }
      const text = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, "image/svg+xml");
      const svgEl = doc.querySelector("svg");
      const inner = svgEl ? svgEl.innerHTML : text;

      let viewBox = { x: 0, y: 0, width: 100, height: 100 };
      const vbAttr = svgEl?.getAttribute("viewBox");
      if (vbAttr) {
        const p = vbAttr
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        viewBox = { x: p[0], y: p[1], width: p[2], height: p[3] };
      } else if (svgEl) {
        viewBox = {
          x: 0,
          y: 0,
          width: parseFloat(svgEl.getAttribute("width")) || 100,
          height: parseFloat(svgEl.getAttribute("height")) || 100,
        };
      }

      const result = { inner, viewBox };
      this.svgCache[path] = result;
      return result;
    } catch (err) {
      console.error(`Error cargando SVG (${path}):`, err);
      this.svgCache[path] = null;
      return null;
    }
  }
}