import { IsDateString, IsIn, IsOptional } from "class-validator";
import { OptionalText, UuidField } from "../../common/dto/fields";
import { PageQueryDto } from "../../common/dto/page-query.dto";

/** Filtros da lista de contas do master. */
export class UsersQueryDto extends PageQueryDto {
  /** Trecho do nome ou e-mail. Tamanho limitado ao de um e-mail válido. */
  @OptionalText(254) email?: string;
}

/**
 * Filtros da busca de eventos de auditoria. Todos opcionais e combináveis.
 * Cada um é validado por tipo (UUID, data ISO, valor de lista fechada), então
 * texto arbitrário nunca chega ao SQL sem passar por aqui.
 */
export class EventsQueryDto extends PageQueryDto {
  @IsOptional() @UuidField() userId?: string;
  /** Trecho do nome da ação, ex.: "transfer" ou "login". */
  @OptionalText(80) action?: string;
  @IsOptional()
  @IsIn(["success", "denied", "failure"], { message: "Resultado inválido." })
  outcome?: "success" | "denied" | "failure";
  @OptionalText(80) ip?: string;
  /** Início do período (ISO 8601). */
  @IsOptional() @IsDateString({}, { message: "Data inválida." }) from?: string;
  /** Fim do período (ISO 8601). */
  @IsOptional() @IsDateString({}, { message: "Data inválida." }) to?: string;
}
