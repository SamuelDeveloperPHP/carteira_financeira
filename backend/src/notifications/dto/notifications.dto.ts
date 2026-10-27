/**
 * Corpo das rotas POST de notificações. Marcar como lida não leva dados (o alvo
 * vem da URL e o usuário, da sessão). A classe vazia faz o pipe global recusar
 * qualquer campo extra enviado.
 */
export class EmptyBodyDto {}
