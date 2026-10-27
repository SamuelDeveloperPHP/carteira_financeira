import { EmailField, MoneyField } from "../../common/dto/fields";

/**
 * Corpo de POST /transfers. Note o que NÃO existe aqui: remetente. Ele vem
 * sempre da sessão autenticada, então ninguém consegue "transferir em nome de"
 * outra pessoa enviando um id no corpo.
 */
export class TransferDto {
  @EmailField() recipientEmail!: string;
  /** Em CENTAVOS inteiros (R$ 25,50 = 2550). Inteiro evita erro de arredondamento. */
  @MoneyField() amount!: number;
}

/**
 * Corpo de POST /transfers/:id/refund. A devolução é sempre integral e quem
 * decide é o servidor, então não há dados a enviar. A classe vazia faz o pipe
 * recusar qualquer campo extra (por exemplo, tentar devolver um valor parcial).
 */
export class RefundDto {}
