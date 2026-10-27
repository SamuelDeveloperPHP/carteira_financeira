import { Module } from "@nestjs/common";
import { UsersRepository } from "./users.repository";

/**
 * Acesso a dados de usuários, compartilhado pelos módulos de autenticação e de
 * carteira (que precisa achar o destinatário por e-mail). Exporta apenas o
 * repositório: as regras de negócio de cada caso de uso ficam nos módulos que o
 * usam, e não aqui.
 */
@Module({ providers: [UsersRepository], exports: [UsersRepository] })
export class UsersModule {}
