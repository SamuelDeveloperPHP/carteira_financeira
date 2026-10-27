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

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export const EmailField = () =>
  applyDecorators(
    Transform(({ value }) =>
      typeof value === "string" ? value.trim().toLowerCase() : value
    ),
    IsString({ message: "E-mail inválido." }),
    MaxLength(254, { message: "E-mail inválido." }),
    Matches(EMAIL_PATTERN, { message: "E-mail inválido." })
  );

export const NameField = () =>
  applyDecorators(
    Transform(trimmed),
    IsString({ message: "Texto inválido." }),
    Length(2, 100, { message: "Texto inválido." })
  );

export const NewPasswordField = () =>
  applyDecorators(
    IsString({ message: "Use uma senha com 12 a 128 caracteres." }),
    Length(12, 128, { message: "Use uma senha com 12 a 128 caracteres." })
  );

export const CurrentPasswordField = () =>
  applyDecorators(
    IsString({ message: "Credenciais inválidas." }),
    Length(1, 128, { message: "Credenciais inválidas." })
  );

// TOTP (6 digits) or a recovery code; separators are ignored.
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

export const MoneyField = () =>
  applyDecorators(
    IsInt({ message: "Valor deve ser positivo, em centavos inteiros." }),
    Min(1, { message: "Valor deve ser positivo, em centavos inteiros." }),
    Max(MAX_CENTS, { message: "Valor deve ser positivo, em centavos inteiros." })
  );

export const UuidField = () =>
  applyDecorators(IsUUID("all", { message: "Identificador inválido." }));

export const PageField = () =>
  applyDecorators(
    IsOptional(),
    Type(() => Number),
    IsInt({ message: "Página inválida." }),
    Min(1, { message: "Página inválida." }),
    Max(10000, { message: "Página inválida." })
  );

export const OptionalText = (max: number, message = "Texto inválido.") =>
  applyDecorators(
    IsOptional(),
    IsString({ message }),
    MaxLength(max, { message })
  );

@ValidatorConstraint({ name: "clientLocation", async: false })
class ClientLocationConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    try {
      location(value);
      return true;
    } catch {
      return false;
    }
  }
  defaultMessage(_args: ValidationArguments) {
    return "Localização inválida.";
  }
}
export const IsClientLocation = () =>
  applyDecorators(IsOptional(), Validate(ClientLocationConstraint));

// Every decorator above carries a Portuguese message; unknown fields (whitelist)
// are reported generically so the API never echoes field names back.
export function validationFailure(errors: ValidationError[]) {
  const first = errors[0];
  const constraints = first?.constraints ?? {};
  if ("whitelistValidation" in constraints)
    return new BadRequestException("Campos inválidos.");
  return new BadRequestException(
    Object.values(constraints)[0] ?? "Campos inválidos."
  );
}
