import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { requestLogger } from "./common/http/request-logger";

/**
 * Monta a aplicação sem colocá-la no ar. Fica separada do `listen` para que os
 * testes de integração possam criá-la e chamá-la sem ocupar uma porta fixa.
 */
export async function createApp() {
  // "Falhar rápido": sem banco ou sem a chave de cifra do 2FA a API não deve
  // subir parcialmente. A chave precisa ter 32 bytes (64 hex) para o AES-256.
  if (
    !process.env.DATABASE_URL ||
    !/^[a-f0-9]{64}$/.test(process.env.TOTP_ENCRYPTION_KEY || "")
  )
    throw new Error("Missing secure runtime configuration");
  const app = await NestFactory.create(AppModule, {
    // Em produção só erros e avisos do framework; o log de requisições é nosso
    // (requestLogger), estruturado e sem dados sensíveis.
    logger: ["error", "warn"],
  });
  // Todas as rotas ficam sob /api; o Nginx encaminha /api para cá e o resto para o frontend.
  app.setGlobalPrefix("api");
  // Só o gateway privado é publicado. Ele sobrescreve os cabeçalhos de IP
  // encaminhado, então confiamos em exatamente 1 proxy: sem isso, um cliente
  // poderia forjar "X-Forwarded-For" e burlar limite de tentativas e auditoria.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  // Cabeçalhos de segurança (CSP, X-Content-Type-Options, HSTS...) em todas as respostas.
  app.use(helmet());
  // Lê o cookie de sessão para o guard.
  app.use(cookieParser());
  // Gera o ID de correlação e registra cada requisição.
  app.use(requestLogger);
  // Ao receber SIGTERM (docker stop), fecha conexões do banco com elegância.
  app.enableShutdownHooks();
  return app;
}

// Só inicia o servidor quando este arquivo é executado diretamente
// (`node dist/main.js`), não quando importado pelos testes.
if (require.main === module)
  createApp()
    .then(app => app.listen(Number(process.env.PORT || 3001), "0.0.0.0"))
    .catch(() => {
      // Mensagem genérica: detalhes de configuração não devem ir para o log público.
      console.error("API startup failed");
      process.exitCode = 1;
    });
