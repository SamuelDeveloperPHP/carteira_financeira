import type { Metadata } from "next";
import "bootstrap/dist/css/bootstrap.min.css";
import "./styles.css";
export const metadata: Metadata = {
  title: "Carteira Financeira | Demonstração",
  description:
    "Carteira com transferências simuladas, autenticação em dois fatores e auditoria.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
