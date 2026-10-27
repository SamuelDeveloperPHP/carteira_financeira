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

@Module({
  imports: [
    DatabaseModule,
    RateLimitModule,
    AuditModule,
    UsersModule,
    AuthModule,
    WalletModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_FILTER, useClass: ErrorsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class AppModule {}
