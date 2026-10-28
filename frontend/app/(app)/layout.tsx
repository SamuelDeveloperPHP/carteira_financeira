"use client";
/*
 * Moldura das páginas autenticadas: sidebar, barra superior e aviso dos códigos
 * de recuperação. Cada item do menu é uma ROTA própria (URL), então o F5 mantém
 * a página em que o usuário estava e o botão "voltar" do navegador funciona.
 *
 * Os redirecionamentos abaixo são conforto de navegação: sem sessão volta para
 * "/", e perfil errado vai para a própria página inicial. A proteção real é do
 * servidor (AccessGuard), que recusa a rota independentemente do que a tela fizer.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { notify } from "../alerts";
import { BellIcon, Brand } from "../components/ui";
import { homeOf, useSession } from "../session";

type Item = { href: string; title: string; badge?: boolean };

const USER_NAV: Item[] = [
  { href: "/carteira", title: "Minha carteira" },
  { href: "/relatorios", title: "Relatórios" },
  { href: "/notificacoes", title: "Notificações", badge: true },
  { href: "/perfil", title: "Meu perfil" },
  { href: "/seguranca", title: "Segurança" },
  { href: "/sobre", title: "Sobre a demonstração" },
];
const MASTER_NAV: Item[] = [
  { href: "/contas", title: "Contas" },
  { href: "/eventos", title: "Trilha de auditoria" },
  { href: "/monitoramento", title: "Monitoramento" },
  { href: "/seguranca", title: "Segurança" },
  { href: "/sobre", title: "Sobre a demonstração" },
];
const TITLES: Record<string, string> = {
  "/carteira": "Minha carteira",
  "/relatorios": "Relatórios",
  "/notificacoes": "Notificações",
  "/perfil": "Meu perfil",
  "/seguranca": "Segurança",
  "/sobre": "Sobre a demonstração",
  "/contas": "Auditoria de contas",
  "/eventos": "Trilha de auditoria",
  "/monitoramento": "Monitoramento",
};

const inSection = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export default function AppLayout({ children }: { children: ReactNode }) {
  const { ready, user, busy, codes, setCodes, unread, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const nav = user?.role === "master" ? MASTER_NAV : USER_NAV;
  const allowed = !!user && nav.some(i => inSection(pathname, i.href));

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/");
    else if (!allowed) router.replace(homeOf(user.role));
  }, [ready, user, allowed, router]);

  if (!ready || !user || !allowed)
    return (
      <main className="loading" role="status">
        Carregando…
      </main>
    );

  const title = TITLES[nav.find(i => inSection(pathname, i.href))!.href];

  // Gera o arquivo de texto dos códigos inteiramente no navegador (Blob local):
  // eles não são enviados a lugar nenhum nem gravados.
  function downloadCodes() {
    const blob = new Blob(
      [
        `Carteira Financeira — códigos de recuperação\nConta: ${user?.email}\nCada código pode ser usado uma única vez. Guarde em local seguro.\n\n${codes.join("\n")}`,
      ],
      { type: "text/plain;charset=utf-8" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "carteira-codigos-recuperacao.txt";
    a.click();
    URL.revokeObjectURL(url);
    notify("success", "Códigos baixados. Guarde o arquivo em local seguro.");
  }

  return (
    <>
      {/* Navbar fixa no topo, separada do menu lateral e do conteúdo. */}
      <header className="appbar">
        <div className="appbar-brand">
          <Brand />
        </div>
        <div className="appbar-title">
          <h1>{title}</h1>
          <p className="muted">
            {user.name} · {user.email}
          </p>
        </div>
        <div className="topbar-actions">
          {/* Sino: só para cliente comum. O contador acende quando há aviso não lido. */}
          {user.role === "user" && (
            <Link
              href="/notificacoes"
              className="bell"
              aria-label={
                unread > 0
                  ? `Notificações: ${unread} não lida${unread > 1 ? "s" : ""}`
                  : "Notificações: nenhuma nova"
              }
            >
              <BellIcon />
              {unread > 0 && <span className="bell-badge">{unread > 99 ? "99+" : unread}</span>}
            </Link>
          )}
          <button className="btn btn-outline-secondary" disabled={busy} onClick={logout}>
            Sair
          </button>
        </div>
      </header>
      <div className="shell">
        <aside className="sidebar">
          <nav aria-label="Navegação principal">
            {nav.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={inSection(pathname, item.href) ? "active" : ""}
                aria-current={inSection(pathname, item.href) ? "page" : undefined}
              >
                {item.title}
                {item.badge && unread > 0 && <span className="nav-badge">{unread}</span>}
              </Link>
            ))}
          </nav>
          <footer>
            {user.role === "master" ? "Perfil master · Somente leitura" : "Conta pessoal"}
            <br />
            Sessão protegida por 2FA
          </footer>
        </aside>
        <main className="main">
        {codes.length > 0 && (
          <section className="panel">
            <h2>Guarde seus códigos de recuperação</h2>
            <p>
              Estes códigos são exibidos uma única vez. Cada um substitui o código do autenticador em um
              login. Guarde-os fora deste dispositivo.
            </p>
            <ul className="codes">
              {codes.map(c => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="inline-actions">
              <button className="btn btn-primary" onClick={downloadCodes}>
                Baixar códigos
              </button>
              <button className="btn btn-outline-secondary" onClick={() => setCodes([])}>
                Já guardei os códigos
              </button>
            </div>
          </section>
        )}
        {children}
        </main>
      </div>
    </>
  );
}
