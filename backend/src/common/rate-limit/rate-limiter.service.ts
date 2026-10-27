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
@Injectable()
export class RateLimiter {
  constructor(private readonly hits: RateLimitRepository) {}
  /**
   * Conta uma tentativa e responde 429 quando `limit` é excedido dentro da
   * janela de `seconds` (padrão 15 min). A tentativa que estoura o limite
   * também é contada: insistir não "abre" a janela mais cedo.
   */
  async throttle(key: string, limit: number, seconds = 900) {
    if ((await this.hits.hit(key, seconds)) > limit)
      throw new HttpException(
        "Muitas tentativas. Tente novamente em 15 minutos.",
        429
      );
  }
  /** Mesma contagem, mas devolve true/false em vez de lançar erro (usado no orçamento de auditoria anônima). */
  async allow(key: string, limit: number, seconds = 900) {
    return (await this.hits.hit(key, seconds)) <= limit;
  }
}
