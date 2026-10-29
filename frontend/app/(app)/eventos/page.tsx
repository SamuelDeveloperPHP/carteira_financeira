"use client";
// Master: trilha de auditoria com filtros (usuário, ação, resultado, IP, período),
// localização e posição em grade local. O filtro de usuário pode vir da URL
// (?userId=...), usado pelo botão "Atividades" da lista de contas.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../api";
import { AuditRow } from "../../components/AuditRow";
import { Field, Pager } from "../../components/ui";
import type { AuditEvent, List } from "../../lib/types";
import { useSession } from "../../session";

const NO_FILTERS = {
  userId: "",
  action: "",
  outcome: "",
  ip: "",
  from: "",
  to: "",
};

function Events() {
  const { busy, work } = useSession();
  const params = useSearchParams();
  const [events, setEvents] = useState<List<AuditEvent>>({
      items: [],
      page: 1,
      hasMore: false,
    }),
    [filters, setFilters] = useState({
      ...NO_FILTERS,
      userId: params.get("userId") ?? "",
    }),
    [expanded, setExpanded] = useState<string | null>(null),
    [map, setMap] = useState<string | null>(null);
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
  useEffect(() => {
    work(() => loadEvents());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
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
              onChange={e => setFilters({ ...filters, userId: e.target.value })}
            />
          </Field>
          <Field label="Ação contém">
            <input
              className="form-control"
              placeholder="auth.login"
              value={filters.action}
              onChange={e => setFilters({ ...filters, action: e.target.value })}
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
              onChange={e => setFilters({ ...filters, ip: e.target.value })}
            />
          </Field>
        </div>
        <div className="filters">
          <Field label="Desde">
            <input
              type="datetime-local"
              className="form-control"
              value={filters.from}
              onChange={e => setFilters({ ...filters, from: e.target.value })}
            />
          </Field>
          <Field label="Até">
            <input
              type="datetime-local"
              className="form-control"
              value={filters.to}
              onChange={e => setFilters({ ...filters, to: e.target.value })}
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
        <p className="empty">Nenhum evento para os filtros informados.</p>
      )}
      <Pager
        value={events}
        busy={busy}
        change={p => work(() => loadEvents(p))}
      />
      <p className="footer-note">
        O IP pode ser compartilhado. A localização vem do navegador e pode ser
        imprecisa ou manipulada. Todas as consultas administrativas são
        auditadas.
      </p>
    </section>
  );
}

// useSearchParams exige Suspense no build de produção do Next.
export default function EventsPage() {
  return (
    <Suspense fallback={<p className="loading">Carregando…</p>}>
      <Events />
    </Suspense>
  );
}
