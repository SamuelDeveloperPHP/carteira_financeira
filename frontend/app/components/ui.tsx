"use client";
import { ReactNode, useState } from "react";

// Rótulo + campo. O <label> envolve o input, então clicar no texto foca o campo
// e leitores de tela associam os dois.
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field d-block">
      <span className="form-label d-block">{label}</span>
      {children}
    </label>
  );
}
// Campo de senha com botão Mostrar/Ocultar. O estado "visível" é local a cada
// campo e volta a oculto ao recarregar. `aria-pressed` informa o estado do botão
// a leitores de tela; `autoComplete` permite ao gerenciador de senhas salvar ou
// sugerir a senha certa (current-password x new-password).
export function PasswordInput({
  value,
  onChange,
  autoComplete,
  minLength = 1,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  minLength?: number;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="input-group">
      <input
        className="form-control"
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        maxLength={128}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-outline-secondary"
        aria-pressed={shown}
        aria-label={shown ? "Ocultar senha" : "Mostrar senha"}
        onClick={() => setShown(s => !s)}
      >
        {shown ? "Ocultar" : "Mostrar"}
      </button>
    </div>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        CF
      </span>
      <span>Carteira financeira</span>
    </div>
  );
}
// Paginação anterior/próxima. `hasMore` vem da API (que pede uma linha a mais
// para saber se há outra página), sem precisar contar o total.
// Ícone de sino (SVG inline, sem dependência externa). `aria-hidden`: o texto
// acessível fica no botão que o contém.
export function BellIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
export function Pager({
  value,
  change,
  busy = false,
}: {
  value: { page: number; hasMore: boolean };
  change: (p: number) => void;
  busy?: boolean;
}) {
  return (
    <div className="pager">
      <button
        className="btn btn-sm btn-outline-secondary"
        disabled={value.page === 1 || busy}
        onClick={() => change(value.page - 1)}
      >
        Anterior
      </button>
      <small>Página {value.page}</small>
      <button
        className="btn btn-sm btn-outline-secondary"
        disabled={!value.hasMore || busy}
        onClick={() => change(value.page + 1)}
      >
        Próxima
      </button>
    </div>
  );
}
