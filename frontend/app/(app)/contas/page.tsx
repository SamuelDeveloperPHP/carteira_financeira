"use client";
// Master: busca de contas e extrato da conta escolhida (somente leitura).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../api";
import { Field, Pager } from "../../components/ui";
import { Transactions } from "../../components/Transactions";
import { cash, date, labels } from "../../lib/format";
import type { Account, AuditEvent, List, Movement } from "../../lib/types";
import { useSession } from "../../session";

export default function AccountsPage() {
  const router = useRouter();
  const { busy, work } = useSession();
  const [accounts, setAccounts] = useState<List<Account>>({ items: [], page: 1, hasMore: false }),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Account | null>(null),
    [statement, setStatement] = useState<List<Movement>>({ items: [], page: 1, hasMore: false }),
    [timeline, setTimeline] = useState<{ movement: Movement; events: AuditEvent[] } | null>(null);
  async function loadAccounts(p = 1) {
    setAccounts(await api(`/admin/users?email=${encodeURIComponent(search)}&page=${p}`));
  }
  useEffect(() => {
    work(() => loadAccounts());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Abre o extrato de uma conta. A consulta é registrada na auditoria.
  async function inspect(a: Account) {
    await work(async () => {
      setSelected(a);
      setTimeline(null);
      setStatement(await api(`/admin/users/${a.id}/statement`));
    });
  }
  return (
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
                                  onClick={() => router.push(`/eventos?userId=${a.id}`)}
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
                    <Transactions admin statement={statement} busy={busy} onTrace={m => work(async () => { setTimeline(await api(`/admin/movements/${m.id}`)); })} onPage={p => work(async () => { if (selected) setStatement(await api(`/admin/users/${selected.id}/statement?page=${p}`)); })} />
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
  );
}
