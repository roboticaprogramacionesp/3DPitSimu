/*
==========================================================
 PitSimulator — ExamplesCatalog.js
 Catálogo de circuitos de ejemplo ya armados (estilo "Examples" de
 Wokwi) -- cada entrada apunta a un proyecto REAL ya guardado en
 examples/<id>/<id>.json (mismo formato que un "Guardar" normal:
 version/timestamp/components/wires/annotations), y opcionalmente a
 un ejemplo en bloques examples/<id>/<id>.xml (mismo que ya usan los
 tutoriales vía TutorialManager.blocksAction()/blocklyPanel.
 openXmlFromUrl()).

 A diferencia de los Tutoriales (que te ENSEÑAN a armar el circuito
 paso a paso), esto carga el circuito YA armado de una -- para
 arrancar de un ejemplo andando y modificarlo, no para aprender a
 cablearlo desde cero. Ver Toolbar.bindExamplesMenu()/
 ProjectManager.loadExample().

 Título/ícono tomados de la entrada de TutorialManager.TUTORIALS que
 mejor corresponde a cada carpeta (cruzando por blocksExample cuando
 existe, o por el tipo de componente real del circuito cuando no) --
 no son 1 a 1 por id/nombre de carpeta en todos los casos.
==========================================================
*/

const EXAMPLES_CATALOG = [

    // ── LEDs · Salidas digitales ──────────────────────────────
    { id: "led", title: "LED con resistencia (protegido)", icon: "Ω", category: "💡 LEDs · Salidas digitales" },
    { id: "semaforo", title: "Semáforo con ESP32", icon: "🚦", category: "💡 LEDs · Salidas digitales" },
    { id: "neopixel", title: "Anillo NeoPixel con ESP32", icon: "🌈", category: "💡 LEDs · Salidas digitales" },
    { id: "neopixel_matrix", title: "Matriz NeoPixel con ESP32", icon: "🎆", category: "💡 LEDs · Salidas digitales" },
    { id: "display", title: "Display 7 segmentos con ESP32", icon: "🔢", category: "💡 LEDs · Salidas digitales" },
    { id: "matrix8x8", title: "Matriz MAX7219 con ESP32", icon: "🔲", category: "💡 LEDs · Salidas digitales" },

    // ── Entradas · Actuadores ──────────────────────────────────
    { id: "boton", title: "Botón (KY-004) con ESP32", icon: "🔘", category: "🔧 Entradas · Actuadores" },
    { id: "seguilinea", title: "TCRT5000 — Infrarrojo (línea/obstáculo)", icon: "⬛", category: "🔧 Entradas · Actuadores" },
    { id: "buzzer", title: "Buzzer con ESP32", icon: "🔊", category: "🔧 Entradas · Actuadores" },
    { id: "servo", title: "Servo motor con ESP32", icon: "⚙️", category: "🔧 Entradas · Actuadores" },
    { id: "motor", title: "Motor reductor (pilas + interruptor + puente H)", icon: "🔧", category: "🔧 Entradas · Actuadores" },
    { id: "motor_a_pasos", title: "28BYJ-48 Motor Paso a Paso con ESP32", icon: "🔁", category: "🔧 Entradas · Actuadores" },
    { id: "foco", title: "Foco 127V controlado con relevador", icon: "⚡", category: "🔧 Entradas · Actuadores" },

    // ── Temperatura · Humedad ──────────────────────────────────
    { id: "dht11", title: "DHT11 — Temperatura y humedad", icon: "💧", category: "🌡️ Temperatura · Humedad" },
    { id: "ky-001", title: "Sensor de temperatura KY-001", icon: "🌡️", category: "🌡️ Temperatura · Humedad" },
    { id: "bmp280", title: "BMP280 Presión y Temperatura con ESP32", icon: "🌦️", category: "🌡️ Temperatura · Humedad" },

    // ── Sensores analógicos ────────────────────────────────────
    { id: "adkey", title: "Teclado analógico ADKEY", icon: "🎛️", category: "🎚️ Sensores · Analógicos" },
    { id: "joystick", title: "Joystick analógico con ESP32", icon: "🕹️", category: "🎚️ Sensores · Analógicos" },
    { id: "pot", title: "Potenciómetro rotativo con ESP32", icon: "🎚️", category: "🎚️ Sensores · Analógicos" },
    { id: "deslizante", title: "Potenciómetro deslizante con ESP32", icon: "🔅", category: "🎚️ Sensores · Analógicos" },
    { id: "encoder", title: "KY-040 Encoder Rotativo con ESP32", icon: "🔄", category: "🎚️ Sensores · Analógicos" },

    // ── Otros sensores ─────────────────────────────────────────
    { id: "ultrasonico", title: "Sensor ultrasónico HC-SR04", icon: "📡", category: "📡 Sensores" },
    { id: "gps", title: "Módulo GPS NEO-6M con ESP32", icon: "🛰️", category: "📡 Sensores" },
    { id: "pir", title: "Sensor PIR de Movimiento con ESP32", icon: "🚶", category: "📡 Sensores" },
    { id: "mpu6050", title: "MPU6050 Acelerómetro y Giroscopio con ESP32", icon: "🌀", category: "📡 Sensores" },
    { id: "bh1750", title: "BH1750 Sensor de Luz con ESP32", icon: "☀️", category: "📡 Sensores" },
    { id: "tcs34725", title: "TCS34725 Sensor de Color con ESP32", icon: "👁️", category: "📡 Sensores" },
    { id: "ds3231", title: "DS3231 Reloj de Tiempo Real con ESP32", icon: "⏰", category: "📡 Sensores" },

    // ── Pantallas y módulos ────────────────────────────────────
    { id: "oled", title: "Display OLED 128x64", icon: "🖥️", category: "🖥️ Pantallas y Módulos" },
    { id: "lcd", title: "LCD 16x2 con resistencia (paralelo)", icon: "📺", category: "🖥️ Pantallas y Módulos" },
    { id: "lcd_i2c", title: "LCD 16x2 I2C", icon: "📟", category: "🖥️ Pantallas y Módulos" },
    { id: "tm1637", title: "TM1637 4 Dígitos con ESP32", icon: "🕐", category: "🖥️ Pantallas y Módulos" },
    { id: "tft", title: "Pantalla TFT 240x240 (ST7789)", icon: "🖼️", category: "🖥️ Pantallas y Módulos" },
    { id: "rfid", title: "Lector RFID RC522 con ESP32", icon: "💳", category: "🖥️ Pantallas y Módulos" },

    // ── Comunicación ───────────────────────────────────────────
    { id: "hc-06", title: "HC-06 Módulo Bluetooth con ESP32", icon: "🔵", category: "📡 Comunicación inalámbrica" },
    { id: "espnow", title: "ESP-NOW: control remoto de un LED", icon: "📡", category: "📡 Comunicación inalámbrica" },
    { id: "wifi", title: "WiFi: prender un LED desde internet", icon: "🌐", category: "📡 Comunicación inalámbrica" },

].map((entry) => ({
    ...entry,
    json: `examples/${entry.id}/${entry.id}.json`,
    // No todas las carpetas tienen el .xml de bloques -- loadExample()
    // ya tolera un 404 acá (sigue andando solo con el circuito).
    xml: `examples/${entry.id}/${entry.id}.xml`,
}));
