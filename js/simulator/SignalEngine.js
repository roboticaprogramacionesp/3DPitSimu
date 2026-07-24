/*
==========================================================
 PitSimulator — SignalEngine.js  (con soporte KY-001)

 Añadido respecto a la versión anterior:
   - setTemperature(componentId, celsius)
     Guarda la temperatura y se la reenvía al firmware
     como TEMP:<gpio>:<celsius>
   - _notifyTempToFirmware(component, celsius)
     Busca el GPIO conectado al pin "signal" del KY-001
     y envía TEMP:<gpio>:<celsius> al firmware.
==========================================================
*/

class SignalEngine {
  constructor(simulator) {
    this.simulator = simulator;

    // Estado: qué GPIO real declaró el firmware para cada bus/
    // dispositivo I2C-SPI-por-dirección (ver QemuBridge.parseLine,
    // rama "PININFO:") -- key → { nombrePin: gpioNum }. Se usa para
    // exigir que el cable dibujado en el canvas llegue EXACTAMENTE
    // al pin que el código del usuario configuró, no solo "a algo"
    // (ver isWiredToDeclaredPins más abajo).
    this.declaredPins = {};

    // Estado GPIO: "componentId:pinId" → 0 | 1
    this.driverStates = {};

    // Estado I2C: dirección → último byte escrito por el
    // firmware (ver setI2cWrittenByte/evaluateKeypadI2c). A
    // diferencia de driverStates, esto es por DIRECCIÓN I2C, no
    // por componentId:pinId -- el I2C de este proyecto no
    // simula topología de cables, ver keypad4x4_i2c_hal.py.
    this.i2cOutputBytes = {};

    // Estado PWM: "componentId:pinId" (del ESP32) → {freq, duty}
    // -- mismo esquema de clave que driverStates, ver
    // setPwmState/evaluateBuzzer. Se borra la entrada (en vez de
    // guardar freq=0) cuando el PWM se apaga, así
    // isKeyConnectedToHighDriver-style lookups no necesitan
    // distinguir "no hay entrada" de "hay una entrada apagada".
    this.pwmStates = {};

    // Temperatura simulada: "componentId" → celsius
    this.tempStates = {};

    // Humedad simulada: "componentId" → porcentaje (solo DHT11/DHT22)
    this.humidityStates = {};

    // Distancia simulada: "componentId" → cm (solo HC-SR04)
    this.distanceStates = {};

    // Ángulo del servo: "componentId" → grados (0-180, solo SG90)
    this.servoStates = {};

    this.simulator.eventBus.on("wire:added", () => this.evaluateAll());
    this.simulator.eventBus.on("wire:removed", () => this.evaluateAll());
  }

  // ====================================================
  // Log de diagnóstico centralizado -- reemplaza el patrón viejo de
  // "comentar/descomentar console.log a mano" por un solo flag
  // global (ver window.PIT_DEBUG en app.js). Mismo criterio en
  // QemuBridge.js (ver su propio _dbg).
  // ====================================================
  _dbg(...args) {
    if (window.PIT_DEBUG) console.log(...args);
  }

  // ====================================================
  // GPIO — llamado desde QemuBridge
  // ====================================================

  setDriverState(componentId, pinId, value) {
    const key = `${componentId}:${pinId}`;
    this.driverStates[key] = value;

    this._dbg(`[SignalEngine] driver ${key} = ${value}`);

    if (pinId === "io2") {
      const esp32 = this.simulator.componentManager.get(componentId);
      if (esp32) this.simulator.renderer.setEsp32GpioLed(esp32, value === 1);
    }

    this.evaluateAll();
  }

  setPinState(componentId, pinId, value) {
    this.setDriverState(componentId, pinId, value);
  }

  // ====================================================
  // Temperatura — llamado desde PropertyPanel (slider)
  // ====================================================

  setTemperature(componentId, celsius) {
    this.tempStates[componentId] = celsius;

    //console.log(`[SignalEngine] temperatura ${componentId} = ${celsius}°C`);

    // Notificar al firmware via WebSocket
    this._notifyTempToFirmware(componentId, celsius);

    // Actualizar el display visual del componente
    this.simulator.eventBus.emit("temp:changed", { componentId, celsius });
  }

  _notifyTempToFirmware(componentId, celsius) {
    if (!this.simulator.qemuBridge?.connected) return;

    const component = this.simulator.componentManager.get(componentId);
    if (!component) return;

    // Si el sensor no tiene VCC/GND realmente cableados, no debe
    // reportar nada (antes esto se ignoraba por completo).
    if (!this.isComponentPowered(component)) return;

    // Buscar el pin "signal" del sensor
    const signalPin = component.pins.find((p) => p.id === "signal");
    if (!signalPin) return;

    const startKey = `${componentId}:signal`;
    const net = this.getNet(startKey);

    // Buscar el GPIO del ESP32 conectado a ese pin
    const esp32 = this.simulator.componentManager
      .getAll()
      .find((c) => c.type.startsWith("esp32"));
    if (!esp32) return;

    for (const key of net) {
      const [cId, pId] = key.split(":");
      if (cId !== esp32.id) continue;
      const match = pId.match(/^io(\d+)$/);
      if (!match) continue;
      const gpioNumber = parseInt(match[1], 10);
      // Si el componente es DHT11/DHT22, incluir humedad en el mensaje
      const humidity = this.humidityStates[componentId];
      if (humidity !== undefined) {
        //console.log(`[SignalEngine] TEMP → GPIO${gpioNumber} = ${celsius}°C ${humidity}%`,);
        this.simulator.qemuBridge.sendData(
          `TEMP:${gpioNumber}:${celsius}:${humidity}`,
        );
      } else {
        //console.log(`[SignalEngine] TEMP → GPIO${gpioNumber} = ${celsius}`);
        this.simulator.qemuBridge.sendData(`TEMP:${gpioNumber}:${celsius}`);
      }
      return;
    }

    //console.warn("[SignalEngine] Sensor no conectado a ningún GPIO del ESP32");
  }

  // ====================================================
  // Botón momentáneo
  // ====================================================

  setPressed(component, pressed) {
    component.pressed = pressed;

    //console.log(`[SignalEngine] ${component.id} ${pressed ? "presionado" : "soltado"}`,);

    if (component.pressPins) {
      this._notifyButtonToFirmware(component, pressed ? 1 : 0);
    }

    this.evaluateAll();
  }

  _notifyButtonToFirmware(component, value) {
    if (!this.isComponentPowered(component)) return;

    const esp32 = this.simulator.componentManager
      .getAll()
      .find((c) => c.type.startsWith("esp32"));
    if (!esp32) return;

    for (const pinId of component.pressPins) {
      const net = this.getNet(`${component.id}:${pinId}`);

      for (const key of net) {
        const [cId, pId] = key.split(":");
        if (cId !== esp32.id) continue;
        const match = pId.match(/^io(\d+)$/);
        if (!match) continue;
        const gpioNumber = parseInt(match[1], 10);
        //console.log(`[SignalEngine] Botón → GPIO${gpioNumber} = ${value}`);
        if (this.simulator.qemuBridge?.connected) {
          this.simulator.qemuBridge.sendData(`IN:${gpioNumber}:${value}`);
        }
        return;
      }
    }
  }

  // ====================================================
  // Joystick KY-023 (X/Y analógico -- ver joystick_hal.py, que
  // agrega el primer machine.ADC de este proyecto)
  //
  // A diferencia del botón momentáneo (que solo puentea 2 pines
  // y listo), acá hace falta mandar un VALOR CONTINUO a cada eje
  // -- por eso el protocolo es distinto ("ADC:<gpio>:<u16>" en vez
  // de "IN:<gpio>:<0|1>"), aunque la lógica de "encontrar a qué
  // GPIO del ESP32 está cableado el pin" es idéntica a
  // _notifyButtonToFirmware -- se factoriza en _notifyAdcToFirmware
  // para no repetir esa búsqueda dos veces.
  //
  // nx, ny vienen normalizados -1..1 desde Renderer.bindJoystick
  // (arrastre del stick en el canvas) -- acá se convierten a la
  // escala u16 (0..65535, centro=32768) que espera joystick_hal.py.
  // ====================================================

  setJoystickPosition(component, nx, ny) {
    const toU16 = (n) => Math.round(((n + 1) / 2) * 65535);
    const x = toU16(nx);
    const y = toU16(ny);

    component.joystickState = { nx, ny, x, y };

    this._notifyAdcToFirmware(component, "vrx", x);
    this._notifyAdcToFirmware(component, "vry", y);
  }

  // ====================================================
  // Potenciómetro deslizante (pot_slider) -- un solo eje, SIN
  // resorte de centrado (a diferencia del joystick, acá
  // Renderer.bindSlider no llama a esto al soltar el mouse, así
  // que el valor se queda en lo último que se mandó).
  // ====================================================

  setSliderPosition(component, n01) {
    const value = Math.round(Math.max(0, Math.min(1, n01)) * 65535);

    component.sliderState = { n01, value };

    this._notifyAdcToFirmware(component, "out", value);
  }

  _notifyAdcToFirmware(component, pinId, value) {
    if (!this.isComponentPowered(component)) return;

    const esp32 = this.simulator.componentManager
      .getAll()
      .find((c) => c.type.startsWith("esp32"));
    if (!esp32) return;

    const net = this.getNet(`${component.id}:${pinId}`);

    for (const key of net) {
      const [cId, pId] = key.split(":");
      if (cId !== esp32.id) continue;
      const match = pId.match(/^io(\d+)$/);
      if (!match) continue;
      const gpioNumber = parseInt(match[1], 10);
      if (this.simulator.qemuBridge?.connected) {
        this.simulator.qemuBridge.sendData(`ADC:${gpioNumber}:${value}`);
      }
      return;
    }
  }

  // ====================================================
  // Teclado analógico ADKEY (5 botones sobre un único pin ADC)
  //
  // A diferencia del joystick (valor continuo por arrastre), acá
  // cada tecla tiene un nivel FIJO -- así es como funciona el
  // divisor resistivo real: cada botón dejar pasar un voltaje
  // distinto por el mismo pin "OUT". Los valores de abajo están
  // espaciados uniformemente entre 0 y 65535 (6 niveles: reposo +
  // 5 teclas) -- NO están verificados contra el datasheet de
  // ningún módulo real en particular (ver nota en adkey.json). Si
  // tenés los valores reales del tuyo, se ajustan acá nomás.
  //
  // Si se sostienen varias teclas a la vez (algo que en el
  // hardware real da un voltaje indefinido, no necesariamente la
  // suma de ambas), acá se simplifica: manda el nivel de la
  // ÚLTIMA tecla que se apretó y sigue sostenida (ver
  // Renderer.bindAdKey, que mantiene la pila de teclas
  // sostenidas).
  // ====================================================

  static ADKEY_LEVELS = {
    sel: 0,
    right: 13107,
    left: 26214,
    down: 39321,
    up: 52428,
  };

  static ADKEY_IDLE_LEVEL = 65535;

  setAdKeyState(component, pressedKeyId) {
    component.adkeyPressed = pressedKeyId || null;

    const value = pressedKeyId
      ? SignalEngine.ADKEY_LEVELS[pressedKeyId]
      : SignalEngine.ADKEY_IDLE_LEVEL;

    if (value === undefined) return;

    //console.log(`[SignalEngine] ADKEY ${component.id}: tecla=${pressedKeyId || "(ninguna)"} valor=${value}`,);

    this._notifyAdcToFirmware(component, "out", value);
  }

  // ====================================================
  // Getters de compatibilidad
  // ====================================================

  getPinState(componentId, pinId) {
    return this.driverStates[`${componentId}:${pinId}`] || 0;
  }

  getTemperature(componentId) {
    return this.tempStates[componentId] ?? 25.0;
  }

  setHumidity(componentId, humidity) {
    this.humidityStates[componentId] = humidity;
    // Re-enviar TEMP con la nueva humedad (incluye temp actual)
    const celsius = this.tempStates[componentId] ?? 25.0;
    this._notifyTempToFirmware(componentId, celsius);
    this.simulator.eventBus.emit("humidity:changed", { componentId, humidity });
  }

  getHumidity(componentId) {
    return this.humidityStates[componentId] ?? 50.0;
  }

  // ====================================================
  // Distancia — llamado desde PropertyPanel (slider HC-SR04)
  // ====================================================

  setDistance(componentId, cm) {
    this.distanceStates[componentId] = cm;

    //console.log(`[SignalEngine] distancia ${componentId} = ${cm}cm`);

    // Notificar al firmware via WebSocket (pin ECHO)
    this._notifyDistanceToFirmware(componentId, cm);

    // Actualizar el display visual del componente
    this.simulator.eventBus.emit("distance:changed", { componentId, cm });
  }

  getDistance(componentId) {
    return this.distanceStates[componentId] ?? 100.0;
  }

  _notifyDistanceToFirmware(componentId, cm) {
    if (!this.simulator.qemuBridge?.connected) return;

    const component = this.simulator.componentManager.get(componentId);
    if (!component) return;

    // Igual que con el DHT11/DHT22: sin VCC/GND cableados, el
    // sensor no debe reportar distancia.
    if (!this.isComponentPowered(component)) return;

    // El HC-SR04 mide y devuelve la distancia por el pin ECHO
    // (el ESP32 dispara el pulso por TRIG, pero el dato simulado
    // se entrega siempre por el GPIO conectado a ECHO)
    const echoPin = component.pins.find((p) => p.id === "echo");
    if (!echoPin) return;

    const startKey = `${componentId}:echo`;
    const net = this.getNet(startKey);

    const esp32 = this.simulator.componentManager
      .getAll()
      .find((c) => c.type.startsWith("esp32"));
    if (!esp32) return;

    for (const key of net) {
      const [cId, pId] = key.split(":");
      if (cId !== esp32.id) continue;
      const match = pId.match(/^io(\d+)$/);
      if (!match) continue;
      const gpioNumber = parseInt(match[1], 10);
      //console.log(`[SignalEngine] DIST → GPIO${gpioNumber} = ${cm}cm`);
      this.simulator.qemuBridge.sendData(`DIST:${gpioNumber}:${cm}`);
      return;
    }

    //console.warn("[SignalEngine] HC-SR04 no conectado a ningún GPIO del ESP32 (pin echo)",);
  }

  // ====================================================
  // Servo SG90 — llamado desde PropertyPanel (slider 0-180°)
  // ====================================================

  setServoAngle(componentId, angle) {
    this.servoStates[componentId] = angle;

    //console.log(`[SignalEngine] servo ${componentId} = ${angle}° (preview manual)`,);

    const component = this.simulator.componentManager.get(componentId);

    if (component) {
      component.properties = component.properties || {};
      component.properties.angle = angle;
      this.simulator.renderer.setServoAngle(component, angle);
    }

    // NOTA: ya NO se manda SERVO:<gpio>:<angulo> al firmware acá.
    // El SG90 es un actuador -- es el firmware el que decide el
    // ángulo (via machine.PWM, ver sg90_hal.py) y lo avisa hacia
    // afuera con SERVOOUT:<gpio>:<angulo> (ver
    // applyServoAngleFromFirmware más abajo). Este slider ahora
    // es solo una preview visual manual, útil para probar cómo
    // se ve el servo sin necesidad de tener firmware corriendo.

    // Actualizar el display visual del PropertyPanel
    this.simulator.eventBus.emit("servo:changed", { componentId, angle });
  }

  getServoAngle(componentId) {
    return this.servoStates[componentId] ?? 90.0;
  }

  // ====================================================
  // Servo SG90 — llamado desde QemuBridge al recibir
  // "SERVOOUT:<gpio>:<angulo>" (el firmware controla el
  // ángulo real via machine.PWM, ver sg90_hal.py)
  // ====================================================

  applyServoAngleFromFirmware(gpioNumber, angle) {
    const esp32 = this.simulator.componentManager
      .getAll()
      .find((c) => c.type.startsWith("esp32"));
    if (!esp32) return;

    const startKey = `${esp32.id}:io${gpioNumber}`;
    const net = this.getNet(startKey);

    for (const key of net) {
      const [cId, pId] = key.split(":");
      if (pId !== "signal") continue;

      const component = this.simulator.componentManager.get(cId);
      if (!component || component.type !== "sg90") continue;

      // Sin VCC/GND cableados, el servo no debe moverse aunque el
      // firmware siga mandando SERVOOUT por el pin de señal.
      if (!this.isComponentPowered(component)) continue;

      //console.log(`[SignalEngine] SERVOOUT ← GPIO${gpioNumber} = ${angle}° (componente: ${cId})`,);

      this.servoStates[cId] = angle;
      component.properties = component.properties || {};
      component.properties.angle = angle;
      this.simulator.renderer.setServoAngle(component, angle);
      this.simulator.eventBus.emit("servo:changed", {
        componentId: cId,
        angle,
      });
      return;
    }

    //console.warn(`[SignalEngine] SERVOOUT en GPIO${gpioNumber} pero ningún SG90 conectado a ese pin`,);
  }

  // ====================================================
  // OLED I2C — llamado desde QemuBridge al recibir "OLED:"
  // (el firmware manda el framebuffer completo cada vez que
  // el código del usuario llama a display.show())
  // ====================================================

  applyOledFramebuffer(hexString, width = 128, height = 64) {
    // Asumimos un solo OLED en el canvas (misma simplificación
    // que ya se usa para el ESP32: find() en vez de un mapeo
    // explícito por dirección I2C)
    const oled = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "oled");

    if (!oled) {
      //console.warn("[SignalEngine] Llegó un framebuffer OLED pero no hay ningún OLED en el canvas",);
      return;
    }

    // BUGFIX: esta función (y las otras 4 pantallas/matrices I2C-SPI
    // de más abajo) dibujaba el framebuffer que manda el firmware sin
    // importar si el componente tenía VCC/GND realmente cableados en
    // el canvas -- a diferencia de TODOS los demás componentes
    // (sensores, buzzer, servo, keypad I2C), que sí llaman a
    // isComponentPowered() antes de reaccionar. Resultado: se podían
    // sacar los cables de alimentación (o todos los cables) y la
    // pantalla seguía actualizándose como si nada. Si no está
    // alimentada, se apaga (pantalla en negro) y no se procesa el
    // framebuffer entrante.
    if (!this.isFullyConnected(oled, "i2c")) {
      this.simulator.renderer.drawOledFramebuffer(
        oled,
        new Uint8Array(Math.ceil((width * height) / 8)),
        width,
        height,
      );
      return;
    }

    const byteCount = Math.ceil(hexString.length / 2);
    const bytes = new Uint8Array(byteCount);

    for (let i = 0; i < byteCount; i++) {
      bytes[i] = parseInt(hexString.substr(i * 2, 2), 16) || 0;
    }

    this.simulator.renderer.drawOledFramebuffer(oled, bytes, width, height);

    this.simulator.eventBus.emit("oled:updated", {
      componentId: oled.id,
      width,
      height,
    });
  }

  // ====================================================
  // Matriz MAX7219 — llamado desde QemuBridge al recibir "MAX:"
  // (max7219_hal.py manda el framebuffer completo cada vez que
  // el firmware llama a display.show() -- ver max7219_hal.py:
  // 1 bit por pixel, fila por fila, MSB primero, ya desacoplado
  // de MONO_HLSB/MONO_HMSB)
  // ====================================================

  applyMax7219Framebuffer(hexString, width, height) {
    // Misma simplificación que OLED/LCD/NeoPixel: una sola
    // matriz por canvas, sin direccionar por CS real.
    const max7219 = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "max7219");

    if (!max7219) {
      //console.warn("[SignalEngine] Llegó un framebuffer MAX7219 pero no hay ninguna matriz en el canvas",);
      return;
    }

    // Ver el comentario largo en applyOledFramebuffer -- misma falla,
    // mismo criterio de arreglo en las 5 pantallas/matrices.
    if (!this.isComponentPowered(max7219)) {
      const blankBytes = new Uint8Array(Math.ceil((width * height) / 8));
      max7219.lastMax7219Frame = { bytes: blankBytes, width, height };
      this.simulator.renderer.drawMax7219Framebuffer(max7219, blankBytes, width, height);
      return;
    }

    const byteCount = Math.ceil(hexString.length / 2);
    const bytes = new Uint8Array(byteCount);

    for (let i = 0; i < byteCount; i++) {
      bytes[i] = parseInt(hexString.substr(i * 2, 2), 16) || 0;
    }

    // Guardado para poder repintar sin esperar al próximo
    // display.show() -- lo usa PropertyPanel._renderMax7219 cuando
    // el usuario cambia el color de los LEDs a mitad de sesión
    // (mismo mecanismo que ya usa neopixel_matrix).
    max7219.lastMax7219Frame = { bytes, width, height };

    this.simulator.renderer.drawMax7219Framebuffer(
      max7219,
      bytes,
      width,
      height,
    );

    this.simulator.eventBus.emit("max7219:updated", {
      componentId: max7219.id,
      width,
      height,
    });
  }

  // ====================================================
  // TM1637 (4 dígitos, CLK+DIO) — llamado desde QemuBridge al
  // recibir "TM1637:" (lo manda tm1637_hal.py en cada write()/
  // show()/number()/numbers()/temperature()/scroll() -- el HAL NO
  // bit-banguea CLK/DIO de verdad, manda directo los 4 bytes de
  // segmentos ya codificados -- mismo criterio que el I2C dummy de
  // oled_hal.py: no vale la pena simular un protocolo de bus bit a
  // bit acá adentro).
  // ====================================================

  applyTm1637Segments(hexString) {
    // Misma simplificación que OLED/LCD/NeoPixel/MAX7219: un
    // solo TM1637 por canvas, sin direccionar por CLK/DIO reales.
    const tm1637 = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "tm1637");

    if (!tm1637) {
      //console.warn("[SignalEngine] Llegó un frame TM1637 pero no hay ninguno en el canvas",);
      return;
    }

    // Ver el comentario largo en applyOledFramebuffer -- misma falla,
    // mismo criterio de arreglo en las 5 pantallas/matrices.
    if (!this.isFullyConnected(tm1637, "tm1637")) {
      tm1637.lastTm1637Frame = [0, 0, 0, 0];
      this.simulator.renderer.applyTm1637Segments(tm1637, [0, 0, 0, 0]);
      return;
    }

    const byteCount = Math.ceil(hexString.length / 2);
    const bytes = [];

    for (let i = 0; i < byteCount; i++) {
      bytes.push(parseInt(hexString.substr(i * 2, 2), 16) || 0);
    }

    // Siempre 4 dígitos -- si por lo que sea llegara menos (línea
    // cortada, etc.) se completa con "apagado" en vez de dejar
    // huecos que revienten applyTm1637Segments().
    while (bytes.length < 4) bytes.push(0);

    // Guardado para poder repintar sin esperar al próximo write()
    // (mismo mecanismo que ya usa max7219/neopixel_matrix si el
    // día de mañana el PropertyPanel necesita repintar a mitad
    // de sesión, ej. al cambiar algo visual).
    tm1637.lastTm1637Frame = bytes;

    this.simulator.renderer.applyTm1637Segments(tm1637, bytes);

    this.simulator.eventBus.emit("tm1637:updated", { componentId: tm1637.id });
  }

  // ====================================================
  // LCD 16x2 (I2C) — llamado desde QemuBridge al recibir "LCD:"
  // (lcd_16x2_i2c.hal.py manda la grilla de texto completa cada
  // vez que el firmware llama a clear()/putstr()/move_to()/etc.)
  // ====================================================

  applyLcdFramebuffer(rowsHex, cols, rows, backlightOn, cursorState = null) {
    // Misma simplificación que el OLED: un solo LCD por canvas,
    // sin direccionar por dirección I2C real. Buscamos tanto el
    // tipo I2C como el paralelo -- si el día de mañana el
    // paralelo también manda "LCD:", esto ya lo soporta sin
    // tocar nada acá.
    const lcd = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "lcd_16x2_i2c" || c.type === "lcd16x2");

    if (!lcd) {
      //console.warn("[SignalEngine] Llegó texto de LCD pero no hay ningún LCD en el canvas",);
      return;
    }

    // Ver el comentario largo en applyOledFramebuffer -- misma falla,
    // mismo criterio de arreglo en las 5 pantallas/matrices. Este es
    // el caso concreto reportado: se sacaban los cables (VCC/GND/SDA/
    // SCL) y el LCD seguía mostrando lo que mandaba el firmware.
    if (!this.isFullyConnected(lcd, "i2c")) {
      this.simulator.renderer.setLcdBacklight(lcd, false);
      this.simulator.renderer.clearLcdText(lcd);
      return;
    }

    const textRows = rowsHex.map((hex) => {
      let text = "";
      for (let i = 0; i < hex.length; i += 2) {
        const code = parseInt(hex.substr(i, 2), 16);
        text += Number.isNaN(code) ? " " : String.fromCharCode(code);
      }
      return text;
    });

    // Dos cosas DISTINTAS que antes se trataban igual:
    // - backlight: prende/apaga la luz de fondo del panel
    //   ENTERO (rectángulo + grilla de puntos), haya o no texto.
    // - display_on: prende/apaga solo la salida de caracteres
    //   -- el panel sigue tan iluminado como estaba, la DDRAM
    //   sigue teniendo el contenido (por eso el HAL sigue
    //   mandando la grilla completa igual).
    this.simulator.renderer.setLcdBacklight(lcd, backlightOn !== false);

    if (
      backlightOn === false ||
      (cursorState && cursorState.displayOn === false)
    ) {
      this.simulator.renderer.clearLcdText(lcd);
    } else {
      this.simulator.renderer.drawLcdText(lcd, textRows, cursorState);
    }

    this.simulator.eventBus.emit("lcd:updated", {
      componentId: lcd.id,
      cols,
      rows,
    });
  }

  // ====================================================
  // TFT ST7789 SPI (240x240) — llamado desde QemuBridge al recibir
  // "TFT:" (tft_st7789_hal.py manda un rectángulo "sucio" -- x, y,
  // ancho, alto y sus pixels RGB565 -- después de cada primitiva de
  // dibujo, en vez del framebuffer completo como hace el OLED/LCD.
  // Ver el comentario largo en QemuBridge.parseLine para el motivo.)
  // ====================================================

  applyTftRegion(hexString, x, y, width, height) {
    // Misma simplificación que el resto de las pantallas: un solo
    // TFT por canvas, sin direccionar por CS real.
    const tft = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "tft_st7789");

    if (!tft) {
      //console.warn("[SignalEngine] Llegó un rectángulo TFT pero no hay ningún TFT en el canvas",);
      return;
    }

    // Ver el comentario largo en applyOledFramebuffer -- misma falla,
    // mismo criterio de arreglo en las 5 pantallas/matrices. El TFT
    // dibuja de a rectángulos "sucios" (no un framebuffer completo),
    // así que en vez de intentar reconstruir la pantalla completa acá,
    // directamente la apagamos (clearTftScreen) y descartamos el
    // rectángulo entrante hasta que vuelva a estar alimentado.
    if (!this.isFullyConnected(tft, "tft", { sck: "scl", mosi: "sda", rst: "res" })) {
      this.simulator.renderer.clearTftScreen(tft);
      return;
    }

    const byteCount = Math.ceil(hexString.length / 2);
    const bytes = new Uint8Array(byteCount);

    for (let i = 0; i < byteCount; i++) {
      bytes[i] = parseInt(hexString.substr(i * 2, 2), 16) || 0;
    }

    this.simulator.renderer.drawTftRegion(tft, bytes, x, y, width, height);

    this.simulator.eventBus.emit("tft:updated", {
      componentId: tft.id,
      x,
      y,
      width,
      height,
    });
  }

  // ====================================================
  // Matriz de NeoPixel — llamado desde QemuBridge al recibir "NEO:"
  // (neomatrix_hal.py manda el framebuffer completo cada vez que
  // el firmware llama a matrix.show() -- ver np.py: NeoMatrix
  // hereda de framebuf.FrameBuffer, así que cualquier forma de
  // dibujar -- pixel(), text(), ezFBfont.write(), ezFBmarquee,
  // blit(), etc. -- termina en el mismo self.buffer que el hal
  // intercepta en show(), antes de que se remapee a índice físico
  // de tira. No hay que preocuparse por layout/rotation acá: eso
  // solo afecta el cableado real, no la imagen que el usuario ve.)
  // ====================================================

  applyNeopixelFramebuffer(hexString, width, height) {
    // Misma simplificación que OLED/LCD: una sola matriz por
    // canvas, sin direccionar por pin real.
    const neo = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "neopixel_matrix");

    if (!neo) {
      //console.warn("[SignalEngine] Llegó un framebuffer de NeoPixel pero no hay ninguna matriz en el canvas",);
      return;
    }

    // RGB888: 3 bytes por pixel (a diferencia del OLED, que manda
    // 1 bit por pixel empaquetado -- acá cada LED ya viene con su
    // color final, incluida la conversión RGB565->RGB888 y el
    // brightness que haga el hal).
    const byteCount = Math.ceil(hexString.length / 2);
    const bytes = new Uint8Array(byteCount);

    for (let i = 0; i < byteCount; i++) {
      bytes[i] = parseInt(hexString.substr(i * 2, 2), 16) || 0;
    }

    // Guardado para poder repintar sin esperar al próximo
    // matrix.show() -- lo usa PropertyPanel._renderNeopixelMatrix
    // cuando el usuario cambia la forma del LED (cuadrado/círculo)
    // a mitad de sesión.
    neo.lastNeopixelFrame = { rgbBytes: bytes, width, height };

    this.simulator.renderer.drawNeopixelFrame(neo, bytes, width, height);

    this.simulator.eventBus.emit("neopixel:updated", {
      componentId: neo.id,
      width,
      height,
    });
  }

  // ====================================================
  // Evaluar LEDs
  // ====================================================

  evaluateAll() {
    this.simulator.componentManager.getAll().forEach((component) => {

      // Primero consultamos el registro (ver ComponentBehaviorRegistry.js) --
      // si el tipo ya migró ahí, su evaluate() reemplaza TODA la cadena
      // legacy de abajo para ese componente. Si no tiene behavior
      // registrado (la mayoría de los tipos, todavía), seguimos con el
      // if/else de siempre sin ningún cambio de comportamiento.
      const behavior = ComponentBehaviorRegistry.get(component.type);
      if (behavior?.signal?.evaluate) {
        behavior.signal.evaluate(component, this);
        return;
      }

      if (Renderer.isLed(component.type)) {
        this.evaluateLed(component);
      }
      if (component.type === "l298n") {
        this.evaluateL298n(component);
      }
      if (component.type === "display7") {
        this.evaluateDisplay7(component);
      }
      if (component.type === "semaforo") {
        this.evaluateSemaforo(component);
      }
      if (component.type === "keypad4x4_i2c") {
        this.evaluateKeypadI2c(component);
      } else if (Renderer.isKeypadMatrix(component.type)) {
        this.evaluateKeypadMatrix(component);
      }
      if (Renderer.isBuzzer(component.type)) {
        this.evaluateBuzzer(component);
      }
    });
  }

  evaluateLed(component) {
    const anodoHigh = this.isKeyConnectedToHighDriver(`${component.id}:anodo`);
    const catodoGnd = this.isKeyConnectedToGnd(`${component.id}:catodo`);
    const isOn = anodoHigh && catodoGnd;

    //console.log(`[SignalEngine] LED ${component.id}: anodoHigh=${anodoHigh} catodoGnd=${catodoGnd} → ${isOn ? "ON" : "OFF"}`,);

    this.simulator.renderer.applyLedState(component, isOn);
  }

  // ====================================================
  // Evaluar L298N (puente H)
  //
  // Lógica estándar del L298N:
  //   IN1=1, IN2=0 → adelante
  //   IN1=0, IN2=1 → atrás
  //   IN1=IN2      → freno / detenido
  // (igual para IN3/IN4 con el Motor B)
  //
  // ENA/ENB habilitan cada puente. En la placa real, un jumper
  // puesto en el header ENA/ENB ata esa línea directo a 5V (motor
  // siempre habilitado a máxima velocidad). Simulamos ese jumper
  // como una propiedad (properties.jumperEnaInstalled / jumperEnbInstalled,
  // true por defecto); si el jumper NO está instalado, el enable
  // depende de si el pin ENA/ENB está cableado a un driver en HIGH.
  // ====================================================

  evaluateL298n(component) {
    if (!this.isComponentPowered(component)) {
      const off = { state: "deshabilitado", enabled: false, in_a: false, in_b: false };

      const motorAComponent = this._findMotorOnOutputs(component, "out1", "out2");
      if (motorAComponent) this.simulator.renderer.applyMotorState(motorAComponent, off);

      const motorBComponent = this._findMotorOnOutputs(component, "out3", "out4");
      if (motorBComponent) this.simulator.renderer.applyMotorState(motorBComponent, off);

      this.simulator.eventBus.emit("motor:changed", {
        componentId: component.id,
        motorA: off,
        motorB: off,
      });
      return;
    }

    const motorA = this._computeL298nMotorState(
      component,
      "in1",
      "in2",
      "ena",
      "jumperEnaInstalled",
    );
    const motorB = this._computeL298nMotorState(
      component,
      "in3",
      "in4",
      "enb",
      "jumperEnbInstalled",
    );

    //console.log(`[SignalEngine] L298N ${component.id}: Motor A=${motorA.state} (en=${motorA.enabled})  Motor B=${motorB.state} (en=${motorB.enabled})`,);

    // Si hay un motor.svg cableado a las salidas OUT1/OUT2 (o
    // OUT3/OUT4), lo animamos según el estado que acabamos de
    // calcular. NOTA: asumo que el .json del L298N nombra sus
    // pines de salida "out1".."out4" -- si usa otros ids, ajustar acá.
    const motorAComponent = this._findMotorOnOutputs(component, "out1", "out2");
    if (motorAComponent)
      this.simulator.renderer.applyMotorState(motorAComponent, motorA);

    const motorBComponent = this._findMotorOnOutputs(component, "out3", "out4");
    if (motorBComponent)
      this.simulator.renderer.applyMotorState(motorBComponent, motorB);

    this.simulator.eventBus.emit("motor:changed", {
      componentId: component.id,
      motorA,
      motorB,
    });
  }

  // Busca, entre los dos cables que salen de un par OUTx/OUTy del
  // L298N, si alguno llega a un componente de tipo "motor".
  _findMotorOnOutputs(l298nComponent, outPinA, outPinB) {
    for (const outPin of [outPinA, outPinB]) {
      const net = this.getNet(`${l298nComponent.id}:${outPin}`);
      for (const key of net) {
        const [cId] = key.split(":");
        if (cId === l298nComponent.id) continue;
        const other = this.simulator.componentManager.get(cId);
        if (other && other.type === "motor") return other;
      }
    }

    return null;
  }

  // Igual que evaluateL298n() pero sin emitir el evento -- para
  // pintar el estado inicial cuando se abre el PropertyPanel.
  getL298nState(component) {
    return {
      motorA: this._computeL298nMotorState(
        component,
        "in1",
        "in2",
        "ena",
        "jumperEnaInstalled",
      ),
      motorB: this._computeL298nMotorState(
        component,
        "in3",
        "in4",
        "enb",
        "jumperEnbInstalled",
      ),
    };
  }

  _computeL298nMotorState(component, inPinA, inPinB, enPin, jumperProp) {
    const a = this.isKeyConnectedToHighDriver(`${component.id}:${inPinA}`);
    const b = this.isKeyConnectedToHighDriver(`${component.id}:${inPinB}`);

    const jumperInstalled = component.properties?.[jumperProp] !== false;
    const enabled =
      jumperInstalled ||
      this.isKeyConnectedToHighDriver(`${component.id}:${enPin}`);

    let state = "detenido";

    if (enabled) {
      if (a && !b) state = "adelante";
      else if (!a && b) state = "atrás";
      else if (a && b) state = "freno";
      else state = "detenido";
    } else {
      state = "deshabilitado";
    }

    return { state, enabled, in_a: a, in_b: b };
  }

  // ====================================================
  // Evaluar Display 7 segmentos
  //
  // Cátodo común: los pines COM van a GND; cada segmento se
  // enciende cuando su pin está en HIGH.
  // Ánodo común: los pines COM van a un driver en HIGH (VCC);
  // cada segmento se enciende cuando su pin está en LOW/GND.
  //
  // (El SVG de este componente no separa los 7 segmentos como
  // paths individuales, así que el resultado visual es una
  // aproximación por brillo -- ver Renderer.applyDisplay7State.
  // La lógica eléctrica de abajo sí es exacta segmento por segmento.)
  // ====================================================

  evaluateDisplay7(component) {
    const isCathode =
      (component.properties?.commonType || "cathode") === "cathode";

    const commonOk = isCathode
      ? this.isKeyConnectedToGnd(`${component.id}:com1`) ||
        this.isKeyConnectedToGnd(`${component.id}:com2`)
      : this.isKeyConnectedToHighDriver(`${component.id}:com1`) ||
        this.isKeyConnectedToHighDriver(`${component.id}:com2`);

    const segmentIds = ["a", "b", "c", "d", "e", "f", "g"];
    const segments = {};

    segmentIds.forEach((id) => {
      segments[id] =
        commonOk &&
        (isCathode
          ? this.isKeyConnectedToHighDriver(`${component.id}:${id}`)
          : this.isKeyConnectedToGnd(`${component.id}:${id}`));
    });

    const dp =
      commonOk &&
      (isCathode
        ? this.isKeyConnectedToHighDriver(`${component.id}:dp`)
        : this.isKeyConnectedToGnd(`${component.id}:dp`));

    //console.log(`[SignalEngine] Display7 ${component.id}: común=${isCathode ? "cátodo" : "ánodo"} ok=${commonOk} segmentos=${JSON.stringify(segments)} dp=${dp}`,);

    this.simulator.renderer.applyDisplay7State(component, segments, dp);
  }

  // ====================================================
  // Evaluar Semáforo (3 LEDs, cátodo común fijo a GND)
  //
  // Mismo patrón que Display7 (varios LEDs independientes que
  // comparten un pin común), pero simplificado: acá el cátodo
  // común no es configurable (a diferencia del Display7, que
  // puede ser cátodo o ánodo común según properties.commonType)
  // -- el semáforo siempre tiene su pin "gnd" a GND, y cada foco
  // (r/y/g) enciende cuando SU pin está en HIGH y el GND está
  // efectivamente conectado a tierra.
  // ====================================================

  evaluateSemaforo(component) {
    const gndOk =
      this.isComponentPowered(component) &&
      this.isKeyConnectedToGnd(`${component.id}:gnd`);

    const lights = {
      r: gndOk && this.isKeyConnectedToHighDriver(`${component.id}:r`),
      y: gndOk && this.isKeyConnectedToHighDriver(`${component.id}:y`),
      g: gndOk && this.isKeyConnectedToHighDriver(`${component.id}:g`),
    };

    //console.log(`[SignalEngine] Semaforo ${component.id}: gndOk=${gndOk} luces=${JSON.stringify(lights)}`, );

    this.simulator.renderer.applySemaforoState(component, lights);
  }

  // ====================================================
  // Teclado matricial (4x4, 3x4, y cualquier NxM futuro)
  //
  // Distinto de todo lo anterior: acá no hay "estado propio" que
  // evaluar en el sentido de un LED prendido/apagado -- lo que
  // hay que simular es el ESCANEO que hace el propio firmware
  // (keypad4.py, reusable tal cual para 3x4 con otro keymap/
  // row_pins/column_pins/num_cols): en cada get_key(), el firmware
  // pone UNA columna en bajo por vez y lee las filas (que tienen
  // pull-up, o sea que en reposo están en alto). Si la tecla de
  // esa fila/columna está apretada en el simulador, esa fila tiene
  // que leer bajo MIENTRAS esa columna siga en bajo.
  //
  // Por eso evaluateKeypadMatrix se dispara con CUALQUIER cambio
  // de GPIO (ver setDriverState → evaluateAll(), arriba) y no solo
  // cuando se aprieta/suelta una tecla: cada vez que el firmware
  // mueve una columna, hay que recalcular las filas de nuevo con
  // el estado de columnas actualizado.
  //
  // Las filas/columnas NO están hardcodeadas a 4x4 -- se derivan
  // de los propios pines del componente (cualquier pin.id que
  // matchee /^r\d+$/ es fila, /^c\d+$/ es columna), así que
  // agregar un keypad3x4/keypad4x3/etc solo necesita su .json/.svg
  // -- no hace falta tocar este método.
  //
  // LIMITACIÓN CONOCIDA: como el envío de "IN:" hacia el firmware
  // viaja por el mismo canal (WebSocket/serie) que el resto de los
  // mensajes, y get_key() escanea las columnas en un loop MUY
  // ajustado (sin ningún delay entre poner la columna en bajo y
  // leer las filas), es posible que en la práctica haga falta más
  // de un ciclo de escaneo para que una tecla se registre, según
  // cuánta latencia tenga el round-trip. Es la misma limitación de
  // fondo que ya existe para cualquier sensor digital reactivo de
  // este simulador, no algo nuevo de este componente.
  // ====================================================

  // Ordena pines tipo "r3"/"c12" por su número, no alfabéticamente
  // (alfabético pondría "r10" antes que "r2") -- no hace diferencia
  // funcional (el orden de recorrido no afecta el resultado), pero
  // mantiene los logs prolijos y predecibles.
  _sortedKeypadPinIds(component, prefix) {
    return component.pins
      .map((p) => p.id)
      .filter((id) => new RegExp(`^${prefix}\\d+$`).test(id))
      .sort(
        (a, b) =>
          parseInt(a.slice(prefix.length), 10) -
          parseInt(b.slice(prefix.length), 10),
      );
  }

  setKeypadKeyPressed(component, rowIndex, colIndex, pressed) {
    if (!component.keypadPressed) component.keypadPressed = new Set();

    const key = `${rowIndex},${colIndex}`;

    if (pressed) {
      component.keypadPressed.add(key);

      this._dbg(`[signal] setKeypadPressed(${rowIndex},${colIndex}, true) → Set tiene:`, [...component.keypadPressed]);
    } else {
      component.keypadPressed.delete(key);

      this._dbg(`[signal] setKeypadPressed(${rowIndex},${colIndex}, false) → Set tiene:`, [...component.keypadPressed]);
    }

    this.evaluateAll();
  }

  evaluateKeypadMatrix(component) {
    const rows = this._sortedKeypadPinIds(component, "r");

    const cols = this._sortedKeypadPinIds(component, "c");

    const pressed = component.keypadPressed || new Set();

    const colLevel = cols.map((colId) =>
      this._getDrivenLevelOnPin(component, colId),
    );

    // LOG: una vez por escaneo, qué columnas están LOW y qué teclas están presionadas

    this._dbg(`[scan] cols=${JSON.stringify(colLevel)} pressedSet=${JSON.stringify([...pressed])}`);

    rows.forEach((rowId, rowIndex) => {
      let rowValue = 1;

      cols.forEach((colId, colIndex) => {
        if (
          colLevel[colIndex] === 0 &&
          pressed.has(`${rowIndex},${colIndex}`)
        ) {
          rowValue = 0;
        }
      });

      if (rowValue === 0) {
        this._dbg(`[scan] → Fila r${rowIndex} lee 0 (tecla detectada)`);
      }

      this._notifyRowToFirmware(component, rowId, rowValue);
    });
  }

  // Busca si algún pin del ESP32 conectado a este pin (por cable)
  // está manejando un valor AHORA MISMO -- a diferencia de
  // isKeyConnectedToHighDriver (que solo dice sí/no para "alto"),
  // acá hace falta el nivel real (0 o 1) para saber si la columna
  // está activa (bajo) o no.
  _getDrivenLevelOnPin(component, pinId) {
    const net = this.getNet(`${component.id}:${pinId}`);
    for (const key of net) {
      if (Object.prototype.hasOwnProperty.call(this.driverStates, key)) {
        return this.driverStates[key];
      }
    }
    return null;
  }

  // Mismo patrón que _notifyButtonToFirmware/_notifyAdcToFirmware
  // (buscar a qué GPIO del ESP32 está cableado este pin), pero acá
  // el protocolo es "IN:" (digital), no "ADC:" -- las filas del
  // teclado son pines digitales comunes con pull-up, cubiertos
  // enteramente por _base_hal.py, sin ningún HAL nuevo.
  _notifyRowToFirmware(component, pinId, value) {
    if (!this.isComponentPowered(component)) return;

    const esp32 = this.simulator.componentManager
      .getAll()
      .find((c) => c.type.startsWith("esp32"));
    if (!esp32) return;

    const net = this.getNet(`${component.id}:${pinId}`);

    for (const key of net) {
      const [cId, pId] = key.split(":");
      if (cId !== esp32.id) continue;
      const match = pId.match(/^io(\d+)$/);
      if (!match) continue;
      const gpioNumber = parseInt(match[1], 10);
      if (this.simulator.qemuBridge?.connected) {
        this.simulator.qemuBridge.sendData(`IN:${gpioNumber}:${value}`);
      }
      return;
    }
  }

  // ====================================================
  // Teclado matricial 4x4 sobre I2C (keypad4x4_i2c, PCF8574)
  //
  // A diferencia de evaluateKeypadMatrix (GPIO, por cable), acá NO
  // se busca ningún cable ni pin del ESP32 -- el I2C de este
  // proyecto no simula topología de bus, se resuelve por
  // DIRECCIÓN nomás (mismo criterio que el OLED/LCD I2C: mandan
  // su protocolo sin importar si SDA/SCL están dibujados
  // conectados a algo en el canvas). Ver keypad4x4_i2c_hal.py
  // para el protocolo "I2CW:"/"I2CR:".
  //
  // La reutilización de UI es total: bindKeypadMatrix/
  // component.keypadPressed son EXACTAMENTE los mismos que usa la
  // versión GPIO (Renderer.isKeypadMatrix matchea cualquier type
  // que empiece con "keypad", así que esto ya funciona sin tocar
  // Renderer.js). Lo único distinto es CÓMO se traduce
  // "qué tecla está apretada" a algo que el firmware pueda leer.
  // ====================================================

  // rows=[0,1,2,3] / cols=[4,5,6,7]: son los valores por DEFAULT
  // del constructor de Keypad4x4_I2C (keypad4_i2c.py) -- como el
  // mapeo fila/columna → bit del expansor es un parámetro de
  // Python (invisible para el simulador, que no ve el código del
  // firmware), acá se asume la convención por default. Si tu
  // proyecto usa rows=/cols= distintos al construir
  // Keypad4x4_I2C(...), avisá y se ajusta.
  _getKeypadI2cAddress(component) {
    const raw = component.properties?.address;
    if (raw === undefined || raw === null || raw === "") return 0x20;
    const parsed =
      typeof raw === "string"
        ? parseInt(raw, raw.trim().toLowerCase().startsWith("0x") ? 16 : 10)
        : raw;
    return Number.isFinite(parsed) ? parsed : 0x20;
  }

  setI2cWrittenByte(address, value) {
    this.i2cOutputBytes[address] = value & 0xff;
    this.evaluateAll();
  }

  evaluateKeypadI2c(component) {
    const address = this._getKeypadI2cAddress(component);

    if (!this.isFullyConnected(component, "i2c")) return;

    // 0xFF = reposo (nadie escribió nada todavía, todas las
    // filas "altas" -- mismo default que trae readfrom() en
    // keypad4x4_i2c_hal.py).
    const outputByte =
      this.i2cOutputBytes[address] !== undefined
        ? this.i2cOutputBytes[address]
        : 0xff;

    const pressed = component.keypadPressed || new Set();

    // Arranca desde lo que el firmware escribió: los bits de
    // fila SIEMPRE se leen de vuelta tal cual se escribieron
    // (un expansor que maneja un pin en bajo lo lee en bajo,
    // sin importar nada externo). Las columnas (bits 4-7) se
    // bajan SOLO si la fila correspondiente está activa (bit en
    // bajo) Y hay una tecla apretada en esa intersección.
    let readByte = outputByte;

    for (let row = 0; row < 4; row++) {
      const rowIsLow = ((outputByte >> row) & 1) === 0;
      if (!rowIsLow) continue;

      for (let col = 0; col < 4; col++) {
        if (pressed.has(`${row},${col}`)) {
          readByte &= ~(1 << (4 + col));
        }
      }
    }

    readByte &= 0xff;

    if (this.simulator.qemuBridge?.connected) {
      this.simulator.qemuBridge.sendData(`I2CR:${address}:${readByte}`);
    }
  }

  // ====================================================
  // MPU6050 (acelerómetro + giroscopio + temperatura, I2C)
  //
  // Mismo criterio de "resolver por dirección, no por cable" que
  // evaluateKeypadI2c -- pero a diferencia del teclado (que
  // necesita traducir bits de fila/columna), acá el firmware
  // siempre lee TODO el bloque de registros por
  // i2c.readfrom_mem(), así que del lado JS alcanza con mandar los
  // 7 valores en bruto (ver mpu6050_hal.py, que arma los bytes
  // reales con el mapa de registros del datasheet) -- no hay
  // ningún estado intermedio que reconstruir acá como sí pasa con
  // el teclado.
  //
  // Llamado desde PropertyPanel (7 sliders: accelX/Y/Z, gyroX/Y/Z,
  // temperature) -- cada uno pisa SOLO su propio valor en
  // component.properties y manda el estado COMPLETO actualizado
  // (el HAL necesita los 7 juntos para armar el bloque de 14 bytes
  // de una, no puede actualizar de a un eje por vez).
  // ====================================================

  _getMpuAddress(component) {
    const raw = component.properties?.i2cAddress;
    if (raw === undefined || raw === null || raw === "") return 0x68;
    const parsed =
      typeof raw === "string"
        ? parseInt(raw, raw.trim().toLowerCase().startsWith("0x") ? 16 : 10)
        : raw;
    return Number.isFinite(parsed) ? parsed : 0x68;
  }

  setMpuAxis(componentId, key, value) {
    const component = this.simulator.componentManager.get(componentId);
    if (!component) return;

    if (!component.properties) component.properties = {};
    component.properties[key] = value;

    this._notifyMpuToFirmware(component);

    // Igual que "temp:changed" -- por si algo del lado visual
    // quiere reaccionar (ej. un indicador en el canvas), aunque
    // hoy el MPU6050 no dibuja nada dinámico en Renderer.js.
    this.simulator.eventBus.emit("mpu:changed", { componentId, key, value });
  }

  _notifyMpuToFirmware(component) {
    if (!this.simulator.qemuBridge?.connected) return;
    if (!this.isComponentPowered(component)) return;

    // Mismo motivo que el comentario grande de arriba (evaluateAll,
    // OJO I2C sin SDA/SCL): un MPU6050 con el bus mal cableado no
    // tiene que seguir reportando datos como si nada.
    if (!this.isFullyConnected(component, "i2c")) return;

    const address = this._getMpuAddress(component);
    const p = component.properties || {};

    const ax = p.accelX ?? 0;
    const ay = p.accelY ?? 0;
    const az = p.accelZ ?? 1;
    const temp = p.temperature ?? 24;
    const gx = p.gyroX ?? 0;
    const gy = p.gyroY ?? 0;
    const gz = p.gyroZ ?? 0;

    this.simulator.qemuBridge.sendData(
      `MPU:${address}:${ax}:${ay}:${az}:${temp}:${gx}:${gy}:${gz}`,
    );
  }

   // ====================================================
  // Encoder rotativo KY-040 (CLK/DT en cuadratura + SW)
  //
  // A diferencia del joystick/slider (un valor analógico continuo
  // por "ADC:"), acá el pulso es DIGITAL en 2 pines independientes
  // -- mismo protocolo "IN:" que un botón, pero CLK y DT se mandan
  // por separado (no puenteados entre sí como pressPins). Cada
  // "click" del eje (ver Renderer.bindEncoder) es un ciclo COMPLETO
  // de cuadratura: reposo [CLK=1,DT=1] -> 3 fases intermedias ->
  // reposo de nuevo, igual que hace un encoder mecánico real entre
  // un detente y el siguiente.
  //
  // PACING CON DELAYS REALES (_pumpEncoderQueue): _base_hal.py NO
  // tiene ningún handshake para pines de ENTRADA -- "SYNC:" solo
  // confirma escrituras de SALIDA (ver _settle() en _base_hal.py,
  // que dispara desde Pin.on()/off(), no desde value()). Si
  // mandáramos las 3 fases intermedias una atrás de otra en el
  // mismo tick de JS, poll_input() del firmware las drenaría TODAS
  // de un saque -- "última muestra gana" (mismo criterio que
  // joystick_hal.py) se comería las fases intermedias y el
  // firmware nunca vería más que el estado de reposo final. Por
  // eso cada fase se manda con un setTimeout entre medio, no todas
  // juntas.
  //
  // LIMITACIÓN CONOCIDA (heredada de _base_hal.py, no es algo
  // nuevo de acá): todo pin de entrada de este proyecto es de
  // POLLEO -- no hay ninguna interrupción real de hardware detrás
  // de un "IN:". Firmware que use Pin.irq() sobre CLK (muy común en
  // ejemplos "de libro" de KY-040) NO va a disparar. Funciona con
  // el patrón típico de tutorial (leer clk/dt en un while True:).
  // ====================================================

  // direction: +1 (horario) / -1 (antihorario)
  setEncoderStep(component, direction) {
    // Reposo = fase 0 = [CLK,DT] = [1,1]. Gray code de 4 fases,
    // cada una difiere de la anterior/siguiente en un solo bit,
    // como en un encoder de cuadratura real.
    const PHASES = [
      [1, 1],
      [1, 0],
      [0, 0],
      [0, 1],
    ];

    // Recorrido de 4 estados (3 intermedios + reposo final) según
    // el sentido de giro.
    const path =
      direction > 0
        ? [PHASES[1], PHASES[2], PHASES[3], PHASES[0]]
        : [PHASES[3], PHASES[2], PHASES[1], PHASES[0]];

    if (!this._encoderQueues) this._encoderQueues = {};
    if (!this._encoderQueues[component.id]) {
      this._encoderQueues[component.id] = { pending: [], running: false };
    }
    const q = this._encoderQueues[component.id];

    // Si se llaman varios steps muy seguido (arrastre rápido)
    // esto se va acumulando acá y _pumpEncoderQueue los va
    // drenando de a uno -- nunca se pisan entre sí.
    q.pending.push(...path);
    this._pumpEncoderQueue(component, q);
  }

  _pumpEncoderQueue(component, q) {
    if (q.running) return;
    q.running = true;

    const step = () => {
      const next = q.pending.shift();
      if (!next) {
        q.running = false;
        return;
      }
      const [clk, dt] = next;
      this._notifyDigitalToFirmware(component, "clk", clk);
      this._notifyDigitalToFirmware(component, "dt", dt);
      // 4ms entre fases: suficiente para que un while True: normal
      // (sin nada bloqueante pesado adentro) llegue a pollear cada
      // transición por separado, sin frenar demasiado un arrastre
      // rápido en pantalla.
      setTimeout(step, 4);
    };

    step();
  }

  // Igual estructura que _notifyButtonToFirmware/_notifyAdcToFirmware
  // (buscar a qué GPIO del ESP32 está cableado el pin), pero para UN
  // SOLO pin digital independiente por vez -- a diferencia de
  // _notifyButtonToFirmware, que itera pressPins asumiendo que
  // todos deben reflejar el MISMO valor (un puente cerrándose).
  _notifyDigitalToFirmware(component, pinId, value) {
    if (!this.isComponentPowered(component)) return;

    const esp32 = this.simulator.componentManager
      .getAll()
      .find((c) => c.type.startsWith("esp32"));
    if (!esp32) return;

    const net = this.getNet(`${component.id}:${pinId}`);

    for (const key of net) {
      const [cId, pId] = key.split(":");
      if (cId !== esp32.id) continue;
      const match = pId.match(/^io(\d+)$/);
      if (!match) continue;
      const gpioNumber = parseInt(match[1], 10);
      if (this.simulator.qemuBridge?.connected) {
        this.simulator.qemuBridge.sendData(`IN:${gpioNumber}:${value}`);
      }
      return;
    }
  }

  
  // ====================================================
  // Buzzer piezo pasivo (buzzer, KY-006)
  //
  // A diferencia de todo lo anterior, acá el pin es un pin de
  // SALIDA del ESP32 (como cualquier GPIO/LED), solo que en vez de
  // 0/1 lleva una FRECUENCIA -- por eso pwmStates es su propio
  // registro (no reutiliza driverStates, que es estrictamente
  // 0/1). Ver buzzer_hal.py para el protocolo "PWM:".
  // ====================================================

  setPwmState(componentId, pinId, freq, duty) {
    const key = `${componentId}:${pinId}`;

    if (freq > 0) {
      this.pwmStates[key] = { freq, duty };
    } else {
      delete this.pwmStates[key];
    }

    this.evaluateAll();
  }

  evaluateBuzzer(component) {
    const net = this.getNet(`${component.id}:s`);

    let active = null;
    for (const key of net) {
      if (this.pwmStates[key]) {
        active = this.pwmStates[key];
        break;
      }
    }

    // Sin VCC/GND cableados, el buzzer no debe sonar aunque el
    // firmware siga mandando PWM por el pin de señal.
    if (active && !this.isComponentPowered(component)) {
      active = null;
    }

    if (active) {
      this.simulator.renderer.playBuzzerTone(component, active.freq);
    } else {
      this.simulator.renderer.stopBuzzerTone(component);
    }
  }

  isKeyConnectedToHighDriver(startKey) {
    const net = this.getNet(startKey);
    for (const key of net) {
      if (this.driverStates[key] === 1) return true;
    }
    return false;
  }

  isKeyConnectedToGnd(startKey) {
    const net = this.getNet(startKey);
    if (net.length === 1) return false;
    for (const key of net) {
      const [cId, pId] = key.split(":");
      const component = this.simulator.componentManager.get(cId);
      if (!component) continue;
      const pin = component.pins.find((p) => p.id === pId);
      if (pin && (pin.type === "ground" || pin.signal === "ground")) {
        return true;
      }
    }
    return false;
  }

  // ====================================================
  // Igual que isKeyConnectedToGnd pero para VCC/5V/3V3 --
  // reusa la misma convención que ya usa WireManager.classifyPin
  // (pin.type / pin.signal === "power") para no depender de que
  // cada componente nombre su pin de alimentación igual ("vcc",
  // "v+", "5v", etc.)
  // ====================================================

  isKeyConnectedToPower(startKey) {
    const net = this.getNet(startKey);
    if (net.length === 1) return false;
    for (const key of net) {
      const [cId, pId] = key.split(":");
      const component = this.simulator.componentManager.get(cId);
      if (!component) continue;
      const pin = component.pins.find((p) => p.id === pId);
      if (pin && (pin.type === "power" || pin.signal === "power")) {
        return true;
      }
    }
    return false;
  }

  // ====================================================
  // Validación genérica de alimentación de un componente.
  //
  // Antes de esto, cualquier sensor/actuador (DHT11, HC-SR04,
  // SG90, joystick, slider, adkey, buzzer, teclado I2C) mandaba
  // datos al firmware con SOLO que su pin de señal llegara a un
  // GPIO del ESP32 -- vcc y gnd podían estar sueltos y el
  // componente "funcionaba" igual. Acá se exige que, SI el
  // componente define pines de alimentación en su .json (type/
  // signal "power"/"ground"), esos pines estén realmente
  // cableados a algo que los provea.
  //
  // Componentes que no definen ningún pin de power/ground (LEDs
  // sueltos, botones de 2 pines, etc.) no tienen nada que validar
  // acá -- esos ya tienen su propia exigencia de GND en
  // evaluateLed/evaluateSemaforo/etc.
  // ====================================================

  isComponentPowered(component) {
    const pins = component.pins || [];

    const powerPins = pins.filter(
      (p) => p.type === "power" || p.signal === "power",
    );
    const gndPins = pins.filter(
      (p) => p.type === "ground" || p.signal === "ground",
    );

    // BUGFIX / generalización: esta función solo exigía VCC/GND, y
    // eso hacía que un módulo I2C (LCD, OLED, MAX7219, TM1637,
    // teclado I2C) con SDA o SCL sin cablear siguiera "comunicándose"
    // igual, porque el protocolo de este simulador resuelve I2C por
    // DIRECCIÓN y no por topología de cables (ver comentarios en
    // evaluateKeypadI2c / applyLcdFramebuffer). En la vida real, un
    // módulo I2C con SDA o SCL desconectado NO funciona -- así que
    // acá se exige que TODO pin que no sea power/ground (datos,
    // señal, clock, chip-select, reset, etc.) tenga al menos un cable
    // conectado a algo. Esto se generaliza a "cualquier módulo o
    // sensor" de una sola vez porque todos los usos de
    // isComponentPowered() en este archivo son sobre componentes
    // periféricos (nunca sobre el ESP32).
    //
    // Un pin puntual se puede eximir de esta exigencia marcándolo con
    // "optional": true en su definición .json (pensado para pines de
    // expansión que casi nadie cablea) -- hoy ningún componente lo usa.
    const dataPins = pins.filter(
      (p) =>
        p.type !== "power" &&
        p.type !== "ground" &&
        p.signal !== "power" &&
        p.signal !== "ground" &&
        !p.optional,
    );

    if (powerPins.length === 0 && gndPins.length === 0 && dataPins.length === 0) {
      return true;
    }

    const powerOk =
      powerPins.length === 0 ||
      powerPins.some((p) =>
        this.isKeyConnectedToPower(`${component.id}:${p.id}`),
      );

    const gndOk =
      gndPins.length === 0 ||
      gndPins.some((p) => this.isKeyConnectedToGnd(`${component.id}:${p.id}`));

    const dataOk = dataPins.every((p) => {
      // getNet() siempre incluye como mínimo la propia clave de
      // arranque -- si el set tiene más de 1 elemento es porque hay
      // por lo menos un cable real conectado a este pin (sin importar
      // a qué llegue del otro lado; es la misma noción que "hay
      // continuidad" con un tester, no una validación de protocolo).
      const net = this.getNet(`${component.id}:${p.id}`);
      return net.length > 1;
    });

    return powerOk && gndOk && dataOk;
  }

  // ====================================================
  // PININFO -- validar que el CABLE de datos llegue al GPIO exacto
  // que el firmware configuró (no solo "a algo", como isComponentPowered).
  // ====================================================

  // Llamado desde QemuBridge cuando llega "PININFO:<key>:<pines>".
  setDeclaredPins(key, pins) {
    this.declaredPins[key] = pins;
  }

  // Busca el pin del ESP32 correspondiente a un número de GPIO --
  // mismo criterio de búsqueda (id exacto "io<N>", luego nombre
  // "GPIO<N>" con límite de palabra) que ya usa
  // QemuBridge.applyGpioChange, para que un cable dibujado hasta,
  // por ejemplo, el pin "io21" del ESP32 se reconozca como "GPIO21"
  // sin importar por cuál de los dos criterios se lo busque.
  _findEsp32PinByGpio(esp32, gpioNumber) {
    const exactId = `io${gpioNumber}`;
    let pin = esp32.pins.find((p) => p.id === exactId);
    if (!pin) {
      const regex = new RegExp(`\\bgpio${gpioNumber}\\b`);
      pin = esp32.pins.find((p) => p.name && regex.test(p.name.toLowerCase()));
    }
    return pin || null;
  }

  // Comprueba, para un componente y una clave de PININFO ("lcd",
  // "oled", "tft", "tm1637", "keypad_i2c:<addr>", etc.), que cada pin
  // declarado por el firmware (ej. {sda:21, scl:22}) esté REALMENTE
  // cableado en el canvas hasta ese mismo GPIO del ESP32 -- no
  // cualquier cable, el que corresponde según el código del usuario.
  //
  // Devuelve:
  //   true  -> todo lo declarado está bien cableado
  //   false -> hay algo declarado que no coincide con el cableado
  //   null  -> todavía no llegó ningún PININFO para esta key (el
  //            firmware no se actualizó, o esta clave no está
  //            soportada todavía) -- en ese caso el llamador debe
  //            usar isComponentPowered() como respaldo, no bloquear
  //            todo por falta de información.
  //
  // pinMap permite mapear un nombre de PININFO a un id de pin
  // distinto en el .json del componente (ej. si el protocolo dice
  // "sck" pero el pin del componente se llama "scl") -- por default
  // se asume el mismo nombre.
  isWiredToDeclaredPins(component, key, pinMap = {}) {
    const declared = this.declaredPins[key];
    if (!declared) return null;

    const esp32 = this.simulator.componentManager
      .getAll()
      .find((c) => c.type.startsWith("esp32"));
    if (!esp32) return false;

    return Object.entries(declared).every(([protoName, gpioNum]) => {
      const pinId = pinMap[protoName] || protoName;
      const pin = component.pins.find((p) => p.id === pinId);
      if (!pin) return true; // el componente no define ese pin -- nada que validar acá

      const esp32Pin = this._findEsp32PinByGpio(esp32, gpioNum);
      if (!esp32Pin) return false;

      const net = this.getNet(`${component.id}:${pin.id}`);
      return net.includes(`${esp32.id}:${esp32Pin.id}`);
    });
  }

  // Combina isWiredToDeclaredPins() con isComponentPowered() como
  // respaldo: si ya tenemos PININFO para esta key, exige el pin
  // EXACTO; si todavía no llegó ninguno (firmware viejo, o HAL que
  // todavía no manda PININFO), se conforma con "hay algún cable"
  // -- así ningún componente queda roto mientras se termina de
  // migrar cada HAL.
  isFullyConnected(component, key, pinMap = {}) {
    const exact = this.isWiredToDeclaredPins(component, key, pinMap);
    if (exact !== null) return exact && this.isComponentPowered(component);
    return this.isComponentPowered(component);
  }

  // ====================================================
  // Aviso (NO bloqueante) de voltaje incorrecto en un pin de
  // alimentación.
  //
  // A diferencia de isComponentPowered (que solo exige que HAYA
  // algo conectado), esto compara VOLTAJES concretos cuando
  // ambos lados los declaran:
  //   - En el pin del propio componente: pin.voltage (ej. un
  //     sensor que solo tolera 3.3V pone "voltage": 3.3 en su
  //     .json).
  //   - En el pin de la fuente (típicamente el ESP32): también
  //     pin.voltage si está declarado, o si no, se infiere del
  //     id/name (ids como "3v3" -> 3.3V, "5v"/"5v_1"/"5v_2" -> 5V).
  //
  // Si CUALQUIERA de los dos lados no declara un voltaje conocido,
  // no se genera aviso (evita falsos positivos con componentes
  // viejos que todavía no tienen el campo "voltage" en su .json).
  //
  // Devuelve un array de strings (uno por pin en conflicto), para
  // que ValidationEngine los sume a sus "warnings" -- esto NUNCA
  // debe frenar la simulación, es solo informativo.
  // ====================================================

  _inferPinVoltage(pin) {
    if (!pin) return null;

    if (typeof pin.voltage === "number") return pin.voltage;

    const id = (pin.id || "").toLowerCase();
    const name = (pin.name || "").toLowerCase();

    if (/3v3|3\.3\s*v/.test(id) || /3v3|3\.3\s*v/.test(name)) return 3.3;
    if (/\b5v\b|5\.0\s*v/.test(id) || /\b5v\b|5\.0\s*v/.test(name)) return 5;

    return null;
  }

  getVoltageWarnings(component) {
    const warnings = [];

    const powerPins = (component.pins || []).filter(
      (p) => p.type === "power" || p.signal === "power",
    );

    powerPins.forEach((pin) => {
      const required = this._inferPinVoltage(pin);
      if (required == null) return;

      const net = this.getNet(`${component.id}:${pin.id}`);

      for (const key of net) {
        const [cId, pId] = key.split(":");
        if (cId === component.id) continue;

        const otherComponent = this.simulator.componentManager.get(cId);
        if (!otherComponent) continue;

        const otherPin = otherComponent.pins.find((p) => p.id === pId);
        if (!otherPin) continue;
        if (otherPin.type !== "power" && otherPin.signal !== "power") continue;

        const supplied = this._inferPinVoltage(otherPin);
        if (supplied == null) continue;

        if (Math.abs(supplied - required) > 0.2) {
          const compName = component.name || component.type;
          const pinName = pin.name || pin.id;
          const sourceName = otherComponent.name || otherComponent.type;
          warnings.push(
            `${compName} (${pinName}): conectado a ${supplied}V en ${sourceName}, pero espera ${required}V`,
          );
        }
      }
    });

    return warnings;
  }

  // ====================================================
  // BFS — obtener todas las claves conectadas via cables
  // ====================================================

  getNet(startKey) {
    const visited = new Set([startKey]);
    const queue = [startKey];

    while (queue.length > 0) {
      const current = queue.shift();

      this.simulator.wireManager.wires.forEach((wire) => {
        const fromKey = `${wire.from.componentId}:${wire.from.pinId}`;
        const toKey = `${wire.to.componentId}:${wire.to.pinId}`;
        let neighbor = null;
        if (fromKey === current) neighbor = toKey;
        if (toKey === current) neighbor = fromKey;
        if (neighbor && !visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      });

      this.simulator.componentManager.getAll().forEach((component) => {
        if (!component.pressed || !component.pressPins) return;
        const [pinA, pinB] = component.pressPins;
        const keyA = `${component.id}:${pinA}`;
        const keyB = `${component.id}:${pinB}`;
        if (keyA === current && !visited.has(keyB)) {
          visited.add(keyB);
          queue.push(keyB);
        }
        if (keyB === current && !visited.has(keyA)) {
          visited.add(keyA);
          queue.push(keyA);
        }
      });
    }

    return [...visited];
  }

  // ====================================================
  // Compatibilidad
  // ====================================================

  isPinGrounded(componentId, pinId) {
    return this.isKeyConnectedToGnd(`${componentId}:${pinId}`);
  }

  isPinConnected(componentId, pinId) {
    const key = `${componentId}:${pinId}`;
    return this.simulator.wireManager.wires.some(
      (w) =>
        `${w.from.componentId}:${w.from.pinId}` === key ||
        `${w.to.componentId}:${w.to.pinId}` === key,
    );
  }

  // ====================================================
  // Reset
  // ====================================================

  reset() {
    this.driverStates = {};
    this.i2cOutputBytes = {};
    this.pwmStates = {};
    this.simulator.renderer.stopAllBuzzers?.();
    this.evaluateAll();
    const esp32 = this.simulator.componentManager
      .getAll()
      .find((c) => c.type.startsWith("esp32"));
    if (esp32) {
      this.simulator.renderer.setEsp32GpioLed(esp32, false);
      this.simulator.renderer.setEsp32PowerLed(esp32, false);
    }
    const oled = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "oled");
    if (oled) {
      this.simulator.renderer.clearOledScreen(oled);
    }
    const lcd = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "lcd_16x2_i2c" || c.type === "lcd16x2");
    if (lcd) {
      this.simulator.renderer.clearLcdText(lcd);
      // Reponer el panel a "prendido" -- LcdApi.__init__ deja el
      // backlight en True por default, así que un firmware que
      // recién arranca (después de este reset) va a arrancar
      // con el panel iluminado, no oscuro como quedó la corrida
      // anterior si alguien había llamado backlight_off().
      this.simulator.renderer.setLcdBacklight(lcd, true);
    }
    const neo = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "neopixel_matrix");
    if (neo) {
      this.simulator.renderer.clearNeopixelGrid(neo);
    }
    const max7219 = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "max7219");
    if (max7219) {
      this.simulator.renderer.clearMax7219Grid(max7219);
    }
    const tm1637 = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "tm1637");
    if (tm1637) {
      this.simulator.renderer.applyTm1637Segments(tm1637, [0, 0, 0, 0]);
    }
    const tft = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "tft_st7789");
    if (tft) {
      this.simulator.renderer.clearTftScreen(tft);
    }
  }
}
if (typeof module !== "undefined") module.exports = SignalEngine;