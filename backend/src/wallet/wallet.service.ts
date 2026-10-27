import { Injectable } from "@nestjs/common";
import { AuditService } from "../common/audit/audit.service";
import { PAGE_SIZE } from "../common/constants";
import { AuditContext } from "../common/http/request.types";
import { LedgerRepository } from "./ledger.repository";

/**
 * Lado de LEITURA da carteira: saldo e extrato paginado. Separado dos serviços
 * que movem dinheiro (transferência, depósito): consultar nunca altera nada.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly audit: AuditService
  ) {}

  /**
   * Saldo atual em centavos. A consulta de saldo NÃO gera evento de auditoria
   * (é frequente e não sensível); o extrato, sim. `simulated` deixa explícito,
   * na própria resposta, que o valor não é dinheiro real.
   */
  async balance(userId: string) {
    const balance = await this.ledger.balanceOf(userId);
    return { balance: balance ?? 0, currency: "BRL", simulated: true };
  }

  /**
   * Uma página do extrato, da movimentação mais nova para a mais antiga. O
   * repositório busca PAGE_SIZE + 1 linhas: a "linha extra" só indica que existe
   * próxima página e é descartada (`slice`), evitando um COUNT(*) separado,
   * caro em tabelas grandes.
   */
  async statement(userId: string, page = 1) {
    const rows = await this.ledger.statement(
      userId,
      (page - 1) * PAGE_SIZE,
      PAGE_SIZE
    );
    return {
      items: rows.slice(0, PAGE_SIZE),
      page,
      hasMore: rows.length > PAGE_SIZE,
    };
  }

  /**
   * Extrato do próprio usuário, registrando a consulta na auditoria. As leituras
   * do master passam por `statement` direto e são auditadas pelo AdminService,
   * com um evento próprio ("admin.statement.view").
   */
  async ownStatement(userId: string, page: number | undefined, ctx: AuditContext) {
    await this.audit.record("wallet.statement.view", userId, userId, ctx, {
      page: page ?? 1,
    });
    return this.statement(userId, page);
  }
}
