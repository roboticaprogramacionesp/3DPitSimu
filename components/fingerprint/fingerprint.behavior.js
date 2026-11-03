/*
==========================================================
 PitSimulator — fingerprint.behavior.js
 Panel de propiedades del sensor de huella FPM383C -- el único
 control manual que tiene sentido acá es "poner el dedo" (imita
 apoyarlo unos segundos), que alimenta directo a
 SignalEngine._handleFpmCommand() (protocolo AS608 real, ver el
 comentario grande en SignalEngine.js). Sin esto, gen_img()/
 wait_finger()/search() del código del alumno nunca tendrían un
 dedo que detectar -- no hay ningún otro mecanismo para simularlo.
==========================================================
*/

ComponentBehaviorRegistry.register("fingerprint", {

    propertyPanel: {

        render(component, panel) {

            panel.content.innerHTML = "";

            const title = document.createElement("h4");
            title.style.cssText = "margin-bottom: 12px; color: #fff;";
            title.textContent = "Sensor de Huella FPM383C";
            panel.content.appendChild(title);

            const engine = panel.simulator.signalEngine;
            const state = engine._fpmState(component.id);

            const status = document.createElement("div");
            status.style.cssText = `
                font-size: 15px;
                font-weight: 600;
                text-align: center;
                margin: 8px 0;
                padding: 8px;
                border-radius: 6px;
            `;
            const refreshStatus = () => {
                const s = engine._fpmState(component.id);
                if (s.fingerPresent) {
                    status.textContent = "👆 Dedo apoyado";
                    status.style.background = "#1e4620";
                    status.style.color = "#6fdc7a";
                } else {
                    status.textContent = "Sin dedo apoyado";
                    status.style.background = "#2a2a2a";
                    status.style.color = "#999";
                }
            };
            refreshStatus();
            panel.content.appendChild(status);

            const btn = document.createElement("button");
            btn.textContent = "👆 Poner el dedo (3 s)";
            btn.style.cssText = `
                width: 100%;
                padding: 10px;
                margin-top: 6px;
                background: #4da3ff;
                color: #fff;
                border: none;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
            `;
            btn.addEventListener("click", () => {
                engine.setFpmFingerPresent(component.id, true, 3000);
                refreshStatus();
                setTimeout(refreshStatus, 3100);
            });
            panel.content.appendChild(btn);

            const hint = document.createElement("div");
            hint.style.cssText = "font-size:11px; color:#777; margin-top:6px; text-align:center;";
            hint.textContent = "Hace falta mientras corre el programa (gen_img/wait_finger/search solo detectan algo con el dedo \"apoyado\").";
            panel.content.appendChild(hint);

            const sep1 = document.createElement("div");
            sep1.style.cssText = "border-top:1px solid #333; margin: 14px 0 10px;";
            panel.content.appendChild(sep1);

            const enrolledLabel = document.createElement("label");
            enrolledLabel.style.cssText = "display:block; font-size:12px; color:#999; text-transform:uppercase; margin-bottom:6px;";
            enrolledLabel.textContent = "Huellas guardadas";
            panel.content.appendChild(enrolledLabel);

            const enrolledList = document.createElement("div");
            enrolledList.style.cssText = "font-size:13px; color:#ccc; font-variant-numeric:tabular-nums;";
            enrolledList.textContent = state.enrolled.length > 0
                ? `IDs: ${state.enrolled.join(", ")}`
                : "(ninguna -- usá el bloque de \"enrolar\" primero)";
            panel.content.appendChild(enrolledList);

            const sep2 = document.createElement("div");
            sep2.style.cssText = "border-top:1px solid #333; margin: 16px 0 12px;";
            panel.content.appendChild(sep2);

            panel._renderCommonProperties(component);

        },

    },

});
