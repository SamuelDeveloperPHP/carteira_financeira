import { PageField } from "./fields";

/**
 * Parâmetro de paginação reutilizado pelas listagens (extrato, contas, eventos).
 * Os DTOs de filtro estendem esta classe; `page` é opcional e começa em 1.
 */
export class PageQueryDto {
  @PageField() page?: number;
}
