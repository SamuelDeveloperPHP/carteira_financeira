/**
 * Catálogo de bancos (código COMPE) usado no cadastro. Lista fixa e curta, só
 * para a demonstração: em produção viria da lista oficial de participantes do
 * Banco Central (ISPB/STR), atualizada periodicamente.
 */
export const BANKS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "001", name: "Banco do Brasil" },
  { code: "033", name: "Santander" },
  { code: "077", name: "Banco Inter" },
  { code: "104", name: "Caixa Econômica Federal" },
  { code: "208", name: "BTG Pactual" },
  { code: "237", name: "Bradesco" },
  { code: "260", name: "Nubank" },
  { code: "290", name: "PagBank" },
  { code: "336", name: "C6 Bank" },
  { code: "341", name: "Itaú Unibanco" },
  { code: "380", name: "PicPay" },
  { code: "422", name: "Banco Safra" },
  { code: "748", name: "Sicredi" },
  { code: "756", name: "Sicoob" },
];

export const bankName = (code: string) =>
  BANKS.find(b => b.code === code)?.name;
