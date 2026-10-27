import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_PIPE } from "@nestjs/core";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./common/audit/audit.module";
import { DatabaseModule } from "./common/database/database.module";
import { createValidationPipe } from "./common/dto/validation-pipe";
import { AccessGuard } from "./common/http/access.guard";
import { ErrorsFilter } from "./common/http/errors.filter";
import { RateLimitModule } from "./common/rate-limit/rate-limit.module";
import { HealthModule } from "./health/health.module";
import { UsersModule } from "./users/users.module";
import { WalletModule } from "./wallet/wallet.module";

/**
 * Módulo raiz: só compõe a aplicação. Não contém regra de negócio.
 *
 * Cada funcionalidade é um módulo com fronteira própria (controller + service +
 * repository + DTOs). A ordem abaixo vai do mais básico (infraestrutura) ao
 * mais específico (negócio).
 */
@Module({
  imports: [
    // Infraestrutura compartilhada (globais ou reutilizadas pelos demais):
    DatabaseModule, // pool PostgreSQL e transações
    RateLimitModule, // limite de tentativas
    AuditModule, // trilha de auditoria
    // Negócio:
    UsersModule,
    AuthModule, // cadastro, login, 2FA, recuperação de senha
    WalletModule, // saldo, extrato, transferência, devolução, depósito
    AdminModule, // consultas do master (auditor)
    HealthModule, // /api/health para o monitoramento do Docker
  ],
  providers: [
    // Os três abaixo são GLOBAIS: valem para todas as rotas, inclusive as futuras.
    // Isso é "seguro por padrão": ninguém precisa lembrar de proteger uma rota nova.

    // 1) Guard: decide quem pode entrar (origem, sessão, 2FA, perfil).
    { provide: APP_GUARD, useClass: AccessGuard },
    // 2) Filtro: toda exceção termina aqui (resposta segura + auditoria).
    { provide: APP_FILTER, useClass: ErrorsFilter },
    // 3) Pipe: valida e limpa todo corpo/consulta com base nos DTOs.
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class AppModule {}
