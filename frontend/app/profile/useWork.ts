"use client";
import { useState } from "react";
import { notify } from "../alerts";

/**
 * Envelope de ação do usuário, o mesmo papel do `work()` da tela principal:
 * liga o "ocupado" (evita clique duplo), captura qualquer erro e o mostra num
 * modal (SweetAlert2) e SEMPRE desliga o "ocupado" no finally. `fail` permite à
 * tela principal tratar sessão expirada (volta ao login).
 */
export function useWork(fail?: (e: unknown) => void) {
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (fail) fail(e);
      else notify("error", e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}
