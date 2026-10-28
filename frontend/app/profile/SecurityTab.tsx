"use client";
/*
 * Aba "Segurança": biometria, geolocalização e reconhecimento facial.
 *
 *   Biometria        - sinalizador para o aplicativo móvel (Face ID / digital do
 *                      aparelho). O servidor guarda só a preferência.
 *   Geolocalização   - desligada, o servidor descarta a localização do login.
 *   Reconhecimento   - cadastro com prova de vida (direita, esquerda, abaixar,
 *     facial           levantar, sorrir); serve para RECUPERAR A SENHA, somado
 *                      ao link do e-mail. Ativar e desativar pedem a senha.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { askInput, confirmAction, notify } from "../alerts";
import { FaceCapture, FaceResult } from "./FaceCapture";
import { setGeoHint } from "./geo-hint";
import { useWork } from "./useWork";

type Settings = { biometricEnabled: boolean; geolocationEnabled: boolean; faceEnabled: boolean };

/** Interruptor acessível: um botão com role="switch" e o estado em aria-checked. */
function Switch({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <p className="muted mb-0">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch${checked ? " on" : ""}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

export function SecurityTab({ fail }: { fail: (e: unknown) => void }) {
  const { busy, run } = useWork(fail);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [capturing, setCapturing] = useState(false);
  // Impede tratar duas vezes o resultado da captura (o componente chama onDone uma vez, mas a defesa é barata).
  const handled = useRef(false);

  async function load() {
    const s = await api<Settings>("/settings");
    setSettings(s);
    setGeoHint(s.geolocationEnabled);
  }
  useEffect(() => {
    run(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(field: "biometricEnabled" | "geolocationEnabled", next: boolean) {
    run(async () => {
      const r = await api<Settings & { message: string }>("/settings", "PATCH", { [field]: next });
      setSettings(r);
      setGeoHint(r.geolocationEnabled);
      notify("success", r.message);
    });
  }

  function startFace() {
    handled.current = false;
    setCapturing(true);
  }

  /** Captura concluída: pede a senha e envia o vetor ao servidor. */
  function enroll(result: FaceResult) {
    if (handled.current) return;
    handled.current = true;
    setCapturing(false);
    run(async () => {
      const password = await askInput({
        title: "Confirme sua senha",
        text: "Para ativar o reconhecimento facial, confirme sua senha.",
        label: "Senha",
        password: true,
        confirmText: "Ativar",
      });
      if (password === null) return;
      const r = await api<{ message: string }>("/settings/face", "POST", {
        password,
        descriptor: result.descriptor,
        liveness: result.liveness,
      });
      await load();
      notify("success", r.message);
    });
  }

  function disableFace() {
    run(async () => {
      const ok = await confirmAction({
        title: "Desativar o reconhecimento facial?",
        html: "O modelo do seu rosto será apagado e a recuperação de senha voltará a depender só do link do e-mail.",
        confirmText: "Desativar",
      });
      if (!ok) return;
      const password = await askInput({
        title: "Confirme sua senha",
        text: "Informe a senha para desativar o reconhecimento facial.",
        label: "Senha",
        password: true,
        confirmText: "Desativar",
      });
      if (password === null) return;
      const r = await api<{ message: string }>("/settings/face/disable", "POST", { password });
      await load();
      notify("success", r.message);
    });
  }

  if (!settings) return <section className="panel">Carregando preferências…</section>;

  return (
    <>
      <section className="panel">
        <h2>Preferências de segurança</h2>
        <Switch
          label="Biometria"
          description="Entrar e confirmar ações com a biometria do aparelho (digital ou Face ID). Será usada pelo aplicativo móvel; no navegador, só a preferência é guardada."
          checked={settings.biometricEnabled}
          disabled={busy}
          onChange={v => toggle("biometricEnabled", v)}
        />
        <Switch
          label="Geolocalização"
          description="Registrar a localização dos seus acessos na trilha de acesso. Desligada, a localização não é guardada."
          checked={settings.geolocationEnabled}
          disabled={busy}
          onChange={v => toggle("geolocationEnabled", v)}
        />
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Reconhecimento facial</h2>
            <p className="muted mb-0">
              Usado para recuperar a senha: além do link enviado ao seu e-mail, será preciso confirmar o rosto.
            </p>
          </div>
          <span className={`status ${settings.faceEnabled ? "ok" : "off"}`}>{settings.faceEnabled ? "Ativado" : "Desativado"}</span>
        </div>

        {capturing ? (
          <FaceCapture onDone={enroll} onCancel={() => setCapturing(false)} />
        ) : settings.faceEnabled ? (
          <div className="inline-actions">
            <button className="btn btn-outline-secondary" disabled={busy} onClick={startFace}>
              Refazer cadastro do rosto
            </button>
            <button className="btn btn-outline-secondary" disabled={busy} onClick={disableFace}>
              Desativar
            </button>
          </div>
        ) : (
          <>
            <p>
              Ao ativar, pediremos para você virar o rosto para a direita e para a esquerda, abaixar e levantar a
              cabeça e sorrir. É a <strong>prova de vida</strong>: ela dificulta o uso de uma foto sua.
            </p>
            <button className="btn btn-primary" disabled={busy} onClick={startFace}>
              Ativar reconhecimento facial
            </button>
          </>
        )}
        <p className="footer-note">
          O vídeo não sai do seu aparelho: apenas um vetor numérico do rosto é enviado, guardado cifrado e nunca
          devolvido. Dado biométrico é sensível (LGPD): ative apenas se concordar. A prova de vida é feita no navegador;
          por isso o rosto <strong>soma-se</strong> ao link do e-mail, sem substituí-lo.
        </p>
      </section>
    </>
  );
}
