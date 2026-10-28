"use client";
/*
 * Aba "Dados bancários": contas (mais de um banco) e chaves Pix de cada uma.
 *
 * As regras valem no SERVIDOR; a tela só orienta e responde rápido:
 *   - a chave é única em todo o sistema, logo não se repete dentro de um banco;
 *   - CPF/CNPJ só do próprio titular; e-mail e celular pedem código de posse;
 *   - até 5 chaves por conta de pessoa física e 20 de pessoa jurídica.
 * A aprovação é SIMULADA (não há ligação com o DICT do Banco Central).
 */
import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { askInput, confirmAction, escapeHtml, notify } from "../alerts";
import { dateTime } from "./format";
import { KEY_MAX_LENGTH, maskDocument, maskPixKey } from "./masks";
import { useWork } from "./useWork";

type PixKey = {
  id: string;
  type: "cpf" | "cnpj" | "email" | "phone" | "evp";
  value: string;
  status: "pending" | "approved" | "rejected";
  protocol: string;
  reason: string | null;
  createdAt: string;
  approvedAt: string | null;
};
type BankAccount = {
  id: string;
  bankCode: string;
  bankName: string;
  agency: string;
  accountNumber: string;
  accountType: "checking" | "savings" | "payment";
  holderDocument: string;
  maxKeys: number;
  keys: PixKey[];
};
type Bank = { code: string; name: string };

const KEY_TYPES: Record<PixKey["type"], string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Celular",
  evp: "Chave aleatória",
};
const ACCOUNT_TYPES = { checking: "Conta corrente", savings: "Poupança", payment: "Conta de pagamento" };
const STATUS = {
  approved: ["Aprovada", "ok"],
  pending: ["Aguardando confirmação", "wait"],
  rejected: ["Recusada", "bad"],
} as const;
const PLACEHOLDER: Record<PixKey["type"], string> = {
  cpf: "000.000.000-00",
  cnpj: "00.000.000/0000-00",
  email: "voce@exemplo.com",
  phone: "(61) 99999-9999",
  evp: "",
};

/** Exibe a chave de forma legível (CPF/CNPJ/celular formatados). */
function showKey(k: PixKey) {
  if (k.type === "phone") return k.value.replace(/^\+55(\d{2})(\d{5})(\d{4})$/, "+55 ($1) $2-$3");
  return maskPixKey(k.type, k.value);
}

/** Chave sugerida ao abrir o formulário: o documento do titular (CPF ou CNPJ). */
function defaultKey(a: BankAccount): { type: PixKey["type"]; value: string } {
  return a.holderDocument.length === 14
    ? { type: "cnpj", value: maskDocument(a.holderDocument) }
    : { type: "cpf", value: maskDocument(a.holderDocument) };
}

export function BankTab({ fail }: { fail: (e: unknown) => void }) {
  const { busy, run } = useWork(fail);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({ bankCode: "", agency: "", accountNumber: "", accountType: "checking", holderDocument: "" });
  // Chave em edição (uma por vez): o valor digitado leva a máscara do tipo.
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [keyForm, setKeyForm] = useState<Record<string, { type: PixKey["type"]; value: string }>>({});

  async function load() {
    const [b, a] = await Promise.all([
      api<{ items: Bank[] }>("/banking/banks"),
      api<{ items: BankAccount[] }>("/banking/accounts"),
    ]);
    setBanks(b.items);
    setAccounts(a.items);
    setLoaded(true);
  }
  useEffect(() => {
    run(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addAccount(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const r = await api<{ message: string }>("/banking/accounts", "POST", form);
      setForm({ ...form, agency: "", accountNumber: "" });
      await load();
      notify("success", r.message);
    });
  }

  function removeAccount(a: BankAccount) {
    run(async () => {
      const ok = await confirmAction({
        title: "Excluir conta bancária?",
        html: `${escapeHtml(a.bankName)} · ag. ${escapeHtml(a.agency)} · conta ${escapeHtml(a.accountNumber)}<br/>As chaves Pix desta conta também serão removidas.`,
        confirmText: "Excluir",
      });
      if (!ok) return;
      const r = await api<{ message: string }>(`/banking/accounts/${a.id}`, "DELETE");
      await load();
      notify("success", r.message);
    });
  }

  /** Pede o código de posse e conclui o registro da chave. */
  async function confirmWithCode(keyId: string, intro: string) {
    const code = await askInput({
      title: "Confirmar a chave Pix",
      text: intro,
      label: "Código de 6 dígitos",
      confirmText: "Confirmar chave",
    });
    if (code === null) return false;
    const r = await api<{ message: string }>(`/banking/pix-keys/${keyId}/confirm`, "POST", { code });
    notify("success", r.message);
    return true;
  }

  function addKey(a: BankAccount, e: FormEvent) {
    e.preventDefault();
    const f = keyForm[a.id] ?? defaultKey(a);
    run(async () => {
      const r = await api<{ id: string; status: string; message: string }>(
        `/banking/accounts/${a.id}/pix-keys`,
        "POST",
        { type: f.type, ...(f.type === "evp" ? {} : { value: f.value }) }
      );
      setKeyForm({ ...keyForm, [a.id]: { type: f.type, value: "" } });
      if (r.status === "pending") {
        // Em demonstração o código aparece no log da API (DEMO_MAIL=true).
        await confirmWithCode(r.id, r.message).catch(fail);
      } else notify(r.status === "approved" ? "success" : "warning", r.message);
      await load();
    });
  }

  function resend(k: PixKey) {
    run(async () => {
      const r = await api<{ message: string }>(`/banking/pix-keys/${k.id}/resend`, "POST", {});
      notify("info", r.message);
      if (await confirmWithCode(k.id, "Informe o novo código enviado.")) await load();
    });
  }

  /** Salva a edição. E-mail/celular alterados voltam a exigir o código de posse. */
  function saveEdit(k: PixKey) {
    if (!editing) return;
    run(async () => {
      const r = await api<{ status: string; message: string }>(`/banking/pix-keys/${k.id}`, "PATCH", { value: editing.value });
      setEditing(null);
      if (r.status === "pending") await confirmWithCode(k.id, r.message).catch(fail);
      else notify(r.status === "approved" ? "success" : "warning", r.message);
      await load();
    });
  }

  function removeKey(k: PixKey) {
    run(async () => {
      const ok = await confirmAction({
        title: "Excluir chave Pix?",
        html: `${KEY_TYPES[k.type]}: <strong>${escapeHtml(showKey(k))}</strong>`,
        confirmText: "Excluir",
      });
      if (!ok) return;
      const r = await api<{ message: string }>(`/banking/pix-keys/${k.id}`, "DELETE");
      await load();
      notify("success", r.message);
    });
  }

  return (
    <>
      <section className="panel">
        <h2>Adicionar conta bancária</h2>
        <p className="muted">
          Você pode cadastrar contas em mais de um banco. O CPF/CNPJ do titular é usado para validar as chaves Pix
          desta conta.
        </p>
        <form onSubmit={addAccount} className="bank-form">
          <label className="field">
            <span className="form-label d-block">Banco</span>
            <select className="form-control" required value={form.bankCode} onChange={e => setForm({ ...form, bankCode: e.target.value })}>
              <option value="">Selecione…</option>
              {banks.map(b => (
                <option key={b.code} value={b.code}>
                  {b.code} · {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="form-label d-block">Agência</span>
            <input className="form-control" required inputMode="numeric" maxLength={5} placeholder="0001" value={form.agency} onChange={e => setForm({ ...form, agency: e.target.value.replace(/\D/g, "") })} />
          </label>
          <label className="field">
            <span className="form-label d-block">Conta (com dígito)</span>
            <input className="form-control" required maxLength={14} placeholder="123456-7" value={form.accountNumber} onChange={e => setForm({ ...form, accountNumber: e.target.value })} />
          </label>
          <label className="field">
            <span className="form-label d-block">Tipo</span>
            <select className="form-control" value={form.accountType} onChange={e => setForm({ ...form, accountType: e.target.value })}>
              {Object.entries(ACCOUNT_TYPES).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="form-label d-block">CPF/CNPJ do titular</span>
            <input className="form-control" required maxLength={18} inputMode="numeric" placeholder="000.000.000-00 ou 00.000.000/0000-00" value={form.holderDocument} onChange={e => setForm({ ...form, holderDocument: maskDocument(e.target.value) })} />
          </label>
          <button className="btn btn-primary" disabled={busy}>
            Cadastrar conta
          </button>
        </form>
      </section>

      {loaded && accounts.length === 0 && (
        <section className="panel empty">
          <h3>Nenhuma conta cadastrada</h3>
          <p className="muted">Cadastre uma conta acima para registrar chaves Pix.</p>
        </section>
      )}

      {accounts.map(a => {
        const f = keyForm[a.id] ?? defaultKey(a);
        const full = a.keys.length >= a.maxKeys;
        return (
          <section className="panel" key={a.id}>
            <div className="section-head">
              <div>
                <h2>
                  {a.bankName} <span className="muted">({a.bankCode})</span>
                </h2>
                <p className="muted mb-0">
                  Ag. {a.agency} · Conta {a.accountNumber} · {ACCOUNT_TYPES[a.accountType]} · Titular {maskDocument(a.holderDocument)}
                </p>
              </div>
              <button className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => removeAccount(a)}>
                Excluir conta
              </button>
            </div>

            <h3>
              Chaves Pix vinculadas a este banco{" "}
              <small className="muted">
                ({a.keys.length}/{a.maxKeys})
              </small>
            </h3>
            {a.keys.length === 0 ? (
              <p className="muted">Nenhuma chave registrada para esta conta.</p>
            ) : (
              <div className="table-responsive">
                <table className="table align-middle">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Chave</th>
                      <th>Situação</th>
                      <th>Protocolo</th>
                      <th>Criada em</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {a.keys.map(k => (
                      <tr key={k.id}>
                        <td>{KEY_TYPES[k.type]}</td>
                        <td className="break">
                          {editing?.id === k.id ? (
                            <input
                              className="form-control"
                              autoFocus
                              aria-label={`Novo valor da chave ${KEY_TYPES[k.type]}`}
                              type={k.type === "email" ? "email" : "text"}
                              inputMode={k.type === "email" ? "email" : "numeric"}
                              maxLength={KEY_MAX_LENGTH[k.type]}
                              value={editing.value}
                              onChange={e => setEditing({ id: k.id, value: maskPixKey(k.type, e.target.value) })}
                              onKeyDown={e => {
                                if (e.key === "Enter") saveEdit(k);
                                if (e.key === "Escape") setEditing(null);
                              }}
                            />
                          ) : (
                            showKey(k)
                          )}
                        </td>
                        <td>
                          <span className={`status ${STATUS[k.status][1]}`}>{STATUS[k.status][0]}</span>
                          {k.reason && <div className="muted small">{k.reason}</div>}
                        </td>
                        <td>{k.protocol}</td>
                        <td>{dateTime(k.createdAt)}</td>
                        <td className="actions">
                          {editing?.id === k.id ? (
                            <>
                              <button className="btn btn-sm btn-primary" disabled={busy || !editing.value} onClick={() => saveEdit(k)}>
                                Salvar
                              </button>{" "}
                              <button className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => setEditing(null)}>
                                Cancelar
                              </button>
                            </>
                          ) : (
                          <>
                          {k.status === "pending" && (
                            <>
                              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(async () => { if (await confirmWithCode(k.id, "Informe o código enviado ao contato da chave.")) await load(); })}>
                                Informar código
                              </button>{" "}
                              <button className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => resend(k)}>
                                Reenviar
                              </button>{" "}
                            </>
                          )}
                          {k.type !== "evp" && (
                            <>
                              <button
                                className="btn btn-sm btn-outline-secondary"
                                disabled={busy}
                                onClick={() => setEditing({ id: k.id, value: showKey(k).replace(/^\+55 /, "") })}
                              >
                                Editar
                              </button>{" "}
                            </>
                          )}
                          <button className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => removeKey(k)}>
                            Excluir
                          </button>
                          </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <form onSubmit={e => addKey(a, e)} className="pix-form">
              <label className="field">
                <span className="form-label d-block">Tipo de chave</span>
                <select
                  className="form-control"
                  value={f.type}
                  onChange={e => {
                    const type = e.target.value as PixKey["type"];
                    // CPF/CNPJ já vêm com o documento do titular (a chave tem de ser ele).
                    const value = type === "cpf" && a.holderDocument.length === 11 ? maskDocument(a.holderDocument) : type === "cnpj" && a.holderDocument.length === 14 ? maskDocument(a.holderDocument) : "";
                    setKeyForm({ ...keyForm, [a.id]: { type, value } });
                  }}
                >
                  {Object.entries(KEY_TYPES).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {f.type !== "evp" ? (
                <label className="field">
                  <span className="form-label d-block">Chave</span>
                  <input
                    className="form-control"
                    required
                    type={f.type === "email" ? "email" : "text"}
                    inputMode={f.type === "email" ? "email" : "numeric"}
                    placeholder={PLACEHOLDER[f.type]}
                    maxLength={KEY_MAX_LENGTH[f.type]}
                    value={f.value}
                    onChange={e => setKeyForm({ ...keyForm, [a.id]: { ...f, value: maskPixKey(f.type, e.target.value) } })}
                  />
                </label>
              ) : (
                <p className="muted pix-note">A chave aleatória é gerada pelo sistema.</p>
              )}
              <button className="btn btn-primary" disabled={busy || full}>
                {full ? "Limite de chaves atingido" : "Registrar chave"}
              </button>
            </form>
          </section>
        );
      })}

      <p className="footer-note">
        Registro de chaves <strong>simulado</strong>: o fluxo segue o do arranjo Pix (validação do formato, posse do
        contato e unicidade da chave), mas nenhum dado é enviado ao DICT do Banco Central. Para trocar a simulação pelo
        diretório real basta implementar a interface <code>PixDirectoryProvider</code>.
      </p>
    </>
  );
}
