import { Injectable } from "@nestjs/common";
import { MailProvider } from "./mail.provider";

/**
 * Envio de e-mail SIMULADO, só para demonstração: nenhuma mensagem sai da
 * máquina. Com DEMO_MAIL=true o link é escrito no log da API, para mostrar o
 * fluxo sem servidor de e-mail. Sem a variável, não faz nada.
 *
 * Um provedor real (SMTP, API transacional) implementaria `MailProvider` e
 * substituiria esta classe no AuthModule, sem alterar as regras de recuperação.
 */
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
        // O token vai no FRAGMENTO da URL (depois do #). Fragmentos não são
        // enviados ao servidor nem aparecem em logs de acesso ou no cabeçalho
        // Referer, o que reduz o vazamento do link.
        link: `${origin}/#reset=${token}`,
      })
    );
  }
}
