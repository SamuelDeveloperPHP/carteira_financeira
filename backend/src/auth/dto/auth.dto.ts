import { Matches } from "class-validator";
import {
  CodeField,
  CurrentPasswordField,
  EmailField,
  IsClientLocation,
  NameField,
  NewPasswordField,
} from "../../common/dto/fields";

export class RegisterDto {
  @NameField() name!: string;
  @EmailField() email!: string;
  @NewPasswordField() password!: string;
}

export class LoginDto {
  @EmailField() email!: string;
  @CurrentPasswordField() password!: string;
  // Declared by the browser and never trusted as proof of identity.
  @IsClientLocation() location?: unknown;
}

export class VerifyDto {
  @CodeField() code!: string;
}

export class RotateDto {
  @CurrentPasswordField() password!: string;
  @CodeField() code!: string;
}

export class ForgotPasswordDto {
  @EmailField() email!: string;
}

export class ResetPasswordDto {
  @Matches(/^[a-f0-9]{64}$/, { message: "Link inválido ou expirado." })
  token!: string;
  @NewPasswordField() password!: string;
}
