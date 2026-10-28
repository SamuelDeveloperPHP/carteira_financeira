import { PixKeyType } from "./pix-key.rules";

/** Token de injeção (Inversão de Dependência), no mesmo modelo de MAIL_PROVIDER. */
export const PIX_DIRECTORY = Symbol("PIX_DIRECTORY");

export interface PixSubmission {
  type: PixKeyType;
  value: string;
  holderDocument: string;
  bankCode: string;
  agency: string;
  accountNumber: string;
}

export type PixDecision =
  | { status: "approved"; protocol: string }
  | { status: "awaiting_ownership"; protocol: string }
  | { status: "rejected"; protocol: string; reason: string };

/**
 * Porta para o diretório de identificadores do Pix (DICT, do Banco Central).
 * O banco real é o participante que fala com o DICT; aqui o serviço depende
 * apenas desta interface. A implementação entregue é uma SIMULAÇÃO: não há
 * credenciamento no Banco Central nem chamada ao DICT real.
 */
export interface PixDirectoryProvider {
  readonly name: string;
  /** Solicita o registro da chave e devolve a decisão com um protocolo. */
  submit(request: PixSubmission): Promise<PixDecision>;
  /** Entrega o código de posse ao e-mail/telefone da chave. */
  sendOwnershipCode(type: PixKeyType, value: string, code: string): Promise<void>;
  /** Confirma o registro depois da prova de posse. */
  confirm(protocol: string): Promise<PixDecision>;
}
