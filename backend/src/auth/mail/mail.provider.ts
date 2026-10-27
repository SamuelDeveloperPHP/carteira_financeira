/**
 * Contrato de envio de e-mail. O restante do sistema só conhece esta interface
 * (princípio da inversão de dependência): trocar o mecanismo de envio não exige
 * mexer nas regras de recuperação de senha.
 */
export interface MailProvider {
  readonly name: string;
  /** Envia o link de redefinição. `minutes` é a validade, para constar no texto. */
  sendPasswordReset(to: string, token: string, minutes: number): Promise<void>;
}

/**
 * Token de injeção. Interfaces TypeScript não existem em tempo de execução, então
 * o Nest precisa de um símbolo para saber qual implementação entregar.
 */
export const MAIL_PROVIDER = Symbol("MAIL_PROVIDER");
