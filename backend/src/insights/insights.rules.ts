/**
 * Regras que transformam os números do período em SUGESTÕES em português.
 * Função pura (sem banco): recebe os totais e devolve a lista, o que a torna
 * fácil de testar. Valores monetários em centavos.
 *
 * As sugestões são orientações gerais sobre o uso da carteira de demonstração;
 * não são aconselhamento financeiro ou de investimento.
 */

export interface InsightInput {
  days: number;
  balance: number;
  income: number;
  expense: number;
  movements: number;
  sentCount: number;
  biggestOut: number;
  topOutflow: { name: string; share: number } | null;
  refundsSent: number;
  refundsReceived: number;
}

export interface Suggestion {
  id: string;
  level: "success" | "info" | "warning";
  title: string;
  message: string;
}

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(cents / 100)
    .replace(/ /g, " ");
const pct = (v: number) => `${Math.round(v * 100)}%`;
const ORDER = { warning: 0, info: 1, success: 2 } as const;

export function buildSuggestions(i: InsightInput): Suggestion[] {
  const out: Suggestion[] = [];

  if (i.movements === 0)
    return [
      {
        id: "no-activity",
        level: "info",
        title: "Sem movimentações no período",
        message:
          "Ainda não há dados para analisar. Adicione saldo ou faça uma transferência e volte aqui para ver indicadores e sugestões.",
      },
    ];

  // 1) Entradas x saídas.
  if (i.expense > 0 && i.income === 0)
    out.push({
      id: "only-outflows",
      level: "warning",
      title: "Só houve saídas no período",
      message: `Você enviou ${brl(i.expense)} e não recebeu nenhuma entrada. Confira se o saldo comporta os próximos pagamentos.`,
    });
  else if (i.expense > i.income)
    out.push({
      id: "outflows-above-inflows",
      level: "warning",
      title: "Saídas maiores que entradas",
      message: `As saídas (${brl(i.expense)}) superaram as entradas (${brl(i.income)}) em ${pct(i.expense / i.income - 1)}. Esse ritmo reduz o saldo.`,
    });
  else if (i.income > i.expense)
    out.push({
      id: "positive-net",
      level: "success",
      title: "Saldo em crescimento",
      message: `As entradas superaram as saídas em ${brl(i.income - i.expense)} no período.`,
    });

  // 2) Fôlego do saldo no ritmo atual de saídas.
  if (i.expense > 0) {
    const perDay = i.expense / i.days;
    const cover = Math.floor(i.balance / perDay);
    out.push(
      cover < 7
        ? {
            id: "low-runway",
            level: "warning",
            title: "Saldo cobre poucos dias",
            message: `No ritmo médio de ${brl(Math.round(perDay))} por dia, o saldo atual (${brl(i.balance)}) cobre cerca de ${cover} dia(s). Considere adicionar saldo.`,
          }
        : {
            id: "runway",
            level: "info",
            title: "Fôlego do saldo",
            message: `No ritmo médio de ${brl(Math.round(perDay))} por dia, o saldo atual cobre cerca de ${cover} dias.`,
          }
    );
  }

  // 3) Concentração das saídas em uma pessoa.
  if (i.topOutflow && i.sentCount >= 3 && i.topOutflow.share >= 0.6)
    out.push({
      id: "concentration",
      level: "info",
      title: "Saídas concentradas em uma pessoa",
      message: `${i.topOutflow.name} recebeu ${pct(i.topOutflow.share)} do que você enviou. Se for recorrente, vale acompanhar esse destino.`,
    });

  // 4) Saída atípica (muito acima da média).
  if (i.sentCount >= 4) {
    const avg = i.expense / i.sentCount;
    if (i.biggestOut > avg * 3)
      out.push({
        id: "atypical-outflow",
        level: "info",
        title: "Uma saída fora do padrão",
        message: `Sua maior saída (${brl(i.biggestOut)}) é ${(i.biggestOut / avg).toFixed(1).replace(".", ",")} vezes a média das suas saídas (${brl(Math.round(avg))}).`,
      });
  }

  // 5) Devoluções.
  if (i.refundsSent > 0)
    out.push({
      id: "refunds-sent",
      level: "info",
      title: "Você devolveu transferências",
      message: `${i.refundsSent} devolução(ões) feita(s) no período. Devoluções são integrais e ficam registradas no extrato.`,
    });
  if (i.refundsReceived > 0)
    out.push({
      id: "refunds-received",
      level: "info",
      title: "Você recebeu devoluções",
      message: `${i.refundsReceived} transferência(s) sua(s) foi(ram) devolvida(s). O valor já voltou ao seu saldo.`,
    });

  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}
