import { Injectable } from "@nestjs/common";
import { Bucket, InsightsRepository } from "./insights.repository";
import { buildSuggestions } from "./insights.rules";

/**
 * Painel de BI do próprio usuário: totais, séries para gráficos, principais
 * contrapartes e sugestões. Somente leitura sobre o razão; não gera auditoria
 * nem altera dados. Valores em centavos (as somas cabem com folga em um inteiro
 * seguro do JavaScript para o volume desta demonstração).
 */
@Injectable()
export class InsightsService {
  constructor(private readonly repo: InsightsRepository) {}

  async overview(userId: string, period: "30" | "90" | "365" = "90") {
    const days = Number(period);
    // 30 dias por dia, 90 por semana e 365 por mês: gráficos legíveis em qualquer período.
    const bucket: Bucket = days <= 30 ? "day" : days <= 90 ? "week" : "month";
    const [balance, kinds, series, counterparts] = await Promise.all([
      this.repo.balance(userId),
      this.repo.byKind(userId, days),
      this.repo.series(userId, days, bucket),
      this.repo.counterparts(userId, days),
    ]);

    const pick = (kind: string, incoming: boolean) => {
      const r = kinds.find(k => k.kind === kind && k.incoming === incoming);
      return {
        count: r?.n ?? 0,
        total: Number(r?.total ?? 0),
        biggest: Number(r?.biggest ?? 0),
      };
    };
    const deposits = pick("deposit", true);
    const received = pick("transfer", true);
    const sent = pick("transfer", false);
    const refundsReceived = pick("refund", true);
    const refundsSent = pick("refund", false);

    const income = deposits.total + received.total + refundsReceived.total;
    const expense = sent.total + refundsSent.total;
    const movements = kinds.reduce((sum, k) => sum + k.n, 0);

    const top = counterparts
      .map(c => ({
        id: c.id,
        name: c.name,
        received: Number(c.received),
        sent: Number(c.sent),
        count: c.n,
      }))
      .sort((a, b) => b.sent + b.received - (a.sent + a.received));
    const topOut = [...top].sort((a, b) => b.sent - a.sent)[0];

    return {
      period: days,
      bucket,
      balance: Number(balance),
      summary: {
        income,
        expense,
        net: income - expense,
        movements,
        averageOut: sent.count ? Math.round(sent.total / sent.count) : 0,
        biggestOut: Math.max(sent.biggest, refundsSent.biggest),
        biggestIn: Math.max(
          deposits.biggest,
          received.biggest,
          refundsReceived.biggest
        ),
      },
      byKind: [
        {
          id: "deposit",
          label: "Saldo adicionado",
          direction: "in",
          ...deposits,
        },
        {
          id: "transfer_in",
          label: "Transferências recebidas",
          direction: "in",
          ...received,
        },
        {
          id: "refund_in",
          label: "Devoluções recebidas",
          direction: "in",
          ...refundsReceived,
        },
        {
          id: "transfer_out",
          label: "Transferências enviadas",
          direction: "out",
          ...sent,
        },
        {
          id: "refund_out",
          label: "Devoluções enviadas",
          direction: "out",
          ...refundsSent,
        },
      ],
      series: series.map(s => ({
        date: s.bucket,
        income: Number(s.income),
        expense: Number(s.expense),
        balance: Number(s.balance_after),
      })),
      counterparts: top,
      suggestions: buildSuggestions({
        days,
        balance: Number(balance),
        income,
        expense,
        movements,
        sentCount: sent.count,
        biggestOut: sent.biggest,
        topOutflow:
          topOut && topOut.sent > 0 && sent.total > 0
            ? { name: topOut.name, share: topOut.sent / sent.total }
            : null,
        refundsSent: refundsSent.count,
        refundsReceived: refundsReceived.count,
      }),
    };
  }
}
