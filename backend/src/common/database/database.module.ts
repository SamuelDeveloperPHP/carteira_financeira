import { Global, Module } from "@nestjs/common";
import { Database } from "./database.service";

/**
 * Conexão com o PostgreSQL. GLOBAL e com instância ÚNICA: todos os módulos
 * compartilham o mesmo pool de conexões. Se cada módulo criasse o seu, o número
 * de conexões abertas se multiplicaria e esgotaria o banco.
 */
@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}
