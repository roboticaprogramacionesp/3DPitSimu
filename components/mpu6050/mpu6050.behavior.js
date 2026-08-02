/*
==========================================================
 PitSimulator — mpu6050.behavior.js
 Panel de propiedades del MPU6050, migrado tal cual desde
 PropertyPanel._renderMpu6050() (+ sus 2 helpers privados,
 usados solo por este panel) hacia ComponentBehaviorRegistry.
 mpu6050 no necesita signal.evaluate ni render.tag propios --
 se resuelve por dirección I2C directo en SignalEngine
 (setMpuAxis/_notifyMpuToFirmware), sin dispatch por tipo.
==========================================================
*/

// Encabezado de sección chico (ícono + texto), igual estilo en las 3
// secciones del MPU6050.
function _mpuSectionHeader(icon, text) {
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

// Una fila "label: [======slider======] valor unidad" -- usada por las
// 7 variables del MPU6050. Actualiza component.properties Y llama a
// signalEngine.setMpuAxis() en cada "input" (valores en vivo mientras
// se arrastra, no solo al soltar).
function _makeMpuSlider(component, panel, key, label, unit, min, max, step, decimals) {
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
        panel.simulator.signalEngine.setMpuAxis(component.id, key, val);
    });

    row.appendChild(slider);
    row.appendChild(valueLabel);
    return row;
}

ComponentBehaviorRegistry.register("mpu6050", {

    signal: {
        // Ver nota "resync" en ComponentBehaviorRegistry.js -- setMpuAxis()
        // solo se llama desde los sliders del panel, nunca automáticamente,
        // así que un ajuste hecho antes de una reconexión de QEMU (o
        // restaurado desde un proyecto guardado) nunca le llegaba al
        // firmware hasta el próximo arrastre. _notifyMpuToFirmware() ya lee
        // todo de component.properties con sus propios defaults, así que
        // alcanza con volver a llamarlo tal cual.
        resync(component, engine) {
            engine._notifyMpuToFirmware(component);
        },
    },

    propertyPanel: {

        render(component, panel) {

            if (!component.properties) component.properties = {};
            const p = component.properties;
            if (p.accelX === undefined) p.accelX = 0.0;
            if (p.accelY === undefined) p.accelY = 0.0;
            if (p.accelZ === undefined) p.accelZ = 1.0;
            if (p.gyroX === undefined) p.gyroX = 0.0;
            if (p.gyroY === undefined) p.gyroY = 0.0;
            if (p.gyroZ === undefined) p.gyroZ = 0.0;
            if (p.temperature === undefined) p.temperature = 24.0;

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "MPU6050 Acelerómetro + Giroscopio";
            panel.content.appendChild(title);

            panel.content.appendChild(_mpuSectionHeader("〰", "ACELERACIÓN"));
            const accelRow = document.createElement("div");
            accelRow.style.cssText = "margin-bottom: 16px;";
            accelRow.appendChild(_makeMpuSlider(component, panel, "accelX", "X:", "g", -2, 2, 0.01, 2));
            accelRow.appendChild(_makeMpuSlider(component, panel, "accelY", "Y:", "g", -2, 2, 0.01, 2));
            accelRow.appendChild(_makeMpuSlider(component, panel, "accelZ", "Z:", "g", -2, 2, 0.01, 2));
            panel.content.appendChild(accelRow);

            panel.content.appendChild(_mpuSectionHeader("↻", "ROTACIÓN"));
            const gyroRow = document.createElement("div");
            gyroRow.style.cssText = "margin-bottom: 16px;";
            gyroRow.appendChild(_makeMpuSlider(component, panel, "gyroX", "X:", "°/sec", -250, 250, 1, 0));
            gyroRow.appendChild(_makeMpuSlider(component, panel, "gyroY", "Y:", "°/sec", -250, 250, 1, 0));
            gyroRow.appendChild(_makeMpuSlider(component, panel, "gyroZ", "Z:", "°/sec", -250, 250, 1, 0));
            panel.content.appendChild(gyroRow);

            panel.content.appendChild(_mpuSectionHeader("🌡", "TEMPERATURA"));
            const tempRow = document.createElement("div");
            tempRow.style.cssText = "margin-bottom: 16px;";
            tempRow.appendChild(_makeMpuSlider(component, panel, "temperature", "", "°C", -40, 85, 0.5, 1));
            panel.content.appendChild(tempRow);

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            // Dirección I2C -- mismo patrón que lcd_16x2_i2c.json
            panel._appendEditableField("Dirección I2C", p.i2cAddress ?? "0x68", (val) => {
                p.i2cAddress = val;
                panel.simulator.signalEngine._notifyMpuToFirmware(component);
            });

            panel._renderCommonProperties(component);

        },

    },

});
