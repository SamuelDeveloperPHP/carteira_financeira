import { HttpException } from "@nestjs/common";

/**
 * Structured log line for failures nobody planned for (database down, bug,
 * provider outage). Business refusals (HttpException: insufficient balance,
 * unknown recipient...) are expected and already recorded in the audit trail,
 * so they are not logged here.
 *
 * Only the error type and driver code are written: messages and stacks can
 * carry SQL parameters, e-mails or tokens.
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
