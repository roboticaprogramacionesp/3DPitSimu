/*

==========================================================

 PitSimulator — PropertyPanel.js

 Panel derecho: propiedades del componente seleccionado.


 Añadido: soporte KY-001 con barra deslizante de temperatura.

 Modificado: KY-001 ahora también muestra propiedades genéricas

 (Nombre, X, Y, Rotación, Espejo horizontal, Pines, Color, ID, Tipo).

==========================================================

*/


class PropertyPanel {


    constructor(simulator) {


        this.simulator = simulator;


        this.content   = document.getElementById("propertyContent");

        this.panel     = document.getElementById("propertyPanel");

        this.pinBtn    = document.getElementById("btnPinPanel");

        this.reopenTab = document.getElementById("propsReopenTab");

        this.layout    = document.getElementById("mainLayout");


        this.pinned    = false;

        this.current   = null;

        this.currentWireId = null;


        this.bindEvents();

        this.bindBusEvents();

        this.clear();


    }


    // ====================================================

    // Eventos

    // ====================================================


    bindEvents() {


        // Fijar / desfijar el panel

        this.pinBtn?.addEventListener("click", () => {

            this.pinned = !this.pinned;

            this.pinBtn.classList.toggle("active", this.pinned);

        });


        // Reabrir panel colapsado

        this.reopenTab?.addEventListener("click", () => {

            this.layout?.classList.remove("props-collapsed");

        });


        // Colapsar el panel al hacer click en el botón de fijar

        // cuando ya estaba fijado (segundo click = cerrar)

        document.addEventListener("keydown", (e) => {

            if (e.key === "Escape" && !this.pinned) this.clear();

        });


    }


    bindBusEvents() {


        this.simulator.eventBus.on("selection:changed", (components) => {

            if (components.length === 1) {

                this.show(components[0]);

            } else {

                this.clear();

            }

        });

        // Actualizar display de temperatura
        this.simulator.eventBus.on("temp:changed", ({ componentId, celsius }) => {

            if (this.current?.id === componentId) {
                this._updateTempDisplay(celsius);
            }

        });

        // Actualizar display de humedad (DHT11)
        this.simulator.eventBus.on("humidity:changed", ({ componentId, humidity }) => {

            if (this.current?.id === componentId) {
                this._updateHumidityDisplay(humidity);
            }

        });

        // Actualizar display de distancia (HC-SR04)
        this.simulator.eventBus.on("distance:changed", ({ componentId, cm }) => {

            if (this.current?.id === componentId) {
                this._updateDistanceDisplay(cm);
            }

        });

        // Actualizar display del ángulo del servo (SG90)
        this.simulator.eventBus.on("servo:changed", ({ componentId, angle }) => {

            if (this.current?.id === componentId) {
                this._updateServoDisplay(angle);
            }

        });

        // Actualizar display de motores (L298N)
        this.simulator.eventBus.on("motor:changed", ({ componentId, motorA, motorB }) => {

            if (this.current?.id === componentId) {
                this._updateL298nDisplay(motorA, motorB);
            }

        });

        // Actualizar display del motor paso a paso (28BYJ-48)
        this.simulator.eventBus.on("stepper:changed", ({ componentId, bits, shaftAngle }) => {

            if (this.current?.id === componentId) {
                this._updateStepperDisplay(bits, shaftAngle);
            }

        });

        // Mostrar/ocultar el panel del cable seleccionado
        this.simulator.eventBus.on("wire:selected", (wireId) => {

            if (!wireId) {
                if (this.currentWireId) {
                    this.currentWireId = null;
                    if (!this.current) this.clear();
                }
                return;
            }

            const wire = this.simulator.wireManager.wires.find(w => w.id === wireId);
            if (wire) this._renderWire(wire);

        });

    }


    // ====================================================

    // Mostrar propiedades de un componente

    // ====================================================


    show(component) {

        this.current = component;
        this.currentWireId = null;

        // Abrir el panel si estaba colapsado
        this.layout?.classList.remove("props-collapsed");

        // Todos los tipos con panel especial ya migraron a
        // ComponentBehaviorRegistry (ver ese archivo) -- un tipo nuevo
        // sin panel especial no necesita tocar este método: cae solo en
        // _renderGeneric() de abajo, igual que hoy.
        const behavior = ComponentBehaviorRegistry.get(component.type);
        if (behavior?.propertyPanel?.render) {
            behavior.propertyPanel.render(component, this);
            return;
        }

        this._renderGeneric(component);

    }

    clear() {

        this.current = null;
        this.currentWireId = null;

        this.content.innerHTML = "";

        // Colapsar el panel cuando no hay selección (si no está fijado)
        if (!this.pinned) {
            this.layout?.classList.add("props-collapsed");
        }

    }


    // ====================================================

    // KY-001 — Panel con barra de temperatura + propiedades genéricas

    // ====================================================


    // _renderTempSensor() migró a components/ky_001/ky_001.behavior.js
    // (registrado para "ky_001" y "dht11", sin llamadores externos --
    // los helpers de abajo siguen acá porque el constructor los llama
    // directo al recibir "temp:changed"/"humidity:changed").

    // ── Actualizar solo el display numérico y el cursor ──────────────────

    _updateTempDisplay(celsius) {


        const display = document.getElementById(`tempDisplay_${this.current?.id}`);

        const cursor  = document.getElementById(`tempCursor_${this.current?.id}`);

        // DHT11 real solo tiene resolución de °C enteros -- ver el
        // mismo criterio (y motivo) en ky_001.behavior.js/render().
        // Sin esto, arrastrar el slider mostraba acá "15.0°C" mientras
        // el render() inicial ya mostraba "15°C" para el mismo valor.
        const isDHT = this.current?.type === "dht11";

        if (display) {

            // Math.trunc(), no Math.round() -- ver el mismo motivo en
            // ky_001.behavior.js/render() (dht11.hal.py usa int(),
            // que trunca hacia cero, no redondea).
            display.textContent   = isDHT ? `${Math.trunc(celsius)}°C` : `${celsius.toFixed(1)}°C`;

            display.style.color   = this._tempToColor(celsius);

        }


        if (cursor) {

            cursor.style.left        = `${this._celsiusToPct(celsius)}%`;

            cursor.style.borderColor = this._tempToColor(celsius);

        }


    }


    _updateHumidityDisplay(humidity) {

        const display = document.getElementById(`humDisplay_${this.current?.id}`);
        const cursor  = document.getElementById(`humCursor_${this.current?.id}`);

        if (display) {
            display.textContent = `${humidity.toFixed(0)}%`;
        }

        if (cursor) {
            cursor.style.left = `${humidity}%`;
        }

    }

    // ── Convertir celsius a color (azul → verde → amarillo → rojo) ───────

    _tempToColor(celsius) {

        if (celsius < 0)   return "#4da3ff";

        if (celsius < 25)  return "#2ecc71";

        if (celsius < 60)  return "#f2c94c";

        return "#ff5252";

    }


    // ── Convertir celsius a porcentaje del slider (−55 a 125) ────────────

    _celsiusToPct(celsius) {

        return Math.round(((celsius + 55) / 180) * 100);

    }


    // ====================================================

    // Panel especial: HC-SR04 (sensor ultrasónico)

    // ====================================================


    // _renderUltrasonicSensor() migró a components/hcsr04/hcsr04.behavior.js
    // (sin llamadores externos -- helpers de abajo siguen acá, ver el
    // mismo motivo que _renderTempSensor más arriba).


    // ── Actualizar solo el display numérico y el cursor (HC-SR04) ────────

    _updateDistanceDisplay(cm) {

        const display = document.getElementById(`distDisplay_${this.current?.id}`);
        const cursor  = document.getElementById(`distCursor_${this.current?.id}`);

        if (display) {
            display.textContent = `${cm.toFixed(1)} cm`;
            display.style.color = this._distToColor(cm);
        }

        if (cursor) {
            cursor.style.left        = `${this._distToPct(cm)}%`;
            cursor.style.borderColor = this._distToColor(cm);
        }

    }


    // ── Convertir distancia a color (rojo=cerca → azul=lejos) ────────────

    _distToColor(cm) {

        if (cm < 10)  return "#ff5252";
        if (cm < 50)  return "#f2c94c";
        if (cm < 200) return "#2ecc71";
        return "#4da3ff";

    }


    // ── Convertir distancia a porcentaje del slider (2 a 400 cm) ─────────

    _distToPct(cm) {

        return Math.round(((cm - 2) / (400 - 2)) * 100);

    }


    // ====================================================

    // Panel especial: Servo SG90

    // ====================================================


    // _renderServo() migró a components/sg90/sg90.behavior.js (sin
    // llamadores externos -- helpers de abajo siguen acá, ver el mismo
    // motivo que _renderTempSensor más arriba).


    // ── Actualizar solo el display numérico y el cursor (SG90) ───────────

    _updateServoDisplay(angle) {

        const display = document.getElementById(`servoDisplay_${this.current?.id}`);
        const cursor  = document.getElementById(`servoCursor_${this.current?.id}`);

        if (display) {
            display.textContent = `${Math.round(angle)}°`;
        }

        if (cursor) {
            cursor.style.left = `${this._angleToPct(angle)}%`;
        }

    }


    // ── Convertir ángulo a porcentaje del slider (0 a 180°) ───────────────

    _angleToPct(angle) {

        return Math.round((angle / 180) * 100);

    }


    // ====================================================

    // Panel especial: L298N (puente H)

    // ====================================================


    // _renderL298n()/_appendL298nMotorBlock() migraron a
    // components/l298n/l298n.behavior.js (sin llamadores externos --
    // helpers de abajo siguen acá, ver el mismo motivo que
    // _renderTempSensor más arriba).

    // ── Actualizar los badges de estado de motor (llamado por "motor:changed") ──

    _updateL298nDisplay(motorA, motorB) {

        const badgeA = document.getElementById(`l298nState_A_${this.current?.id}`);
        const badgeB = document.getElementById(`l298nState_B_${this.current?.id}`);

        if (badgeA) {
            badgeA.textContent = this._l298nStateLabel(motorA.state);
            badgeA.style.background = this._l298nStateColor(motorA.state);
        }

        if (badgeB) {
            badgeB.textContent = this._l298nStateLabel(motorB.state);
            badgeB.style.background = this._l298nStateColor(motorB.state);
        }

    }


    // ── Traducción de estado a texto / color ─────────────────────────────

    _l298nStateLabel(state) {

        const labels = {
            adelante:      "▲ Adelante",
            "atrás":       "▼ Atrás",
            freno:         "■ Freno",
            detenido:      "● Detenido",
            deshabilitado: "○ Deshabilitado",
        };

        return labels[state] || state;

    }

    _l298nStateColor(state) {

        const colors = {
            adelante:      "#2ecc71",
            "atrás":       "#4da3ff",
            freno:         "#ff5252",
            detenido:      "#555",
            deshabilitado: "#333",
        };

        return colors[state] || "#555";

    }


    // ── Motor paso a paso (28BYJ-48) -- ver components/28byj/28byj.behavior.js ──

    // Usado tanto para el estado inicial (llamado directo desde
    // 28byj.behavior.js al abrir el panel) como para la actualización
    // en vivo de acá abajo (_updateStepperDisplay, via "stepper:changed")
    // -- misma fila de 4 cuadraditos IN1-IN4, se reconstruye entera
    // cada vez (más simple que tocar cada cuadradito a mano, y son
    // solo 4 elementos chicos).
    _renderStepperCoils(coilsRow, bits) {

        coilsRow.innerHTML = "";
        (bits || [false, false, false, false]).forEach((on, i) => {
            const dot = document.createElement("div");
            dot.style.cssText = `
                flex: 1;
                text-align: center;
                padding: 6px 0;
                border-radius: 6px;
                font-size: 11px;
                font-weight: 700;
                color: #fff;
                background: ${on ? "#4da3ff" : "#333"};
            `;
            dot.textContent = `IN${i + 1}`;
            coilsRow.appendChild(dot);
        });

    }

    _renderStepperAngle(angleLabel, shaftAngle) {

        const normalized = ((shaftAngle || 0) % 360 + 360) % 360;
        angleLabel.textContent = `Ángulo del eje: ${normalized.toFixed(1)}°`;

    }

    _updateStepperDisplay(bits, shaftAngle) {

        const coilsRow = document.getElementById(`stepperCoils_${this.current?.id}`);
        const angleLabel = document.getElementById(`stepperAngle_${this.current?.id}`);

        if (coilsRow) this._renderStepperCoils(coilsRow, bits);
        if (angleLabel) this._renderStepperAngle(angleLabel, shaftAngle);

    }


    // ====================================================

    // Panel especial: Display 7 Segmentos

    // ====================================================


    // _renderDisplay7() migró a components/display7/display7.behavior.js
    // (sin llamadores externos).


    // ====================================================

    // Panel genérico (componentes sin panel especial)

    // ====================================================


    _renderGeneric(component) {


        this.content.innerHTML = "";

        this._renderCommonProperties(component);


    }


    // ====================================================

    // Panel especial: Teclado matricial 4x4 I2C (PCF8574)

    // ====================================================


    // _renderKeypadI2c() migró a
    // components/keypad4x4_i2c/keypad4x4_i2c.behavior.js (sin
    // llamadores externos).


    // ====================================================

    // Panel especial: OLED I2C (SSD1306) — color de pantalla

    // ====================================================


    // _renderOled() migró a components/oled/oled.behavior.js (sin
    // llamadores externos).


    // ====================================================

    // Panel especial: LCD 16x2 (con o sin backpack I2C) — color

    // ====================================================


    // _renderLcd() migró a components/lcd16x2/lcd16x2.behavior.js
    // (registrado para "lcd16x2" y "lcd_16x2_i2c", sin llamadores
    // externos).


    // ====================================================

    // Panel especial: TFT ST7789 SPI (240x240, color real)

    // ====================================================


    // _renderTft() migró a components/tft_st7789/tft_st7789.behavior.js
    // (sin llamadores externos).


    // ====================================================

    // Panel especial: MPU6050 (acelerómetro + giroscopio + temp)

    // ====================================================


    // _renderMpu6050() (+ sus 2 helpers privados) migró a
    // components/mpu6050/mpu6050.behavior.js (sin llamadores externos).


    // ====================================================

    // Panel especial: Matriz de NeoPixel (WS2812) — rows/cols/shape

    // ====================================================


    // _renderNeopixelMatrix() migró a
    // components/neopixel_matrix/neopixel_matrix.behavior.js (sin
    // llamadores externos).


    // ====================================================

    // Panel especial: Matriz MAX7219 — rows/cols/shape/color

    // ====================================================


    // _renderMax7219() migró a components/max7219/max7219.behavior.js
    // (sin llamadores externos).


    // ====================================================

    // Propiedades comunes a todos los componentes

    // (Nombre, X, Y, Rotación, Espejo horizontal, Color, Pines, ID, Tipo, Eliminar)

    // ====================================================


    _renderCommonProperties(component) {


        // Nombre

        this._appendEditableField("Nombre", component.name, (val) => {

            component.name = val;

            const label = component.element?.querySelector(".component-name-label");

            if (label) label.textContent = val;

        });


        // Posición X / Y

        const posRow = document.createElement("div");

        posRow.className = "property-row";


        posRow.appendChild(this._makeNumberField("X", component.x, (val) => {

            component.setPosition(val, component.y);

            this.simulator.wireManager.renderAll();

        }));

        posRow.appendChild(this._makeNumberField("Y", component.y, (val) => {

            component.setPosition(component.x, val);

            this.simulator.wireManager.renderAll();

        }));

        this.content.appendChild(posRow);


        // Rotación

        this._appendEditableField("Rotación", component.rotation, (val) => {

            component.setRotation(parseFloat(val) || 0);

            this.simulator.wireManager.renderAll();

            this.simulator.selectionManager.renderHighlight();

        }, "number");


        // Espejo horizontal

        const flipBtn = document.createElement("button");

        flipBtn.className = "property-flip-btn";

        flipBtn.textContent = component.flipX ? "⟺ Espejo: ON" : "⟺ Espejo: OFF";

        flipBtn.classList.toggle("active", !!component.flipX);

        flipBtn.addEventListener("click", () => {

            component.toggleFlip();

            flipBtn.textContent = component.flipX ? "⟺ Espejo: ON" : "⟺ Espejo: OFF";

            flipBtn.classList.toggle("active", component.flipX);

            this.simulator.wireManager.renderAll();

            this.simulator.selectionManager.renderHighlight();

        });

        const flipField = document.createElement("div");

        flipField.className = "property-field";

        const flipLabel = document.createElement("label");

        flipLabel.textContent = "Espejo horizontal";

        flipField.appendChild(flipLabel);

        flipField.appendChild(flipBtn);

        this.content.appendChild(flipField);


        // Color (si el componente tiene colorTargets, o si es un LED
        // -- los LEDs no usan colorTargets, usan el mecanismo de
        // color_path32 / data-led-role dentro de Renderer.applyLedColor)

        if (component.colorTargets?.length > 0 || Renderer.isLed(component.type)) {

            this._appendColorField(component);

        }


        // ID

        this._appendField("ID", component.id);


        // Tipo

        this._appendField("Tipo", component.type);


        // Pines

        this._appendField("Pines", component.pins.map(p => p.name || p.id).join(", "));


        // Botón eliminar

        const delBtn = document.createElement("button");

        delBtn.className = "property-delete-btn";

        delBtn.textContent = "Eliminar componente";

        delBtn.addEventListener("click", () => {

            this.simulator.selectionManager.clear();

            // Igual criterio que Simulator.deleteSelection(): capturar
            // los cables conectados antes de borrar, para que Ctrl+Z
            // los restaure junto con el componente (este botón antes
            // ni siquiera empujaba un comando al historial -- borrar
            // desde acá no se podía deshacer en absoluto).
            const removedWires = this.simulator.wireManager.wires.filter(w =>
                w.from.componentId === component.id || w.to.componentId === component.id
            );

            this.simulator.removeComponent(component.id);

            this.simulator.history.push({
                undo: () => {
                    this.simulator.addComponent(component);
                    removedWires.forEach(wire => this.simulator.wireManager.wires.push(wire));
                    this.simulator.wireManager.ensureUniqueWireIds();
                    this.simulator.wireManager.renderAll();
                },
                redo: () => this.simulator.removeComponent(component.id)
            });

            this.clear();

        });

        this.content.appendChild(delBtn);


    }


    // ====================================================

    // Helpers de campo

    // ====================================================


    _appendField(label, value) {


        const wrap = document.createElement("div");

        wrap.className = "property-field";


        const lbl = document.createElement("label");

        lbl.textContent = label;


        const val = document.createElement("div");

        val.className = "property-static";

        val.textContent = value;


        wrap.appendChild(lbl);

        wrap.appendChild(val);

        this.content.appendChild(wrap);


    }


    _appendEditableField(label, value, onChange, type = "text") {


        const wrap = document.createElement("div");

        wrap.className = "property-field";


        const lbl = document.createElement("label");

        lbl.textContent = label;


        const input = document.createElement("input");

        input.type  = type;

        input.value = value;

        input.addEventListener("change", () => onChange(input.value));


        wrap.appendChild(lbl);

        wrap.appendChild(input);

        this.content.appendChild(wrap);


        return input;


    }


    _makeNumberField(label, value, onChange) {


        const wrap = document.createElement("div");

        wrap.className = "property-field";


        const lbl = document.createElement("label");

        lbl.textContent = label;


        const input = document.createElement("input");

        input.type  = "number";

        input.value = Math.round(value);

        input.addEventListener("change", () => onChange(parseFloat(input.value) || 0));


        wrap.appendChild(lbl);

        wrap.appendChild(input);


        return wrap;


    }


    // ====================================================

    // Panel especial: Cable seleccionado

    // ====================================================


    _renderWire(wire) {

        this.current       = null;
        this.currentWireId = wire.id;

        this.layout?.classList.remove("props-collapsed");

        this.content.innerHTML = "";

        const title = document.createElement("h4");
        title.style.cssText = "margin-bottom: 12px; color: #fff;";
        title.textContent = "Cable";
        this.content.appendChild(title);

        // ── Extremos del cable (solo lectura) ───────────────────────────

        // OJO -- "Desde"/"Hasta" muestran component.name, que es un
        // campo de texto libre editable por el usuario (ver el campo
        // "Nombre" más abajo en _renderGeneric) Y que además viaja tal
        // cual dentro de cualquier archivo de proyecto .json (ver
        // ProjectManager.serialize/deserialize) -- abrir un proyecto
        // ajeno con un nombre de componente tipo "<img src=x
        // onerror=...>" ejecutaría ese script apenas alguien
        // seleccionara un cable conectado a ese componente, si esto
        // fuera innerHTML con el texto interpolado crudo (como era
        // antes). Con textContent + nodos armados a mano, ese texto
        // nunca se interpreta como HTML, sea lo que sea que contenga.
        const endsBox = document.createElement("div");
        endsBox.style.cssText = "font-size:13px; color:#ccc; margin-bottom:16px; line-height:1.7; background:#1e1f22; border:1px solid #333; border-radius:6px; padding:10px 12px;";

        const fromRow = document.createElement("div");
        const fromLabel = document.createElement("strong");
        fromLabel.style.color = "#999";
        fromLabel.textContent = "Desde: ";
        fromRow.appendChild(fromLabel);
        fromRow.appendChild(document.createTextNode(this._describeWireEnd(wire.from)));

        const toRow = document.createElement("div");
        const toLabel = document.createElement("strong");
        toLabel.style.color = "#999";
        toLabel.textContent = "Hasta: ";
        toRow.appendChild(toLabel);
        toRow.appendChild(document.createTextNode(this._describeWireEnd(wire.to)));

        endsBox.appendChild(fromRow);
        endsBox.appendChild(toRow);
        this.content.appendChild(endsBox);

        // ── Color (paleta automática + personalizado) ───────────────────

        this._appendWireColorField(wire);

        // ── Tipo de conector (para el circuito físico real) ─────────────

        this._appendWireConnectorTypeField(wire);

        // ── Restaurar color automático ──────────────────────────────────

        const autoBtn = document.createElement("button");
        autoBtn.className = "property-flip-btn";
        autoBtn.style.marginBottom = "12px";
        autoBtn.textContent = "↺ Restaurar color automático";
        autoBtn.addEventListener("click", () => {

            const pinFrom = this.simulator.wireManager.getPinDefinition(wire.from);
            const pinTo   = this.simulator.wireManager.getPinDefinition(wire.to);

            const oldColor = wire.color;
            const newColor = WireManager.colorForPins(pinFrom, pinTo);

            if (oldColor === newColor) return;

            wire.color = newColor;
            this.simulator.wireManager.renderAll();
            this._renderWire(wire); // re-pintar el panel para reflejar el swatch activo

            this.simulator.history.push({
                undo: () => {
                    wire.color = oldColor;
                    this.simulator.wireManager.renderAll();
                    this._syncWirePanelIfCurrent(wire);
                },
                redo: () => {
                    wire.color = newColor;
                    this.simulator.wireManager.renderAll();
                    this._syncWirePanelIfCurrent(wire);
                }
            });

        });
        this.content.appendChild(autoBtn);

        // ── Borrar cable ─────────────────────────────────────────────────

        const delBtn = document.createElement("button");
        delBtn.className = "property-delete-btn";
        delBtn.textContent = "Borrar cable";
        delBtn.addEventListener("click", () => {

            this.simulator.wireManager.removeWire(wire.id);
            this.simulator.wireManager.selectedWire = null;
            this.clear();

        });
        this.content.appendChild(delBtn);

    }

    // Descripción legible de un extremo { componentId, pinId }
    _describeWireEnd(ref) {

        const component = this.simulator.componentManager.get(ref.componentId);
        const pin       = component?.pins.find(p => p.id === ref.pinId);

        const compName = component?.name || ref.componentId;
        const pinName  = pin?.name || ref.pinId;

        return `${compName} → ${pinName}`;

    }

    // Paleta de colores del cable: las categorías automáticas
    // (GND, VCC, I2C, etc.) + la paleta clásica de WireManager.COLORS,
    // más un selector personalizado -- igual que con el LED.
    _appendWireColorField(wire) {

        const wrap = document.createElement("div");
        wrap.style.cssText = "margin-bottom: 12px;";

        const label = document.createElement("label");
        label.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
        label.textContent = "Color del cable";
        wrap.appendChild(label);

        const palette = document.createElement("div");
        palette.className = "led-palette";

        const rawSwatches = [
            ...Object.values(WireManager.CATEGORY_COLORS),
            ...WireManager.COLORS
        ];

        // Quitar colores repetidos manteniendo el orden
        const seen = new Set();
        const swatches = rawSwatches.filter(color => {
            const norm = Utils.normalizeHex(color);
            if (seen.has(norm)) return false;
            seen.add(norm);
            return true;
        });

        swatches.forEach(color => {

            const btn = document.createElement("button");
            btn.className = "led-swatch";
            btn.style.background = color;
            btn.title = color;

            if (Utils.normalizeHex(wire.color) === Utils.normalizeHex(color)) {
                btn.classList.add("active");
            }

            btn.addEventListener("click", () => {

                const oldColor = wire.color;
                const newColor = color;

                if (Utils.normalizeHex(oldColor) === Utils.normalizeHex(newColor)) return;

                palette.querySelectorAll(".led-swatch").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                wire.color = newColor;
                this.simulator.wireManager.renderAll();

                this.simulator.history.push({
                    undo: () => {
                        wire.color = oldColor;
                        this.simulator.wireManager.renderAll();
                        this._syncWirePanelIfCurrent(wire);
                    },
                    redo: () => {
                        wire.color = newColor;
                        this.simulator.wireManager.renderAll();
                        this._syncWirePanelIfCurrent(wire);
                    }
                });

            });

            palette.appendChild(btn);

        });

        // Selector de color personalizado. "input" actualiza en vivo
        // mientras se arrastra el picker (sin tocar el historial, para
        // no llenarlo de pasos intermedios); "change" registra UN solo
        // paso de historial cuando se termina de elegir el color.
        const customPicker = document.createElement("input");
        customPicker.type  = "color";
        customPicker.className = "led-swatch-custom";
        customPicker.value = wire.color;
        customPicker.title = "Color personalizado";

        let colorBeforeCustomEdit = wire.color;

        customPicker.addEventListener("input", () => {
            palette.querySelectorAll(".led-swatch").forEach(b => b.classList.remove("active"));
            wire.color = customPicker.value;
            this.simulator.wireManager.renderAll();
        });

        customPicker.addEventListener("change", () => {

            const oldColor = colorBeforeCustomEdit;
            const newColor = customPicker.value;

            if (Utils.normalizeHex(oldColor) === Utils.normalizeHex(newColor)) return;

            this.simulator.history.push({
                undo: () => {
                    wire.color = oldColor;
                    this.simulator.wireManager.renderAll();
                    this._syncWirePanelIfCurrent(wire);
                },
                redo: () => {
                    wire.color = newColor;
                    this.simulator.wireManager.renderAll();
                    this._syncWirePanelIfCurrent(wire);
                }
            });

            colorBeforeCustomEdit = newColor;

        });

        palette.appendChild(customPicker);

        wrap.appendChild(palette);
        this.content.appendChild(wrap);

    }

    // Tipo de conector real (ver WireManager.CONNECTOR_TYPES/
    // defaultConnectorType) -- para armar el circuito FÍSICO, no tiene
    // ningún efecto en la simulación. El valor inicial es un default
    // razonable (ver WireManager.defaultConnectorType), pero el
    // usuario es quien mejor sabe qué conectores tiene a mano, así que
    // acá lo puede cambiar libremente.
    _appendWireConnectorTypeField(wire) {

        const wrap = document.createElement("div");
        wrap.style.cssText = "margin-bottom: 12px;";

        const label = document.createElement("label");
        label.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
        label.textContent = "Tipo de cable (circuito físico)";
        wrap.appendChild(label);

        const select = document.createElement("select");
        select.className = "property-select";

        WireManager.CONNECTOR_TYPES.forEach((type) => {
            const opt = document.createElement("option");
            opt.value = type;
            opt.textContent = type;
            if ((wire.connectorType || "hembra-hembra") === type) opt.selected = true;
            select.appendChild(opt);
        });

        select.addEventListener("change", () => {

            const oldType = wire.connectorType;
            const newType = select.value;

            if (oldType === newType) return;

            wire.connectorType = newType;

            this.simulator.history.push({
                undo: () => { wire.connectorType = oldType; this._syncWirePanelIfCurrent(wire); },
                redo: () => { wire.connectorType = newType; this._syncWirePanelIfCurrent(wire); },
            });

        });

        wrap.appendChild(select);
        this.content.appendChild(wrap);

    }

    // Si el panel sigue mostrando este mismo cable (no se cambió la
    // selección mientras tanto), lo vuelve a pintar -- usado desde los
    // undo/redo de color para que la paleta refleje el swatch activo.
    _syncWirePanelIfCurrent(wire) {

        if (this.currentWireId === wire.id) {
            this._renderWire(wire);
        }

    }




    _appendColorField(component) {


        const SWATCHES = [

            { label: "Rojo",     color: "#e60000" },

            { label: "Verde",    color: "#00cc44" },

            { label: "Azul",     color: "#1a6fff" },

            { label: "Amarillo", color: "#ffcc00" },

            { label: "Blanco",   color: "#ffffff" },

            { label: "Naranja",  color: "#ff6600" },

        ];


        const wrap = document.createElement("div");

        wrap.className = "property-field";


        const lbl = document.createElement("label");

        lbl.textContent = "Color";


        const palette = document.createElement("div");

        palette.className = "led-palette";


        SWATCHES.forEach(sw => {

            const btn = document.createElement("button");

            btn.className = "led-swatch";

            btn.title     = sw.label;

            btn.style.background = sw.color;

            btn.addEventListener("click", () => {

                palette.querySelectorAll(".led-swatch").forEach(b => b.classList.remove("active"));

                btn.classList.add("active");

                component.properties = component.properties || {};

                component.properties.color = sw.color;

                this.simulator.renderer.recolor(component, sw.color);

                if (Renderer.isLed(component.type)) {

                    this.simulator.renderer.applyLedColor(

                        component,

                        component.element?.classList.contains("led-on") || false

                    );

                }

            });

            palette.appendChild(btn);

        });


        // Selector de color personalizado

        const customPicker = document.createElement("input");

        customPicker.type  = "color";

        customPicker.className = "led-swatch-custom";

        customPicker.title = "Color personalizado";

        customPicker.addEventListener("input", () => {

            palette.querySelectorAll(".led-swatch").forEach(b => b.classList.remove("active"));

            component.properties = component.properties || {};

            component.properties.color = customPicker.value;

            this.simulator.renderer.recolor(component, customPicker.value);

            if (Renderer.isLed(component.type)) {

                this.simulator.renderer.applyLedColor(

                    component,

                    component.element?.classList.contains("led-on") || false

                );

            }

        });

        palette.appendChild(customPicker);


        wrap.appendChild(lbl);

        wrap.appendChild(palette);

        this.content.appendChild(wrap);


    }


}