import { ValidationPipe } from "@nestjs/common";
import { validationFailure } from "./fields";

// Unknown fields are rejected (not stripped): a request carrying `role` or any
// other unexpected property fails instead of being half-applied.
export const createValidationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: validationFailure,
  });
