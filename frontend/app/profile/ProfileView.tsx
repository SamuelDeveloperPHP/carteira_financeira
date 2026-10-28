"use client";
/*
 * Página de perfil do usuário, em três abas:
 *   1. Dados bancários  - contas e chaves Pix
 *   2. Segurança        - biometria, geolocalização, reconhecimento facial
 *   3. Trilha de acesso - login/logout, permanência e mapas
 * Cada aba só é montada (e só consulta a API) quando está aberta.
 */
import { useState } from "react";
import { AccessTab } from "./AccessTab";
import { BankTab } from "./BankTab";
import { SecurityTab } from "./SecurityTab";

const TABS = [
  ["bank", "Dados bancários"],
  ["security", "Segurança"],
  ["access", "Trilha de acesso"],
] as const;

export function ProfileView({ fail }: { fail: (e: unknown) => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("bank");
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Perfil">
        {TABS.map(([id, title]) => (
          <button
            key={id}
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {title}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "bank" && <BankTab fail={fail} />}
        {tab === "security" && <SecurityTab fail={fail} />}
        {tab === "access" && <AccessTab fail={fail} />}
      </div>
    </>
  );
}
