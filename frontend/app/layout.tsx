import type { Metadata } from "next";
import "bootstrap/dist/css/bootstrap.min.css";
import "./styles.css";
import { SessionProvider } from "./session";
export const metadata: Metadata = {
  title: "Carteira Financeira | Demonstração",
  description:
    "Carteira com transferências simuladas, autenticação em dois fatores e auditoria.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <SessionProvider>
          <div className="demo">
            Ambiente de demonstração — valores simulados. Nenhuma conta bancária
            real é movimentada.
          </div>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
