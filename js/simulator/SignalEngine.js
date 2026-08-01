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
  // Joystick KY-023 (X/Y analógico -- ver joystick.hal.py, que
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
  // escala u16 (0..65535, centro=32768) que espera joystick.hal.py.
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
  //
  // El módulo real tiene UN solo wiper pero lo saca por 2 pines
  // (out1/out2, ver pot_slider.json) -- son la MISMA señal, así que
  // un solo arrastre manda el mismo valor a ambos, sin importar
  // cuál (o cuáles) esté cableado el usuario.
  // ====================================================

  setSliderPosition(component, n01) {
    const value = Math.round(Math.max(0, Math.min(1, n01)) * 65535);

    component.sliderState = { n01, value };

    this._notifyAdcToFirmware(component, "out1", value);
    this._notifyAdcToFirmware(component, "out2", value);
  }

  // ====================================================
  // Potenciómetro ROTATIVO (pot_rotary) -- mismo criterio que
  // setSliderPosition (un solo eje, SIN resorte de centrado: el
  // valor se queda en lo último que se arrastró), pero acá el
  // arrastre en pot_rotary.behavior.js manda un ÁNGULO ya
  // recortado a la carrera mecánica real (~300°) en vez de una
  // posición lineal -- n01 (0..1) llega ya convertido desde ese
  // ángulo. Un solo pin de salida ("sig"), a diferencia del
  // deslizante que saca el wiper por 2.
  // ====================================================

  setPotRotaryValue(component, n01) {
    const value = Math.round(Math.max(0, Math.min(1, n01)) * 65535);

    component.potRotaryState = { n01, value };

    this._notifyAdcToFirmware(component, "sig", value);
  }

  // ====================================================
  // KY-018 Fotorresistor (LDR) -- mismo patrón que
  // setPotRotaryValue/setSliderPosition (valor continuo por un solo
  // pin "s"), pero acá n01 no viene de un arrastre en el canvas sino
  // del slider "Nivel de luz" del panel de propiedades
  // (ky-018.behavior.js), igual criterio que setBh1750Lux. 0 =
  // oscuridad, 1 = luz intensa (más luz -> más voltaje en "s").
  // ====================================================

  setKy018LightLevel(component, n01) {
    const value = Math.round(Math.max(0, Math.min(1, n01)) * 65535);

    component.ky018State = { n01, value };

    this._notifyAdcToFirmware(component, "s", value);
  }

  // ====================================================
  // Lector RC522 -- REDISEÑADO a pedido (estilo Wokwi): ya no hay
  // un componente "tarjeta" aparte para arrastrar/cablear -- la
  // tarjeta a simular se elige desde el propio panel de propiedades
  // del lector (dropdown con tarjetas preseteadas + botón TAP +
  // switch Hold), igual que en Wokwi. rc522.behavior.js es quien
  // arma ese panel y llama a estos métodos.
  //
  // A diferencia de TODO lo demás en este archivo, acá NO hay pin
  // involucrado en decidir QUÉ tarjeta se "presenta" -- una RFID
  // real se detecta por PROXIMIDAD (acoplamiento inductivo), no por
  // continuidad eléctrica, así que no hay ningún "getNet() del lado
  // de la tarjeta" que recorrer. Sí seguimos exigiendo que el LECTOR
  // esté alimentado (isComponentPowered) antes de mandar nada --
  // un RC522 sin 3.3V/GND no "detecta" nada tampoco en la vida real.
  // ====================================================

  setRc522PresentedCard(component, uidHex) {
    component._rc522PresentedUid = uidHex || null;

    if (!this.isComponentPowered(component)) return;
    if (!this.simulator.qemuBridge?.connected) return;

    this.simulator.qemuBridge.sendData(uidHex ? `RFID:${uidHex}` : `RFID:NONE`);
  }

  // TAP: presenta la tarjeta un instante y la retira sola (mismo
  // concepto que "acercar y sacar" la tarjeta del lector) -- si
  // mientras tanto se pidió otra cosa (otro tap, o Hold), el
  // timeout de ESTE tap no pisa ese estado más nuevo (chequea que
  // siga siendo la MISMA presentación antes de limpiar).
  static RC522_TAP_DURATION_MS = 400;

  tapRc522(component, uidHex) {
    this.setRc522PresentedCard(component, uidHex);
    setTimeout(() => {
      if (component._rc522PresentedUid === uidHex) {
        this.setRc522PresentedCard(component, null);
      }
    }, SignalEngine.RC522_TAP_DURATION_MS);
  }

  // Re-envía al firmware el estado de componentes que solo se
  // notifican en el momento de una interacción puntual (ver nota
  // "resync" en ComponentBehaviorRegistry.js) -- se llama una vez por
  // cada reconexión real a QEMU, DESPUÉS de que el HAL ya esté
  // cargado (si el mensaje llega antes de que el .hal.py del
  // componente registre su propio protocolo, se pierde igual que
  // cualquier otro mensaje sin listener). Sin esto, un RC522 con
  // Hold prendido desde un proyecto recién cargado (o desde antes de
  // un restart de QEMU) queda con la tarjeta "puesta" en la UI pero
  // el firmware nunca se entera.
  resyncAllComponents() {
    this.simulator.componentManager.getAll().forEach((component) => {
      const behavior = ComponentBehaviorRegistry.get(component.type);
      if (behavior?.signal?.resync) {
        behavior.signal.resync(component, this);
      }
    });
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

  // Llamado desde QemuBridge al recibir "OLEDC:" (oled_hal.py cada
  // vez que el firmware llama a display.contrast(v), 0-255). Antes
  // era un no-op total en el HAL -- ahora sí afecta el brillo de los
  // píxeles prendidos en el panel (ver Renderer.setOledContrast).
  applyOledContrast(value) {
    const oled = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "oled");

    if (!oled) return;
    if (!this.isFullyConnected(oled, "i2c")) return;

    const clamped = Math.max(0, Math.min(255, value));
    this.simulator.renderer.setOledContrast(oled, clamped);
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

    // ANTES: backlight y display_on se trataban como conceptos
    // separados a propósito (fiel al HD44780 real -- display_off()
    // solo oculta caracteres, el panel se ve igual de iluminado).
    // Cambiado a pedido: visualmente esto confundía más de lo que
    // ayudaba (el LCD paralelo ni siquiera expone backlight real --
    // ver lcd16x2.hal.py, manda "backlight=1" fijo -- así que
    // display_on era la ÚNICA señal de "prendido/apagado" que el
    // usuario podía controlar, y quedaba invisible). Ahora ambas
    // señales combinadas deciden si el panel se ve "iluminado" -- el
    // contenido (DDRAM) no se pierde igual: el HAL manda la grilla
    // completa en cada _emit() sin importar display_on, así que
    // reactivar el display siempre muestra el texto correcto sin
    // necesidad de un lcd.message() nuevo.
    const displayOn = !cursorState || cursorState.displayOn !== false;
    const effectivelyLit = backlightOn !== false && displayOn;

    this.simulator.renderer.setLcdBacklight(lcd, effectivelyLit);

    if (!effectivelyLit) {
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

  // Busca el único TFT del canvas y valida que esté cableado -- misma
  // lógica de guarda que necesitan tanto applyTftRegion (rectángulo
  // pixel a pixel) como applyTftSolidFill (relleno sólido compacto,
  // ver más abajo), factorizada para no duplicarla entre las dos.
  // Devuelve null si no hay que dibujar nada (sin TFT en el canvas, o
  // ya se apagó la pantalla por desconexión).
  _resolveTftForDraw() {
    const tft = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "tft_st7789");

    if (!tft) {
      //console.warn("[SignalEngine] Llegó un rectángulo TFT pero no hay ningún TFT en el canvas",);
      return null;
    }

    // Ver el comentario largo en applyOledFramebuffer -- misma falla,
    // mismo criterio de arreglo en las 5 pantallas/matrices. El TFT
    // dibuja de a rectángulos "sucios" (no un framebuffer completo),
    // así que en vez de intentar reconstruir la pantalla completa acá,
    // directamente la apagamos (clearTftScreen) y descartamos el
    // rectángulo entrante hasta que vuelva a estar alimentado.
    if (!this.isFullyConnected(tft, "tft", { sck: "scl", mosi: "sda", rst: "res" })) {
      this.simulator.renderer.clearTftScreen(tft);
      return null;
    }

    return tft;
  }

  applyTftRegion(hexString, x, y, width, height) {
    const tft = this._resolveTftForDraw();
    if (!tft) return;

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

  // Relleno sólido -- protocolo compacto "TFT:x:y:WxH:S<hex4>" (ver
  // QemuBridge.js/tft_st7789.hal.py:_send_solid): un fill()/fill_rect()
  // grande (ej. tft.init() limpiando los 240x240 en negro) es UN SOLO
  // color repetido en cada pixel de la región -- mandarlo pixel por
  // pixel como hex (lo que hacía antes _send_solid) son 230KB de texto
  // para una pantalla completa, lentísimo de transmitir/parsear.
  // Acá directamente coloreamos el rectángulo con ctx.fillRect en vez
  // de reconstruir un ImageData de decenas de miles de píxeles.
  applyTftSolidFill(colorValue, x, y, width, height) {
    const tft = this._resolveTftForDraw();
    if (!tft) return;

    this.simulator.renderer.fillTftRegion(tft, colorValue, x, y, width, height);

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
  // Anillo de NeoPixel — llamado desde QemuBridge al recibir "NEOR:"
  // (neopixel_ring.hal.py manda la tira completa cada vez que el
  // firmware llama a NeoPixel.write()). Misma simplificación que la
  // matriz: un solo anillo por canvas, sin direccionar por pin real.
  // ====================================================

  applyNeopixelRingFrame(hexString, n) {
    const ring = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "neopixel_ring");

    if (!ring) return;

    const byteCount = Math.ceil(hexString.length / 2);
    const bytes = new Uint8Array(byteCount);

    for (let i = 0; i < byteCount; i++) {
      bytes[i] = parseInt(hexString.substr(i * 2, 2), 16) || 0;
    }

    ring.lastNeopixelRingFrame = { rgbBytes: bytes, n };

    this.simulator.renderer.drawNeopixelRingFrame(ring, bytes, n);

    this.simulator.eventBus.emit("neopixel_ring:updated", { componentId: ring.id, n });
  }

  // ====================================================
  // Evaluar LEDs
  // ====================================================

  // Todos los tipos que este loop manejaba (led, l298n, display7,
  // semaforo, keypad4x4_i2c, keypad3x4/keypad4x4, buzzer) ya migraron
  // a ComponentBehaviorRegistry (ver ese archivo) -- un tipo NUEVO
  // que quiera "evaluarse" en cada cambio de red solo necesita
  // registrar signal.evaluate en su propio components/<type>/<type>.behavior.js,
  // sin tocar este método.
  evaluateAll() {
    this.simulator.componentManager.getAll().forEach((component) => {
      const behavior = ComponentBehaviorRegistry.get(component.type);
      if (behavior?.signal?.evaluate) {
        behavior.signal.evaluate(component, this);
      }
    });
  }

  // Lógica real migrada a components/led/led.behavior.js (ver
  // ComponentBehaviorRegistry.js) -- este método queda como wrapper
  // delgado porque tiene llamadores externos directos (tests,
  // PropertyPanel en otros tipos con el mismo patrón) que esperan
  // poder invocar evaluateLed(component) por su nombre.
  evaluateLed(component) {
    ComponentBehaviorRegistry.get(component.type)?.signal?.evaluate(component, this);
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

  // Lógica real migrada a components/l298n/l298n.behavior.js -- los
  // helpers privados de abajo (_findMotorOnOutputs,
  // _computeL298nMotorState) y getL298nState() SIGUEN acá porque
  // getL298nState() tiene un llamador externo (PropertyPanel.js).
  // Ver el comentario de evaluateLed() más arriba sobre el wrapper.
  evaluateL298n(component) {
    ComponentBehaviorRegistry.get(component.type)?.signal?.evaluate(component, this);
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

  // Lógica real migrada a components/display7/display7.behavior.js --
  // ver el comentario de evaluateLed() más arriba sobre por qué queda
  // un wrapper delgado acá (PropertyPanel también llama a este método
  // por nombre al tocar el switch cátodo/ánodo común).
  evaluateDisplay7(component) {
    ComponentBehaviorRegistry.get(component.type)?.signal?.evaluate(component, this);
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

  // Lógica real migrada a components/semaforo/semaforo.behavior.js --
  // ver el comentario de evaluateLed() más arriba sobre por qué queda
  // un wrapper delgado acá.
  evaluateSemaforo(component) {
    ComponentBehaviorRegistry.get(component.type)?.signal?.evaluate(component, this);
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

  // Lógica real (+ sus 3 helpers privados de antes) migrada a
  // components/keypad4x4/keypad4x4.behavior.js -- ver el comentario
  // de evaluateLed() más arriba sobre por qué queda un wrapper
  // delgado acá.
  evaluateKeypadMatrix(component) {
    ComponentBehaviorRegistry.get(component.type)?.signal?.evaluate(component, this);
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
  setI2cWrittenByte(address, value) {
    this.i2cOutputBytes[address] = value & 0xff;
    this.evaluateAll();
  }

  // Lógica real (+ su helper privado de antes) migrada a
  // components/keypad4x4_i2c/keypad4x4_i2c.behavior.js -- ver el
  // comentario de evaluateLed() más arriba sobre por qué queda un
  // wrapper delgado acá.
  evaluateKeypadI2c(component) {
    ComponentBehaviorRegistry.get(component.type)?.signal?.evaluate(component, this);
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
  // BH1750 (sensor de luz ambiental, I2C)
  //
  // Mismo criterio que MPU6050 (resolver por dirección I2C, "última
  // muestra gana"), pero con un solo valor (lux) en vez de 7 --
  // ver components/bh1750/bh1750.hal.py para el chip real (comando
  // de modo por writeto() + lectura de 2 bytes crudos por
  // readfrom(), sin mapa de registros).
  // ====================================================

  _getBh1750Address(component) {
    const raw = component.properties?.i2cAddress;
    if (raw === undefined || raw === null || raw === "") return 0x23;
    const parsed =
      typeof raw === "string"
        ? parseInt(raw, raw.trim().toLowerCase().startsWith("0x") ? 16 : 10)
        : raw;
    return Number.isFinite(parsed) ? parsed : 0x23;
  }

  setBh1750Lux(componentId, lux) {
    const component = this.simulator.componentManager.get(componentId);
    if (!component) return;

    if (!component.properties) component.properties = {};
    component.properties.lux = lux;

    this._notifyBh1750ToFirmware(component);

    this.simulator.eventBus.emit("bh1750:changed", { componentId, lux });
  }

  _notifyBh1750ToFirmware(component) {
    if (!this.simulator.qemuBridge?.connected) return;
    if (!this.isComponentPowered(component)) return;
    if (!this.isFullyConnected(component, "i2c")) return;

    const address = this._getBh1750Address(component);
    const lux = component.properties?.lux ?? 200;

    this.simulator.qemuBridge.sendData(`BH1750:${address}:${lux}`);
  }

  // ====================================================
  // TCS34725 (sensor de color RGB + clear, I2C)
  //
  // Dirección FIJA 0x29 (sin pin ADDR, igual criterio que BMP180) --
  // ver components/tcs34725/tcs34725.hal.py para el mapa de
  // registros real. El color se elige en el panel de propiedades
  // (un <input type="color">) en vez de arrastrar/detectar nada en
  // el canvas -- no hay una "tarjeta de color" física que simular.
  //
  // hexToU16Channels(): un hex #RRGGBB (0-255 por canal) se escala a
  // la escala de 16 bits que espera el registro real (multiplicando
  // por 257 = 65535/255, conversión exacta sin redondeo raro en los
  // extremos). El canal "clear" (sin filtrar) no tiene un color
  // real que leer -- se aproxima como el máximo de los 3 canales
  // (misma idea que un sensor real: clear siempre es >= cualquier
  // canal filtrado individual), con un piso para que nunca lea 0
  // absoluto con luz ambiente aunque el color elegido sea negro puro.
  // ====================================================

  _hexToU16Channels(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    const r8 = m ? parseInt(m[1], 16) : 255;
    const g8 = m ? parseInt(m[2], 16) : 128;
    const b8 = m ? parseInt(m[3], 16) : 0;

    const toU16 = (v) => Math.round(v * 257);
    const r = toU16(r8);
    const g = toU16(g8);
    const b = toU16(b8);
    const c = Math.max(r, g, b, toU16(20));

    return { r, g, b, c };
  }

  setTcs34725Color(componentId, hex) {
    const component = this.simulator.componentManager.get(componentId);
    if (!component) return;

    if (!component.properties) component.properties = {};
    component.properties.color = hex;

    this._notifyTcs34725ToFirmware(component);

    this.simulator.eventBus.emit("tcs34725:changed", { componentId, hex });
  }

  _notifyTcs34725ToFirmware(component) {
    if (!this.simulator.qemuBridge?.connected) return;
    if (!this.isComponentPowered(component)) return;
    if (!this.isFullyConnected(component, "i2c")) return;

    const { r, g, b, c } = this._hexToU16Channels(component.properties?.color);
    const address = 0x29;

    this.simulator.qemuBridge.sendData(`TCS:${address}:${r}:${g}:${b}:${c}`);
  }

  // ====================================================
  // DS3231 (RTC de alta precisión, I2C)
  //
  // Dirección FIJA 0x68 (sin pin ADDR) -- ver
  // components/ds3231/ds3231.hal.py para el mapa de registros real.
  // Sigue tickeando SOLO mientras el componente exista en el canvas:
  // ds3231.behavior.js arranca un setInterval de 1s en
  // render.initialState y lo limpia en Renderer.removeComponent
  // (ver ese archivo) -- acá solo se calcula y manda el epoch actual.
  // ====================================================

  setDs3231Offset(componentId, offsetMs) {
    const component = this.simulator.componentManager.get(componentId);
    if (!component) return;

    if (!component.properties) component.properties = {};
    component.properties.rtcOffsetMs = offsetMs;

    this._notifyDs3231ToFirmware(component);
  }

  _notifyDs3231ToFirmware(component) {
    if (!this.simulator.qemuBridge?.connected) return;
    if (!this.isComponentPowered(component)) return;
    if (!this.isFullyConnected(component, "i2c")) return;

    const offsetMs = component.properties?.rtcOffsetMs || 0;
    const epochSeconds = Math.floor((Date.now() + offsetMs) / 1000);

    this.simulator.qemuBridge.sendData(`RTC:104:${epochSeconds}`);
  }

  // ====================================================
  // BMP180 (presión barométrica + temperatura, I2C)
  //
  // Dirección FIJA 0x77 (a diferencia de BH1750/MPU6050, este chip
  // no tiene pin ADDR) -- ver components/bmp180/bmp180.hal.py para
  // el mapa de registros real + cómo se invierten las fórmulas de
  // compensación de Bosch.
  // ====================================================

  setBmp180(componentId, key, value) {
    const component = this.simulator.componentManager.get(componentId);
    if (!component) return;

    if (!component.properties) component.properties = {};
    component.properties[key] = value;

    this._notifyBmp180ToFirmware(component);

    this.simulator.eventBus.emit("bmp180:changed", { componentId, key, value });
  }

  _notifyBmp180ToFirmware(component) {
    if (!this.simulator.qemuBridge?.connected) return;
    if (!this.isComponentPowered(component)) return;
    if (!this.isFullyConnected(component, "i2c")) return;

    const p = component.properties || {};
    const temp = p.temperature ?? 22;
    const pressure = p.pressure ?? 101325;

    this.simulator.qemuBridge.sendData(`BMP180:119:${temp}:${pressure}`);
  }

  // ====================================================
  // BMP280 (presión barométrica + temperatura, I2C)
  //
  // A diferencia del BMP180 (dirección fija 0x77), el BMP280 sí
  // tiene pin SDO que elige 0x76/0x77 -- dirección configurable
  // igual que BH1750/MPU6050. Ver components/bmp280/bmp280.hal.py
  // para el mapa de registros real (distinto del BMP180) + la
  // inversión de la fórmula de compensación de Bosch para este chip.
  // ====================================================

  _getBmp280Address(component) {
    const raw = component.properties?.i2cAddress;
    if (raw === undefined || raw === null || raw === "") return 0x76;
    const parsed =
      typeof raw === "string"
        ? parseInt(raw, raw.trim().toLowerCase().startsWith("0x") ? 16 : 10)
        : raw;
    return Number.isFinite(parsed) ? parsed : 0x76;
  }

  setBmp280(componentId, key, value) {
    const component = this.simulator.componentManager.get(componentId);
    if (!component) return;

    if (!component.properties) component.properties = {};
    component.properties[key] = value;

    this._notifyBmp280ToFirmware(component);

    this.simulator.eventBus.emit("bmp280:changed", { componentId, key, value });
  }

  _notifyBmp280ToFirmware(component) {
    if (!this.simulator.qemuBridge?.connected) return;
    if (!this.isComponentPowered(component)) return;
    if (!this.isFullyConnected(component, "i2c")) return;

    const address = this._getBmp280Address(component);
    const p = component.properties || {};
    const temp = p.temperature ?? 22;
    const pressure = p.pressure ?? 101325;

    this.simulator.qemuBridge.sendData(`BMP280:${address}:${temp}:${pressure}`);
  }

  // ====================================================
  // QMC5883L (magnetómetro/brújula, I2C) -- ver
  // components/qmc5883l/qmc5883l.hal.py para el protocolo real de
  // registro "a mano" que usa este driver (no readfrom_mem/
  // writeto_mem). Dirección FIJA 0x2C (default del driver real del
  // usuario) -- no tiene pin ADDR.
  //
  // El panel de propiedades elige un HEADING (0-360°, "hacia dónde
  // apunta" el sensor) en vez de un valor crudo -- se convierte acá
  // a un vector X/Y sintético (X=M*cos, Y=M*sin, magnitud M=2000
  // arbitraria pero suficiente para que atan2(y,x) del código del
  // usuario recupere el mismo heading), más una Z fija chica
  // (componente vertical típica del campo terrestre).
  // ====================================================

  setQmc5883Heading(componentId, headingDeg) {
    const component = this.simulator.componentManager.get(componentId);
    if (!component) return;

    if (!component.properties) component.properties = {};
    component.properties.heading = headingDeg;

    this._notifyQmc5883ToFirmware(component);

    this.simulator.eventBus.emit("qmc5883l:changed", { componentId, headingDeg });
  }

  _notifyQmc5883ToFirmware(component) {
    if (!this.simulator.qemuBridge?.connected) return;
    if (!this.isComponentPowered(component)) return;
    if (!this.isFullyConnected(component, "i2c")) return;

    const headingDeg = component.properties?.heading ?? 0;
    const rad = (headingDeg * Math.PI) / 180;
    const MAG_MAGNITUDE = 2000;

    const x = Math.round(MAG_MAGNITUDE * Math.cos(rad));
    const y = Math.round(MAG_MAGNITUDE * Math.sin(rad));
    const z = 400;

    const address = 0x2c;

    this.simulator.qemuBridge.sendData(`MAG:${address}:${x}:${y}:${z}`);
  }

  // ====================================================
  // GPS (NMEA por UART) -- primer periférico UART de este proyecto,
  // ver components/_uart_bus/_uart_bus.hal.py para el protocolo
  // completo. A diferencia de I2C (se resuelve por dirección), acá
  // el "id" de UART lo elige el código del usuario (UART(1)/UART(2))
  // -- _findGpsUartId cruza el PININFO que declaró el firmware al
  // construir su UART contra el cable real dibujado desde el pin
  // "tx" del GPS hasta el ESP32, para saber a qué id mandarle las
  // oraciones NMEA.
  //
  // Genera sentencias GPRMC + GGA reales (con checksum NMEA
  // correcto, XOR de todo el cuerpo entre "$" y "*") a partir de las
  // propiedades elegidas en el panel -- ver gps.behavior.js para el
  // ticking de 1s (mismo patrón que ds3231.behavior.js) que llama a
  // esto periódicamente para que la hora/fecha del GPRMC seas la
  // hora real, no solo un valor fijo.
  // ====================================================

  _findGpsUartId(component) {
    const esp32 = this.simulator.componentManager
      .getAll()
      .find((c) => c.type.startsWith("esp32"));
    if (!esp32) return null;

    const net = this.getNet(`${component.id}:tx`);
    let gpioNum = null;
    for (const key of net) {
      const [cId, pId] = key.split(":");
      if (cId !== esp32.id) continue;
      const match = pId.match(/^io(\d+)$/);
      if (match) {
        gpioNum = parseInt(match[1], 10);
        break;
      }
    }
    if (gpioNum === null) return null;

    for (const key of Object.keys(this.declaredPins)) {
      if (!key.startsWith("uart:")) continue;
      const declared = this.declaredPins[key];
      if (declared.rx === gpioNum) {
        return parseInt(key.slice("uart:".length), 10);
      }
    }
    return null;
  }

  _nmeaChecksum(body) {
    let cs = 0;
    for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
    return cs.toString(16).toUpperCase().padStart(2, "0");
  }

  _nmeaLatLon(lat, lon) {
    const latHemi = lat >= 0 ? "N" : "S";
    const lonHemi = lon >= 0 ? "E" : "W";
    const latAbs = Math.abs(lat);
    const lonAbs = Math.abs(lon);
    const latDeg = Math.floor(latAbs);
    const latMin = (latAbs - latDeg) * 60;
    const lonDeg = Math.floor(lonAbs);
    const lonMin = (lonAbs - lonDeg) * 60;

    const pad2 = (n) => String(n).padStart(2, "0");
    const pad3 = (n) => String(n).padStart(3, "0");
    const padMin = (m) => m.toFixed(4).padStart(7, "0");

    return {
      latStr: `${pad2(latDeg)}${padMin(latMin)}`,
      latHemi,
      lonStr: `${pad3(lonDeg)}${padMin(lonMin)}`,
      lonHemi,
    };
  }

  _buildGprmc(component) {
    const p = component.properties || {};
    const now = new Date();
    const time = `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}.00`;
    const date = `${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCFullYear() % 100).padStart(2, "0")}`;

    const { latStr, latHemi, lonStr, lonHemi } = this._nmeaLatLon(p.lat ?? 0, p.lon ?? 0);
    const status = p.fixValid === false ? "V" : "A";
    const speed = (p.speedKnots ?? 0).toFixed(1);
    const course = (p.course ?? 0).toFixed(1);

    const body = `GPRMC,${time},${status},${latStr},${latHemi},${lonStr},${lonHemi},${speed},${course},${date},,,A`;
    return `$${body}*${this._nmeaChecksum(body)}`;
  }

  _buildGpgga(component) {
    const p = component.properties || {};
    const now = new Date();
    const time = `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}.00`;

    const { latStr, latHemi, lonStr, lonHemi } = this._nmeaLatLon(p.lat ?? 0, p.lon ?? 0);
    const fixQuality = p.fixValid === false ? 0 : 1;
    const satellites = p.satellites ?? 8;
    const altitude = (p.altitude ?? 10).toFixed(1);

    const body = `GPGGA,${time},${latStr},${latHemi},${lonStr},${lonHemi},${fixQuality},${satellites},1.0,${altitude},M,0.0,M,,`;
    return `$${body}*${this._nmeaChecksum(body)}`;
  }

  setGpsData(componentId, data) {
    const component = this.simulator.componentManager.get(componentId);
    if (!component) return;

    if (!component.properties) component.properties = {};
    Object.assign(component.properties, data);

    this._notifyGpsToFirmware(component);

    this.simulator.eventBus.emit("gps:changed", { componentId });
  }

  _notifyGpsToFirmware(component) {
    if (!this.simulator.qemuBridge?.connected) return;
    if (!this.isComponentPowered(component)) return;

    const uartId = this._findGpsUartId(component);
    if (uartId === null) return; // el firmware todavía no construyó su UART

    this.simulator.qemuBridge.sendData(`UART:${uartId}:${this._buildGprmc(component)}`);
    this.simulator.qemuBridge.sendData(`UART:${uartId}:${this._buildGpgga(component)}`);
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
  // joystick.hal.py) se comería las fases intermedias y el
  // firmware nunca vería más que el estado de reposo final. Por
  // eso cada fase se manda con un setTimeout entre medio, no todas
  // juntas.
  //
  // ACTUALIZACIÓN: la nota vieja de acá decía que Pin.irq() sobre CLK
  // (el patrón que usa rotary_irq_esp.py, la librería real más común
  // para KY-040) NO iba a disparar nunca, por ser todo polleo sin
  // interrupción de hardware real. Eso quedó desactualizado -- _base.hal.py
  // arma un machine.Timer de fondo (10ms) que llama a poll_input()
  // aunque el firmware nunca llame sleep()/value(), así que Pin.irq()
  // SÍ dispara solo, de forma asincrónica. Confirmado offline: el
  // handler se dispara correctamente en transiciones sucesivas (no en
  // la primera lectura de un pin recién creado -- hace falta un valor
  // anterior para detectar flanco, ver _maybe_fire_irq en _base.hal.py).
  //
  // Lo que SÍ era un bug real (reportado: "al hacer clic las flechas
  // no se actualiza el valor" con rotary_irq_esp.py): el orden CLK
  // antes que DT en el step() de abajo. Esa librería dispara su IRQ
  // sobre CLK y lee dt.value() de forma síncrona ADENTRO del handler
  // -- si la línea de CLK se procesa antes que la de DT, el handler ve
  // un DT todavía viejo y la tabla de estados de cuadratura descarta
  // la transición por "inválida" (silencioso, sin excepción). Ver el
  // fix (DT antes que CLK) en step() más abajo.
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
    // el sentido de giro. Antes empezaba directo en la fase 1/3 --
    // FIX real (confirmado con el código fuente de verdad de
    // rotary_irq_esp.py/rotary.py, que el usuario pasó): esa
    // librería registra Pin.irq() en AMBOS pines (CLK y DT, no solo
    // CLK) y arma su propia máquina de estados por Gray code
    // re-leyendo los dos pines en cada flanco. El problema: la
    // PRIMERA vez que se gira el encoder, ni CLK ni DT tuvieron
    // NUNCA un "IN:" antes -- _maybe_fire_irq() de _base.hal.py
    // exige un valor anterior para detectar un flanco (si no, no hay
    // "flanco" que detectar), así que ese primer mensaje de cada pin
    // actualiza _pin_input_states pero NUNCA dispara el IRQ. Eso
    // significa que el primer giro entero se pierde en silencio --
    // la máquina de estados de la librería ni se entera de que pasó.
    // Confirmado a mano contra la tabla _transition_table real: sin
    // este fix, el primer clic nunca completa un ciclo válido.
    //
    // Fix: mandar la fase de REPOSO [1,1] explícita ANTES de arrancar
    // -- para el primer giro de la vida del encoder, esto establece
    // la línea base que le faltaba a _maybe_fire_irq(); para
    // cualquier giro posterior es un reenvío inofensivo del mismo
    // valor ya vigente (no dispara nada, _maybe_fire_irq ve
    // old==new).
    const path =
      direction > 0
        ? [PHASES[0], PHASES[1], PHASES[2], PHASES[3], PHASES[0]]
        : [PHASES[0], PHASES[3], PHASES[2], PHASES[1], PHASES[0]];

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
      // FIX real (a pedido: "en el encoder al hacer clic las flechas
      // no se actualiza el valor" -- confirmado con rotary_irq_esp.py,
      // que SÍ depende de Pin.irq() sobre CLK, no del patrón de
      // polling en while True:): antes se mandaba CLK primero y DT
      // después. rotary_irq_esp registra su handler de IRQ sobre CLK
      // y, DENTRO de ese handler, lee dt.value() de forma síncrona
      // para decidir el sentido de giro (el clásico algoritmo de
      // tabla de estados de cuadratura). Si la línea "IN:18:..." (CLK)
      // se procesa ANTES que "IN:19:..." (DT) -- que es lo que pasaba,
      // mandando CLK primero -- el handler de CLK se dispara con el DT
      // TODAVÍA viejo en _pin_input_states (esa línea ni llegó a
      // poll_input() todavía), así que lee la combinación
      // CLK/DT incorrecta para esa fase. La mayoría de estas
      // implementaciones descartan silenciosamente cualquier
      // combinación que no matchee una transición válida de Gray code
      // -- por eso el conteo se quedaba pegado en 0 pase lo que pase.
      // Mandando DT primero, para cuando la línea de CLK se procesa y
      // dispara el IRQ, DT ya está actualizado en _pin_input_states.
      this._notifyDigitalToFirmware(component, "dt", dt);
      this._notifyDigitalToFirmware(component, "clk", clk);
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
  // FC-51 (sensor infrarrojo de obstáculos, salida digital)
  //
  // Sin protocolo propio -- reusa _notifyDigitalToFirmware() (el
  // mismo helper genérico que ya usa el encoder KY-040 para CLK/DT),
  // mandando el pin "out" directo. Activo en BAJO (0 = objeto
  // detectado, 1 = sin obstáculo), igual que el módulo real.
  // ====================================================

  setFc51Detected(componentId, detected) {
    const component = this.simulator.componentManager.get(componentId);
    if (!component) return;

    if (!component.properties) component.properties = {};
    component.properties.detectado = detected;

    this._notifyDigitalToFirmware(component, "out", detected ? 0 : 1);

    this.simulator.eventBus.emit("fc51:changed", { componentId, detected });
  }

  // ====================================================
  // TCRT5000 (sensor infrarrojo de línea/obstáculo) -- mismo
  // criterio y protocolo que setFc51Detected, solo cambia el nombre
  // del pin ("do" en vez de "out", ver tcrt5000.json).
  // ====================================================

  setTcrt5000Detected(componentId, detected) {
    const component = this.simulator.componentManager.get(componentId);
    if (!component) return;

    if (!component.properties) component.properties = {};
    component.properties.detectado = detected;

    this._notifyDigitalToFirmware(component, "do", detected ? 0 : 1);

    this.simulator.eventBus.emit("tcrt5000:changed", { componentId, detected });
  }

  // ====================================================
  // PIR HC-SR501 (sensor de movimiento) -- a diferencia de FC-51/
  // TCRT5000 (activos en BAJO), el HC-SR501 real es activo en ALTO:
  // OUT=1 mientras detecta movimiento, OUT=0 en reposo.
  // ====================================================

  setPirDetected(componentId, detected) {
    const component = this.simulator.componentManager.get(componentId);
    if (!component) return;

    if (!component.properties) component.properties = {};
    component.properties.detectado = detected;

    this._notifyDigitalToFirmware(component, "out", detected ? 1 : 0);

    this.simulator.eventBus.emit("pir:changed", { componentId, detected });
  }

  // ====================================================
  // Buzzer piezo pasivo (buzzer, KY-006)
  //
  // A diferencia de todo lo anterior, acá el pin es un pin de
  // SALIDA del ESP32 (como cualquier GPIO/LED), solo que en vez de
  // 0/1 lleva una FRECUENCIA -- por eso pwmStates es su propio
  // registro (no reutiliza driverStates, que es estrictamente
  // 0/1). Ver buzzer.hal.py para el protocolo "PWM:".
  // ====================================================

  setPwmState(componentId, pinId, freq, duty) {
    const key = `${componentId}:${pinId}`;

    if (freq > 0) {
      this.pwmStates[key] = { freq, duty };
    } else {
      delete this.pwmStates[key];
    }

    // Mismo hook que ya tiene setDriverState() para el LED GPIO2
    // integrado de la placa -- SIN esto, ese LED solo reaccionaba a
    // GPIO:2:0/1 (digital), nunca a PWM:2:..., así que quedaba fijo
    // pase lo que pase con el duty (reportado por el usuario: "el led
    // externo sí cambia de brillo, el interno no").
    if (pinId === "io2") {
      const esp32 = this.simulator.componentManager.get(componentId);
      if (esp32) {
        const brightness = freq > 0 ? Math.max(0, Math.min(1, duty / 1023)) : 0;
        this.simulator.renderer.setEsp32GpioLedBrightness(esp32, brightness);
      }
    }

    this.evaluateAll();
  }

  // Lógica real migrada a components/buzzer/buzzer.behavior.js -- ver
  // el comentario de evaluateLed() más arriba sobre por qué queda un
  // wrapper delgado acá en vez de borrarse del todo.
  evaluateBuzzer(component) {
    ComponentBehaviorRegistry.get(component.type)?.signal?.evaluate(component, this);
  }

  isKeyConnectedToHighDriver(startKey) {
    const net = this.getNet(startKey);
    for (const key of net) {
      if (this.driverStates[key] === 1) return true;
    }
    return false;
  }

  // Mismo criterio que isKeyConnectedToHighDriver, pero para PWM: un
  // pin manejado con machine.PWM (ver setPwmState/_base.hal.py) nunca
  // pasa por driverStates (no es un 0/1 digital), así que un LED
  // cableado a un pin en PWM se veía SIEMPRE apagado -- isOn dependía
  // solo de driverStates. Devuelve {freq, duty} del primer pin de la
  // red con un PWM activo (freq > 0), o null si ninguno.
  getPwmDutyForKey(startKey) {
    const net = this.getNet(startKey);
    for (const key of net) {
      const pwm = this.pwmStates[key];
      if (pwm && pwm.freq > 0) return pwm;
    }
    return null;
  }

  // Un componente cuenta como FUENTE real de tierra/alimentación (no
  // solo "otro periférico que también tiene un pin ground/power") si
  // declara properties.isPowerSource=true en su .json -- hoy son el
  // ESP32 (esp32_wroom.json) y la batería (battery_18650.json).
  // Cualquier componente NUEVO que provea alimentación (otro pack de
  // pilas, una fuente externa, etc.) solo necesita sumar ese flag,
  // sin tocar nada acá.
  //
  // BUG REAL (reportado: LCD/OLED "sin alimentación" en un proyecto
  // GUARDADO antes de que este flag existiera): un ESP32 restaurado
  // desde un archivo viejo trae SUS PROPIAS properties congeladas al
  // momento de guardar, sin el "isPowerSource" que se agregó acá
  // después -- deserialize() nunca mezcla defaults nuevos del .json
  // actual sobre un save viejo. Resultado: CUALQUIER proyecto
  // guardado antes de este audit quedaba con TODOS sus periféricos
  // reportando "no alimentado", sin importar que el cableado fuera
  // perfecto. El ESP32 es la placa central -- no es opcional/
  // enchufable como una batería, así que cuenta como fuente real
  // por TIPO, sin depender de que esa propiedad haya sobrevivido la
  // ida y vuelta de guardado/carga. El flag explícito sigue siendo
  // la vía para fuentes NUEVAS (baterías, fuentes externas, etc.).
  _isPowerSourceComponent(component) {
    if (!component) return false;
    if (component.type?.startsWith("esp32")) return true;
    return !!component.properties?.isPowerSource;
  }

  isKeyConnectedToGnd(startKey) {
    const net = this.getNet(startKey);
    if (net.length === 1) return false;

    // AUDITORÍA (a pedido: "solo funcionen si los pines de gnd... está
    // conectado al gnd de la tarjeta esp32"): antes esto aceptaba
    // CUALQUIER otro pin tipo "ground" en la red, sin importar si esa
    // red llegaba de verdad hasta una fuente real -- dos periféricos
    // con su GND cableado entre sí, pero NINGUNO conectado al ESP32 ni
    // a una batería, pasaban igual (cada uno "veía" el GND del otro).
    // En la vida real eso no tiene tierra de verdad (nada cierra el
    // circuito contra la fuente), así que ahora se exige encontrar
    // puntualmente un pin ground de un componente FUENTE
    // (_isPowerSourceComponent) en la red -- una cadena periférico ->
    // periférico -> ESP32/batería sigue funcionando igual que antes
    // (getNet ya la atraviesa completa), lo único que deja de
    // aceptarse es una cadena que nunca llega a ninguna fuente real.
    // IMPORTANTE: no se puede restringir esto a "debe ser el ESP32
    // puntualmente" -- el L298N.power_gnd/power_12v se alimenta a
    // propósito de una batería externa (12V), no del ESP32 (que ni
    // siquiera podría proveer esa corriente en la vida real).
    for (const key of net) {
      // FIX real (encontrado agregando el switch de alimentación): si
      // startKey ES un pin ground (el caso normal -- se llama con el
      // propio pin GND del componente que se está chequeando), el
      // Set "visited" de getNet() SIEMPRE incluye a startKey en su
      // propia red, así que el loop se encontraba a SÍ MISMO y
      // devolvía true sin importar qué haya (o no) del otro lado del
      // cable -- un pin GND wireado a CUALQUIER COSA (incluso a un
      // interruptor ABIERTO, sin ninguna tierra real más allá) daba
      // "conectado a tierra" trivialmente. Saltear startKey obliga a
      // encontrar un pin ground DISTINTO en la red -- no cambia nada
      // para el caso normal (GND cableado directo a otro GND real,
      // ese otro pin sigue matcheando igual), pero si corta la
      // continuidad real.
      if (key === startKey) continue;
      const [cId, pId] = key.split(":");
      const component = this.simulator.componentManager.get(cId);
      if (!component || !this._isPowerSourceComponent(component)) continue;
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

    // Mismo criterio (y mismo motivo) que isKeyConnectedToGnd de
    // arriba -- exigir que la red llegue puntualmente a un pin de
    // alimentación de un componente FUENTE real (ESP32 o batería, ver
    // _isPowerSourceComponent), no de cualquier otro periférico. Acá
    // NO importa si es 3.3V/5V del ESP32 o los ~7.4V de la batería --
    // cualquier fuente real cuenta como "hay alimentación" (a pedido:
    // casi todo sensor/módulo debe poder usar cualquiera). La
    // preferencia por 3.3V y las excepciones puntuales que sí
    // necesitan un voltaje específico (ej. un relevador) se manejan
    // aparte, como AVISO no bloqueante -- ver getVoltageWarnings()/
    // _inferPinVoltage(), que solo dispara cuando el propio .json del
    // componente declara "voltage" explícito en su pin.
    for (const key of net) {
      // Mismo fix que isKeyConnectedToGnd de arriba -- ver ese
      // comentario. Confirmado en la práctica con el nuevo switch de
      // alimentación: sin este "continue", L298N.power_12v se
      // encontraba a sí mismo en su propia red y reportaba "hay
      // alimentación" incluso con el interruptor abierto entre él y
      // la batería.
      if (key === startKey) continue;
      const [cId, pId] = key.split(":");
      const component = this.simulator.componentManager.get(cId);
      if (!component || !this._isPowerSourceComponent(component)) continue;
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
    // expansión que casi nadie cablea, ej. v0/rw/d0-d3 del LCD
    // paralelo, ena/enb del L298N, out2 del pot_slider si el usuario
    // solo usa un riel).
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

    // ANTES: si no había "voltage" explícito, se adivinaba mirando el
    // TEXTO del id/name del pin (ej. "VCC (+5V)" -> 5). A pedido
    // ("todos los sensores y módulos deben poder conectarse a 3.3V o
    // 5V... debería funcionar en cualquiera"): eso generaba avisos
    // falsos para CASI CUALQUIER sensor -- KY-040, joystick, KY-018,
    // KY-023, L298N, etc. tienen "+5V" en el nombre (rótulo nominal
    // de la sérigrafía real) pero en la práctica funcionan perfecto
    // con 3.3V del ESP32, que es justo la conexión correcta y
    // recomendada, no un error. Ninguno de esos .json declara
    // "voltage" a propósito -- todos disparaban el aviso solo por el
    // texto. Ahora SOLO se avisa si el componente declaró
    // explícitamente "voltage" en su pin (para el día que se agregue
    // algo que sí lo necesite de verdad, ej. un relevador que
    // requiere 5V real para activar la bobina -- ese .json puede
    // declarar "voltage": 5 a propósito, y ESE caso sí generaría el
    // aviso, con intención real y no una adivinanza de texto).
    if (typeof pin.voltage === "number") return pin.voltage;

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

      // Interruptor deslizante SPDT (NC/COM/NO, ej. slide_switch): a
      // diferencia de pressPins (un solo par, puenteado solo mientras
      // "pressed"), acá COM siempre está puenteado a UNO de los dos
      // lados -- nunca ambos, nunca ninguno -- según
      // component.spdtPosition ("nc"|"no"). Mismo criterio genérico
      // que pressPins arriba, solo que el par activo puede cambiar.
      this.simulator.componentManager.getAll().forEach((component) => {
        if (!component.spdtPins) return;
        const { common, nc, no } = component.spdtPins;
        const activeSide = component.spdtPosition === "no" ? no : nc;
        if (!activeSide) return;

        const keyCommon = `${component.id}:${common}`;
        const keyActive = `${component.id}:${activeSide}`;
        if (keyCommon === current && !visited.has(keyActive)) {
          visited.add(keyActive);
          queue.push(keyActive);
        }
        if (keyActive === current && !visited.has(keyCommon)) {
          visited.add(keyCommon);
          queue.push(keyCommon);
        }
      });

      // Puente incondicional (ej. resistencia): a diferencia de
      // pressPins/spdtPins, este componente no tiene estado propio que
      // decida SI puentea -- sus dos terminales están conectados entre
      // sí siempre que exista el componente (ver resistencia.behavior.js,
      // que fija component.alwaysBridgePins una sola vez en initialState).
      this.simulator.componentManager.getAll().forEach((component) => {
        if (!component.alwaysBridgePins) return;
        const [pinA, pinB] = component.alwaysBridgePins;
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
    const neoRing = this.simulator.componentManager
      .getAll()
      .find((c) => c.type === "neopixel_ring");
    if (neoRing) {
      this.simulator.renderer.clearNeopixelRing(neoRing);
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