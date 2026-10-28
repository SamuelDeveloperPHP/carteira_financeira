import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { AuditService } from "../common/audit/audit.service";
import { FACE_ATTEMPTS, FACE_MATCH_THRESHOLD } from "../common/constants";
import { Database, Queryable } from "../common/database/database.service";
import { AuditContext } from "../common/http/request.types";
import { RateLimiter } from "../common/rate-limit/rate-limiter.service";
import { checkPassword, decrypt, encrypt } from "../common/security/crypto";
import { UsersRepository } from "../users/users.repository";
import { DisableFaceDto, EnrollFaceDto } from "./dto/settings.dto";
import { parseDescriptor, sameFace } from "./face-matching";
import { SettingsRepository } from "./settings.repository";

/** 403 de rosto que não confere; leva o usuário para a auditoria feita depois do rollback. */
export class FaceMismatchException extends ForbiddenException {
  constructor(readonly userId: string) {
    super("Reconhecimento facial não confere.");
  }
}

/**
 * Reconhecimento facial, usado para RECUPERAR A SENHA.
 *
 * Como funciona: o navegador detecta o rosto, exige a prova de vida (virar à
 * direita, à esquerda, abaixar, levantar a cabeça e sorrir) e gera um vetor de
 * 128 números. O servidor guarda o vetor CIFRADO (AES-256-GCM) e, na
 * recuperação, calcula a distância entre o vetor novo e o guardado.
 *
 * Limites honestos:
 *   - a prova de vida roda no navegador, que é controlado por quem o usa: ela
 *     dificulta fotos e vídeos, mas não é à prova de fraude. Por isso o rosto
 *     NUNCA substitui o link do e-mail: soma-se a ele (defesa em profundidade);
 *   - o vetor não é devolvido por nenhuma rota;
 *   - em produção, a verificação deveria usar o SDK biométrico do aplicativo
 *     (Face ID / BiometricPrompt) ou um serviço de prova de vida certificado.
 */
@Injectable()
export class FaceService {
  constructor(
    private readonly db: Database,
    private readonly repo: SettingsRepository,
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter
  ) {}

  /** Cadastra (ou substitui) o rosto, depois de reconfirmar a senha. */
  async enroll(userId: string, dto: EnrollFaceDto, ctx: AuditContext) {
    await this.limiter.throttle(`face-enroll:${userId}`, FACE_ATTEMPTS);
    const descriptor = parseDescriptor(dto.descriptor);
    // As cinco etapas têm de aparecer, sem repetição.
    if (new Set(dto.liveness).size !== 5)
      throw new UnprocessableEntityException("Conclua todas as etapas da prova de vida.");
    await this.assertPassword(userId, dto.password, ctx);
    await this.db.transaction(async tx => {
      await this.repo.saveTemplate(tx, userId, encrypt(JSON.stringify(descriptor)));
      await this.repo.update(tx, userId, { face: true });
      // `livenessAttestedByClient`: a prova de vida foi declarada pelo navegador.
      await this.audit.record("face.enrolled", userId, userId, ctx, { livenessAttestedByClient: true }, "success", null, tx);
    });
    return { message: "Reconhecimento facial ativado." };
  }

  /** Remove o modelo facial e desliga o recurso. */
  async disable(userId: string, dto: DisableFaceDto, ctx: AuditContext) {
    await this.limiter.throttle(`face-enroll:${userId}`, FACE_ATTEMPTS);
    await this.assertPassword(userId, dto.password, ctx);
    await this.db.transaction(async tx => {
      await this.repo.deleteTemplate(tx, userId);
      await this.repo.update(tx, userId, { face: false });
      await this.audit.record("face.disabled", userId, userId, ctx, {}, "success", null, tx);
    });
    return { message: "Reconhecimento facial desativado e modelo apagado." };
  }

  /** O usuário tem reconhecimento facial ativo? (decide se a redefinição de senha exige o rosto) */
  async isRequired(userId: string, q?: Queryable): Promise<boolean> {
    return (await this.repo.get(userId, q)).face_enabled;
  }

  /**
   * Confere o rosto na redefinição de senha. Lança 403 se não conferir. Cada
   * tentativa conta no limite (gravado fora da transação do chamador, então um
   * rollback não devolve a tentativa).
   */
  async assertMatch(userId: string, candidate: unknown, ctx: AuditContext, q?: Queryable) {
    await this.limiter.throttle(`face-verify:${userId}`, FACE_ATTEMPTS);
    const stored = await this.repo.template(userId, q);
    if (!stored) throw new ForbiddenException("Reconhecimento facial não confere.");
    const ok = sameFace(
      JSON.parse(decrypt(stored)) as number[],
      parseDescriptor(candidate),
      FACE_MATCH_THRESHOLD
    );
    // Não audita aqui: quem chama está dentro de uma transação que segura o
    // bloqueio do usuário, e um INSERT de auditoria (FK para users) esperaria por
    // esse bloqueio. A recusa é auditada por quem captura a exceção, após o rollback.
    if (!ok) throw new FaceMismatchException(userId);
  }

  /** Registra a recusa facial na trilha. Chamar DEPOIS do rollback da transação que a provocou. */
  async auditMismatch(userId: string, ctx: AuditContext) {
    await this.audit.record("face.verify", userId, userId, ctx, {}, "denied", "face_mismatch");
  }

  private async assertPassword(userId: string, password: string, ctx: AuditContext) {
    const user = await this.users.findById(userId);
    if (!user || !(await checkPassword(password, user.password_hash))) {
      await this.audit.record("face.reauth", userId, userId, ctx, {}, "denied", "bad_password");
      throw new UnauthorizedException("Senha incorreta.");
    }
  }
}
