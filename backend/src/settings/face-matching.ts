import { BadRequestException } from "@nestjs/common";

/** Tamanho do vetor ("descritor") gerado pelo modelo de reconhecimento facial. */
export const FACE_VECTOR_SIZE = 128;

/**
 * Valida o vetor facial recebido do navegador: 128 números finitos e em faixa
 * plausível. Rejeita qualquer outra coisa antes de tocar em criptografia ou banco.
 */
export function parseDescriptor(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== FACE_VECTOR_SIZE ||
    value.some(
      n => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 5
    )
  )
    throw new BadRequestException("Leitura facial inválida. Tente novamente.");
  return value as number[];
}

/** Distância euclidiana entre dois vetores: quanto menor, mais parecidos. */
export function faceDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < FACE_VECTOR_SIZE; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

/** True se a distância está dentro do limite (mesma pessoa, segundo o modelo). */
export const sameFace = (a: number[], b: number[], threshold: number) =>
  faceDistance(a, b) <= threshold;
