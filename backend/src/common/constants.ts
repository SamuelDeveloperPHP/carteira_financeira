// Valores de regra de negócio e segurança em um só lugar. Alterar uma política
// (tempo de sessão, limite de valor) é mudar uma linha aqui, não caçar números
// espalhados pelo código.

/** Limite por carteira e por operação: R$ 10 bilhões, em centavos. Valor de demonstração, não política bancária. Espelha o CHECK do banco. */
export const MAX_CENTS = 1_000_000_000_000;

/** Nome do cookie de sessão. */
export const SESSION_COOKIE = "wallet_session";

/** Validade do link de recuperação de senha. Curta de propósito: reduz a janela de uso se o e-mail for exposto. */
export const RESET_MINUTES = 7;

/** Validade da sessão "parcial" (senha aceita, falta o 2FA). Basta para digitar o código. */
export const PARTIAL_SESSION_MINUTES = 10;

/** Validade da sessão completa: 8 horas (um dia de trabalho), depois exige novo login. */
export const FULL_SESSION_MINUTES = 8 * 60;

/** Máximo de sessões completas simultâneas por usuário; ao exceder, as mais antigas são revogadas (limita o dano de um cookie roubado). */
export const MAX_FULL_SESSIONS = 5;

/** Itens por página no extrato e na lista de contas. */
export const PAGE_SIZE = 20;

/** Itens por página na lista de eventos de auditoria (mais densa, por isso maior). */
export const EVENTS_PAGE_SIZE = 30;
