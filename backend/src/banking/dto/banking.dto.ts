import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";
import { Transform } from "class-transformer";
import { BANKS } from "../banks.catalog";
import { PIX_KEY_TYPES } from "../pix-key.rules";

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** Cadastro de conta bancária. O titular (CPF/CNPJ) é validado e normalizado no serviço. */
export class CreateBankAccountDto {
  @IsIn(BANKS.map(b => b.code), { message: "Banco inválido." })
  bankCode!: string;
  @Transform(trimmed)
  @Matches(/^[0-9]{4,5}$/, {
    message: "Agência inválida (4 ou 5 dígitos, sem dígito verificador).",
  })
  agency!: string;
  @Transform(trimmed)
  @Matches(/^[0-9]{3,12}-?[0-9Xx]?$/, { message: "Número da conta inválido." })
  accountNumber!: string;
  @IsIn(["checking", "savings", "payment"], {
    message: "Tipo de conta inválido.",
  })
  accountType!: "checking" | "savings" | "payment";
  @IsString({ message: "CPF ou CNPJ do titular inválido." })
  @MaxLength(18, { message: "CPF ou CNPJ do titular inválido." })
  holderDocument!: string;
}

/** Cadastro de chave Pix. Na chave aleatória (evp) o valor é gerado pelo servidor. */
export class CreatePixKeyDto {
  @IsIn([...PIX_KEY_TYPES], { message: "Tipo de chave inválido." })
  type!: (typeof PIX_KEY_TYPES)[number];
  @IsOptional()
  @IsString({ message: "Chave inválida." })
  @MaxLength(80, { message: "Chave inválida." })
  value?: string;
}

/** Edição de chave: só o valor muda (o tipo e a conta são fixos). */
export class UpdatePixKeyDto {
  @IsString({ message: "Chave inválida." })
  @MaxLength(80, { message: "Chave inválida." })
  value!: string;
}

/** Código de posse de 6 dígitos enviado ao e-mail ou telefone da chave. */
export class ConfirmPixKeyDto {
  @Transform(trimmed)
  @Matches(/^[0-9]{6}$/, { message: "Código inválido." })
  code!: string;
}

/** Corpo vazio: rotas cujo alvo vem da URL. */
export class EmptyBodyDto {}
