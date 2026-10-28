// Máscaras de digitação para documentos e chaves Pix. Servem só para conforto
// de quem digita: o servidor remove a pontuação e valida de novo.

const digits = (v: string) => v.replace(/\D/g, "");

/** 123.456.789-09 (aceita digitação parcial). */
export function maskCpf(v: string): string {
  const d = digits(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
}

/** 12.345.678/0001-90 (aceita digitação parcial). */
export function maskCnpj(v: string): string {
  const d = digits(v).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, "$1.$2.$3/$4-$5");
}

/** Documento do titular: até 11 dígitos é CPF; acima disso, CNPJ. */
export const maskDocument = (v: string) =>
  digits(v).length <= 11 ? maskCpf(v) : maskCnpj(v);

/** (61) 99999-9999 (celular) ou (61) 3333-4444 (10 dígitos). */
export function maskPhone(v: string): string {
  const d = digits(v).slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return d.length > 10
    ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
    : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

export type PixKeyType = "cpf" | "cnpj" | "email" | "phone" | "evp";

/** Aplica a máscara do tipo de chave. E-mail e chave aleatória não têm máscara. */
export function maskPixKey(type: PixKeyType, v: string): string {
  if (type === "cpf") return maskCpf(v);
  if (type === "cnpj") return maskCnpj(v);
  if (type === "phone") return maskPhone(v);
  return v;
}

/** Tamanho máximo do campo (já com a pontuação da máscara). */
export const KEY_MAX_LENGTH: Record<PixKeyType, number> = {
  cpf: 14,
  cnpj: 18,
  phone: 15,
  email: 77,
  evp: 0,
};
