"use client";
/*
 * Fluxo visual do reconhecimento facial: primeiro a tela de preparação (título,
 * moldura oval e botão "Começar"); ao clicar, abre uma MODAL com a captura e a
 * prova de vida (FaceCapture). A câmera só é pedida depois do clique.
 */
import { useEffect, useRef, useState } from "react";
import { FaceCapture, FaceResult } from "./FaceCapture";

/** Silhueta ilustrativa dentro da moldura (a tela de preparação não usa a câmera). */
function Silhouette() {
  return (
    <svg viewBox="0 0 100 130" aria-hidden="true" className="face-silhouette">
      <circle cx="50" cy="48" r="24" />
      <path d="M8 130c2-30 20-46 42-46s40 16 42 46z" />
    </svg>
  );
}

export function FaceFlow({
  onDone,
  onCancel,
}: {
  onDone: (result: FaceResult) => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  // Modal acessível: Esc fecha, o foco vai para ela e a rolagem da página fica travada.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="face-intro">
      <h3>
        Prepare-se para
        <br />o reconhecimento facial
      </h3>
      <div className="face-oval" aria-hidden="true">
        <Silhouette />
      </div>
      <p>Posicione seu rosto no formato oval e toque no botão Começar</p>
      <button
        type="button"
        className="btn btn-primary face-start"
        onClick={() => setOpen(true)}
      >
        Começar
      </button>
      <button type="button" className="btn btn-link" onClick={onCancel}>
        Cancelar
      </button>

      {open && (
        <div
          className="face-backdrop"
          onMouseDown={e => e.target === e.currentTarget && setOpen(false)}
        >
          <div
            className="face-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Reconhecimento facial"
            tabIndex={-1}
            ref={dialog}
          >
            <h3>Reconhecimento facial</h3>
            <FaceCapture
              onCancel={() => setOpen(false)}
              onDone={result => {
                setOpen(false);
                onDone(result);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
