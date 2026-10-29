"use client";
/*
 * Relatórios: indicadores, gráficos e sugestões sobre as movimentações do
 * próprio usuário, em uma página separada de "Minha carteira". Os números vêm
 * do servidor (GET /insights); as sugestões são regras automáticas e NÃO são
 * aconselhamento financeiro.
 */
import { useEffect, useState } from "react";
import { api } from "../../api";
import {
  BalanceChart,
  FlowChart,
  GREEN,
  HBars,
  Point,
  RED,
} from "../../components/charts";
import { cash } from "../../lib/format";
import { useSession } from "../../session";

type Period = "30" | "90" | "365";
type Overview = {
  period: number;
  bucket: "day" | "week" | "month";
  balance: number;
  summary: {
    income: number;
    expense: number;
    net: number;
    movements: number;
    averageOut: number;
    biggestOut: number;
    biggestIn: number;
  };
  byKind: {
    id: string;
    label: string;
    direction: "in" | "out";
    count: number;
    total: number;
  }[];
  series: { date: string; income: number; expense: number; balance: number }[];
  counterparts: {
    id: string;
    name: string;
    received: number;
    sent: number;
    count: number;
  }[];
  suggestions: {
    id: string;
    level: "success" | "info" | "warning";
    title: string;
    message: string;
  }[];
};

const PERIODS: [Period, string][] = [
  ["30", "30 dias"],
  ["90", "90 dias"],
  ["365", "12 meses"],
];
const BUCKET_TEXT = { day: "por dia", week: "por semana", month: "por mês" };
const LEVEL_TEXT = {
  warning: "Atenção",
  info: "Informação",
  success: "Bom sinal",
};
const two = (n: number) => String(n).padStart(2, "0");

/** Rótulo do intervalo: dd/mm (dia e semana) ou mm/aaaa (mês). */
function label(date: string, bucket: Overview["bucket"]) {
  const d = new Date(date);
  return bucket === "month"
    ? `${two(d.getMonth() + 1)}/${d.getFullYear()}`
    : `${two(d.getDate())}/${two(d.getMonth() + 1)}`;
}

export default function BiPage() {
  const { busy, work } = useSession();
  const [period, setPeriod] = useState<Period>("90");
  const [data, setData] = useState<Overview | null>(null);

  async function load(p: Period = period) {
    setData(await api<Overview>(`/insights?period=${p}`));
  }
  useEffect(() => {
    work(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(p: Period) {
    setPeriod(p);
    work(() => load(p));
  }

  if (!data) return null;
  const s = data.summary;
  const points: Point[] = data.series.map(p => ({
    label: label(p.date, data.bucket),
    income: p.income,
    expense: p.expense,
    balance: p.balance,
  }));
  const kpis: [string, string, string?][] = [
    ["Entradas", cash(s.income), "pos"],
    ["Saídas", cash(s.expense), "neg"],
    [
      "Resultado do período",
      `${s.net > 0 ? "+" : ""}${cash(s.net)}`,
      s.net >= 0 ? "pos" : "neg",
    ],
    ["Saldo atual", cash(data.balance)],
    ["Movimentações", String(s.movements)],
    ["Maior saída", cash(s.biggestOut)],
    ["Média por transferência enviada", cash(s.averageOut)],
    ["Maior entrada", cash(s.biggestIn)],
  ];

  return (
    <>
      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Relatórios</h2>
            <p className="muted mb-0">
              Indicadores e sugestões sobre as suas movimentações.
            </p>
          </div>
          <div className="seg" role="group" aria-label="Período">
            {PERIODS.map(([id, title]) => (
              <button
                key={id}
                type="button"
                className={period === id ? "active" : ""}
                aria-pressed={period === id}
                disabled={busy}
                onClick={() => choose(id)}
              >
                {title}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Sugestões</h2>
        <ul className="suggestions">
          {data.suggestions.map(sg => (
            <li key={sg.id} className={sg.level}>
              <span className="suggestion-level">{LEVEL_TEXT[sg.level]}</span>
              <strong>{sg.title}</strong>
              <p className="mb-0">{sg.message}</p>
            </li>
          ))}
        </ul>
        <p className="footer-note">
          Sugestões geradas automaticamente a partir das suas movimentações
          simuladas. Não são aconselhamento financeiro nem recomendação de
          investimento.
        </p>
      </section>

      <div className="metric-grid">
        {kpis.map(([caption, value, tone]) => (
          <section className="panel" key={caption}>
            <h3>{caption}</h3>
            <p className={`metric-value ${tone ?? ""}`}>{value}</p>
          </section>
        ))}
      </div>

      <section className="panel">
        <h2>Entradas e saídas</h2>
        <p className="muted">
          {BUCKET_TEXT[data.bucket]} · <span style={{ color: GREEN }}>■</span>{" "}
          entradas <span style={{ color: RED }}>■</span> saídas
        </p>
        {points.length ? (
          <FlowChart points={points} />
        ) : (
          <p className="muted">Sem movimentações no período.</p>
        )}
      </section>

      <section className="panel">
        <h2>Evolução do saldo</h2>
        <p className="muted">
          Saldo ao fim de cada intervalo com movimentação (
          {BUCKET_TEXT[data.bucket]}).
        </p>
        {points.length ? (
          <BalanceChart points={points} />
        ) : (
          <p className="muted">Sem movimentações no período.</p>
        )}
        {points.length > 0 && (
          <details className="chart-table">
            <summary>Ver os dados em tabela</summary>
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Intervalo</th>
                    <th>Entradas</th>
                    <th>Saídas</th>
                    <th>Saldo ao fim</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((p, i) => (
                    <tr key={i}>
                      <td>{p.label}</td>
                      <td className="amount credit">{cash(p.income)}</td>
                      <td className="amount">{cash(p.expense)}</td>
                      <td className="amount">{cash(p.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      <div className="wallet-grid">
        <section className="panel">
          <h2>Por tipo de operação</h2>
          <HBars
            rows={data.byKind.map(k => ({
              label: k.label,
              value: k.total,
              count: k.count,
              color: k.direction === "in" ? GREEN : RED,
            }))}
          />
        </section>
        <section className="panel">
          <h2>Principais contrapartes</h2>
          {data.counterparts.length ? (
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Pessoa</th>
                    <th>Enviado</th>
                    <th>Recebido</th>
                    <th>Operações</th>
                  </tr>
                </thead>
                <tbody>
                  {data.counterparts.map(c => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td className="amount">{cash(c.sent)}</td>
                      <td className="amount credit">{cash(c.received)}</td>
                      <td>{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              Nenhuma transferência com outras pessoas no período.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
