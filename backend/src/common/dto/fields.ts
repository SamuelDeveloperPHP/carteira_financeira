import { applyDecorators, BadRequestException } from "@nestjs/common";
import { Transform, Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationError,
} from "class-validator";
import { MAX_CENTS } from "../constants";
import { EMAIL_PATTERN, location } from "../security/validation";

// Biblioteca de CAMPOS reutilizáveis. Cada função devolve um decorador composto
// (validação + normalização + mensagem em português). Assim "e-mail" ou "valor"
// têm exatamente a mesma regra em todos os DTOs, e o texto de erro nunca diverge.

/** Remove espaços nas pontas de textos; ignora valores que não são texto (a validação seguinte os recusa). */
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/**
 * E-mail: normaliza (aparar + minúsculas) ANTES de validar, para que
 * "ANA@x.com " e "ana@x.com" sejam a mesma conta. A mensagem é a mesma para
 * qualquer falha, sem dizer qual regra quebrou.
 */
export const EmailField = () =>
  applyDecorators(
    Transform(({ value }) =>
      typeof value === "string" ? value.trim().toLowerCase() : value
    ),
    IsString({ message: "E-mail inválido." }),
    MaxLength(254, { message: "E-mail inválido." }), // 254 é o máximo do padrão de e-mail
    Matches(EMAIL_PATTERN, { message: "E-mail inválido." })
  );

/** Nome de pessoa: 2 a 100 caracteres, espaços das pontas removidos. */
export const NameField = () =>
  applyDecorators(
    Transform(trimmed),
    IsString({ message: "Texto inválido." }),
    Length(2, 100, { message: "Texto inválido." })
  );

/**
 * Senha NOVA (cadastro e redefinição): 12 a 128 caracteres. Nunca é aparada nem
 * alterada, pois espaços fazem parte da senha. O teto de 128 impede que alguém
 * envie megabytes de texto para travar o scrypt (negação de serviço).
 */
export const NewPasswordField = () =>
  applyDecorators(
    IsString({ message: "Use uma senha com 12 a 128 caracteres." }),
    Length(12, 128, { message: "Use uma senha com 12 a 128 caracteres." })
  );

/**
 * Senha JÁ existente (login, troca do autenticador): só precisa ser texto não
 * vazio. A mensagem é a genérica de credenciais, para não revelar a política
 * de senha a quem está tentando adivinhar.
 */
export const CurrentPasswordField = () =>
  applyDecorators(
    IsString({ message: "Credenciais inválidas." }),
    Length(1, 128, { message: "Credenciais inválidas." })
  );

/**
 * Código do segundo fator: 6 dígitos (TOTP) ou 16 hexadecimais (recuperação).
 * Espaços e hífens são removidos, pois o usuário costuma digitar "123 456" ou
 * "a2ad-37e8-...". A conferência exata do formato é feita no serviço.
 */
export const CodeField = () =>
  applyDecorators(
    Transform(({ value }) =>
      typeof value === "string"
        ? value.trim().replace(/[-\s]/g, "").toLowerCase()
        : value
    ),
    IsString({ message: "Código inválido." }),
    Length(6, 32, { message: "Código inválido." })
  );

/**
 * Valor em CENTAVOS: inteiro, de 1 até o limite. `IsInt` recusa 1.5, "100" (texto),
 * NaN e null; `Min(1)` recusa zero e negativos (que seriam um "saque" disfarçado).
 */
export const MoneyField = (
  max = MAX_CENTS,
  maxMessage = "Valor deve ser positivo, em centavos inteiros."
) =>
  applyDecorators(
    IsInt({ message: "Valor deve ser positivo, em centavos inteiros." }),
    Min(1, { message: "Valor deve ser positivo, em centavos inteiros." }),
    // `max` permite um teto próprio (ex.: adição de saldo) com mensagem clara.
    Max(max, { message: maxMessage })
  );

/** Identificador UUID de qualquer versão. */
export const UuidField = () =>
  applyDecorators(IsUUID("all", { message: "Identificador inválido." }));

/**
 * Número da página. Chega como TEXTO na URL (?page=3); `Type(() => Number)` o
 * converte. O teto de 10.000 evita OFFSETs enormes, que fariam o banco varrer
 * milhões de linhas.
 */
export const PageField = () =>
  applyDecorators(
    IsOptional(),
    Type(() => Number),
    IsInt({ message: "Página inválida." }),
    Min(1, { message: "Página inválida." }),
    Max(10000, { message: "Página inválida." })
  );

/** Texto opcional com tamanho máximo (filtros de busca). */
export const OptionalText = (max: number, message = "Texto inválido.") =>
  applyDecorators(
    IsOptional(),
    IsString({ message }),
    MaxLength(max, { message })
  );

/**
 * Valida a localização enviada pelo navegador reaproveitando a MESMA função
 * usada fora dos DTOs (security/validation.ts), para não haver duas regras.
 */
@ValidatorConstraint({ name: "clientLocation", async: false })
class ClientLocationConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    try {
      location(value); // lança se o formato for inválido
      return true;
    } catch {
      return false;
    }
  }
  defaultMessage(_args: ValidationArguments) {
    return "Localização inválida.";
  }
}
/** Localização é opcional (o usuário pode negar a permissão), mas, se vier, tem de ser válida. */
export const IsClientLocation = () =>
  applyDecorators(IsOptional(), Validate(ClientLocationConstraint));

/**
 * Converte a lista de erros do class-validator em UMA resposta 400 curta.
 * Todo decorador acima já carrega mensagem em português. Campo desconhecido
 * (whitelist) vira "Campos inválidos." sem repetir o nome do campo, para a API
 * não confirmar a um atacante quais propriedades existem.
 */
export function validationFailure(errors: ValidationError[]) {
  const first = errors[0];
  const constraints = first?.constraints ?? {};
  if ("whitelistValidation" in constraints)
    return new BadRequestException("Campos inválidos.");
  return new BadRequestException(
    Object.values(constraints)[0] ?? "Campos inválidos."
  );
}
