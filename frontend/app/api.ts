// Cliente HTTP único da aplicação (compartilhado pela tela principal e pelo perfil).

// Erro devolvido pela API, com o status HTTP. A mensagem já vem segura e em
// português, pronta para ser mostrada ao usuário.
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    // Código estável (opcional) enviado pela API; decide o comportamento da
    // tela sem depender do texto da mensagem, que é para pessoas.
    public code?: string
  ) {
    super(message);
  }
}
// ÚNICO ponto de saída para a API. Centralizar evita esquecer cabeçalhos.
//  - credentials "same-origin": envia o cookie de sessão só para o próprio site;
//  - cache "no-store": saldo e extrato nunca vêm de cache do navegador;
//  - X-Wallet-Request: prova ao servidor que a chamada vem desta aplicação
//    (defesa contra CSRF, junto com o cabeçalho Origin);
//  - Idempotency-Key (opcional): usada nas operações que movem dinheiro, para
//    que repetir o pedido não pague duas vezes.
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string
): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Wallet-Request": "1",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  // Se a resposta não for JSON (ex.: gateway fora do ar), usa mensagem genérica.
  const data = await r
    .json()
    .catch(() => ({ message: "Serviço indisponível. Tente novamente." }));
  if (!r.ok)
    throw new ApiError(
      data.message || "Não foi possível concluir.",
      r.status,
      data.code
    );
  return data;
}
