"use client";
/*
 * Aba "Trilha de acesso": histórico de entradas e saídas, tempo de permanência
 * e localização. Cada acesso tem o SEU mapa (um <div> Leaflet com marcador e
 * tooltip) e há um mapa geral com todos os pontos.
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import { AccessMiniMap, AccessOverviewMap } from "./AccessMap";
import {
  AccessEntry,
  dateTime,
  duration,
  END_REASONS,
  LOCATION_STATES,
} from "./format";
import { useWork } from "./useWork";

type Page = { items: AccessEntry[]; page: number; hasMore: boolean };

export function AccessTab({ fail }: { fail: (e: unknown) => void }) {
  const { busy, run } = useWork(fail);
  const [list, setList] = useState<Page>({
    items: [],
    page: 1,
    hasMore: false,
  });
  const [points, setPoints] = useState<AccessEntry[] | null>(null);

  async function load(page = 1) {
    const [l, m] = await Promise.all([
      api<Page>(`/access?page=${page}`),
      api<{ items: AccessEntry[] }>("/access/map"),
    ]);
    setList(l);
    setPoints(m.items);
  }
  useEffect(() => {
    run(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Mapa geral dos acessos</h2>
            <p className="muted mb-0">
              Passe o mouse (ou toque) em um marcador para ver os dados do
              acesso.
            </p>
          </div>
          <button
            className="btn btn-sm btn-outline-secondary"
            disabled={busy}
            onClick={() => run(() => load(list.page))}
          >
            Atualizar
          </button>
        </div>
        {points && <AccessOverviewMap items={points} />}
      </section>

      <section className="panel">
        <h2>Histórico de acessos</h2>
        {list.items.length === 0 && (
          <p className="muted">Nenhum acesso registrado.</p>
        )}
        <div className="access-list">
          {list.items.map(a => (
            <article className="access-card" key={a.id}>
              <header>
                <strong>{dateTime(a.startedAt)}</strong>
                <span className={`status ${a.active ? "ok" : "off"}`}>
                  {a.current
                    ? "Sessão atual"
                    : a.active
                      ? "Sessão ativa"
                      : (END_REASONS[a.endReason ?? ""] ?? "Encerrada")}
                </span>
              </header>
              <dl>
                <div>
                  <dt>Entrada</dt>
                  <dd>{dateTime(a.startedAt)}</dd>
                </div>
                <div>
                  <dt>Saída</dt>
                  <dd>{a.endedAt ? dateTime(a.endedAt) : "—"}</dd>
                </div>
                <div>
                  <dt>Permanência</dt>
                  <dd>
                    {duration(a.durationSeconds)}
                    {a.active && " (em andamento)"}
                  </dd>
                </div>
                <div>
                  <dt>IP</dt>
                  <dd>{a.ip ?? "—"}</dd>
                </div>
                <div>
                  <dt>Aparelho</dt>
                  <dd className="break">{a.device ?? "—"}</dd>
                </div>
                <div>
                  <dt>Localização</dt>
                  <dd>
                    {LOCATION_STATES[a.location.status] ?? a.location.status}
                    {a.location.accuracy !== undefined &&
                      ` · precisão de ${Math.round(a.location.accuracy)} m`}
                  </dd>
                </div>
              </dl>
              {/* Um mapa Leaflet por acesso. */}
              <AccessMiniMap access={a} />
            </article>
          ))}
        </div>
        <div className="pager">
          <button
            className="btn btn-sm btn-outline-secondary"
            disabled={list.page === 1 || busy}
            onClick={() => run(() => load(list.page - 1))}
          >
            Anterior
          </button>
          <small>Página {list.page}</small>
          <button
            className="btn btn-sm btn-outline-secondary"
            disabled={!list.hasMore || busy}
            onClick={() => run(() => load(list.page + 1))}
          >
            Próxima
          </button>
        </div>
        <p className="footer-note">
          A localização é informada pelo navegador no momento do login e não é
          verificada: serve para você reconhecer acessos estranhos. Os mapas
          usam o OpenStreetMap, que recebe do seu navegador o pedido das imagens
          da região exibida.
        </p>
      </section>
    </>
  );
}
