import { IsIn, IsOptional } from "class-validator";

/** Período da análise, em dias. Lista fechada: evita consultas arbitrariamente longas. */
export class InsightsQueryDto {
  @IsOptional()
  @IsIn(["30", "90", "365"], { message: "Período inválido." })
  period?: "30" | "90" | "365";
}
