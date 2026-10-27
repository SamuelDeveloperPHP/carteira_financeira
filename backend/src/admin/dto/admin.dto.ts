import { IsDateString, IsIn, IsOptional } from "class-validator";
import { OptionalText, UuidField } from "../../common/dto/fields";
import { PageQueryDto } from "../../common/dto/page-query.dto";

export class UsersQueryDto extends PageQueryDto {
  @OptionalText(254) email?: string;
}

export class EventsQueryDto extends PageQueryDto {
  @IsOptional() @UuidField() userId?: string;
  @OptionalText(80) action?: string;
  @IsOptional()
  @IsIn(["success", "denied", "failure"], { message: "Resultado inválido." })
  outcome?: "success" | "denied" | "failure";
  @OptionalText(80) ip?: string;
  @IsOptional() @IsDateString({}, { message: "Data inválida." }) from?: string;
  @IsOptional() @IsDateString({}, { message: "Data inválida." }) to?: string;
}
