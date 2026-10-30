import { HttpException, Injectable } from "@nestjs/common";
import { RateLimitRepository } from "./rate-limit.repository";

/**
 * Limitador de tentativas por JANELA FIXA, guardado no PostgreSQL. Por ficar no
 * banco (e não na memória do processo), o limite vale entre reinícios e entre
 * várias instâncias da API.
 *
 * Protege contra força bruta (adivinhar senha ou código de 6 dígitos), envio em
 * massa (recuperação de senha) e abuso (cadastros e escritas em excesso).
 * Janela fixa é simples e previsível; a contrapartida é permitir uma rajada na
 * virada da janela, aceitável para este uso.
 */
const tooMany = () =>
  new HttpException("Muitas tentativas. Tente novamente em 15 minutos.", 429);

@Injectable()
export class RateLimiter {
  constructor(private readonly hits: RateLimitRepository) {}
  /**
   * Conta uma tentativa e responde 429 quando `limit` é excedido dentro da
   * janela de `seconds` (padrão 15 min). A tentativa que estoura o limite
   * também é contada: insistir não "abre" a janela mais cedo.
   */
  async throttle(key: string, limit: number, seconds = 900) {
    if ((await this.hits.hit(key, seconds)) > limit) throw tooMany();
  }
  /**
   * Limite só de FALHAS: recusa (429) se a chave já acumulou `limit` falhas na
   * janela, sem contar esta consulta. Quem chama conta a falha com `fail` e zera
   * com `reset` quando a tentativa dá certo. Assim, entrar com sucesso não gasta
   * o limite e quem erra a senha de outra pessoa (sem ser ela) não a tranca fora.
   */
  async guard(key: string, limit: number) {
    if ((await this.hits.count(key)) >= limit) throw tooMany();
  }
  /** Conta uma falha na janela da chave (par de `guard`). */
  async fail(key: string, seconds = 900) {
    await this.hits.hit(key, seconds);
  }
  /** Zera a janela da chave (par de `guard`): chamada quando a tentativa dá certo. */
  async reset(key: string) {
    await this.hits.reset(key);
  }
  /** Mesma contagem, mas devolve true/false em vez de lançar erro (usado no orçamento de auditoria anônima). */
  async allow(key: string, limit: number, seconds = 900) {
    return (await this.hits.hit(key, seconds)) <= limit;
  }
}
