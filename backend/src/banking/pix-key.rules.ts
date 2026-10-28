import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { EMAIL_PATTERN } from "../common/security/validation";

/**
 * Regras de formato das chaves Pix, no padrão do arranjo do Banco Central.
 * São funções PURAS (sem banco, sem rede), por isso testáveis isoladamente.
 */

export const PIX_KEY_TYPES = ["cpf", "cnpj", "email", "phone", "evp"] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

/** Limite do arranjo: pessoa física até 5 chaves por conta; pessoa jurídica até 20. */
export const maxKeysPerAccount = (holderDocument: string) =>
  holderDocument.length === 14 ? 20 : 5;

/** Remove tudo que não é dígito ("123.456.789-09" -> "12345678909"). */
export const onlyDigits = (value: string) => value.replace(/\D/g, "");

/**
 * Valida os dois dígitos verificadores do CPF (módulo 11). Sequências com todos
 * os dígitos iguais (111.111.111-11) passam na conta, mas são inválidas.
 */
export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

/** Valida os dígitos verificadores do CNPJ (pesos 2..9 repetidos, módulo 11). */
export function isValidCnpj(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    let weight = 2;
    for (let i = len - 1; i >= 0; i--) {
      sum += Number(d[i]) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

/** Documento do titular: CPF ou CNPJ válido, devolvido só com dígitos. */
export function holderDocument(value: string): string {
  const d = onlyDigits(value);
  if (d.length === 11 && isValidCpf(d)) return d;
  if (d.length === 14 && isValidCnpj(d)) return d;
  throw new BadRequestException("CPF ou CNPJ do titular inválido.");
}

/**
 * Telefone no formato do Pix: +55, DDD de dois dígitos e celular de nove dígitos
 * (começando em 9). Aceita entrada com máscara e completa o "+55".
 */
export function normalizePhone(value: string): string {
  const d = onlyDigits(value);
  const national = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  const result = `+55${national}`;
  if (!/^\+55[1-9][0-9]9[0-9]{8}$/.test(result))
    throw new BadRequestException(
      "Telefone inválido. Use DDD + celular, como (61) 99999-9999."
    );
  return result;
}

/**
 * Normaliza e valida a chave conforme o tipo. Para CPF/CNPJ, a chave tem de ser
 * o documento do TITULAR da conta (não se registra o CPF de terceiros). Chave
 * aleatória (EVP) é gerada aqui, nunca escolhida pelo cliente.
 */
export function normalizePixKey(
  type: PixKeyType,
  raw: string | undefined,
  holder: string
): string {
  switch (type) {
    case "evp":
      return randomUUID();
    case "cpf":
      if (!raw || !isValidCpf(raw))
        throw new BadRequestException("CPF inválido.");
      if (onlyDigits(raw) !== holder)
        throw new BadRequestException(
          "A chave CPF deve ser o documento do titular da conta."
        );
      return onlyDigits(raw);
    case "cnpj":
      if (!raw || !isValidCnpj(raw))
        throw new BadRequestException("CNPJ inválido.");
      if (onlyDigits(raw) !== holder)
        throw new BadRequestException(
          "A chave CNPJ deve ser o documento do titular da conta."
        );
      return onlyDigits(raw);
    case "email": {
      const email = (raw || "").trim().toLowerCase();
      if (email.length > 77 || !EMAIL_PATTERN.test(email))
        throw new BadRequestException("E-mail inválido.");
      return email;
    }
    case "phone":
      return normalizePhone(raw || "");
  }
}

/** E-mail e telefone exigem PROVA DE POSSE (código enviado ao próprio contato). */
export const needsOwnershipProof = (type: PixKeyType) =>
  type === "email" || type === "phone";
