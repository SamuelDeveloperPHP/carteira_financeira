"use client";
// Minha carteira: saldo, adicionar saldo, transferência e extrato.
import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { confirmAction, escapeHtml, notify } from "../../alerts";
import { Field } from "../../components/ui";
import { Transactions } from "../../components/Transactions";
import { cash, SELF_DEPOSIT_MAX_CENTS, toCents } from "../../lib/format";
import type { List, Movement } from "../../lib/types";
import { useSession } from "../../session";

export default function WalletPage() {
  const { user, busy, work } = useSession();
  const [balance, setBalance] = useState(0),
    [statement, setStatement] = useState<List<Movement>>({ items: [], page: 1, hasMore: false }),
    [recipient, setRecipient] = useState(""),
    [amount, setAmount] = useState(""),
    [topUp, setTopUp] = useState("");
  // Chaves de idempotência. Ficam em useRef (não em estado) porque não afetam a
  // tela e precisam sobreviver entre cliques:
  //  - `request`: a chave da transferência em andamento. Se o usuário clicar de
  //    novo com OS MESMOS dados (ex.: após timeout de rede), reaproveita a chave
  //    e o servidor devolve o resultado original em vez de pagar duas vezes.
  //  - `depositRequest`: o mesmo para a adição de saldo.
  //  - `refundKeys`: uma chave por transferência devolvida.
  const request = useRef<{ payload: string; key: string } | null>(null),
    depositRequest = useRef<{ amount: number; key: string } | null>(null),
    refundKeys = useRef<Record<string, string>>({});
  // Saldo e extrato são buscados juntos (Promise.all), em paralelo.
  async function loadWallet(p = 1) {
    const [w, s] = await Promise.all([
      api<{ balance: number }>("/wallet"),
      api<List<Movement>>(`/wallet/statement?page=${p}`),
    ]);
    setBalance(w.balance);
    setStatement(s);
  }
  useEffect(() => {
    work(() => loadWallet());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Adicionar saldo (simulado): (1) valida o valor e o teto, (2) pede confirmação,
  // (3) envia com chave de idempotência e (4) mostra a mensagem devolvida pela
  // API. Se a rede falhar e o usuário clicar de novo com o MESMO valor, a chave é
  // reaproveitada e o servidor não credita duas vezes.
  async function addBalance(e: FormEvent) {
    e.preventDefault();
    await work(async () => {
      const value = toCents(topUp);
      if (value > SELF_DEPOSIT_MAX_CENTS)
        throw new Error("O valor máximo por adição é R$ 10.000,00.");
      const confirmed = await confirmAction({
        title: "Adicionar saldo",
        html: `Adicionar <strong>${cash(value)}</strong> (valor simulado) à sua carteira?`,
        confirmText: "Adicionar",
      });
      if (!confirmed) return;
      if (depositRequest.current?.amount !== value)
        depositRequest.current = { amount: value, key: crypto.randomUUID() };
      const r = await api<{ message: string }>(
        "/deposits",
        "POST",
        { amount: value },
        depositRequest.current.key
      );
      depositRequest.current = null;
      setTopUp("");
      await loadWallet();
      notify("success", r.message);
    });
  }
  // Transferir: (1) valida o valor, (2) confere o saldo para resposta imediata
  // (a verificação que vale é a do servidor, dentro da transação), (3) pede
  // confirmação, (4) envia com chave de idempotência e (5) recarrega o extrato.
  async function transfer(e: FormEvent) {
    e.preventDefault();
    await work(async () => {
      const value = toCents(amount);
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
      notify("success", `${r.message} Referência: ${r.id}`);
    });
  }
  // Devolver (reversão pedida pelo usuário): só aparece para quem RECEBEU a
  // transferência. É sempre integral e única; o servidor impõe as duas regras.
  async function refund(m: Movement) {
    await work(async () => {
      const confirmed = await confirmAction({
        title: "Devolver transferência",
        html: `Devolver <strong>${cash(m.amount)}</strong> a <strong>${escapeHtml(m.sender_name)}</strong>? A devolução é integral e não pode ser repetida.`,
        confirmText: "Devolver",
      });
      if (!confirmed) return;
      // Uma chave de idempotência por transferência: repetir o clique nunca devolve duas vezes.
      refundKeys.current[m.id] ??= crypto.randomUUID();
      const r = await api<{ message: string }>(
        `/transfers/${m.id}/refund`,
        "POST",
        {},
        refundKeys.current[m.id]
      );
      await loadWallet(statement.page);
      notify("success", r.message);
    });
  }
  return (
              <>
                <div className="wallet-grid">
                  <section className="panel balance-panel">
                    <h2>Saldo disponível</h2>
                    <div className="balance">{cash(balance)}</div>
                    <span className="tag success">
                      Carteira em reais · Simulação
                    </span>
                    {/* Saldo inicial: o próprio usuário adiciona valor simulado à sua carteira. */}
                    <form className="balance-note" onSubmit={addBalance}>
                      <h3>Adicionar saldo</h3>
                      <p className="muted small">
                        Valor simulado, até R$ 10.000,00 por adição. Você também
                        pode receber transferências de outros usuários.
                      </p>
                      <Field label="Valor em reais">
                        <input
                          className="form-control"
                          inputMode="decimal"
                          placeholder="0,00"
                          required
                          value={topUp}
                          onChange={e => setTopUp(e.target.value)}
                        />
                      </Field>
                      <button className="btn btn-primary" disabled={busy}>
                        {busy ? "Processando…" : "Adicionar saldo"}
                      </button>
                    </form>
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
                  <Transactions statement={statement} busy={busy} userId={user?.id} onRefund={refund} onPage={p => work(() => loadWallet(p))} />
                </section>
              </>
  );
}
