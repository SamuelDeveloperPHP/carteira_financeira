import { ValidationPipe } from "@nestjs/common";
import { validationFailure } from "./fields";

/**
 * Configuração ÚNICA da validação de entrada, usada pela aplicação e pelos testes.
 *
 * - whitelist + forbidNonWhitelisted: campo que o DTO não declara é RECUSADO
 *   (não apenas ignorado). Uma requisição com `role: "master"` ou `senderId`
 *   falha por inteiro, em vez de ser aplicada pela metade. Isso fecha a porta
 *   para "mass assignment" e escalonamento de privilégio.
 * - transform: converte o corpo em instância do DTO e aplica as normalizações
 *   (e-mail minúsculo, textos aparados, página "3" -> 3).
 * - exceptionFactory: devolve sempre UMA mensagem curta em português, sem
 *   expor nomes de campos nem detalhes internos.
 */
export const createValidationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: validationFailure,
  });
