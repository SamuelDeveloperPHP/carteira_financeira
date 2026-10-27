import { PageField } from "./fields";

export class PageQueryDto {
  @PageField() page?: number;
}
