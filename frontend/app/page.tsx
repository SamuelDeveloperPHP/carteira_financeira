"use client";
/*
 * Entrada ("/"): login, cadastro, recuperação de senha e segundo fator (2FA).
 * Quem já está autenticado é levado direto à página inicial do seu perfil.
 * As demais telas ficam em rotas próprias (ver o grupo app/(app)).
 */
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { notify } from "./alerts";
import { api } from "./api";
import { Brand, Field, PasswordInput } from "./components/ui";
import { locate } from "./lib/locate";
import { FaceResult } from "./profile/FaceCapture";
import { FaceFlow } from "./profile/FaceFlow";
import { homeOf, useSession } from "./session";

export default function Entry() {
  const router = useRouter();
  const { ready, user, stage, setStage, busy, work, signIn, logout } = useSession();
  const [register, setRegister] = useState(false),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<"none" | "request" | "reset">("none"),
    [resetToken, setResetToken] = useState(""),
    [newPassword, setNewPassword] = useState("");
  // Recuperação com reconhecimento facial: o servidor diz se o usuário o ativou;
  // então a redefinição só segue depois da captura (prova de vida) do rosto.
  const [faceNeeded, setFaceNeeded] = useState(false),
    [faceOpen, setFaceOpen] = useState(false),
    [faceResult, setFaceResult] = useState<FaceResult | null>(null);
  const [enrollment, setEnrollment] = useState<{ qr: string; secret: string } | null>(null);

  // Já autenticado: vai para a página inicial do perfil.
  useEffect(() => {
    if (ready && user) router.replace(homeOf(user.role));
  }, [ready, user, router]);

  // O token de recuperação viaja no FRAGMENTO da URL (#reset=...), que nunca é
  // enviado ao servidor; é removido da barra de endereço assim que lido.
  useEffect(() => {
    const readToken = () => {
      const token = /^#reset=([a-f0-9]{64})$/.exec(location.hash)?.[1];
      if (!token) return;
      history.replaceState(null, "", location.pathname + location.search);
      setResetToken(token);
      setRecovery("reset");
      setFaceNeeded(false);
      setFaceResult(null);
      setFaceOpen(false);
      // Pergunta se este usuário exigirá o rosto (não gasta o link).
      api<{ faceRequired: boolean }>("/auth/reset-requirements", "POST", { token })
        .then(r => setFaceNeeded(r.faceRequired))
        .catch(() => {});
    };
    readToken();
    window.addEventListener("hashchange", readToken);
    return () => window.removeEventListener("hashchange", readToken);
  }, []);

  // Estágio "setup" (primeiro acesso ou troca do autenticador): busca o QR code.
  useEffect(() => {
    if (ready && !user && stage === "setup" && !enrollment)
      work(async () => setEnrollment(await api("/auth/setup")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user, stage]);

  // Formulário de entrada/cadastro. No cadastro cria a conta (saldo zero) e
  // volta ao login. No login pede a localização (opcional), envia e-mail+senha e
  // avança para o estágio devolvido pelo servidor: "setup" (QR code do
  // autenticador) ou "challenge" (pede o código). A senha é apagada do estado
  // assim que enviada.
  async function login(e: FormEvent) {
    e.preventDefault();
    await work(async () => {
      if (register) {
        await api("/auth/register", "POST", { name, email, password });
        setRegister(false);
        setPassword("");
        notify("success", "Conta criada com saldo zero. Entre para configurar o autenticador.");
        return;
      }
      const location = await locate();
      const r = await api("/auth/login", "POST", { email, password, location });
      setPassword("");
      setCode("");
      setStage(r.stage);
    });
  }
  // Recuperação de senha, passo 1: pede o link. A resposta é sempre a mesma,
  // exista ou não a conta, para não revelar quais e-mails estão cadastrados.
  async function forgot(e: FormEvent) {
    e.preventDefault();
    await work(async () => {
      const r = await api<{ message: string }>("/auth/forgot-password", "POST", { email });
      setRecovery("none");
      notify("success", r.message);
    });
  }
  // Recuperação de senha, passo 2: define a nova senha com o token do link
  // (válido por 7 minutos e de uso único). O 2FA continua obrigatório depois.
  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    await work(async () => {
      try {
        const r = await api<{ message: string }>("/auth/reset-password", "POST", {
          token: resetToken,
          password: newPassword,
          ...(faceNeeded && faceResult ? { face: faceResult.descriptor } : {}),
        });
        setNewPassword("");
        setResetToken("");
        setRecovery("none");
        notify("success", r.message);
      } finally {
        // O rosto vale uma tentativa: sucesso ou recusa, é preciso refazer a captura.
        setFaceResult(null);
      }
    });
  }
  // Segundo fator: envia o código de 6 dígitos (ou de recuperação). Na primeira
  // vez, a resposta traz os códigos de recuperação, exibidos UMA única vez.
  async function verify(e: FormEvent) {
    e.preventDefault();
    await work(async () => {
      const r = await api("/auth/verify", "POST", { code });
      setCode("");
      setEnrollment(null);
      signIn(r.user, r.recoveryCodes || []);
      notify("success", "Acesso confirmado.");
      router.replace(homeOf(r.user.role));
    });
  }

  // Enquanto /auth/status não responde (ou o redirecionamento ocorre), mostra "carregando".
  if (!ready || user)
    return (
      <main className="loading" role="status">
        Carregando sua carteira…
      </main>
    );
  return (
        <main className="auth-grid">
          <section className="auth-story">
            <Brand />
            <div>
              <h1>
                Seu saldo.
                <br />
                Cada movimento.
              </h1>
              <p>
                Transfira entre carteiras com acesso protegido e histórico de
                todas as operações.
              </p>
            </div>
            <footer>
              Autenticação em dois fatores
              <br />
              Rastreabilidade do início ao fim
            </footer>
          </section>
          <section className="auth-form">
            <div className="auth-form-inner">
              {stage === "login" && recovery === "request" ? (
                <>
                  <h2>Recuperar acesso</h2>
                  <p className="muted">
                    Informe seu e-mail. Se houver conta, enviaremos um link
                    válido por 7 minutos e de uso único. O segundo fator
                    continuará obrigatório.
                  </p>
                  <form onSubmit={forgot}>
                    <Field label="E-mail">
                      <input
                        className="form-control"
                        type="email"
                        autoComplete="username"
                        required
                        maxLength={254}
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                      />
                    </Field>
                    <button disabled={busy} className="btn btn-primary w-100">
                      {busy ? "Aguarde…" : "Enviar link"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-link w-100 mt-2"
                      onClick={() => setRecovery("none")}
                    >
                      Voltar ao login
                    </button>
                  </form>
                </>
              ) : stage === "login" && recovery === "reset" ? (
                <>
                  <h2>Definir nova senha</h2>
                  <p className="muted">
                    Escolha uma nova senha. Todas as sessões serão encerradas e
                    o código do autenticador continuará sendo exigido.
                  </p>
                  <form onSubmit={resetPassword}>
                    <Field label="Nova senha">
                      <PasswordInput
                        autoComplete="new-password"
                        minLength={12}
                        value={newPassword}
                        onChange={setNewPassword}
                      />
                      <small>Use pelo menos 12 caracteres.</small>
                    </Field>
                    {faceNeeded && (
                      <div className="face-gate">
                        <strong>Confirmação facial</strong>
                        <p className="muted">
                          Você ativou o reconhecimento facial. Além do link,
                          confirme seu rosto: vire à direita e à esquerda,
                          abaixe e levante a cabeça e sorria.
                        </p>
                        {faceOpen ? (
                          <FaceFlow
                            onDone={r => {
                              setFaceResult(r);
                              setFaceOpen(false);
                            }}
                            onCancel={() => setFaceOpen(false)}
                          />
                        ) : faceResult ? (
                          <p className="status ok">Rosto verificado ✓</p>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-outline-secondary"
                            disabled={busy}
                            onClick={() => setFaceOpen(true)}
                          >
                            Confirmar meu rosto
                          </button>
                        )}
                      </div>
                    )}
                    <button
                      disabled={busy || (faceNeeded && !faceResult)}
                      className="btn btn-primary w-100"
                    >
                      {busy ? "Aguarde…" : "Redefinir senha"}
                    </button>
                  </form>
                </>
              ) : stage === "login" ? (
                <>
                  <h2>
                    {register ? "Abra sua carteira" : "Acesse sua carteira"}
                  </h2>
                  <p className="muted">
                    {register
                      ? "Comece com saldo zero e configure seu autenticador."
                      : "Entre com sua senha. Depois, confirme o segundo fator."}
                  </p>
                  <div className="auth-tabs">
                    <button
                      className={!register ? "active" : ""}
                      onClick={() => setRegister(false)}
                    >
                      Entrar
                    </button>
                    <button
                      className={register ? "active" : ""}
                      onClick={() => setRegister(true)}
                    >
                      Criar conta
                    </button>
                  </div>
                  <form onSubmit={login}>
                    {register && (
                      <Field label="Nome completo">
                        <input
                          className="form-control"
                          autoComplete="name"
                          required
                          minLength={2}
                          maxLength={100}
                          value={name}
                          onChange={e => setName(e.target.value)}
                        />
                      </Field>
                    )}
                    <Field label="E-mail">
                      <input
                        className="form-control"
                        type="email"
                        autoComplete="username"
                        required
                        maxLength={254}
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                      />
                    </Field>
                    <Field label="Senha">
                      <PasswordInput
                        autoComplete={
                          register ? "new-password" : "current-password"
                        }
                        minLength={register ? 12 : 1}
                        value={password}
                        onChange={setPassword}
                      />
                      {register && <small>Use pelo menos 12 caracteres.</small>}
                    </Field>
                    {!register && (
                      <p className="small muted">
                        Ao entrar, solicitaremos sua localização para o
                        histórico de segurança. Você pode recusar e continuar.
                      </p>
                    )}
                    <button disabled={busy} className="btn btn-primary w-100">
                      {busy
                        ? "Aguarde…"
                        : register
                          ? "Criar conta"
                          : "Continuar"}
                    </button>
                    {!register && (
                      <button
                        type="button"
                        className="btn btn-link w-100 mt-2"
                        onClick={() => setRecovery("request")}
                      >
                        Esqueci minha senha
                      </button>
                    )}
                  </form>
                </>
              ) : (
                <>
                  <h2>
                    {stage === "setup"
                      ? "Configure seu autenticador"
                      : "Confirme seu acesso"}
                  </h2>
                  {stage === "setup" ? (
                    <>
                      <p>
                        Escaneie o QR Code com Google Authenticator, Microsoft
                        Authenticator ou aplicativo compatível.
                      </p>
                      {enrollment ? (
                        <>
                          <img
                            className="qr"
                            src={enrollment.qr}
                            alt="QR Code para cadastrar a carteira no autenticador"
                          />
                          <details>
                            <summary>Inserir a chave manualmente</summary>
                            <code className="secret">{enrollment.secret}</code>
                          </details>
                        </>
                      ) : (
                        <button
                          className="btn btn-outline-secondary"
                          onClick={() =>
                            work(async () =>
                              setEnrollment(await api("/auth/setup"))
                            )
                          }
                        >
                          Carregar QR Code
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="muted">
                      Informe o código de seis dígitos ou um código de
                      recuperação ainda não utilizado.
                    </p>
                  )}
                  <form className="mt-4" onSubmit={verify}>
                    <Field
                      label={
                        stage === "setup"
                          ? "Código do autenticador"
                          : "Código do autenticador ou de recuperação"
                      }
                    >
                      <input
                        className="form-control"
                        autoComplete="one-time-code"
                        required
                        maxLength={32}
                        value={code}
                        onChange={e => setCode(e.target.value)}
                      />
                    </Field>
                    <button className="btn btn-primary w-100" disabled={busy}>
                      {busy ? "Validando…" : "Confirmar acesso"}
                    </button>
                  </form>
                  <button
                    className="btn btn-link mt-3"
                    disabled={busy}
                    onClick={logout}
                  >
                    Voltar ao login
                  </button>
                </>
              )}
            </div>
          </section>
        </main>
  );
}
