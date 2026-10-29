"use client";
// Tabela de movimentações, reutilizada pelas duas visões: a do cliente (com o
// botão Devolver) e a do master (com o botão Rastrear). `admin` escolhe a ação.
import { cash, date, labels } from "../lib/format";
import type { List, Movement } from "../lib/types";
import { Pager } from "./ui";

export function Transactions({
  statement,
  busy,
  admin = false,
  userId,
  onRefund,
  onTrace,
  onPage,
}: {
  statement: List<Movement>;
  busy: boolean;
  admin?: boolean;
  userId?: string;
  onRefund?: (m: Movement) => void;
  onTrace?: (m: Movement) => void;
  onPage: (p: number) => void;
}) {
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
                <td className={`amount ${Number(m.delta) > 0 ? "credit" : ""}`}>
                  {Number(m.delta) > 0 ? "+" : ""}
                  {cash(m.delta)}
                </td>
                <td className="amount">{cash(m.balance_after)}</td>
                <td>
                  {admin ? (
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => onTrace?.(m)}
                    >
                      Rastrear
                    </button>
                  ) : m.kind === "transfer" &&
                    m.recipient_id === userId &&
                    !m.refund_id ? (
                    <button
                      disabled={busy}
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => onRefund?.(m)}
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
      <Pager value={statement} busy={busy} change={onPage} />
    </>
  );
}
