import { SELF_DEPOSIT_MAX_CENTS } from "../../common/constants";
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
 * Corpo de POST /deposits ("adicionar saldo"). Também não há id de carteira: o
 * crédito vai sempre para a conta da sessão. O teto por operação é aplicado
 * aqui, antes de qualquer regra de negócio, com mensagem própria.
 */
export class DepositDto {
  /** Em CENTAVOS inteiros, de 1 até SELF_DEPOSIT_MAX_CENTS (R$ 10.000,00). */
  @MoneyField(
    SELF_DEPOSIT_MAX_CENTS,
    "O valor máximo por adição é R$ 10.000,00."
  )
  amount!: number;
}

/**
 * Corpo de POST /transfers/:id/refund. A devolução é sempre integral e quem
 * decide é o servidor, então não há dados a enviar. A classe vazia faz o pipe
 * recusar qualquer campo extra (por exemplo, tentar devolver um valor parcial).
 */
export class RefundDto {}
