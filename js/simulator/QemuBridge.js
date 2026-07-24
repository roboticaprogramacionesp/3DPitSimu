/*
==========================================================
 PitSimulator — QemuBridge.js
 Conecta el simulador con server.js via WebSocket (REPL / GPIO).

 NOTA (cambio respecto a la versión original):
 server.js actual NO expone una API HTTP (/api/status,
 /api/start, /api/stop). Lanza QEMU directamente al ejecutar
 "node server.js" y solo abre un WebSocket en el puerto 8787.
 Por eso esta versión se conecta directo al WS al cargar la
 página, sin pasar por fetch() a ninguna API HTTP.

 Si más adelante server.js agrega esa API HTTP (para poder
 arrancar/detener QEMU con el botón "Simular" sin tener que
 tener una terminal abierta), se puede reintroducir
 checkStatus()/apiStart()/apiStop() con fetch.
==========================================================
*/

class QemuBridge {

    // Único puerto real que expone server.js hoy (ws://localhost:8787)
    static WS_URL = "ws://localhost:8787";

    constructor(simulator) {

        this.simulator = simulator;
        this.ws        = null;
        this.connected = false;
        this.buffer    = "";

        this.init();

        this.simulator.eventBus.on("qemu:send",       (text) => this.send(text));

        // El botón "▶ Simular" ahora solo conecta/desconecta el WS
        // (QEMU ya está corriendo por separado, lanzado por
        // "node server.js" en la terminal).
        this.simulator.eventBus.on("simulation:start", ()    => this.connectWs());
        this.simulator.eventBus.on("simulation:stop",  ()    => this.disconnectWs());

    }

    // ====================================================
    // Buscar el ESP32 en el canvas
    //
    // ANTES esto se resolvía UNA sola vez en init() y se guardaba en
    // this.esp32 -- pero QemuBridge se crea una sola vez al arrancar
    // la página, mientras que el ESP32 puede reemplazarse por un
    // objeto Component completamente nuevo (con un id distinto) en
    // cualquier momento: ProjectManager.deserialize() (importar un
    // proyecto, o el autoload de localStorage) borra
    // this.simulator.componentLayer/componentManager y recrea todos
    // los componentes desde cero. this.esp32 se quedaba apuntando al
    // objeto viejo, y como applyGpioChange() lo usaba para armar el
    // componentId que le pasa a SignalEngine.setDriverState(), ese id
    // ya no existía en componentManager -- SignalEngine SÍ hace la
    // búsqueda en vivo (componentManager.get(componentId)), pero con
    // un id que apuntaba a nada, así que el LED de GPIO2 dejaba de
    // prenderse después de cualquier import, sin ningún error visible.
    //
    // Ahora se busca en vivo cada vez que hace falta -- mismo patrón
    // que ya usa SignalEngine.js en sus propios métodos relacionados
    // al ESP32 (ver evaluateEsp32/reset/etc: todos vuelven a hacer
    // getAll().find(...) en cada llamada en vez de cachear).
    // ====================================================

    getEsp32() {
        return this.simulator.componentManager.getAll()
            .find(c => c.type.startsWith("esp32")) || null;
    }

    // ====================================================
    // Inicializar
    // ====================================================

    init() {

        // Solo para loguear que se encontró al arrancar -- el valor en
        // sí ya no se guarda en ningún lado (ver getEsp32() arriba).
        const esp32 = this.getEsp32();

        if (esp32) {
            console.log(`[QemuBridge] ESP32 encontrado: ${esp32.id}`);
        }

        // No arrancamos la conexión automáticamente al cargar la página.
        // El usuario decide cuando entrar en modo simulación con el botón.
        this.updateStatus("disconnected");

    }

    // ====================================================
    // WebSocket — REPL / GPIO
    // ====================================================

    connectWs() {

        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

        console.log(`[QemuBridge] Conectando WebSocket a ${QemuBridge.WS_URL}...`);

        this.ws = new WebSocket(QemuBridge.WS_URL);

        this.ws.onopen    = ()    => this.onOpen();
        this.ws.onclose   = ()    => this.onClose();
        this.ws.onerror   = (e)   => this.onError(e);
        this.ws.onmessage = (msg) => this.onMessage(msg);

    }

    disconnectWs() {

        // ANTES: esto solo cerraba el WebSocket. QEMU (y tu
        // while True corriendo adentro) seguía vivo del otro lado
        // -- "Detener" solo desconectaba la vista del navegador,
        // no paraba el programa. Ahora mandamos Ctrl+C primero
        // para interrumpir de verdad lo que esté corriendo, y
        // recién después cerramos el socket.
        if (this.ws && this.connected) {
            try { this.ws.send("\x03"); } catch (e) {}
        }

        // Pequeño margen para que el \x03 salga por el WS antes de
        // cerrarlo -- si cerramos en el mismo tick, hay riesgo de
        // que el mensaje ni siquiera llegue a salir del navegador.
        const wsToClose = this.ws;
        this.ws = null;
        this.connected = false;

        setTimeout(() => {
            if (wsToClose) wsToClose.close();
        }, 100);

    }

    send(text) {

        if (!this.connected || !this.ws) return;
        const line = text.endsWith("\n") ? text : text + "\r\n";
        this.ws.send(line);

    }

    interrupt() { if (this.connected) this.ws.send("\x03"); }
    softReset()  { if (this.connected) this.ws.send("\x04"); }

    // REVERTIDO -- el experimento del canal de datos por UART1 (ver
    // historial) hizo que QEMU mezclara los dos "-serial" sobre el
    // mismo UART físico y terminó scrambleando TODO el texto del
    // REPL, no solo los primeros caracteres como antes. Volvimos al
    // canal único. sendData() se queda como alias de send() para no
    // tener que tocar SignalEngine.js otra vez (sigue llamando a
    // sendData() para IN:/TEMP:/DIST:, pero ahora va derecho a stdin,
    // exactamente como send()).
    sendData(text) {
        this.send(text);
    }

    // ====================================================
    // Handlers WebSocket
    // ====================================================

    onOpen() {

        console.log("[QemuBridge] ✅ Conectado a QEMU");
        this.connected = true;
        this.buffer    = "";
        this.updateStatus("connected");
        this.simulator.eventBus.emit("qemu:connected");
        this.simulator.startSimulation();

        // Encender LED Power integrado del ESP32
        const esp32 = this.getEsp32();
        if (esp32) {
            this.simulator.renderer.setEsp32PowerLed(esp32, true);
        }

    }

    onClose() {

        console.log("[QemuBridge] ❌ Desconectado");
        this.connected = false;
        this.updateStatus("disconnected");
        this.simulator.eventBus.emit("qemu:disconnected");
        this.simulator.stopSimulation();

        // Apagar LED Power integrado del ESP32
        const esp32 = this.getEsp32();
        if (esp32) {
            this.simulator.renderer.setEsp32PowerLed(esp32, false);
            this.simulator.renderer.setEsp32GpioLed(esp32, false);
        }

        // Cortar cualquier buzzer que haya quedado sonando -- si no,
        // un tono podría quedar sonando para siempre tras desconectar
        // a mitad de una nota (ver Renderer.stopAllBuzzers).
        this.simulator.renderer.stopAllBuzzers?.();

    }

    onError(e) {

        console.error("[QemuBridge] Error WebSocket:", e);
        this.updateStatus("error");

    }

    onMessage(msg) {

        const text = msg.data;

        // Mensajes de estado internos del bridge (prefijo \x00STATUS:)
        if (text.startsWith("\x00STATUS:")) {
            try {
                const data = JSON.parse(text.slice(8));
                if (!data.running) {
                    this.simulator.stopSimulation();
                    this.updateStatus("disconnected");
                    this.simulator.renderer.stopAllBuzzers?.();
                }
            } catch (e) {}
            return;
        }

        this.buffer += text;
        const lines  = this.buffer.split("\n");
        this.buffer  = lines.pop();

        // Antes acá se emitía "text" (el chunk CRUDO, sin procesar)
        // directo al panel REPL, ANTES de siquiera mirar qué venía
        // adentro -- por eso un solo fill() de pantalla completa del
        // TFT (que manda ~230KB de "TFT:0:0:240x240:0000...") se veía
        // enterito como texto en la consola: parseLine() SÍ lo
        // reconocía y lo consumía, pero recién una línea después de
        // que ya se había mandado a mostrar.
        //
        // Ahora se arma el texto visible SOLO con las líneas
        // COMPLETAS (ya con su \n) que no empiezan con ninguno de los
        // prefijos de protocolo que parseLine() sabe interpretar --
        // esas nunca son texto para el humano, son datos binarios/hex
        // para el simulador. El resto (líneas de verdad, tracebacks,
        // prompts, etc.) se muestra igual que antes.
        //
        // Costo del cambio: el eco ahora es línea por línea en vez de
        // caracter por caracter (se espera a ver el "\n" antes de
        // mostrar algo) -- imperceptible para el uso normal (pegar
        // código, ver tracebacks), pero si en algún momento hace
        // falta eco en vivo mientras se tipea LETRA A LETRA en el
        // prompt ">>> ", este cambio lo pierde.
        const visibleLines = lines.filter(line => !this._isProtocolLine(line));
        if (visibleLines.length) {
            this.simulator.eventBus.emit("qemu:output", visibleLines.join("\n") + "\n");
        }

        lines.forEach(line => this.parseLine(line.trim()));

    }

    // Mismos prefijos que reconoce parseLine() más abajo -- si se
    // agrega un protocolo nuevo (otro tipo de pantalla, etc.) hay que
    // sumarlo ACÁ TAMBIÉN, o sus líneas van a aparecer crudas en el
    // panel REPL igual que pasaba con TFT: antes de este fix.
    _isProtocolLine(line) {
        const trimmed = line.trim();
        return trimmed.startsWith("GPIO:")   ||
               trimmed.startsWith("OLED:")   ||
               trimmed.startsWith("OLEDC:")  ||
               trimmed.startsWith("LCD:")    ||
               trimmed.startsWith("MAX:")    ||
               trimmed.startsWith("TM1637:") ||
               trimmed.startsWith("TFT:")    ||
               trimmed.startsWith("NEO:")    ||
               trimmed.startsWith("I2CW:")   ||
               trimmed.startsWith("PININFO:") ||
               trimmed.startsWith("PWM:");
    }

    // ====================================================
    // Parser GPIO
    // ====================================================

    parseLine(line) {

        if (!line) return;

        if (line.startsWith("GPIO:")) {
            const parts = line.split(":");
            if (parts.length >= 3) {
                const pin   = parseInt(parts[1], 10);
                const value = parseInt(parts[2], 10);
                if (!isNaN(pin) && (value === 0 || value === 1)) {
                    this.applyGpioChange(pin, value);

                    // Confirmación para _base_hal.py: applyGpioChange()
                    // ya corrió setDriverState() -> evaluateAll() de
                    // forma SINCRÓNICA acá arriba (incluye
                    // evaluateKeypadMatrix() si corresponde), así que
                    // para cuando llegamos a esta línea cualquier "IN:"
                    // que dependiera de este cambio de pin ya salió por
                    // el WS. Mandamos "SYNC:\n" DESPUÉS de eso a
                    // propósito -- el orden de envío se preserva end to
                    // end (mismo WS, mismo throttle FIFO en server.js),
                    // así que el firmware siempre ve los IN: antes que
                    // su SYNC: correspondiente. Reemplaza al viejo
                    // _SETTLE_MS fijo del lado Python -- ver _base_hal.py.
                    this.send("SYNC:\n");
                }
            }
            return;
        }

        if (line.startsWith("PWM:")) {
            // Formato: PWM:<gpio>:<freq>:<duty> -- lo manda
            // buzzer_hal.py cada vez que se construye/actualiza/
            // apaga un PWM (freq=0 significa apagado). A diferencia
            // de "ADC:"/"I2CR:" (simulador → firmware), este es
            // firmware → simulador, igual dirección que "GPIO:".
            const parts = line.split(":");
            if (parts.length >= 4) {
                const gpio = parseInt(parts[1], 10);
                const freq = parseInt(parts[2], 10);
                const duty = parseInt(parts[3], 10);
                if (!isNaN(gpio) && !isNaN(freq)) {
                    this.applyPwmChange(gpio, freq, duty);
                }
            }
            return;
        }

        if (line.startsWith("OLED:")) {
            // Formato: OLED:<ancho>x<alto>:<framebuffer en hex>
            // (lo manda oled_hal.py cada vez que el firmware llama a display.show())
            const parts = line.split(":");
            if (parts.length >= 3) {
                const dims = parts[1].match(/^(\d+)x(\d+)$/);
                if (dims) {
                    const width  = parseInt(dims[1], 10);
                    const height = parseInt(dims[2], 10);
                    const hex    = parts.slice(2).join(":");
                    this.simulator.signalEngine.applyOledFramebuffer(hex, width, height);
                }
            }
            return;
        }

        if (line.startsWith("OLEDC:")) {
            // Formato: OLEDC:<contraste 0-255> -- lo manda oled_hal.py
            // cada vez que el firmware llama a display.contrast(v).
            // Solo afecta el brillo de los píxeles PRENDIDOS (mismo
            // comportamiento que un SSD1306 real -- los apagados
            // siguen negros sin importar el contraste).
            const value = parseInt(line.slice("OLEDC:".length), 10);
            if (!isNaN(value)) {
                this.simulator.signalEngine.applyOledContrast(value);
            }
            return;
        }

        if (line.startsWith("LCD:")) {
            // Formato: LCD:<cols>x<rows>:<backlight 0|1>:<display_on 0|1>:
            //          <cursor_on 0|1>:<blink_on 0|1>:<cursor_col>:<cursor_row>:
            //          <fila0 hex>:<fila1 hex>...
            // (lo manda lcd_16x2_i2c.hal.py cada vez que el firmware
            // llama a clear()/putstr()/move_to()/backlight_on()/
            // display_on()/show_cursor()/blink_cursor_on()/etc.)
            const parts = line.split(":");
            if (parts.length >= 9) {
                const dims = parts[1].match(/^(\d+)x(\d+)$/);
                if (dims) {
                    const cols       = parseInt(dims[1], 10);
                    const rows       = parseInt(dims[2], 10);
                    const backlight  = parts[2] === "1";
                    const cursorState = {
                        displayOn: parts[3] === "1",
                        cursorOn:  parts[4] === "1",
                        blinkOn:   parts[5] === "1",
                        cursorCol: parseInt(parts[6], 10),
                        cursorRow: parseInt(parts[7], 10),
                    };
                    const rowsHex    = parts.slice(8);
                    this.simulator.signalEngine.applyLcdFramebuffer(rowsHex, cols, rows, backlight, cursorState);
                }
            }
            return;
        }

        if (line.startsWith("MAX:")) {
            // Formato: MAX:<ancho>x<alto>:<bitmap en hex, 1 bit por
            // pixel, fila por fila, MSB primero>
            // (lo manda max7219_hal.py cada vez que el firmware llama
            // a display.show() -- ver max7219_hal.py: leemos con el
            // propio framebuf.pixel(x,y), así que no importa si el
            // usuario usa rotate_180 o no, el protocolo ya llega
            // desacoplado de MONO_HLSB/MONO_HMSB)
            const parts = line.split(":");
            if (parts.length >= 3) {
                const dims = parts[1].match(/^(\d+)x(\d+)$/);
                if (dims) {
                    const width  = parseInt(dims[1], 10);
                    const height = parseInt(dims[2], 10);
                    const hex    = parts.slice(2).join(":");
                    this.simulator.signalEngine.applyMax7219Framebuffer(hex, width, height);
                }
            }
            return;
        }

        if (line.startsWith("TM1637:")) {
            // Formato: TM1637:<8 caracteres hex = 4 bytes, uno por
            // dígito, ya codificados bit a bit: a=bit0 ... g=bit6>
            // (lo manda tm1637_hal.py en cada write()/show()/
            // number()/numbers()/temperature()/scroll() -- el bit7
            // del byte de ÍNDICE 1 controla los dos puntos ":", misma
            // convención que la librería real mcauser/micropython-tm1637)
            const hex = line.slice("TM1637:".length);
            this.simulator.signalEngine.applyTm1637Segments(hex);
            return;
        }

        if (line.startsWith("TFT:")) {
            // Formato: TFT:<x>:<y>:<ancho>x<alto>:<hex RGB565 big-endian,
            // fila por fila, 2 bytes por pixel>
            // (lo manda tft_st7789_hal.py después de CADA primitiva de
            // dibujo -- pixel/hline/vline/line/rect/fill_rect/fill/
            // blit_buffer -- pero mandando SOLO el rectángulo mínimo
            // afectado, no la pantalla entera: a diferencia del OLED/
            // LCD/TM1637/MAX7219 -- que sí mandan el framebuffer
            // completo, pero recién cuando el firmware llama a
            // .show() -- el driver ST7789 real no buferiza nada, escribe
            // directo a la pantalla en cada llamada. Si mandáramos los
            // 240x240 px completos en cada pixel() suelto, un texto de
            // unas pocas letras (cientos de pixel() sueltos) saturaría
            // el UART del REPL. El rectángulo sucio evita eso.
            const parts = line.split(":");
            if (parts.length >= 5) {
                const x = parseInt(parts[1], 10);
                const y = parseInt(parts[2], 10);
                const dims = parts[3].match(/^(\d+)x(\d+)$/);
                if (dims && !isNaN(x) && !isNaN(y)) {
                    const width  = parseInt(dims[1], 10);
                    const height = parseInt(dims[2], 10);
                    const hex    = parts.slice(4).join(":");
                    // Variante compacta "S<hex4>" (ver
                    // tft_st7789.hal.py:_send_solid): TODO el rectángulo
                    // es un único color repetido -- fill()/fill_rect()
                    // grandes (ej. tft.init() limpiando 240x240) mandan
                    // esto en vez de 2*ancho*alto caracteres hex
                    // literales, que para una pantalla completa son
                    // ~230KB de texto por UART para algo que es UN color.
                    if (hex.startsWith("S")) {
                        const colorValue = parseInt(hex.slice(1), 16);
                        if (!isNaN(colorValue)) {
                            this.simulator.signalEngine.applyTftSolidFill(colorValue, x, y, width, height);
                        }
                    } else {
                        this.simulator.signalEngine.applyTftRegion(hex, x, y, width, height);
                    }
                }
            }
            return;
        }

        if (line.startsWith("NEO:")) {
            // Formato: NEO:<ancho>x<alto>:<RGB888 por pixel en hex, fila por
            // fila, 6 hex chars por pixel (RRGGBB)>
            // (lo manda el hal de NeoMatrix cada vez que el firmware llama a
            // .show() -- ver np.py: mandamos el framebuffer LÓGICO (x,y) tal
            // cual el usuario lo dibujó con ezFBfont/ezFBmarquee/pixel/etc,
            // ANTES de que NeoMatrix.show() lo remapee a índice físico de
            // tira según layout/rotation -- esos dos parámetros son solo
            // para el cableado real de la tira, no cambian lo que el
            // usuario ve dibujado en el panel, así que ni los necesitamos
            // acá. brightness si se reenvía, ya aplicado sobre el color
            // -- ver neomatrix_hal.py).
            const parts = line.split(":");
            if (parts.length >= 3) {
                const dims = parts[1].match(/^(\d+)x(\d+)$/);
                if (dims) {
                    const width  = parseInt(dims[1], 10);
                    const height = parseInt(dims[2], 10);
                    const hex    = parts.slice(2).join(":");
                    this.simulator.signalEngine.applyNeopixelFramebuffer(hex, width, height);
                }
            }
            return;
        }

        if (line.startsWith("PININFO:")) {
            // Formato: PININFO:<key>:<pin1>=<gpio>,<pin2>=<gpio>,...
            //
            // <key> identifica el dispositivo/bus:
            //   - Dispositivos que este proyecto asume ÚNICOS por
            //     canvas (misma simplificación que ya usa
            //     SignalEngine para el resto de su protocolo):
            //     "lcd", "oled", "tm1637", "tft".
            //   - I2C direccionable con posibles múltiples instancias:
            //     "keypad_i2c:<dirección decimal>".
            //
            // Lo manda cada HAL UNA sola vez al construirse (ver
            // I2cLcd.__init__ en lcd_16x2_i2c_hal.py, etc.) para
            // declarar qué GPIO real le pasó el código del usuario
            // (ej. "sda=21,scl=22"). SignalEngine usa esto para exigir
            // que el CABLE dibujado en el canvas llegue EXACTAMENTE a
            // ese pin del ESP32 -- no que "haya algún cable" (eso ya
            // lo cubre isComponentPowered), sino el mismo pin que
            // configuró el firmware. Ver SignalEngine.setDeclaredPins
            // / isWiredToDeclaredPins.
            const rest = line.slice("PININFO:".length);
            const sepIdx = rest.lastIndexOf(":");
            if (sepIdx > 0) {
                const key = rest.slice(0, sepIdx);
                const pairsStr = rest.slice(sepIdx + 1);
                const pins = {};
                pairsStr.split(",").forEach(pair => {
                    const [name, numStr] = pair.split("=");
                    const num = parseInt(numStr, 10);
                    if (name && !Number.isNaN(num)) pins[name] = num;
                });
                this.simulator.signalEngine.setDeclaredPins(key, pins);
            }
            return;
        }

        if (line.startsWith("I2CW:")) {
            // Formato: I2CW:<dirección>:<byte> -- lo manda cualquier
            // HAL cuyo I2C dummy sea "inteligente" (ver
            // keypad4x4_i2c_hal.py) cada vez que el firmware escribe
            // un byte nuevo por I2C. A diferencia de "GPIO:" (que
            // busca un pin del ESP32 por número), acá no hace falta
            // buscar nada: el I2C de este proyecto se resuelve por
            // DIRECCIÓN, no por topología de cables -- se lo pasamos
            // directo a SignalEngine, que ya sabe qué componente(s)
            // usan esa dirección (ver evaluateKeypadI2c).
            const parts = line.split(":");
            if (parts.length >= 3) {
                const addr  = parseInt(parts[1], 10);
                const value = parseInt(parts[2], 10);
                if (!Number.isNaN(addr) && !Number.isNaN(value)) {
                    this.simulator.signalEngine.setI2cWrittenByte(addr, value);

                    // Igual que con "GPIO:": setI2cWrittenByte() ya
                    // corrió evaluateAll() -> evaluateKeypadI2c() de
                    // forma SINCRÓNICA acá arriba, así que cualquier
                    // "I2CR:" que dependiera de esta escritura ya
                    // salió por el WS. Mandamos "SYNC:\n" DESPUÉS a
                    // propósito, mismo criterio que la rama GPIO --
                    // sin esto, writeto() del lado Python no tenía
                    // ninguna confirmación de la que colgarse, y el
                    // readfrom() inmediatamente posterior (ver
                    // keypad4_i2c.py: escribe fila -> lee columnas en
                    // el mismo tick) corría en carrera contra el
                    // round-trip -- leyendo el I2CR: de la escritura
                    // ANTERIOR, no de esta.
                    this.send("SYNC:\n");
                }
            }
            return;
        }

    }

    applyGpioChange(gpioNumber, value) {

        // Búsqueda en vivo (ver getEsp32() arriba) -- esto es lo que
        // se rompía después de importar un proyecto: con this.esp32
        // cacheado, este método seguía "encontrando" el pin (el
        // objeto viejo en memoria seguía teniendo su array pins
        // intacto) pero mandaba un componentId que ya no existía en
        // componentManager, así que SignalEngine.setDriverState()
        // nunca encontraba el componente y el LED de GPIO2 se quedaba
        // apagado sin ningún error visible.
        const esp32 = this.getEsp32();
        if (!esp32) return;

        // Buscar el pin por id exacto "io<N>" primero
        const exactId = `io${gpioNumber}`;
        let pin = esp32.pins.find(p => p.id === exactId);

        // Si no encuentra por id exacto, buscar por nombre exacto "GPIO<N>"
        // usando word boundary para evitar que "GPIO2" coincida con "GPIO22"
        if (!pin) {
            const nameTarget = `gpio${gpioNumber}`;
            pin = esp32.pins.find(p => {
                if (!p.name) return false;
                const name = p.name.toLowerCase();
                // Debe coincidir exactamente con "gpio<N>" como palabra completa
                const regex = new RegExp(`\\bgpio${gpioNumber}\\b`);
                return regex.test(name);
            });
        }

        if (!pin) {
            console.warn(`[QemuBridge] GPIO${gpioNumber} no encontrado en el ESP32`);
            return;
        }

        this._dbg(`[QemuBridge] GPIO${gpioNumber} → ${value ? "HIGH" : "LOW"} (pin: ${pin.id})`);

        this.simulator.signalEngine.setDriverState(esp32.id, pin.id, value);
        this.simulator.eventBus.emit("gpio:changed", { gpio: gpioNumber, pinId: pin.id, value });

    }

    applyPwmChange(gpioNumber, freq, duty) {

        // Misma búsqueda en vivo que applyGpioChange -- ver el
        // comentario de ahí sobre por qué NUNCA hay que cachear el
        // objeto esp32/pin entre llamadas.
        const esp32 = this.getEsp32();
        if (!esp32) return;

        const exactId = `io${gpioNumber}`;
        let pin = esp32.pins.find(p => p.id === exactId);

        if (!pin) {
            const regex = new RegExp(`\\bgpio${gpioNumber}\\b`);
            pin = esp32.pins.find(p => p.name && regex.test(p.name.toLowerCase()));
        }

        if (!pin) {
            console.warn(`[QemuBridge] GPIO${gpioNumber} no encontrado en el ESP32 (PWM)`);
            return;
        }

        this.simulator.signalEngine.setPwmState(esp32.id, pin.id, freq, duty);

    }

    // ====================================================
    // Log de diagnóstico centralizado (ver window.PIT_DEBUG en
    // app.js) -- mismo criterio que SignalEngine._dbg.
    // ====================================================

    _dbg(...args) {
        if (window.PIT_DEBUG) console.log(...args);
    }

    // ====================================================
    // Estado visual
    // ====================================================

    updateStatus(status) {

        const el = document.getElementById("qemuStatus");
        if (!el) return;

        const labels = {
            connecting:   "⏳ Conectando...",
            connected:    "✅ Simulando",
            disconnected: "🔴 Detenido",
            error:        "⚠️ Error",
        };

        const colors = {
            connecting:   "#f2c94c",
            connected:    "#00ff88",
            disconnected: "#666",
            error:        "#ff9800",
        };

        el.textContent = labels[status] || status;
        el.style.color = colors[status] || "#eee";

    }

}