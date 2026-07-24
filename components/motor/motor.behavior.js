/*
==========================================================
 PitSimulator — motor.behavior.js
 Comportamiento de render del motor DC, migrado tal cual desde
 Renderer.tagMotorElements() hacia ComponentBehaviorRegistry.
 No tiene "estado inicial" propio -- applyMotorState() (que
 sigue viviendo en Renderer.js, llamado desde
 components/l298n/l298n.behavior.js) ya deja el indicador
 oculto (opacity 0) por default, seteado acá mismo en tag().
==========================================================
*/

ComponentBehaviorRegistry.register("motor", {

    render: {

        tag(component, graphic) {

            const axle = graphic.querySelector("#eje_motor");
            if (!axle) {
                console.warn("[motor.behavior] No se encontró #eje_motor en el SVG del motor");
                return;
            }

            const x = parseFloat(axle.getAttribute("x")) || 0;
            const y = parseFloat(axle.getAttribute("y")) || 0;
            const w = parseFloat(axle.getAttribute("width")) || 0;
            const h = parseFloat(axle.getAttribute("height")) || 0;
            const cx = x + w / 2;
            const cy = y + h / 2;

            axle.setAttribute("data-motor-role", "axle");
            axle.removeAttribute("id");

            const NS = Utils.SVG_NS;

            const wrapper = document.createElementNS(NS, "g");
            wrapper.setAttribute("transform", `translate(${cx}, ${cy})`);

            const indicator = document.createElementNS(NS, "g");
            indicator.setAttribute("data-motor-role", "spin-indicator");
            indicator.style.transformOrigin = "0px 0px";
            indicator.style.opacity = "0"; // oculto hasta que applyMotorState() diga lo contrario

            const r = Utils.clamp(h * 0.34, 16, h / 2 - 4);

            const backdrop = document.createElementNS(NS, "circle");
            backdrop.setAttribute("data-motor-role", "backdrop");
            backdrop.setAttribute("r", r * 0.92);
            backdrop.setAttribute("fill", "#1a1a1a");
            backdrop.setAttribute("fill-opacity", "0.28");
            indicator.appendChild(backdrop);

            const rotor = document.createElementNS(NS, "g");
            rotor.setAttribute("data-motor-role", "rotor");
            rotor.style.transformOrigin = "0px 0px";

            for (let i = 0; i < 3; i++) {
                const blade = document.createElementNS(NS, "ellipse");
                blade.setAttribute("data-motor-role", "blade");
                blade.setAttribute("cx", r * 0.52);
                blade.setAttribute("cy", 0);
                blade.setAttribute("rx", r * 0.58);
                blade.setAttribute("ry", r * 0.2);
                blade.setAttribute("stroke", "#00000055");
                blade.setAttribute("stroke-width", "0.6");
                blade.setAttribute("transform", `rotate(${i * 120})`);
                rotor.appendChild(blade);
            }

            const hub = document.createElementNS(NS, "circle");
            hub.setAttribute("data-motor-role", "hub");
            hub.setAttribute("r", r * 0.22);
            hub.setAttribute("stroke", "#00000055");
            hub.setAttribute("stroke-width", "0.6");
            rotor.appendChild(hub);

            const tick = document.createElementNS(NS, "path");
            tick.setAttribute("data-motor-role", "tick");
            tick.setAttribute("d", `M ${r + 3},0 l -6,-3.6 l 0,7.2 z`);
            tick.setAttribute("stroke", "#00000055");
            tick.setAttribute("stroke-width", "0.6");
            rotor.appendChild(tick);

            indicator.appendChild(rotor);

            const ring = document.createElementNS(NS, "circle");
            ring.setAttribute("data-motor-role", "ring");
            ring.setAttribute("r", r * 0.98);
            ring.setAttribute("fill", "none");
            ring.setAttribute("stroke", "#000000");
            ring.setAttribute("stroke-opacity", "0.25");
            ring.setAttribute("stroke-width", "1");
            indicator.appendChild(ring);

            wrapper.appendChild(indicator);
            graphic.appendChild(wrapper);

        },

    },

});
