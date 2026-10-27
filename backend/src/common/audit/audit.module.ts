import { Global, Module } from "@nestjs/common";
import { AuditRepository } from "./audit.repository";
import { AuditService } from "./audit.service";

/**
 * Trilha de auditoria. É GLOBAL porque praticamente todo módulo precisa
 * registrar eventos: assim ninguém importa este módulo explicitamente e nenhum
 * serviço "esquece" de ter acesso à auditoria.
 */
@Global()
@Module({
  providers: [AuditRepository, AuditService],
  exports: [AuditRepository, AuditService],
})
export class AuditModule {}
