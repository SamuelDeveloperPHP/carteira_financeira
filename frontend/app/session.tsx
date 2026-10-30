"use client";
/*
 * Sessão compartilhada por TODAS as páginas (React Context).
 *
 * Guarda o que precisa sobreviver à troca de rota: o usuário autenticado, o
 * estágio do login, o "ocupado" global, os códigos de recuperação recém-gerados
 * e o contador do sino. Cada página consome isto com `useSession()`.
 *
 * Segurança no navegador: a sessão vive em cookie HttpOnly; aqui só fica o
 * resultado de /auth/status (nome, e-mail, perfil). Nada sensível em localStorage.
 * Quem decide o acesso é SEMPRE o servidor: os redirecionamentos do layout são
 * conforto de navegação, não proteção.
 */
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { notify } from "./alerts";
import { api, ApiError } from "./api";
import type { User } from "./lib/types";
import { setGeoHint } from "./profile/geo-hint";

/** Código do 401 de sessão ausente ou vencida (ver backend/src/common/http/error-codes.ts). */
const SESSION_EXPIRED = "session_expired";

/** Página inicial de cada perfil, depois do login. */
export const homeOf = (role: User["role"]) =>
  role === "master" ? "/contas" : "/relatorios";

interface Session {
  /** false até /auth/status responder (evita piscar a tela de login). */
  ready: boolean;
  user: User | null;
  /** login · setup · challenge · full, espelhando a sessão no servidor. */
  stage: string;
  setStage: (stage: string) => void;
  busy: boolean;
  /** Envelope de toda ação do usuário: ocupado + try/catch + finally. */
  work: (fn: () => Promise<void>) => Promise<void>;
  /** Mostra o erro ao usuário; se a sessão expirou, volta ao login. */
  fail: (e: unknown) => void;
  codes: string[];
  setCodes: (codes: string[]) => void;
  unread: number;
  setUnread: (n: number) => void;
  /** Marca o usuário como autenticado (depois do 2FA). */
  signIn: (user: User, recoveryCodes?: string[]) => void;
  /** Encerra a sessão no servidor e limpa a tela. */
  logout: () => Promise<void>;
  /** Descarta a sessão só no navegador (o servidor já a revogou, ex.: troca do autenticador). */
  expire: (stage: string) => void;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession fora do SessionProvider");
  return ctx;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false),
    [user, setUser] = useState<User | null>(null),
    [stage, setStage] = useState("login"),
    [busy, setBusy] = useState(false),
    [codes, setCodes] = useState<string[]>([]),
    [unread, setUnreadState] = useState(0);
  // Último contador visto: o toast só aparece quando o número AUMENTA.
  const lastUnread = useRef(0);

  const setUnread = useCallback((n: number) => {
    lastUnread.current = n;
    setUnreadState(n);
  }, []);

  function fail(e: unknown) {
    notify(
      "error",
      e instanceof Error ? e.message : "Não foi possível concluir."
    );
    if (
      e instanceof ApiError &&
      e.status === 401 &&
      user &&
      e.code === SESSION_EXPIRED
    ) {
      setUser(null);
      setStage("login");
    }
  }

  async function work(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  // Ao abrir qualquer URL (inclusive com F5): pergunta ao servidor em que ponto
  // do login o cookie está. `active` evita atualizar estado depois de desmontar.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const s = await api<{ stage: string; user: User | null }>(
          "/auth/status"
        );
        if (!active) return;
        setStage(s.stage);
        if (s.user) {
          setUser(s.user);
          if (s.user.role === "user")
            api<{ geolocationEnabled: boolean }>("/settings")
              .then(r => setGeoHint(r.geolocationEnabled))
              .catch(() => {});
        }
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401) && active) fail(e);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Contador do sino (só cliente comum): ao entrar, a cada 15 s e quando a aba
  // volta a ficar visível. É uma chamada barata (COUNT com índice parcial) e as
  // falhas são silenciosas: o próximo ciclo tenta de novo.
  const customerId = user?.role === "user" ? user.id : null;
  useEffect(() => {
    if (!customerId) {
      setUnread(0);
      return;
    }
    let active = true;
    const refresh = async () => {
      try {
        const { unread: total } = await api<{ unread: number }>(
          "/notifications/count"
        );
        if (!active) return;
        if (total > lastUnread.current)
          notify(
            "info",
            total === 1
              ? "Você tem 1 notificação nova."
              : `Você tem ${total} notificações novas.`
          );
        setUnread(total);
      } catch {
        /* silencioso */
      }
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [customerId, setUnread]);

  function signIn(u: User, recoveryCodes: string[] = []) {
    setUser(u);
    setStage("full");
    setCodes(recoveryCodes);
  }

  function expire(next: string) {
    setUser(null);
    setStage(next);
    setCodes([]);
  }

  async function logout() {
    await work(async () => {
      await api("/auth/logout", "POST", {});
      expire("login");
      notify("info", "Sessão encerrada com segurança.");
      router.push("/");
    });
  }

  return (
    <SessionContext.Provider
      value={{
        ready,
        user,
        stage,
        setStage,
        busy,
        work,
        fail,
        codes,
        setCodes,
        unread,
        setUnread,
        signIn,
        logout,
        expire,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
