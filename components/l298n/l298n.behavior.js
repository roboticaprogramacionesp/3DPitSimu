/*
==========================================================
 PitSimulator — l298n.behavior.js
 Comportamiento de señal del puente H L298N, migrado tal cual
 desde SignalEngine.evaluateL298n() hacia
 ComponentBehaviorRegistry.

 A diferencia de otros tipos migrados, los helpers
 _findMotorOnOutputs()/_computeL298nMotorState() y el método
 getL298nState() SIGUEN viviendo en SignalEngine.js -- no se
 movieron acá porque getL298nState() tiene un llamador externo
 real (PropertyPanel.js, para pintar el estado inicial del panel
 de propiedades sin disparar el evento "motor:changed"). Este
 behavior los llama de vuelta vía "engine".
==========================================================
*/

// Bloque de estado + jumper para un motor (A o B) del L298N -- usado
// solo por propertyPanel.render() de abajo. _l298nStateColor()/
// _l298nStateLabel() SIGUEN viviendo en PropertyPanel.js porque
// _updateL298nDisplay() (llamado por el constructor al recibir
// "motor:changed") también los necesita.
function _appendL298nMotorBlock(component, panel, label, motorState, jumperProp) {

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
        background: ${panel._l298nStateColor(motorState.state)};
    `;
    badge.textContent = panel._l298nStateLabel(motorState.state);
    wrap.appendChild(badge);

    const jumperRow = document.createElement("label");
    jumperRow.style.cssText = "display:flex; align-items:center; gap:8px; font-size:13px; color:#ccc; cursor:pointer;";

    const jumperCheckbox = document.createElement("input");
    jumperCheckbox.type    = "checkbox";
    jumperCheckbox.checked = component.properties?.[jumperProp] !== false;

    jumperCheckbox.addEventListener("change", () => {
        component.properties = component.properties || {};
        component.properties[jumperProp] = jumperCheckbox.checked;
        panel.simulator.signalEngine.evaluateL298n(component);
    });

    const jumperText = document.createElement("span");
    jumperText.textContent = `Jumper EN${label} instalado (habilitado a máx. velocidad)`;

    jumperRow.appendChild(jumperCheckbox);
    jumperRow.appendChild(jumperText);
    wrap.appendChild(jumperRow);

    panel.content.appendChild(wrap);

}

ComponentBehaviorRegistry.register("l298n", {

    signal: {

        evaluate(component, engine) {

            if (!engine.isComponentPowered(component)) {
                const off = { state: "deshabilitado", enabled: false, in_a: false, in_b: false };

                const motorAComponent = engine._findMotorOnOutputs(component, "out1", "out2");
                if (motorAComponent) engine.simulator.renderer.applyMotorState(motorAComponent, off);

                const motorBComponent = engine._findMotorOnOutputs(component, "out3", "out4");
                if (motorBComponent) engine.simulator.renderer.applyMotorState(motorBComponent, off);

                engine.simulator.eventBus.emit("motor:changed", {
                    componentId: component.id,
                    motorA: off,
                    motorB: off,
                });
                return;
            }

            const motorA = engine._computeL298nMotorState(
                component,
                "in1",
                "in2",
                "ena",
                "jumperEnaInstalled",
            );
            const motorB = engine._computeL298nMotorState(
                component,
                "in3",
                "in4",
                "enb",
                "jumperEnbInstalled",
            );

            const motorAComponent = engine._findMotorOnOutputs(component, "out1", "out2");
            if (motorAComponent)
                engine.simulator.renderer.applyMotorState(motorAComponent, motorA);

            const motorBComponent = engine._findMotorOnOutputs(component, "out3", "out4");
            if (motorBComponent)
                engine.simulator.renderer.applyMotorState(motorBComponent, motorB);

            engine.simulator.eventBus.emit("motor:changed", {
                componentId: component.id,
                motorA,
                motorB,
            });

        },

    },

    propertyPanel: {

        // Migrado tal cual desde PropertyPanel._renderL298n().
        render(component, panel) {

            panel.content.innerHTML = "";

            component.properties = component.properties || {};

            const { motorA, motorB } = panel.simulator.signalEngine.getL298nState(component);

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "L298N — Puente H";
            panel.content.appendChild(title);

            _appendL298nMotorBlock(component, panel, "A", motorA, "jumperEnaInstalled");
            _appendL298nMotorBlock(component, panel, "B", motorB, "jumperEnbInstalled");

            const sep = document.createElement("div");
            sep.style.cssText = "border-top:1px solid #333; margin: 12px 0;";
            panel.content.appendChild(sep);

            panel._renderCommonProperties(component);

        },

    },

});
