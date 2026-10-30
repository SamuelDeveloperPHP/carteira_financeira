import { Injectable } from "@nestjs/common";
import { ACCESS_MAP_LIMIT, ACCESS_PAGE_SIZE } from "../common/constants";
import { AccessLogRepository, AccessRow } from "./access-log.repository";

/**
 * Trilha de acesso do próprio usuário: quando entrou, quando saiu, quanto tempo
 * ficou e de onde (IP, aparelho e coordenadas informadas pelo navegador).
 *
 * A localização é DECLARADA pelo navegador e não verificada: serve para o
 * usuário reconhecer acessos suspeitos, não como prova de onde ele estava.
 */
@Injectable()
export class AccessService {
  constructor(private readonly repo: AccessLogRepository) {}

  async list(userId: string, currentHash: string, page = 1) {
    const rows = await this.repo.page(
      userId,
      currentHash,
      (page - 1) * ACCESS_PAGE_SIZE,
      ACCESS_PAGE_SIZE
    );
    return {
      items: rows.slice(0, ACCESS_PAGE_SIZE).map(r => this.view(r)),
      page,
      hasMore: rows.length > ACCESS_PAGE_SIZE,
    };
  }

  async map(userId: string, currentHash: string) {
    const rows = await this.repo.withCoordinates(
      userId,
      currentHash,
      ACCESS_MAP_LIMIT
    );
    return { items: rows.map(r => this.view(r)), limit: ACCESS_MAP_LIMIT };
  }

  private view(r: AccessRow) {
    return {
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      endReason: r.end_reason,
      active: r.ended_at === null,
      current: r.current,
      durationSeconds: r.duration_seconds,
      ip: r.ip,
      device: r.device,
      location: r.location,
    };
  }
}
