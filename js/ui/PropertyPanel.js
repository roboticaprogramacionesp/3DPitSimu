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

        // Primero consultamos el registro (ver ComponentBehaviorRegistry.js)
        // -- si component.type ya migró ahí, su propertyPanel.render()
        // reemplaza TODA la cadena legacy de abajo. Si no tiene behavior
        // registrado (la mayoría de los tipos, todavía), seguimos con el
        // if/else de siempre sin ningún cambio de comportamiento.
        const behavior = ComponentBehaviorRegistry.get(component.type);
        if (behavior?.propertyPanel?.render) {
            behavior.propertyPanel.render(component, this);
            return;
        }

        // Despachar al renderer correcto según el tipo
        const tempSensors = ["ky_001", "dht11"];

        if (tempSensors.includes(component.type)) {
            this._renderTempSensor(component);
        } else if (component.type === "hcsr04") {
            this._renderUltrasonicSensor(component);
        } else if (component.type === "sg90") {
            this._renderServo(component);
        } else if (component.type === "l298n") {
            this._renderL298n(component);
        } else if (component.type === "display7") {
            this._renderDisplay7(component);
        } else if (component.type === "oled") {
            this._renderOled(component);
        } else if (component.type === "lcd16x2" || component.type === "lcd_16x2_i2c") {
            this._renderLcd(component);
        } else if (component.type === "neopixel_matrix") {
            this._renderNeopixelMatrix(component);
        } else if (component.type === "max7219") {
            this._renderMax7219(component);
        } else if (component.type === "tft_st7789") {
            this._renderTft(component);
        } else if (component.type === "mpu6050") {
            this._renderMpu6050(component);
        } else if (component.type === "keypad4x4_i2c") {
            this._renderKeypadI2c(component);
        } else {
            this._renderGeneric(component);
        }

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


    _renderTempSensor(component) {

        const celsius  = this.simulator.signalEngine.getTemperature(component.id);
        const humidity = this.simulator.signalEngine.getHumidity?.(component.id) ?? 50.0;
        const isDHT    = component.type === "dht11";

        this.content.innerHTML = "";

        // ── Título ──────────────────────────────────────────────────────
        const title = document.createElement("div");
        title.style.cssText = `
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1px;
            text-transform: uppercase;
            color: #4da3ff;
            margin-bottom: 14px;
            padding-bottom: 8px;
            border-bottom: 1px solid #333;
        `;
        title.textContent = isDHT
            ? "DHT11 — Temperatura y Humedad"
            : "Dallas DS18B20 — Sensor de temperatura";
        this.content.appendChild(title);


        // ── Barra de temperatura ─────────────────────────────────────────

        const barWrap = document.createElement("div");

        barWrap.style.cssText = "margin-bottom: 16px;";


        const barLabel = document.createElement("label");

        barLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";

        barLabel.textContent = "Temperatura simulada";


        // Display numérico grande

        const tempDisplay = document.createElement("div");

        tempDisplay.id = `tempDisplay_${component.id}`;

        tempDisplay.style.cssText = `

            font-size: 36px;

            font-weight: 700;

            color: ${this._tempToColor(celsius)};

            text-align: center;

            margin: 8px 0;

            font-variant-numeric: tabular-nums;

            transition: color 0.3s;

        `;

        tempDisplay.textContent = `${celsius.toFixed(1)}°C`;


        // Barra visual tipo termómetro

        const barTrack = document.createElement("div");

        barTrack.style.cssText = `

            width: 100%;

            height: 12px;

            background: linear-gradient(to right, #4da3ff, #2ecc71, #f2c94c, #ff5252);

            border-radius: 6px;

            margin: 8px 0;

            position: relative;

        `;


        const barCursor = document.createElement("div");

        barCursor.id = `tempCursor_${component.id}`;

        const pct = this._celsiusToPct(celsius);

        barCursor.style.cssText = `

            position: absolute;

            top: -4px;

            left: ${pct}%;

            transform: translateX(-50%);

            width: 20px;

            height: 20px;

            background: #fff;

            border: 3px solid ${this._tempToColor(celsius)};

            border-radius: 50%;

            transition: left 0.15s, border-color 0.3s;

        `;

        barTrack.appendChild(barCursor);


        // Etiquetas min/max

        const barMinMax = document.createElement("div");

        barMinMax.style.cssText = "display:flex; justify-content:space-between; font-size:11px; color:#666; margin-top:2px;";

        barMinMax.innerHTML = "<span>−55°C</span><span>+125°C</span>";


        // Slider real (invisible, encima de la barra para interacción)

        const slider = document.createElement("input");

        slider.type  = "range";

        slider.min   = "-55";

        slider.max   = "125";

        slider.step  = "0.5";

        slider.value = celsius;

        slider.style.cssText = `

            width: 100%;

            margin-top: 6px;

            accent-color: #4da3ff;

            cursor: pointer;

        `;


        slider.addEventListener("input", () => {

            const val = parseFloat(slider.value);

            this._updateTempDisplay(val);

            this.simulator.signalEngine.setTemperature(component.id, val);

        });


        barWrap.appendChild(barLabel);

        barWrap.appendChild(tempDisplay);

        barWrap.appendChild(barTrack);

        barWrap.appendChild(barMinMax);

        barWrap.appendChild(slider);


        this.content.appendChild(barWrap);


        // ── Humedad (solo DHT11) o Device Address (KY-001) ───────────────
        if (isDHT) {

            const humWrap = document.createElement("div");
            humWrap.style.cssText = "margin-bottom: 16px;";

            const humLabel = document.createElement("label");
            humLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
            humLabel.textContent = "Humedad simulada";

            const humDisplay = document.createElement("div");
            humDisplay.id = `humDisplay_${component.id}`;
            humDisplay.style.cssText = `
                font-size: 36px;
                font-weight: 700;
                color: #4da3ff;
                text-align: center;
                margin: 8px 0;
                font-variant-numeric: tabular-nums;
            `;
            humDisplay.textContent = `${humidity.toFixed(0)}%`;

            const humTrack = document.createElement("div");
            humTrack.style.cssText = `
                width: 100%;
                height: 12px;
                background: linear-gradient(to right, #e6f3ff, #4da3ff, #0040aa);
                border-radius: 6px;
                margin: 8px 0;
                position: relative;
            `;

            const humCursor = document.createElement("div");
            humCursor.id = `humCursor_${component.id}`;
            const humPct = humidity;
            humCursor.style.cssText = `
                position: absolute;
                top: -4px;
                left: ${humPct}%;
                transform: translateX(-50%);
                width: 20px;
                height: 20px;
                background: #fff;
                border: 3px solid #4da3ff;
                border-radius: 50%;
                transition: left 0.15s;
            `;
            humTrack.appendChild(humCursor);

            const humMinMax = document.createElement("div");
            humMinMax.style.cssText = "display:flex; justify-content:space-between; font-size:11px; color:#666; margin-top:2px;";
            humMinMax.innerHTML = "<span>0%</span><span>100%</span>";

            const humSlider = document.createElement("input");
            humSlider.type  = "range";
            humSlider.min   = "0";
            humSlider.max   = "100";
            humSlider.step  = "1";
            humSlider.value = humidity;
            humSlider.style.cssText = "width:100%; margin-top:6px; accent-color:#4da3ff; cursor:pointer;";

            humSlider.addEventListener("input", () => {
                const val = parseFloat(humSlider.value);
                this._updateHumidityDisplay(val);
                this.simulator.signalEngine.setHumidity(component.id, val);
            });

            humWrap.appendChild(humLabel);
            humWrap.appendChild(humDisplay);
            humWrap.appendChild(humTrack);
            humWrap.appendChild(humMinMax);
            humWrap.appendChild(humSlider);
            this.content.appendChild(humWrap);

        } else {

            // KY-001: mostrar dirección OneWire
            const addrWrap = document.createElement("div");
            addrWrap.style.cssText = "margin-bottom: 16px;";

            const addrLabel = document.createElement("label");
            addrLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:4px; letter-spacing:.03em;";
            addrLabel.textContent = "Device Address";

            const addrValue = document.createElement("div");
            addrValue.style.cssText = "font-size:13px; color:#4da3ff; font-family:monospace; letter-spacing:1px;";
            addrValue.textContent = component.properties?.address || "28 01 02 03 04 05 06 (default)";

            addrWrap.appendChild(addrLabel);
            addrWrap.appendChild(addrValue);
            this.content.appendChild(addrWrap);

        }


        // ── Separador ────────────────────────────────────────────────────

        const sep = document.createElement("div");

        sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";

        this.content.appendChild(sep);


        // ── Propiedades genéricas (Nombre, X, Y, Rotación, Espejo, Pines, …) ──

        this._renderCommonProperties(component);


    }


    // ── Actualizar solo el display numérico y el cursor ──────────────────

    _updateTempDisplay(celsius) {


        const display = document.getElementById(`tempDisplay_${this.current?.id}`);

        const cursor  = document.getElementById(`tempCursor_${this.current?.id}`);


        if (display) {

            display.textContent   = `${celsius.toFixed(1)}°C`;

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


    _renderUltrasonicSensor(component) {

        this.content.innerHTML = "";

        const cm = this.simulator.signalEngine.getDistance(component.id);


        // ── Título ────────────────────────────────────────────────────────

        const title = document.createElement("h4");
        title.style.cssText = "margin-bottom: 12px; color: #fff;";
        title.textContent = "HC-SR04 — Sensor ultrasónico";
        this.content.appendChild(title);


        // ── Distancia simulada ───────────────────────────────────────────

        const distWrap = document.createElement("div");
        distWrap.style.cssText = "margin-bottom: 16px;";

        const distLabel = document.createElement("label");
        distLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
        distLabel.textContent = "Distancia simulada";

        const distDisplay = document.createElement("div");
        distDisplay.id = `distDisplay_${component.id}`;
        distDisplay.style.cssText = `
            font-size: 36px;
            font-weight: 700;
            color: ${this._distToColor(cm)};
            text-align: center;
            margin: 8px 0;
            font-variant-numeric: tabular-nums;
        `;
        distDisplay.textContent = `${cm.toFixed(1)} cm`;

        const distTrack = document.createElement("div");
        distTrack.style.cssText = `
            width: 100%;
            height: 12px;
            background: linear-gradient(to right, #ff5252, #f2c94c, #2ecc71, #4da3ff);
            border-radius: 6px;
            margin: 8px 0;
            position: relative;
        `;

        const distCursor = document.createElement("div");
        distCursor.id = `distCursor_${component.id}`;
        distCursor.style.cssText = `
            position: absolute;
            top: -4px;
            left: ${this._distToPct(cm)}%;
            transform: translateX(-50%);
            width: 20px;
            height: 20px;
            background: #fff;
            border: 3px solid ${this._distToColor(cm)};
            border-radius: 50%;
            transition: left 0.15s;
        `;
        distTrack.appendChild(distCursor);

        const distMinMax = document.createElement("div");
        distMinMax.style.cssText = "display:flex; justify-content:space-between; font-size:11px; color:#666; margin-top:2px;";
        distMinMax.innerHTML = "<span>2 cm</span><span>400 cm</span>";

        const distSlider = document.createElement("input");
        distSlider.type  = "range";
        distSlider.min   = "2";
        distSlider.max   = "400";
        distSlider.step  = "0.5";
        distSlider.value = cm;
        distSlider.style.cssText = "width:100%; margin-top:6px; accent-color:#4da3ff; cursor:pointer;";

        distSlider.addEventListener("input", () => {
            const val = parseFloat(distSlider.value);
            this._updateDistanceDisplay(val);
            this.simulator.signalEngine.setDistance(component.id, val);
        });

        distWrap.appendChild(distLabel);
        distWrap.appendChild(distDisplay);
        distWrap.appendChild(distTrack);
        distWrap.appendChild(distMinMax);
        distWrap.appendChild(distSlider);
        this.content.appendChild(distWrap);


        // ── Separador ────────────────────────────────────────────────────

        const sep = document.createElement("div");
        sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
        this.content.appendChild(sep);


        // ── Propiedades genéricas (Nombre, X, Y, Rotación, Espejo, Pines, …) ──

        this._renderCommonProperties(component);

    }


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


    _renderServo(component) {

        this.content.innerHTML = "";

        const angle = component.properties?.angle ?? this.simulator.signalEngine.getServoAngle(component.id);


        // ── Título ────────────────────────────────────────────────────────

        const title = document.createElement("h4");
        title.style.cssText = "margin-bottom: 12px; color: #fff;";
        title.textContent = "Servo SG90";
        this.content.appendChild(title);


        // ── Ángulo del eje ───────────────────────────────────────────────

        const angleWrap = document.createElement("div");
        angleWrap.style.cssText = "margin-bottom: 16px;";

        const angleLabel = document.createElement("label");
        angleLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
        angleLabel.textContent = "Ángulo del eje";

        const angleDisplay = document.createElement("div");
        angleDisplay.id = `servoDisplay_${component.id}`;
        angleDisplay.style.cssText = `
            font-size: 36px;
            font-weight: 700;
            color: #4da3ff;
            text-align: center;
            margin: 8px 0;
            font-variant-numeric: tabular-nums;
        `;
        angleDisplay.textContent = `${Math.round(angle)}°`;

        const angleTrack = document.createElement("div");
        angleTrack.style.cssText = `
            width: 100%;
            height: 12px;
            background: linear-gradient(to right, #ff5252, #f2c94c, #2ecc71, #4da3ff);
            border-radius: 6px;
            margin: 8px 0;
            position: relative;
        `;

        const angleCursor = document.createElement("div");
        angleCursor.id = `servoCursor_${component.id}`;
        angleCursor.style.cssText = `
            position: absolute;
            top: -4px;
            left: ${this._angleToPct(angle)}%;
            transform: translateX(-50%);
            width: 20px;
            height: 20px;
            background: #fff;
            border: 3px solid #4da3ff;
            border-radius: 50%;
            transition: left 0.15s;
        `;
        angleTrack.appendChild(angleCursor);

        const angleMinMax = document.createElement("div");
        angleMinMax.style.cssText = "display:flex; justify-content:space-between; font-size:11px; color:#666; margin-top:2px;";
        angleMinMax.innerHTML = "<span>0°</span><span>180°</span>";

        const angleSlider = document.createElement("input");
        angleSlider.type  = "range";
        angleSlider.min   = "0";
        angleSlider.max   = "180";
        angleSlider.step  = "1";
        angleSlider.value = angle;
        angleSlider.style.cssText = "width:100%; margin-top:6px; accent-color:#4da3ff; cursor:pointer;";

        angleSlider.addEventListener("input", () => {
            const val = parseFloat(angleSlider.value);
            this._updateServoDisplay(val);
            this.simulator.signalEngine.setServoAngle(component.id, val);
        });

        angleWrap.appendChild(angleLabel);
        angleWrap.appendChild(angleDisplay);
        angleWrap.appendChild(angleTrack);
        angleWrap.appendChild(angleMinMax);
        angleWrap.appendChild(angleSlider);
        this.content.appendChild(angleWrap);


        // ── Separador ────────────────────────────────────────────────────

        const sep = document.createElement("div");
        sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
        this.content.appendChild(sep);


        // ── Propiedades genéricas (Nombre, X, Y, Rotación, Espejo, Pines, …) ──

        this._renderCommonProperties(component);

    }


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


    _renderL298n(component) {

        this.content.innerHTML = "";

        component.properties = component.properties || {};

        const { motorA, motorB } = this.simulator.signalEngine.getL298nState(component);


        // ── Título ────────────────────────────────────────────────────────

        const title = document.createElement("h4");
        title.style.cssText = "margin-bottom: 12px; color: #fff;";
        title.textContent = "L298N — Puente H";
        this.content.appendChild(title);


        // ── Motor A ──────────────────────────────────────────────────────

        this._appendL298nMotorBlock(component, "A", motorA, "jumperEnaInstalled");


        // ── Motor B ──────────────────────────────────────────────────────

        this._appendL298nMotorBlock(component, "B", motorB, "jumperEnbInstalled");


        // ── Separador ────────────────────────────────────────────────────

        const sep = document.createElement("div");
        sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
        this.content.appendChild(sep);


        // ── Propiedades genéricas (Nombre, X, Y, Rotación, Espejo, Pines, …) ──

        this._renderCommonProperties(component);

    }


    // ── Bloque de estado + jumper para un motor (A o B) del L298N ────────

    _appendL298nMotorBlock(component, label, motorState, jumperProp) {

        const wrap = document.createElement("div");
        wrap.style.cssText = "margin-bottom: 16px; background:#1e1f22; border:1px solid #333; border-radius:8px; padding:12px;";

        const title = document.createElement("div");
        title.style.cssText = "font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
        title.textContent = `Motor ${label}`;
        wrap.appendChild(title);

        const badge = document.createElement("div");
        badge.id = `l298nState_${label}_${component.id}`;
        badge.style.cssText = `
            font-size: 20px;
            font-weight: 700;
            text-align: center;
            padding: 8px;
            border-radius: 6px;
            margin-bottom: 10px;
            color: #fff;
            background: ${this._l298nStateColor(motorState.state)};
        `;
        badge.textContent = this._l298nStateLabel(motorState.state);
        wrap.appendChild(badge);

        const jumperRow = document.createElement("label");
        jumperRow.style.cssText = "display:flex; align-items:center; gap:8px; font-size:13px; color:#ccc; cursor:pointer;";

        const jumperCheckbox = document.createElement("input");
        jumperCheckbox.type    = "checkbox";
        jumperCheckbox.checked = component.properties?.[jumperProp] !== false;

        jumperCheckbox.addEventListener("change", () => {
            component.properties = component.properties || {};
            component.properties[jumperProp] = jumperCheckbox.checked;
            this.simulator.signalEngine.evaluateL298n(component);
        });

        const jumperText = document.createElement("span");
        jumperText.textContent = `Jumper EN${label} instalado (habilitado a máx. velocidad)`;

        jumperRow.appendChild(jumperCheckbox);
        jumperRow.appendChild(jumperText);
        wrap.appendChild(jumperRow);

        this.content.appendChild(wrap);

    }


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


    // ====================================================

    // Panel especial: Display 7 Segmentos

    // ====================================================


    _renderDisplay7(component) {

        this.content.innerHTML = "";

        component.properties = component.properties || {};
        if (!component.properties.commonType) component.properties.commonType = "cathode";

        const title = document.createElement("h4");
        title.style.cssText = "margin-bottom: 12px; color: #fff;";
        title.textContent = "Display 7 Segmentos";
        this.content.appendChild(title);

        // ── Nota sobre la aproximación visual ───────────────────────────

        const warn = document.createElement("div");
        warn.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5; background:#1e1f22; border:1px solid #333; border-radius:6px; padding:8px 10px;";
        warn.textContent = "El SVG no separa los 7 segmentos, así que el brillo del dígito completo representa cuántos segmentos deberían estar encendidos. El punto decimal sí se prende y apaga de forma real.";
        this.content.appendChild(warn);

        // ── Tipo de común ────────────────────────────────────────────────

        const label = document.createElement("label");
        label.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
        label.textContent = "Tipo de común";
        this.content.appendChild(label);

        const group = document.createElement("div");
        group.style.cssText = "display:flex; gap:8px; margin-bottom:8px;";

        const makeBtn = (value, text) => {

            const btn = document.createElement("button");
            btn.className = "property-flip-btn";
            btn.style.flex = "1";
            btn.textContent = text;
            if (component.properties.commonType === value) btn.classList.add("active");

            btn.addEventListener("click", () => {
                if (component.properties.commonType === value) return;
                component.properties.commonType = value;
                this.simulator.signalEngine.evaluateDisplay7(component);
                this._renderDisplay7(component); // re-pintar para reflejar el botón activo
            });

            return btn;

        };

        group.appendChild(makeBtn("cathode", "Cátodo común"));
        group.appendChild(makeBtn("anode",  "Ánodo común"));
        this.content.appendChild(group);

        const note = document.createElement("div");
        note.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;";
        note.textContent = component.properties.commonType === "cathode"
            ? "COM va a GND. Cada segmento se enciende con HIGH."
            : "COM va a VCC/3V3. Cada segmento se enciende con LOW.";
        this.content.appendChild(note);

        // ── Separador ────────────────────────────────────────────────────

        const sep = document.createElement("div");
        sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
        this.content.appendChild(sep);

        // ── Propiedades genéricas (Nombre, X, Y, Rotación, Espejo, Pines, …) ──

        this._renderCommonProperties(component);

    }


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


    _renderKeypadI2c(component) {

        this.content.innerHTML = "";
        component.properties = component.properties || {};

        const title = document.createElement("h4");
        title.style.cssText = "margin-bottom: 12px; color: #fff;";
        title.textContent = "Teclado Matricial 4x4 (I2C)";
        this.content.appendChild(title);

        // A diferencia de OLED/LCD, ACÁ este campo sí es funcional:
        // evaluateKeypadI2c() en SignalEngine.js lee
        // component.properties.address en cada evaluación -- cambiar
        // este valor cambia de verdad a qué dirección responde el
        // simulador (0x20 = default del PCF8574 si no se especifica
        // nada distinto al construir Keypad4x4_I2C(...) en Python).
        this._appendEditableField("Dirección I2C", component.properties.address ?? "0x20", (val) => {
            component.properties.address = val;
            this.simulator.signalEngine.evaluateAll();
        });

        const note = document.createElement("div");
        note.style.cssText = "font-size:12px; color:#888; margin: 8px 0 16px; line-height:1.5;";
        note.textContent = "Tiene que coincidir con la dirección que le pasás al construir Keypad4x4_I2C(...) en tu código MicroPython.";
        this.content.appendChild(note);

        const sep = document.createElement("div");
        sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
        this.content.appendChild(sep);

        this._renderCommonProperties(component);

    }


    // ====================================================

    // Panel especial: OLED I2C (SSD1306) — color de pantalla

    // ====================================================


    _renderOled(component) {

        this.content.innerHTML = "";

        component.properties = component.properties || {};
        if (!component.properties.colorScheme) component.properties.colorScheme = "blue";

        const title = document.createElement("h4");
        title.style.cssText = "margin-bottom: 12px; color: #fff;";
        title.textContent = "OLED I2C";
        this.content.appendChild(title);

        const label = document.createElement("label");
        label.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
        label.textContent = "Color de pantalla";
        this.content.appendChild(label);

        // Mismo patrón que _renderDisplay7: un pequeño swatch de
        // color adentro de cada botón para que se distingan de un
        // vistazo, sin depender solo del texto.
        const schemes = [
            { value: "blue",        text: "Azul",           swatch: "rgb(127,217,255)" },
            { value: "white",       text: "Blanca",         swatch: "rgb(235,235,235)" },
            { value: "yellow",      text: "Amarilla",       swatch: "rgb(255,209,64)" },
            { value: "blue_yellow", text: "Azul + Amarilla", swatch: "linear-gradient(to bottom, rgb(255,209,64) 0%, rgb(255,209,64) 25%, rgb(127,217,255) 25%, rgb(127,217,255) 100%)" },
        ];

        const group = document.createElement("div");
        group.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:16px;";

        schemes.forEach(({ value, text, swatch }) => {

            const btn = document.createElement("button");
            btn.className = "property-flip-btn";
            btn.style.cssText = "display:flex; align-items:center; gap:8px; justify-content:flex-start; padding:8px 10px;";
            if (component.properties.colorScheme === value) btn.classList.add("active");

            const dot = document.createElement("span");
            dot.style.cssText = `width:14px; height:14px; border-radius:50%; flex:none; background:${swatch}; border:1px solid rgba(255,255,255,0.25);`;
            btn.appendChild(dot);

            const span = document.createElement("span");
            span.textContent = text;
            btn.appendChild(span);

            btn.addEventListener("click", () => {

                if (component.properties.colorScheme === value) return;
                component.properties.colorScheme = value;

                // No tenemos guardado el último framebuffer acá, así
                // que no podemos "repintar" el contenido -- limpiamos
                // con el nuevo color de fondo (el próximo dibujo del
                // firmware ya sale con el esquema nuevo) en vez de
                // dejar la pantalla con los colores viejos hasta el
                // próximo oled.show().
                this.simulator.renderer.clearOledScreen(component);

                this._renderOled(component); // re-pintar para reflejar el botón activo

            });

            group.appendChild(btn);

        });

        this.content.appendChild(group);

        const note = document.createElement("div");
        note.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;";
        note.textContent = "\"Azul + Amarilla\" imita las pantallas SSD1306 físicas de dos colores: la franja de arriba sale amarilla y el resto celeste, sin importar qué dibuje el firmware ahí.";
        this.content.appendChild(note);

        const sep = document.createElement("div");
        sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
        this.content.appendChild(sep);

        // OJO: a diferencia del teclado I2C, este campo es solo de
        // REFERENCIA -- SignalEngine.js asume un único OLED en el
        // canvas y lo busca por tipo, no por dirección (ver
        // applyOledFramebuffer). Cambiarlo acá no cambia a qué
        // responde el simulador; sirve para anotar qué dirección le
        // pasás vos al construir tu objeto SSD1306 en Python.
        this._appendEditableField("Dirección I2C", component.properties.i2cAddress ?? "0x3C", (val) => {
            component.properties.i2cAddress = val;
        });

        this._renderCommonProperties(component);

    }


    // ====================================================

    // Panel especial: LCD 16x2 (con o sin backpack I2C) — color

    // ====================================================


    _renderLcd(component) {

        this.content.innerHTML = "";

        component.properties = component.properties || {};
        if (!component.properties.colorScheme) component.properties.colorScheme = "yellow_green";

        const title = document.createElement("h4");
        title.style.cssText = "margin-bottom: 12px; color: #fff;";
        title.textContent = component.type === "lcd_16x2_i2c" ? "LCD 16x2 I2C" : "LCD 16x2";
        this.content.appendChild(title);

        const label = document.createElement("label");
        label.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
        label.textContent = "Color de pantalla";
        this.content.appendChild(label);

        const schemes = [
            { value: "yellow_green", text: "Verde / amarilla", swatch: "rgb(135,173,52)" },
            { value: "blue",         text: "Azul",              swatch: "rgb(43,78,168)" },
        ];

        const group = document.createElement("div");
        group.style.cssText = "display:flex; flex-direction:column; gap:8px; margin-bottom:16px;";

        schemes.forEach(({ value, text, swatch }) => {

            const btn = document.createElement("button");
            btn.className = "property-flip-btn";
            btn.style.cssText = "display:flex; align-items:center; gap:8px; justify-content:flex-start; padding:8px 10px;";
            if (component.properties.colorScheme === value) btn.classList.add("active");

            const dot = document.createElement("span");
            dot.style.cssText = `width:14px; height:14px; border-radius:3px; flex:none; background:${swatch}; border:1px solid rgba(255,255,255,0.25);`;
            btn.appendChild(dot);

            const span = document.createElement("span");
            span.textContent = text;
            btn.appendChild(span);

            btn.addEventListener("click", () => {

                if (component.properties.colorScheme === value) return;
                component.properties.colorScheme = value;

                this.simulator.renderer.applyLcdColorScheme(component);

                this._renderLcd(component); // re-pintar para reflejar el botón activo

            });

            group.appendChild(btn);

        });

        this.content.appendChild(group);

        const note = document.createElement("div");
        note.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;";
        note.textContent = "Este LCD todavía no muestra el texto real que manda el firmware (eso falta implementar, igual que el framebuffer del OLED) -- por ahora el color es solo estético.";
        this.content.appendChild(note);

        const sep = document.createElement("div");
        sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
        this.content.appendChild(sep);

        // Mismo criterio que el OLED: campo de REFERENCIA, no
        // funcional -- SignalEngine.js asume un único LCD I2C en el
        // canvas (busca por tipo, no por dirección). Solo aparece
        // para la variante I2C -- la paralela (lcd16x2) no tiene
        // dirección de ningún tipo.
        if (component.type === "lcd_16x2_i2c") {
            this._appendEditableField("Dirección I2C", component.properties.i2cAddress ?? "0x27", (val) => {
                component.properties.i2cAddress = val;
            });
        }

        this._renderCommonProperties(component);

    }


    // ====================================================

    // Panel especial: TFT ST7789 SPI (240x240, color real)

    // ====================================================


    _renderTft(component) {

        this.content.innerHTML = "";

        const title = document.createElement("h4");
        title.style.cssText = "margin-bottom: 12px; color: #fff;";
        title.textContent = "TFT 1.54\" 240x240 (ST7789)";
        this.content.appendChild(title);

        const note = document.createElement("div");
        note.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;";
        note.textContent = "A diferencia del OLED/LCD, esta pantalla se actualiza en vivo, región por región, en cada primitiva de dibujo (pixel, línea, rect, etc.) -- no hace falta llamar a ningún show(). No tiene esquema de color elegible: el firmware manda el color real (RGB565) de cada pixel.";
        this.content.appendChild(note);

        const btnClear = document.createElement("button");
        btnClear.className = "property-flip-btn";
        btnClear.style.cssText = "width:100%; margin-bottom:16px;";
        btnClear.textContent = "Poner pantalla en negro";
        btnClear.addEventListener("click", () => {
            this.simulator.renderer.clearTftScreen(component);
        });
        this.content.appendChild(btnClear);

        const sep = document.createElement("div");
        sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
        this.content.appendChild(sep);

        this._renderCommonProperties(component);

    }


    // ====================================================

    // Panel especial: MPU6050 (acelerómetro + giroscopio + temp)

    // ====================================================


    _renderMpu6050(component) {

        if (!component.properties) component.properties = {};
        const p = component.properties;
        if (p.accelX === undefined) p.accelX = 0.0;
        if (p.accelY === undefined) p.accelY = 0.0;
        if (p.accelZ === undefined) p.accelZ = 1.0;
        if (p.gyroX === undefined) p.gyroX = 0.0;
        if (p.gyroY === undefined) p.gyroY = 0.0;
        if (p.gyroZ === undefined) p.gyroZ = 0.0;
        if (p.temperature === undefined) p.temperature = 24.0;

        this.content.innerHTML = "";

        const title = document.createElement("h4");
        title.style.cssText = "margin-bottom: 12px; color: #fff;";
        title.textContent = "MPU6050 Acelerómetro + Giroscopio";
        this.content.appendChild(title);

        // ── Sección ACELERACIÓN (X/Y/Z en "g") ──────────────────
        this.content.appendChild(this._mpuSectionHeader("〰", "ACELERACIÓN"));
        const accelRow = document.createElement("div");
        accelRow.style.cssText = "margin-bottom: 16px;";
        accelRow.appendChild(this._makeMpuSlider(component, "accelX", "X:", "g", -2, 2, 0.01, 2));
        accelRow.appendChild(this._makeMpuSlider(component, "accelY", "Y:", "g", -2, 2, 0.01, 2));
        accelRow.appendChild(this._makeMpuSlider(component, "accelZ", "Z:", "g", -2, 2, 0.01, 2));
        this.content.appendChild(accelRow);

        // ── Sección ROTACIÓN (X/Y/Z en "°/sec") ─────────────────
        this.content.appendChild(this._mpuSectionHeader("↻", "ROTACIÓN"));
        const gyroRow = document.createElement("div");
        gyroRow.style.cssText = "margin-bottom: 16px;";
        gyroRow.appendChild(this._makeMpuSlider(component, "gyroX", "X:", "°/sec", -250, 250, 1, 0));
        gyroRow.appendChild(this._makeMpuSlider(component, "gyroY", "Y:", "°/sec", -250, 250, 1, 0));
        gyroRow.appendChild(this._makeMpuSlider(component, "gyroZ", "Z:", "°/sec", -250, 250, 1, 0));
        this.content.appendChild(gyroRow);

        // ── Sección TEMPERATURA ──────────────────────────────────
        this.content.appendChild(this._mpuSectionHeader("🌡", "TEMPERATURA"));
        const tempRow = document.createElement("div");
        tempRow.style.cssText = "margin-bottom: 16px;";
        tempRow.appendChild(this._makeMpuSlider(component, "temperature", "", "°C", -40, 85, 0.5, 1));
        this.content.appendChild(tempRow);

        const sep = document.createElement("div");
        sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
        this.content.appendChild(sep);

        // Dirección I2C -- mismo patrón que lcd_16x2_i2c.json
        this._appendEditableField("Dirección I2C", p.i2cAddress ?? "0x68", (val) => {
            p.i2cAddress = val;
            this.simulator.signalEngine._notifyMpuToFirmware(component);
        });

        this._renderCommonProperties(component);

    }

    // Encabezado de sección chico (ícono + texto), igual estilo en
    // las 3 secciones del MPU6050 -- separado en su propio helper
    // para no repetir el mismo cssText tres veces.
    _mpuSectionHeader(icon, text) {
        const header = document.createElement("div");
        header.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.5px;
            color: #ccc;
            margin: 14px 0 8px;
        `;
        header.innerHTML = `<span style="font-size:14px;">${icon}</span><span>${text}</span>`;
        return header;
    }

    // Una fila "label: [======slider======] valor unidad" -- usada
    // por las 7 variables del MPU6050. Actualiza component.properties
    // Y llama a signalEngine.setMpuAxis() en cada "input" (valores en
    // vivo mientras se arrastra, no solo al soltar).
    _makeMpuSlider(component, key, label, unit, min, max, step, decimals) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:8px;";

        if (label) {
            const lbl = document.createElement("span");
            lbl.style.cssText = "width:14px; font-size:12px; color:#999;";
            lbl.textContent = label;
            row.appendChild(lbl);
        }

        const slider = document.createElement("input");
        slider.type  = "range";
        slider.min   = String(min);
        slider.max   = String(max);
        slider.step  = String(step);
        slider.value = component.properties[key];
        slider.style.cssText = "flex:1; accent-color:#4da3ff; cursor:pointer;";

        const valueLabel = document.createElement("span");
        valueLabel.style.cssText = "min-width:64px; text-align:right; font-size:12px; color:#ddd; font-variant-numeric:tabular-nums;";
        valueLabel.textContent = `${Number(component.properties[key]).toFixed(decimals)} ${unit}`;

        slider.addEventListener("input", () => {
            const val = parseFloat(slider.value);
            valueLabel.textContent = `${val.toFixed(decimals)} ${unit}`;
            this.simulator.signalEngine.setMpuAxis(component.id, key, val);
        });

        row.appendChild(slider);
        row.appendChild(valueLabel);
        return row;
    }


    // ====================================================

    // Panel especial: Matriz de NeoPixel (WS2812) — rows/cols/shape

    // ====================================================


    _renderNeopixelMatrix(component) {

        this.content.innerHTML = "";

        component.properties = component.properties || {};
        if (!component.properties.cols)  component.properties.cols  = 8;
        if (!component.properties.rows)  component.properties.rows = 8;
        if (!component.properties.shape) component.properties.shape = "square";

        const title = document.createElement("h4");
        title.style.cssText = "margin-bottom: 12px; color: #fff;";
        title.textContent = "Matriz de NeoPixel";
        this.content.appendChild(title);

        // ── Rows / Cols ──────────────────────────────────────
        // Cambiar cualquiera de los dos rearma el bisel + el canvas
        // interno (Renderer.tagNeopixelElements) al vuelo -- mismo
        // mecanismo que ya usa drawNeopixelFrame() cuando el tamaño
        // que llega por "NEO:" no coincide con el actual.

        const label = document.createElement("label");
        label.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
        label.textContent = "Tamaño de la matriz";
        this.content.appendChild(label);

        const sizeRow = document.createElement("div");
        sizeRow.style.cssText = "display:flex; gap:8px; margin-bottom:16px;";

        const rebuildGrid = () => {
            const graphic = component.element?.querySelector(".component-graphic");
            if (graphic) this.simulator.renderer.tagNeopixelElements(component, graphic);
        };

        sizeRow.appendChild(this._makeNumberField("Columnas", component.properties.cols, (val) => {
            const cols = Math.max(1, Math.min(64, Math.round(val) || 1));
            component.properties.cols = cols;
            rebuildGrid();
        }));

        sizeRow.appendChild(this._makeNumberField("Filas", component.properties.rows, (val) => {
            const rows = Math.max(1, Math.min(64, Math.round(val) || 1));
            component.properties.rows = rows;
            rebuildGrid();
        }));

        this.content.appendChild(sizeRow);

        // ── Forma de cada LED ────────────────────────────────

        const shapeLabel = document.createElement("label");
        shapeLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
        shapeLabel.textContent = "Forma del LED";
        this.content.appendChild(shapeLabel);

        const shapes = [
            { value: "square", text: "Cuadrado" },
            { value: "circle", text: "Círculo" },
        ];

        const shapeGroup = document.createElement("div");
        shapeGroup.style.cssText = "display:flex; gap:8px; margin-bottom:16px;";

        shapes.forEach(({ value, text }) => {

            const btn = document.createElement("button");
            btn.className = "property-flip-btn";
            btn.style.cssText = "flex:1; padding:8px 10px;";
            if (component.properties.shape === value) btn.classList.add("active");
            btn.textContent = text;

            btn.addEventListener("click", () => {

                if (component.properties.shape === value) return;
                component.properties.shape = value;

                // Repintar con el último frame que tengamos (si el
                // firmware ya mandó algo) para que el cambio de forma
                // se note al toque, sin esperar al próximo .show().
                if (component.lastNeopixelFrame) {
                    const { rgbBytes, width, height } = component.lastNeopixelFrame;
                    this.simulator.renderer.drawNeopixelFrame(component, rgbBytes, width, height);
                } else {
                    this.simulator.renderer.clearNeopixelGrid(component);
                }

                this._renderNeopixelMatrix(component); // re-pintar para reflejar el botón activo

            });

            shapeGroup.appendChild(btn);

        });

        this.content.appendChild(shapeGroup);

        const note = document.createElement("div");
        note.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;";
        note.textContent = "El tamaño real de la matriz lo define tu código MicroPython (NeoMatrix(pin, width, height, ...)) -- estos valores son solo para que el panel se vea igual mientras probás. Si el firmware manda un frame de otro tamaño, el panel se reacomoda solo.";
        this.content.appendChild(note);

        const sep = document.createElement("div");
        sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
        this.content.appendChild(sep);

        this._renderCommonProperties(component);

    }


    // ====================================================

    // Panel especial: Matriz MAX7219 — rows/cols/shape/color

    // ====================================================


    _renderMax7219(component) {

        this.content.innerHTML = "";

        component.properties = component.properties || {};
        if (!component.properties.cols)  component.properties.cols  = 8;
        if (!component.properties.rows)  component.properties.rows = 8;
        if (!component.properties.shape) component.properties.shape = "circle";
        if (!component.properties.color) component.properties.color = "#ff2222";

        const title = document.createElement("h4");
        title.style.cssText = "margin-bottom: 12px; color: #fff;";
        title.textContent = "Matriz MAX7219";
        this.content.appendChild(title);

        // ── Tamaño de la matriz ──────────────────────────────
        // Los MAX7219 se venden como módulos de 8x8 que se
        // encadenan -- por eso, a diferencia del NeoPixel (cualquier
        // rows x cols), acá el tamaño se elige entre los presets
        // reales más comunes en vez de un campo numérico libre.
        // Cambiar el preset rearma el bisel + el canvas interno al
        // vuelo (Renderer.tagMax7219Elements).

        const label = document.createElement("label");
        label.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
        label.textContent = "Tamaño de la matriz";
        this.content.appendChild(label);

        const rebuildGrid = () => {
            const graphic = component.element?.querySelector(".component-graphic");
            if (graphic) this.simulator.renderer.tagMax7219Elements(component, graphic);
        };

        // Los módulos MAX7219 reales se encadenan en HORIZONTAL (4
        // módulos de 8x8 uno al lado del otro = 32 columnas x 8 filas
        // de alto, no al revés) -- por eso acá "cols" es el que crece
        // en los presets grandes y "rows" se mantiene fijo en 8. Antes
        // estaban invertidos (cols:8, rows:32), lo que armaba una tira
        // vertical angosta en vez de una franja horizontal ancha.
        const sizePresets = [
            { cols: 8,  rows: 8, text: "8 x 8"  },
            { cols: 16, rows: 8, text: "8 x 16" },
            { cols: 32, rows: 8, text: "8 x 32" },
        ];

        const sizeGroup = document.createElement("div");
        sizeGroup.style.cssText = "display:flex; gap:8px; margin-bottom:16px;";

        sizePresets.forEach(({ cols, rows, text }) => {

            const btn = document.createElement("button");
            btn.className = "property-flip-btn";
            btn.style.cssText = "flex:1; padding:8px 10px;";
            if (component.properties.cols === cols && component.properties.rows === rows) {
                btn.classList.add("active");
            }
            btn.textContent = text;

            btn.addEventListener("click", () => {

                if (component.properties.cols === cols && component.properties.rows === rows) return;
                component.properties.cols = cols;
                component.properties.rows = rows;

                rebuildGrid();

                this._renderMax7219(component); // re-pintar para reflejar el botón activo

            });

            sizeGroup.appendChild(btn);

        });

        this.content.appendChild(sizeGroup);

        // ── Forma de cada LED ────────────────────────────────

        const shapeLabel = document.createElement("label");
        shapeLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
        shapeLabel.textContent = "Forma del LED";
        this.content.appendChild(shapeLabel);

        const shapes = [
            { value: "circle", text: "Círculo"  },
            { value: "square", text: "Cuadrado" },
        ];

        const shapeGroup = document.createElement("div");
        shapeGroup.style.cssText = "display:flex; gap:8px; margin-bottom:16px;";

        const repaintCurrentFrame = () => {
            if (component.lastMax7219Frame) {
                const { bytes, width, height } = component.lastMax7219Frame;
                this.simulator.renderer.drawMax7219Framebuffer(component, bytes, width, height);
            } else {
                this.simulator.renderer.clearMax7219Grid(component);
            }
        };

        shapes.forEach(({ value, text }) => {

            const btn = document.createElement("button");
            btn.className = "property-flip-btn";
            btn.style.cssText = "flex:1; padding:8px 10px;";
            if (component.properties.shape === value) btn.classList.add("active");
            btn.textContent = text;

            btn.addEventListener("click", () => {

                if (component.properties.shape === value) return;
                component.properties.shape = value;

                repaintCurrentFrame();

                this._renderMax7219(component); // re-pintar para reflejar el botón activo

            });

            shapeGroup.appendChild(btn);

        });

        this.content.appendChild(shapeGroup);

        // ── Color del LED ────────────────────────────────────
        // Los MAX7219 reales son de un solo color (casi siempre
        // rojo) -- a diferencia del NeoPixel (RGB por LED real), acá
        // hay UN color para toda la matriz.

        const colorLabel = document.createElement("label");
        colorLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px;";
        colorLabel.textContent = "Color del LED";
        this.content.appendChild(colorLabel);

        const colors = [
            { value: "#ff2222", text: "Rojo"    },
            { value: "#00e676", text: "Verde"   },
            { value: "#2979ff", text: "Azul"    },
            { value: "#ffea00", text: "Amarillo"},
        ];

        const colorGroup = document.createElement("div");
        colorGroup.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:16px;";

        colors.forEach(({ value, text }) => {

            const btn = document.createElement("button");
            btn.className = "property-flip-btn";
            btn.style.cssText = "display:flex; align-items:center; gap:8px; justify-content:flex-start; padding:8px 10px;";
            if (component.properties.color === value) btn.classList.add("active");

            const dot = document.createElement("span");
            dot.style.cssText = `width:14px; height:14px; border-radius:50%; flex:none; background:${value}; border:1px solid rgba(255,255,255,0.25);`;
            btn.appendChild(dot);

            const span = document.createElement("span");
            span.textContent = text;
            btn.appendChild(span);

            btn.addEventListener("click", () => {

                if (component.properties.color === value) return;
                component.properties.color = value;

                repaintCurrentFrame();

                this._renderMax7219(component); // re-pintar para reflejar el botón activo

            });

            colorGroup.appendChild(btn);

        });

        this.content.appendChild(colorGroup);

        const note = document.createElement("div");
        note.style.cssText = "font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;";
        note.textContent = "El tamaño real de la matriz lo define tu código MicroPython (Max7219(width, height, spi, cs)) -- estos valores son solo para que el panel se vea igual mientras probás. Si el firmware manda un frame de otro tamaño, el panel se reacomoda solo.";
        this.content.appendChild(note);

        const sep2 = document.createElement("div");
        sep2.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
        this.content.appendChild(sep2);

        this._renderCommonProperties(component);

    }


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

            this.simulator.removeComponent(component.id);

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

        const endsBox = document.createElement("div");
        endsBox.style.cssText = "font-size:13px; color:#ccc; margin-bottom:16px; line-height:1.7; background:#1e1f22; border:1px solid #333; border-radius:6px; padding:10px 12px;";
        endsBox.innerHTML = `
            <div><strong style="color:#999;">Desde:</strong> ${this._describeWireEnd(wire.from)}</div>
            <div><strong style="color:#999;">Hasta:</strong> ${this._describeWireEnd(wire.to)}</div>
        `;
        this.content.appendChild(endsBox);

        // ── Color (paleta automática + personalizado) ───────────────────

        this._appendWireColorField(wire);

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