import { EmailField, MoneyField } from "../../common/dto/fields";

export class TransferDto {
  @EmailField() recipientEmail!: string;
  @MoneyField() amount!: number;
}

// Refund carries no data; the empty class makes the pipe reject any extra field.
export class RefundDto {}
