import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { requestLogger } from "./common/http/request-logger";

export async function createApp() {
  if (
    !process.env.DATABASE_URL ||
    !/^[a-f0-9]{64}$/.test(process.env.TOTP_ENCRYPTION_KEY || "")
  )
    throw new Error("Missing secure runtime configuration");
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
  });
  app.setGlobalPrefix("api");
  // Only the private gateway is published. It overwrites forwarded IP headers.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.use(helmet());
  app.use(cookieParser());
  app.use(requestLogger);
  app.enableShutdownHooks();
  return app;
}

if (require.main === module)
  createApp()
    .then(app => app.listen(Number(process.env.PORT || 3001), "0.0.0.0"))
    .catch(() => {
      console.error("API startup failed");
      process.exitCode = 1;
    });
