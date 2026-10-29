"use client";
// Master: usuários, movimentações, saldo total, conciliação e alertas operacionais.
import { useEffect, useState } from "react";
import { api } from "../../api";
import { cash } from "../../lib/format";
import type { Metrics } from "../../lib/types";
import { useSession } from "../../session";

export default function MetricsPage() {
  const { busy, work } = useSession();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  useEffect(() => {
    work(async () => setMetrics(await api("/admin/metrics")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!metrics) return null;
  return (
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
          ["Recusas / falhas em 15 min", metrics.failuresLast15Minutes],
          ["Banco de dados", "Disponível"],
          [
            "Conciliação",
            metrics.reconciliation.balanced ? "Sem divergências" : "Investigar",
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
          conciliação compara os saldos aos lançamentos e depósitos. Indicadores
          atualizados por consulta.
        </p>
      </section>
    </>
  );
}
