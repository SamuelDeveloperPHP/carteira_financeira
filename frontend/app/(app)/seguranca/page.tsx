"use client";
// Segurança: troca do autenticador. Pede senha + código, encerra todas as
// sessões e exige novo cadastro do autenticador antes de continuar.
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { notify } from "../../alerts";
import { api } from "../../api";
import { Field } from "../../components/ui";
import { useSession } from "../../session";

export default function SecurityPage() {
  const router = useRouter();
  const { busy, work, expire } = useSession();
  const [password, setPassword] = useState(""),
    [code, setCode] = useState("");

  function rotate(e: FormEvent) {
    e.preventDefault();
    work(async () => {
      const r = await api("/auth/rotate", "POST", { password, code });
      setPassword("");
      setCode("");
      // O servidor já revogou todas as sessões: a tela volta ao estágio "setup"
      // e a página de entrada busca o novo QR code.
      expire(r.stage);
      notify("warning", "Autenticador substituído. Cadastre o novo para continuar.");
      router.replace("/");
    });
  }

  return (
    <section className="panel">
      <h2>Autenticação em dois fatores</h2>
      <p>
        Seu acesso exige senha e código do autenticador. Transferências e devoluções utilizam a sessão já
        autenticada.
      </p>
      <hr />
      <h3>Trocar o autenticador</h3>
      <p className="muted">
        Confirme sua senha e um código válido. Todas as sessões e códigos de recuperação anteriores serão
        revogados. Você precisará cadastrar o novo autenticador antes de continuar.
      </p>
      <form className="security-form" onSubmit={rotate}>
        <Field label="Senha atual">
          <input
            className="form-control"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Código atual ou de recuperação">
          <input
            className="form-control"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={e => setCode(e.target.value)}
          />
        </Field>
        <button disabled={busy} className="btn btn-outline-secondary">
          Confirmar troca do autenticador
        </button>
      </form>
    </section>
  );
}
