"use client";
/*
 * Gráficos em SVG puro (sem biblioteca): leves, sem dependência nova e
 * acessíveis. Cada gráfico tem `role="img"` com um resumo em texto e um
 * <title> por barra/ponto (aparece ao passar o mouse). Valores em centavos.
 */
import { cash } from "../lib/format";

export const GREEN = "#176b57";
export const RED = "#b3261e";
const GRID = "#d8e1e7";
const MUTED = "#526777";

/** Valor compacto para o eixo: R$ 1,5 mil, R$ 2 mi. */
export function compact(cents: number): string {
  const v = cents / 100;
  const abs = Math.abs(v);
  const f = (n: number) =>
    n
      .toFixed(n >= 10 ? 0 : 1)
      .replace(".", ",")
      .replace(/,0$/, "");
  if (abs >= 1_000_000) return `R$ ${f(v / 1_000_000)} mi`;
  if (abs >= 1_000) return `R$ ${f(v / 1_000)} mil`;
  return `R$ ${f(v)}`;
}

/** "Bom" teto do eixo (1, 2, 5 × 10^n) para as linhas de grade ficarem redondas. */
function niceMax(value: number): number {
  if (value <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

const W = 640;
const H = 240;
const PAD = { left: 64, right: 12, top: 14, bottom: 30 };
const innerW = W - PAD.left - PAD.right;
const innerH = H - PAD.top - PAD.bottom;

function Axes({ max, labels }: { max: number; labels: string[] }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  // Mostra no máximo ~8 rótulos no eixo X.
  const step = Math.ceil(labels.length / 8) || 1;
  const slot = innerW / Math.max(labels.length, 1);
  return (
    <>
      {ticks.map(t => {
        const y = PAD.top + innerH * (1 - t);
        return (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y}
              y2={y}
              stroke={GRID}
            />
            <text
              x={PAD.left - 8}
              y={y + 4}
              textAnchor="end"
              fontSize="11"
              fill={MUTED}
            >
              {compact(max * t)}
            </text>
          </g>
        );
      })}
      {labels.map((l, i) =>
        i % step === 0 ? (
          <text
            key={i}
            x={PAD.left + slot * (i + 0.5)}
            y={H - 10}
            textAnchor="middle"
            fontSize="11"
            fill={MUTED}
          >
            {l}
          </text>
        ) : null
      )}
    </>
  );
}

export type Point = {
  label: string;
  income: number;
  expense: number;
  balance: number;
};

/** Barras agrupadas: entradas (verde) e saídas (vermelho) por intervalo. */
export function FlowChart({ points }: { points: Point[] }) {
  const max = niceMax(
    Math.max(...points.flatMap(p => [p.income, p.expense]), 0)
  );
  const slot = innerW / Math.max(points.length, 1);
  const bar = Math.min(26, slot * 0.36);
  const h = (v: number) => (v / max) * innerH;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Entradas e saídas em ${points.length} intervalo(s)`}
      className="chart"
    >
      <Axes max={max} labels={points.map(p => p.label)} />
      {points.map((p, i) => {
        const cx = PAD.left + slot * (i + 0.5);
        return (
          <g key={i}>
            <rect
              x={cx - bar - 1}
              y={PAD.top + innerH - h(p.income)}
              width={bar}
              height={h(p.income)}
              fill={GREEN}
              rx="2"
            >
              <title>{`${p.label}: entradas ${cash(p.income)}`}</title>
            </rect>
            <rect
              x={cx + 1}
              y={PAD.top + innerH - h(p.expense)}
              width={bar}
              height={h(p.expense)}
              fill={RED}
              rx="2"
            >
              <title>{`${p.label}: saídas ${cash(p.expense)}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

/** Linha do saldo ao fim de cada intervalo, com área suave sob a curva. */
export function BalanceChart({ points }: { points: Point[] }) {
  const max = niceMax(Math.max(...points.map(p => p.balance), 0));
  const slot = innerW / Math.max(points.length, 1);
  const xy = (p: Point, i: number): [number, number] => [
    PAD.left + slot * (i + 0.5),
    PAD.top + innerH - (p.balance / max) * innerH,
  ];
  const coords = points.map(xy);
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const area = coords.length
    ? `${coords[0][0]},${PAD.top + innerH} ${line} ${coords[coords.length - 1][0]},${PAD.top + innerH}`
    : "";
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Evolução do saldo; último valor ${cash(points.at(-1)?.balance ?? 0)}`}
      className="chart"
    >
      <Axes max={max} labels={points.map(p => p.label)} />
      <polygon points={area} fill={GREEN} opacity="0.12" />
      <polyline
        points={line}
        fill="none"
        stroke={GREEN}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={coords[i][0]}
          cy={coords[i][1]}
          r="4"
          fill="#fff"
          stroke={GREEN}
          strokeWidth="2"
        >
          <title>{`${p.label}: saldo ${cash(p.balance)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** Barras horizontais proporcionais (por tipo de operação). */
export function HBars({
  rows,
}: {
  rows: { label: string; value: number; count: number; color: string }[];
}) {
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <ul className="hbars">
      {rows.map(r => (
        <li key={r.label}>
          <div className="hbars-head">
            <span>{r.label}</span>
            <strong>{cash(r.value)}</strong>
          </div>
          <div className="hbars-track" aria-hidden="true">
            <span
              style={{
                width: `${(r.value / max) * 100}%`,
                background: r.color,
              }}
            />
          </div>
          <small className="muted">{r.count} operação(ões)</small>
        </li>
      ))}
    </ul>
  );
}
