"use client";
// Perfil: três abas, cada uma com a sua URL (/perfil/bancario, /perfil/seguranca, /perfil/acessos).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

const TABS = [
  ["/perfil/bancario", "Dados bancários"],
  ["/perfil/seguranca", "Segurança"],
  ["/perfil/acessos", "Trilha de acesso"],
] as const;

export default function ProfileLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <nav className="tabs" aria-label="Perfil">
        {TABS.map(([href, title]) => (
          <Link
            key={href}
            href={href}
            className={pathname === href ? "active" : ""}
            aria-current={pathname === href ? "page" : undefined}
          >
            {title}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
