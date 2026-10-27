import { Injectable } from "@nestjs/common";

export interface MailProvider {
  readonly name: string;
  sendPasswordReset(to: string, token: string, minutes: number): Promise<void>;
}

// Demonstration mailer: no e-mail leaves the machine. With DEMO_MAIL=true the
// link is written to the API console so the flow can be shown; a real provider
// (SMTP/API) would implement MailProvider and replace this class.
@Injectable()
export class SimulatedMail implements MailProvider {
  readonly name = "simulation";
  async sendPasswordReset(to: string, token: string, minutes: number) {
    if (process.env.DEMO_MAIL !== "true") return;
    const origin = (process.env.APP_ORIGINS || "http://localhost:3080").split(
      ","
    )[0];
    console.log(
      JSON.stringify({
        event: "mail.simulated",
        to,
        subject: "Redefinição de senha",
        expiresInMinutes: minutes,
        link: `${origin}/#reset=${token}`,
      })
    );
  }
}
