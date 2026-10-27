import { Matches } from "class-validator";
import {
  CodeField,
  CurrentPasswordField,
  EmailField,
  IsClientLocation,
  NameField,
  NewPasswordField,
} from "../../common/dto/fields";

// Um DTO por rota de entrada. Ele define o contrato: quais campos existem, de
// que tipo e com que limites. Qualquer outro campo é recusado pelo pipe global.

/** Cadastro. Não existe campo de perfil: todo cadastro público é cliente comum. */
export class RegisterDto {
  @NameField() name!: string;
  @EmailField() email!: string;
  /** 12 a 128 caracteres; o limite superior evita abuso de CPU no scrypt. */
  @NewPasswordField() password!: string;
}

/** Login. A senha aqui só exige "não vazia": o rigor de tamanho vale na criação, não na entrada. */
export class LoginDto {
  @EmailField() email!: string;
  @CurrentPasswordField() password!: string;
  // Declarada pelo navegador e NUNCA usada como prova de identidade: só enriquece a auditoria.
  @IsClientLocation() location?: unknown;
}

/** Segundo fator: código de 6 dígitos do autenticador ou código de recuperação. */
export class VerifyDto {
  @CodeField() code!: string;
}

/** Troca do autenticador: exige a senha E um código válido (duas provas). */
export class RotateDto {
  @CurrentPasswordField() password!: string;
  @CodeField() code!: string;
}

/** Pedido de link de recuperação. */
export class ForgotPasswordDto {
  @EmailField() email!: string;
}

/** Redefinição de senha com o link recebido. */
export class ResetPasswordDto {
  // O token tem exatamente 64 caracteres hexadecimais (256 bits). Formato
  // errado já é recusado aqui, sem consultar o banco.
  @Matches(/^[a-f0-9]{64}$/, { message: "Link inválido ou expirado." })
  token!: string;
  @NewPasswordField() password!: string;
}
