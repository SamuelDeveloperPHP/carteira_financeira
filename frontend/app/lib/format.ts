// Formatação e conversões usadas pelas páginas.

// Centavos -> "R$ 25,50". O banco guarda inteiros; a divisão por 100 só
// acontece aqui, na hora de exibir.
export const cash = (v: number | string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v) / 100
  );
export const date = (v: string) => new Date(v).toLocaleString("pt-BR");
// Teto de uma adição de saldo (R$ 10.000,00, em centavos). Espelha o limite do
// servidor, que é quem de fato o impõe; aqui serve só para responder na hora.
export const SELF_DEPOSIT_MAX_CENTS = 1_000_000;

// Converte o texto digitado ("25,50" ou "25.5") em CENTAVOS inteiros, sem usar
// ponto flutuante: separa reais e centavos como texto e combina com inteiros
// (25*100 + 50). O servidor valida de novo; esta checagem só dá resposta rápida.
export function toCents(text: string): number {
  if (!/^\d{1,10}([,.]\d{1,2})?$/.test(text))
    throw new Error("Informe um valor válido, como 25,50.");
  const [w, d = ""] = text.replace(",", ".").split(".");
  const value = Number(w) * 100 + Number(d.padEnd(2, "0"));
  if (value < 1 || value > 1000000000000)
    throw new Error("Informe um valor positivo dentro do limite.");
  return value;
}

// Tradução dos códigos técnicos da API para texto de tela.
export const labels: Record<string, string> = {
  transfer_received: "Transferência recebida",
  refund_received: "Devolução recebida",
  deposit: "Depósito simulado",
  transfer: "Transferência",
  refund: "Devolução",
  success: "Sucesso",
  denied: "Recusado",
  failure: "Falha",
  unavailable: "Indisponível",
  timeout: "Tempo esgotado",
  disabled: "Desativada pelo usuário",
};
