import { applyDecorators } from "@nestjs/common";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";
import { FACE_VECTOR_SIZE } from "../face-matching";

const FACE_MESSAGE = "Leitura facial inválida. Tente novamente.";

/**
 * Vetor facial de 128 números produzido no navegador. Reutilizado também no DTO
 * de redefinição de senha. A faixa é conferida de novo em `parseDescriptor`.
 */
export const FaceDescriptorField = () =>
  applyDecorators(
    IsArray({ message: FACE_MESSAGE }),
    ArrayMinSize(FACE_VECTOR_SIZE, { message: FACE_MESSAGE }),
    ArrayMaxSize(FACE_VECTOR_SIZE, { message: FACE_MESSAGE }),
    IsNumber({}, { each: true, message: FACE_MESSAGE }),
    Min(-5, { each: true, message: FACE_MESSAGE }),
    Max(5, { each: true, message: FACE_MESSAGE })
  );

/** Alteração das preferências simples. Campos opcionais: só o que vier é alterado. */
export class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean({ message: "Valor inválido." })
  biometricEnabled?: boolean;
  @IsOptional()
  @IsBoolean({ message: "Valor inválido." })
  geolocationEnabled?: boolean;
}

/** Cadastro facial: senha (reautenticação) + vetor + etapas de prova de vida cumpridas. */
export class EnrollFaceDto {
  @IsString({ message: "Senha inválida." })
  @Length(1, 128, { message: "Senha inválida." })
  password!: string;
  @FaceDescriptorField() descriptor!: number[];
  @IsArray({ message: "Prova de vida incompleta." })
  @ArrayMinSize(5, { message: "Prova de vida incompleta." })
  @ArrayMaxSize(5, { message: "Prova de vida incompleta." })
  @IsIn(["right", "left", "down", "up", "smile"], {
    each: true,
    message: "Prova de vida incompleta.",
  })
  liveness!: string[];
}

/** Desativar o reconhecimento facial também exige a senha. */
export class DisableFaceDto {
  @IsString({ message: "Senha inválida." })
  @Length(1, 128, { message: "Senha inválida." })
  password!: string;
}
