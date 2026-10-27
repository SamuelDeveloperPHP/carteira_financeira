import { HttpException } from "@nestjs/common";

/**
 * Escreve uma linha de log estruturada (JSON) para falhas que ninguém previu:
 * banco fora do ar, bug, provedor de pagamento indisponível.
 *
 * Recusas de negócio (HttpException: saldo insuficiente, destinatário
 * inexistente...) são ESPERADAS e já ficam na trilha de auditoria, então não
 * poluem o log de erros.
 *
 * Só o TIPO do erro e o código do driver são gravados. A mensagem e a pilha
 * podem conter parâmetros SQL, e-mails ou tokens, e jamais devem ir para o log.
 * O `correlationId` permite achar a requisição e o evento de auditoria
 * correspondentes.
 */
export function logUnexpected(
  event: string,
  correlationId: string | undefined,
  error: unknown,
  extra: Record<string, unknown> = {}
): void {
  if (error instanceof HttpException) return;
  const failure = error as { code?: string; constructor?: { name?: string } };
  console.error(
    JSON.stringify({
      event,
      correlationId,
      errorType: failure?.constructor?.name,
      code: failure?.code,
      ...extra,
    })
  );
}
