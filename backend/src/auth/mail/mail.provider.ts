export interface MailProvider {
  readonly name: string;
  sendPasswordReset(to: string, token: string, minutes: number): Promise<void>;
}

// Injection token: services depend on the interface, never on a concrete mailer.
export const MAIL_PROVIDER = Symbol("MAIL_PROVIDER");
