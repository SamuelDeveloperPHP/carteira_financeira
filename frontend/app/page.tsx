"use client";
import { useEffect, useRef, useState, FormEvent, ReactNode } from "react";
import { confirmAction, escapeHtml, notify } from "./alerts";
type User = {
  id: string;
  name: string;
  email: string;
  role: "user" | "master";
};
type Movement = {
  id: string;
  kind: string;
  amount: string;
  delta: string;
  balance_after: string;
  sender_id: string | null;
  recipient_id: string;
  sender_name: string;
  recipient_name: string;
  sender_email: string;
  recipient_email: string;
  original_id: string | null;
  refund_id: string | null;
  created_at: string;
};
type LocationData = {
  status: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  capturedAt?: string;
};
type AuditEvent = {
  id: string;
  actor_name: string;
  actor_email: string;
  action: string;
  outcome: string;
  resource: string;
  reason: string;
  correlation_id: string;
  ip: string;
  device: string;
  location: LocationData;
  details: Record<string, unknown>;
  created_at: string;
};
type Account = User & {
  balance: string | null;
  totp_enabled: boolean;
  created_at: string;
};
type List<T> = { items: T[]; page: number; hasMore: boolean };
type Metrics = {
  users: number;
  movements: number;
  balance: string;
  database: string;
  uptimeSeconds: number;
  failuresLast15Minutes: number;
  reconciliation: { balanced: boolean; mismatchedWallets: number };
  alerts: { level: string; message: string }[];
};
const cash = (v: number | string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v) / 100
  );
const date = (v: string) => new Date(v).toLocaleString("pt-BR");
const labels: Record<string, string> = {
  deposit: "Depósito simulado",
  transfer: "Transferência",
  refund: "Devolução",
  success: "Sucesso",
  denied: "Recusado",
  failure: "Falha",
  unavailable: "Indisponível",
  timeout: "Tempo esgotado",
};
class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}
async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string
): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Wallet-Request": "1",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r
    .json()
    .catch(() => ({ message: "Serviço indisponível. Tente novamente." }));
  if (!r.ok)
    throw new ApiError(data.message || "Não foi possível concluir.", r.status);
  return data;
}
async function locate(): Promise<LocationData> {
  if (!navigator.geolocation) return { status: "unavailable" };
  return new Promise(resolve =>
    navigator.geolocation.getCurrentPosition(
      p =>
        resolve({
          status: "granted",
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
          capturedAt: new Date(p.timestamp).toISOString(),
        }),
      e =>
        resolve({
          status:
            e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable",
        }),
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 60000 }
    )
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field d-block">
      <span className="form-label d-block">{label}</span>
      {children}
    </label>
  );
}
function PasswordInput({
  value,
  onChange,
  autoComplete,
  minLength = 1,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  minLength?: number;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="input-group">
      <input
        className="form-control"
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        maxLength={128}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-outline-secondary"
        aria-pressed={shown}
        aria-label={shown ? "Ocultar senha" : "Mostrar senha"}
        onClick={() => setShown(s => !s)}
      >
        {shown ? "Ocultar" : "Mostrar"}
      </button>
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        CF
      </span>
      <span>Carteira financeira</span>
    </div>
  );
}
function Pager({
  value,
  change,
  busy = false,
}: {
  value: { page: number; hasMore: boolean };
  change: (p: number) => void;
  busy?: boolean;
}) {
  return (
    <div className="pager">
      <button
        className="btn btn-sm btn-outline-secondary"
        disabled={value.page === 1 || busy}
        onClick={() => change(value.page - 1)}
      >
        Anterior
      </button>
      <small>Página {value.page}</small>
      <button
        className="btn btn-sm btn-outline-secondary"
        disabled={!value.hasMore || busy}
        onClick={() => change(value.page + 1)}
      >
        Próxima
      </button>
    </div>
  );
}

export default function Home() {
  const [ready, setReady] = useState(false),
    [user, setUser] = useState<User | null>(null),
    [stage, setStage] = useState("login");
  const [register, setRegister] = useState(false),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<"none" | "request" | "reset">(
      "none"
    ),
    [resetToken, setResetToken] = useState(""),
    [newPassword, setNewPassword] = useState("");
  const [enrollment, setEnrollment] = useState<{
      qr: string;
      secret: string;
    } | null>(null),
    [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [view, setView] = useState("wallet");
  const [balance, setBalance] = useState(0),
    [statement, setStatement] = useState<List<Movement>>({
      items: [],
      page: 1,
      hasMore: false,
    });
  const [recipient, setRecipient] = useState(""),
    [amount, setAmount] = useState("");
  const request = useRef<{ payload: string; key: string } | null>(null),
    refundKeys = useRef<Record<string, string>>({});
  const [rotatePassword, setRotatePassword] = useState(""),
    [rotateCode, setRotateCode] = useState("");
  const [accounts, setAccounts] = useState<List<Account>>({
      items: [],
      page: 1,
      hasMore: false,
    }),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Account | null>(null);
  const [events, setEvents] = useState<List<AuditEvent>>({
      items: [],
      page: 1,
      hasMore: false,
    }),
    [filters, setFilters] = useState({
      userId: "",
      action: "",
      outcome: "",
      ip: "",
      from: "",
      to: "",
    });
  const [expanded, setExpanded] = useState<string | null>(null),
    [map, setMap] = useState<string | null>(null),
    [metrics, setMetrics] = useState<Metrics | null>(null);
  const [timeline, setTimeline] = useState<{
    movement: Movement;
    events: AuditEvent[];
  } | null>(null);
  function error(e: unknown) {
    notify(
      "error",
      e instanceof Error ? e.message : "Não foi possível concluir."
    );
    if (e instanceof ApiError && e.status === 401 && user &&
        (e.message.startsWith("Sessão expirada") || e.message === "Entre para continuar.")) {
      setUser(null);
      setStage("login");
    }
  }
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  async function loadWallet(p = 1) {
    const [w, s] = await Promise.all([
      api<{ balance: number }>("/wallet"),
      api<List<Movement>>(`/wallet/statement?page=${p}`),
    ]);
    setBalance(w.balance);
    setStatement(s);
  }
  async function loadAccounts(p = 1) {
    setAccounts(
      await api(`/admin/users?email=${encodeURIComponent(search)}&page=${p}`)
    );
  }
  async function loadEvents(p = 1, f = filters) {
    const q = new URLSearchParams({ page: String(p) });
    Object.entries(f).forEach(([k, v]) => {
      if (v)
        q.set(k, k === "from" || k === "to" ? new Date(v).toISOString() : v);
    });
    setEvents(await api(`/admin/events?${q}`));
    setExpanded(null);
    setMap(null);
  }
  async function initialize(u: User) {
    setUser(u);
    setStage("full");
    setView(u.role === "master" ? "accounts" : "wallet");
    if (u.role === "master") setAccounts(await api("/admin/users"));
    else await loadWallet();
  }
  useEffect(() => {
    let active = true;
    // The reset token travels in the URL fragment, which is never sent to the
    // server; it is removed from the address bar as soon as it is read.
    const readToken = () => {
      const token = /^#reset=([a-f0-9]{64})$/.exec(location.hash)?.[1];
      if (!token) return;
      history.replaceState(null, "", location.pathname + location.search);
      setResetToken(token);
      setRecovery("reset");
    };
    readToken();
    window.addEventListener("hashchange", readToken);
    (async () => {
      try {
        const s = await api<{ stage: string; user: User | null }>(
          "/auth/status"
        );
        if (!active) return;
        setStage(s.stage);
        if (s.user) await initialize(s.user);
        else if (s.stage === "setup") setEnrollment(await api("/auth/setup"));
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401) && active) error(e);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
      window.removeEventListener("hashchange", readToken);
    };
  }, []);
  async function login(e: FormEvent) {
    e.preventDefault();
    await work(async () => {
      if (register) {
        await api("/auth/register", "POST", { name, email, password });
        setRegister(false);
        setPassword("");
        notify(
          "success",
          "Conta criada com saldo zero. Entre para configurar o autenticador."
        );
        return;
      }
      const location = await locate();
      const r = await api("/auth/login", "POST", { email, password, location });
      setPassword("");
      setCode("");
      setStage(r.stage);
      if (r.stage === "setup") setEnrollment(await api("/auth/setup"));
    });
  }
  async function forgot(e: FormEvent) {
    e.preventDefault();
    await work(async () => {
      const r = await api<{ message: string }>(
        "/auth/forgot-password",
        "POST",
        { email }
      );
      setRecovery("none");
      notify("success", r.message);
    });
  }
  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    await work(async () => {
      const r = await api<{ message: string }>(
        "/auth/reset-password",
        "POST",
        { token: resetToken, password: newPassword }
      );
      setNewPassword("");
      setResetToken("");
      setRecovery("none");
      notify("success", r.message);
    });
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    await work(async () => {
      const r = await api("/auth/verify", "POST", { code });
      setCode("");
      setEnrollment(null);
      setCodes(r.recoveryCodes || []);
      await initialize(r.user);
      notify("success", "Acesso confirmado.");
    });
  }
  async function logout() {
    await work(async () => {
      await api("/auth/logout", "POST", {});
      setUser(null);
      setStage("login");
      setCodes([]);
      setCode("");
      setEnrollment(null);
      setSelected(null);
      setTimeline(null);
      notify("info", "Sessão encerrada com segurança.");
    });
  }
  function cents() {
    if (!/^\d{1,10}([,.]\d{1,2})?$/.test(amount))
      throw new Error("Informe um valor válido, como 25,50.");
    const [w, d = ""] = amount.replace(",", ".").split(".");
    const value = Number(w) * 100 + Number(d.padEnd(2, "0"));
    if (value < 1 || value > 1000000000000)
      throw new Error("Informe um valor positivo dentro do limite.");
    return value;
  }
  async function transfer(e: FormEvent) {
    e.preventDefault();
    await work(async () => {
      const value = cents();
      if (value > balance) throw new Error("Saldo insuficiente.");
      const confirmed = await confirmAction({
        title: "Confirmar transferência",
        html: `Enviar <strong>${cash(value)}</strong> para <strong>${escapeHtml(recipient.trim())}</strong>?`,
        confirmText: "Transferir",
      });
      if (!confirmed) return;
      const payload = JSON.stringify({
        recipientEmail: recipient.trim(),
        amount: value,
      });
      if (request.current?.payload !== payload)
        request.current = { payload, key: crypto.randomUUID() };
      const r = await api(
        "/transfers",
        "POST",
        JSON.parse(payload),
        request.current.key
      );
      request.current = null;
      setRecipient("");
      setAmount("");
      await loadWallet();
      notify("success", `Transferência concluída. Referência: ${r.id}`);
    });
  }
  async function refund(m: Movement) {
    await work(async () => {
      const confirmed = await confirmAction({
        title: "Devolver transferência",
        html: `Devolver <strong>${cash(m.amount)}</strong> a <strong>${escapeHtml(m.sender_name)}</strong>? A devolução é integral e não pode ser repetida.`,
        confirmText: "Devolver",
      });
      if (!confirmed) return;
      // One idempotency key per transfer: a retry never refunds twice.
      refundKeys.current[m.id] ??= crypto.randomUUID();
      await api(
        `/transfers/${m.id}/refund`,
        "POST",
        {},
        refundKeys.current[m.id]
      );
      await loadWallet(statement.page);
      notify("success", "Valor devolvido integralmente ao remetente.");
    });
  }
  async function switchView(next: string) {
    await work(async () => {
      setView(next);
      setTimeline(null);
      if (next === "wallet") await loadWallet();
      if (next === "accounts") await loadAccounts();
      if (next === "events") await loadEvents();
      if (next === "metrics") setMetrics(await api("/admin/metrics"));
    });
  }
  async function inspect(a: Account) {
    await work(async () => {
      setSelected(a);
      setTimeline(null);
      setStatement(await api(`/admin/users/${a.id}/statement`));
    });
  }
  function downloadCodes() {
    const blob = new Blob(
      [
        `Carteira Financeira — códigos de recuperação\nConta: ${user?.email}\nCada código pode ser usado uma única vez. Guarde em local seguro.\n\n${codes.join("\n")}`,
      ],
      { type: "text/plain;charset=utf-8" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "carteira-codigos-recuperacao.txt";
    a.click();
    URL.revokeObjectURL(url);
    notify("success", "Códigos baixados. Guarde o arquivo em local seguro.");
  }
  function transactions(admin = false) {
    return (
      <>
        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th>Data e operação</th>
                <th>De / para</th>
                <th>Valor</th>
                <th>Saldo após</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {statement.items.map(m => (
                <tr key={m.id}>
                  <td>
                    <strong>{labels[m.kind]}</strong>
                    <small className="d-block">{date(m.created_at)}</small>
                    {m.refund_id && <span className="tag">Devolvida</span>}
                  </td>
                  <td>
                    {Number(m.delta) > 0
                      ? m.sender_name || "Operador da demonstração"
                      : m.recipient_name}
                    <small className="d-block">
                      {Number(m.delta) > 0 ? m.sender_email : m.recipient_email}
                    </small>
                  </td>
                  <td
                    className={`amount ${Number(m.delta) > 0 ? "credit" : ""}`}
                  >
                    {Number(m.delta) > 0 ? "+" : ""}
                    {cash(m.delta)}
                  </td>
                  <td className="amount">{cash(m.balance_after)}</td>
                  <td>
                    {admin ? (
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() =>
                          work(async () => {
                            setTimeline(await api(`/admin/movements/${m.id}`));
                          })
                        }
                      >
                        Rastrear
                      </button>
                    ) : m.kind === "transfer" &&
                      m.recipient_id === user?.id &&
                      !m.refund_id ? (
                      <button
                        disabled={busy}
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => refund(m)}
                      >
                        Devolver
                      </button>
                    ) : (
                      <small>—</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!statement.items.length && (
          <div className="empty">
            <h3>Nenhuma movimentação</h3>
            <p>As entradas, transferências e devoluções aparecerão aqui.</p>
          </div>
        )}
        <Pager
          value={statement}
          busy={busy}
          change={p =>
            work(async () => {
              if (admin && selected)
                setStatement(
                  await api(`/admin/users/${selected.id}/statement?page=${p}`)
                );
              else await loadWallet(p);
            })
          }
        />
      </>
    );
  }
  if (!ready)
    return (
      <main className="loading" role="status">
        Carregando sua carteira…
      </main>
    );
  return (
    <>
      <div className="demo">
        Ambiente de demonstração — valores simulados. Nenhuma conta bancária
        real é movimentada.
      </div>
      {!user ? (
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
                    <button disabled={busy} className="btn btn-primary w-100">
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
      ) : (
        <div className="shell">
          <aside className="sidebar">
            <Brand />
            <nav aria-label="Navegação principal">
              {(user.role === "master"
                ? [
                    ["accounts", "Contas"],
                    ["events", "Trilha de auditoria"],
                    ["metrics", "Monitoramento"],
                  ]
                : [["wallet", "Minha carteira"]]
              )
                .concat([
                  ["security", "Segurança"],
                  ["about", "Sobre a demonstração"],
                ])
                .map(([id, title]) => (
                  <button
                    key={id}
                    className={view === id ? "active" : ""}
                    onClick={() => switchView(id)}
                    disabled={busy}
                  >
                    {title}
                  </button>
                ))}
            </nav>
            <footer>
              {user.role === "master"
                ? "Perfil master · Somente leitura"
                : "Conta pessoal"}
              <br />
              Sessão protegida por 2FA
            </footer>
          </aside>
          <main className="main">
            <header className="topbar">
              <div>
                <h1>
                  {
                    (
                      {
                        wallet: "Minha carteira",
                        accounts: "Auditoria de contas",
                        events: "Trilha de auditoria",
                        metrics: "Monitoramento",
                        security: "Segurança",
                        about: "Sobre a demonstração",
                      } as Record<string, string>
                    )[view]
                  }
                </h1>
                <p className="muted">
                  {user.name} · {user.email}
                </p>
              </div>
              <button
                className="btn btn-outline-secondary"
                disabled={busy}
                onClick={logout}
              >
                Sair
              </button>
            </header>
            {codes.length > 0 && (
              <section className="panel">
                <h2>Guarde seus códigos de recuperação</h2>
                <p>
                  Estes códigos são exibidos uma única vez. Cada um substitui o
                  código do autenticador em um login. Guarde-os fora deste
                  dispositivo.
                </p>
                <ul className="codes">
                  {codes.map(c => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <div className="inline-actions">
                  <button className="btn btn-primary" onClick={downloadCodes}>
                    Baixar códigos
                  </button>
                  <button
                    className="btn btn-outline-secondary"
                    onClick={() => setCodes([])}
                  >
                    Já guardei os códigos
                  </button>
                </div>
              </section>
            )}
            {view === "wallet" && (
              <>
                <div className="wallet-grid">
                  <section className="panel balance-panel">
                    <h2>Saldo disponível</h2>
                    <div className="balance">{cash(balance)}</div>
                    <span className="tag success">
                      Carteira em reais · Simulação
                    </span>
                    <div className="balance-note">
                      <h3>Como adicionar saldo?</h3>
                      <p className="muted mb-0">
                        Nesta demonstração, o operador confirma um depósito
                        simulado. Você também pode receber transferências de
                        outros usuários.
                      </p>
                    </div>
                  </section>
                  <section className="panel">
                    <h2>Fazer uma transferência</h2>
                    <p className="muted small">
                      Envie para outra pessoa cadastrada nesta carteira.
                    </p>
                    <form onSubmit={transfer}>
                      <Field label="E-mail do destinatário">
                        <input
                          className="form-control"
                          type="email"
                          required
                          value={recipient}
                          onChange={e => setRecipient(e.target.value)}
                        />
                      </Field>
                      <Field label="Valor em reais">
                        <input
                          className="form-control"
                          inputMode="decimal"
                          placeholder="0,00"
                          required
                          value={amount}
                          onChange={e => setAmount(e.target.value)}
                        />
                      </Field>
                      <div className="inline-actions">
                        <button className="btn btn-primary" disabled={busy}>
                          {busy ? "Processando…" : "Transferir"}
                        </button>
                      </div>
                    </form>
                  </section>
                </div>
                <section className="panel">
                  <div className="section-head">
                    <h2>Extrato da carteira</h2>
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      disabled={busy}
                      onClick={() => work(() => loadWallet(statement.page))}
                    >
                      Atualizar
                    </button>
                  </div>
                  {transactions()}
                </section>
              </>
            )}
            {view === "accounts" && (
              <>
                <section className="panel">
                  <form
                    className="filters"
                    onSubmit={e => {
                      e.preventDefault();
                      work(() => loadAccounts());
                    }}
                  >
                    <Field label="Buscar por nome ou e-mail">
                      <input
                        className="form-control"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                      />
                    </Field>
                    <button disabled={busy} className="btn btn-primary">
                      Buscar contas
                    </button>
                  </form>
                  <div className="table-responsive">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Usuário</th>
                          <th>Perfil</th>
                          <th>Saldo</th>
                          <th>Segundo fator</th>
                          <th>Consulta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accounts.items.map(a => (
                          <tr key={a.id}>
                            <td>
                              <strong>{a.name}</strong>
                              <small className="d-block">{a.email}</small>
                            </td>
                            <td>
                              {a.role === "master" ? "Master" : "Usuário"}
                            </td>
                            <td className="amount">
                              {a.balance === null ? "—" : cash(a.balance)}
                            </td>
                            <td>
                              <span
                                className={`tag ${a.totp_enabled ? "success" : ""}`}
                              >
                                {a.totp_enabled ? "Ativo" : "Pendente"}
                              </span>
                            </td>
                            <td>
                              <div className="inline-actions">
                                {a.role === "user" && (
                                  <button
                                    className="btn btn-sm btn-outline-secondary"
                                    disabled={busy}
                                    onClick={() => inspect(a)}
                                  >
                                    Extrato
                                  </button>
                                )}
                                <button
                                  className="btn btn-sm btn-outline-secondary"
                                  onClick={() =>
                                    work(async () => {
                                      const f = { ...filters, userId: a.id };
                                      setFilters(f);
                                      setView("events");
                                      await loadEvents(1, f);
                                    })
                                  }
                                >
                                  Atividades
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!accounts.items.length && (
                    <p className="empty">Nenhuma conta encontrada.</p>
                  )}
                  <Pager
                    value={accounts}
                    busy={busy}
                    change={p => work(() => loadAccounts(p))}
                  />
                </section>
                {selected && (
                  <section className="panel">
                    <div className="section-head">
                      <div>
                        <h2>Extrato de {selected.name}</h2>
                        <small>{selected.email}</small>
                      </div>
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => {
                          setSelected(null);
                          setTimeline(null);
                        }}
                      >
                        Fechar
                      </button>
                    </div>
                    {transactions(true)}
                  </section>
                )}
                {timeline && (
                  <section className="panel">
                    <h2>Rastreio da movimentação</h2>
                    <p className="small">Referência: {timeline.movement.id}</p>
                    <ul className="timeline">
                      {timeline.events.map(e => (
                        <li key={e.id}>
                          <strong>{e.action}</strong>
                          <small>
                            {date(e.created_at)} · {labels[e.outcome]}
                          </small>
                          <span className="small">
                            Correlação: {e.correlation_id}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
            {view === "events" && (
              <section className="panel">
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    work(() => loadEvents());
                  }}
                >
                  <div className="filters">
                    <Field label="ID do usuário">
                      <input
                        className="form-control"
                        value={filters.userId}
                        onChange={e =>
                          setFilters({ ...filters, userId: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Ação contém">
                      <input
                        className="form-control"
                        placeholder="auth.login"
                        value={filters.action}
                        onChange={e =>
                          setFilters({ ...filters, action: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Resultado">
                      <select
                        className="form-select"
                        value={filters.outcome}
                        onChange={e =>
                          setFilters({ ...filters, outcome: e.target.value })
                        }
                      >
                        <option value="">Todos</option>
                        <option value="success">Sucesso</option>
                        <option value="denied">Recusado</option>
                        <option value="failure">Falha</option>
                      </select>
                    </Field>
                    <Field label="IP">
                      <input
                        className="form-control"
                        value={filters.ip}
                        onChange={e =>
                          setFilters({ ...filters, ip: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <div className="filters">
                    <Field label="Desde">
                      <input
                        type="datetime-local"
                        className="form-control"
                        value={filters.from}
                        onChange={e =>
                          setFilters({ ...filters, from: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Até">
                      <input
                        type="datetime-local"
                        className="form-control"
                        value={filters.to}
                        onChange={e =>
                          setFilters({ ...filters, to: e.target.value })
                        }
                      />
                    </Field>
                    <button className="btn btn-primary" disabled={busy}>
                      Filtrar eventos
                    </button>
                    <button
                      className="btn btn-outline-secondary"
                      type="button"
                      onClick={() =>
                        work(async () => {
                          const f = {
                            userId: "",
                            action: "",
                            outcome: "",
                            ip: "",
                            from: "",
                            to: "",
                          };
                          setFilters(f);
                          await loadEvents(1, f);
                        })
                      }
                    >
                      Limpar
                    </button>
                  </div>
                </form>
                <div className="table-responsive">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Data / responsável</th>
                        <th>Ação</th>
                        <th>Origem</th>
                        <th>Resultado</th>
                        <th>Detalhes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.items.map(e => (
                        <AuditRow
                          key={e.id}
                          event={e}
                          expanded={expanded === e.id}
                          showMap={map === e.id}
                          toggle={() => {
                            setExpanded(expanded === e.id ? null : e.id);
                            setMap(null);
                          }}
                          map={() => setMap(map === e.id ? null : e.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                {!events.items.length && (
                  <p className="empty">
                    Nenhum evento para os filtros informados.
                  </p>
                )}
                <Pager
                  value={events}
                  busy={busy}
                  change={p => work(() => loadEvents(p))}
                />
                <p className="footer-note">
                  O IP pode ser compartilhado. A localização vem do navegador e
                  pode ser imprecisa ou manipulada. Todas as consultas
                  administrativas são auditadas.
                </p>
              </section>
            )}
            {view === "metrics" && metrics && (
              <>
                <div className="section-head">
                  <h2>Operação e integridade</h2>
                  <button
                    className="btn btn-outline-secondary"
                    disabled={busy}
                    onClick={() =>
                      work(async () => setMetrics(await api("/admin/metrics")))
                    }
                  >
                    Atualizar
                  </button>
                </div>
                <div className="metric-grid">
                  {[
                    ["Contas de usuários", metrics.users],
                    ["Movimentações", metrics.movements],
                    ["Saldo total simulado", cash(metrics.balance)],
                    [
                      "Recusas / falhas em 15 min",
                      metrics.failuresLast15Minutes,
                    ],
                    ["Banco de dados", "Disponível"],
                    [
                      "Conciliação",
                      metrics.reconciliation.balanced
                        ? "Sem divergências"
                        : "Investigar",
                    ],
                  ].map(([caption, value]) => (
                    <section className="panel" key={String(caption)}>
                      <h3>{caption}</h3>
                      <p className="metric-value">{value}</p>
                    </section>
                  ))}
                </div>
                <section className="panel">
                  <h2>Alertas operacionais</h2>
                  {metrics.alerts.length ? (
                    metrics.alerts.map((a, i) => (
                      <div key={i} className="notice error">
                        {a.message}
                      </div>
                    ))
                  ) : (
                    <p className="muted mb-0">
                      Nenhum limite de alerta atingido nesta consulta.
                    </p>
                  )}
                  <p className="footer-note">
                    Alerta a partir de cinco falhas ou recusas em 15 minutos. A
                    conciliação compara os saldos aos lançamentos e depósitos.
                    Indicadores atualizados por consulta.
                  </p>
                </section>
              </>
            )}
            {view === "security" && (
              <section className="panel">
                <h2>Autenticação em dois fatores</h2>
                <p>
                  Seu acesso exige senha e código do autenticador.
                  Transferências e devoluções utilizam a sessão já autenticada.
                </p>
                <hr />
                <h3>Trocar o autenticador</h3>
                <p className="muted">
                  Confirme sua senha e um código válido. Todas as sessões e
                  códigos de recuperação anteriores serão revogados. Você
                  precisará cadastrar o novo autenticador antes de continuar.
                </p>
                <form
                  className="security-form"
                  onSubmit={e => {
                    e.preventDefault();
                    work(async () => {
                      const r = await api("/auth/rotate", "POST", {
                        password: rotatePassword,
                        code: rotateCode,
                      });
                      setUser(null);
                      setStage(r.stage);
                      setCodes([]);
                      setRotatePassword("");
                      setRotateCode("");
                      setEnrollment(await api("/auth/setup"));
                      notify(
                        "warning",
                        "Autenticador substituído. Cadastre o novo para continuar."
                      );
                    });
                  }}
                >
                  <Field label="Senha atual">
                    <input
                      className="form-control"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={rotatePassword}
                      onChange={e => setRotatePassword(e.target.value)}
                    />
                  </Field>
                  <Field label="Código atual ou de recuperação">
                    <input
                      className="form-control"
                      autoComplete="one-time-code"
                      required
                      value={rotateCode}
                      onChange={e => setRotateCode(e.target.value)}
                    />
                  </Field>
                  <button disabled={busy} className="btn btn-outline-secondary">
                    Confirmar troca do autenticador
                  </button>
                </form>
              </section>
            )}
            {view === "about" && (
              <section className="panel">
                <h2>Uma carteira para demonstrar o fluxo completo</h2>
                <p>
                  Os saldos são simulados. Cada conta começa com zero, recebe
                  depósitos confirmados pelo operador ou transferências de
                  outras contas e pode enviar valores a usuários cadastrados.
                </p>
                <h3>Devolução com saldo disponível</h3>
                <p>
                  Quem recebeu uma transferência pode devolver seu valor
                  integral uma única vez. A operação exige saldo suficiente e
                  preserva o histórico original.
                </p>
                <h3>Evolução para dinheiro real</h3>
                <p>
                  O projeto pode evoluir mediante integração com um banco ou
                  provedor de pagamentos, com confirmação e conciliação das
                  operações. Essa integração ainda não está implementada. Não
                  informe credenciais bancárias nesta demonstração.
                </p>
                <h3>Auditoria de segurança</h3>
                <p>
                  Registramos operações, acessos e consultas relevantes, com IP,
                  contexto do navegador e localização quando autorizada. O
                  master pode investigar esses registros, mas não pode
                  movimentar seu dinheiro ou apagar a trilha.
                </p>
              </section>
            )}
          </main>
        </div>
      )}
    </>
  );
}

function AuditRow({
  event: e,
  expanded,
  showMap,
  toggle,
  map,
}: {
  event: AuditEvent;
  expanded: boolean;
  showMap: boolean;
  toggle: () => void;
  map: () => void;
}) {
  const loc = e.location,
    hasLocation =
      loc?.status === "granted" &&
      typeof loc.latitude === "number" &&
      typeof loc.longitude === "number";
  return (
    <>
      <tr>
        <td>
          {date(e.created_at)}
          <small className="d-block">
            {e.actor_email || "Não autenticado / sistema"}
          </small>
        </td>
        <td>{e.action}</td>
        <td>
          {e.ip}
          <small className="d-block">
            {hasLocation
              ? "Localização disponível"
              : loc?.status === "denied"
                ? "Localização recusada"
                : "Sem localização"}
          </small>
        </td>
        <td>
          <span className={`tag ${e.outcome}`}>{labels[e.outcome]}</span>
        </td>
        <td>
          <button
            className="btn btn-sm btn-outline-secondary"
            aria-expanded={expanded}
            onClick={toggle}
          >
            {expanded ? "Fechar" : "Detalhes"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5}>
            <div className="details">
              <dl>
                <dt>Responsável</dt>
                <dd>{e.actor_name || "Sistema / acesso não autenticado"}</dd>
                <dt>Recurso</dt>
                <dd>{e.resource || "—"}</dd>
                <dt>Correlação</dt>
                <dd>{e.correlation_id}</dd>
                <dt>Navegador</dt>
                <dd>{e.device}</dd>
                <dt>Motivo</dt>
                <dd>{e.reason || "—"}</dd>
                <dt>Localização</dt>
                <dd>
                  {hasLocation
                    ? `${loc.latitude}, ${loc.longitude} (precisão estimada: ${Math.round(loc.accuracy || 0)} m)`
                    : loc?.status === "denied"
                      ? "Permissão negada"
                      : labels[loc?.status] || "Indisponível"}
                </dd>
                <dt>Contexto</dt>
                <dd>{JSON.stringify(e.details)}</dd>
              </dl>
              {hasLocation && (
                <>
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    onClick={map}
                  >
                    {showMap
                      ? "Fechar posição"
                      : "Visualizar posição geográfica"}
                  </button>
                  {showMap && (
                    <LocalPosition
                      latitude={loc.latitude!}
                      longitude={loc.longitude!}
                    />
                  )}
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
function LocalPosition({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}) {
  const x = 40 + (longitude + 180) * 2,
    y = 30 + (90 - latitude) * 2;
  return (
    <figure className="mt-3">
      <svg
        viewBox="0 0 800 420"
        role="img"
        aria-label={`Posição declarada: latitude ${latitude}, longitude ${longitude}`}
        style={{
          width: "100%",
          maxWidth: 800,
          background: "#e8f0f4",
          border: "1px solid #c5d6df",
        }}
      >
        <rect
          x="40"
          y="30"
          width="720"
          height="360"
          fill="#f9fcfd"
          stroke="#8ba5b6"
        />
        {[-120, -60, 0, 60, 120].map(lon => (
          <line
            key={lon}
            x1={40 + (lon + 180) * 2}
            y1="30"
            x2={40 + (lon + 180) * 2}
            y2="390"
            stroke="#cbdbe4"
          />
        ))}
        {[-60, -30, 0, 30, 60].map(lat => (
          <line
            key={lat}
            x1="40"
            y1={30 + (90 - lat) * 2}
            x2="760"
            y2={30 + (90 - lat) * 2}
            stroke="#cbdbe4"
          />
        ))}
        <text x="8" y="40" fontSize="12">
          90°N
        </text>
        <text x="8" y="215" fontSize="12">
          0°
        </text>
        <text x="8" y="390" fontSize="12">
          90°S
        </text>
        <text x="40" y="410" fontSize="12">
          180°O
        </text>
        <text x="395" y="410" fontSize="12">
          0°
        </text>
        <text x="724" y="410" fontSize="12">
          180°L
        </text>
        <circle
          cx={x}
          cy={y}
          r="10"
          fill="#176b57"
          stroke="#fff"
          strokeWidth="3"
        />
        <line
          x1={x}
          y1="30"
          x2={x}
          y2="390"
          stroke="#176b57"
          strokeDasharray="4 4"
          opacity=".5"
        />
        <line
          x1="40"
          y1={y}
          x2="760"
          y2={y}
          stroke="#176b57"
          strokeDasharray="4 4"
          opacity=".5"
        />
      </svg>
      <figcaption className="small muted mt-2">
        Grade geográfica local de latitude/longitude, sem envio de dados a
        serviços de mapas. Posição declarada pelo navegador; não verificada.
      </figcaption>
    </figure>
  );
}
