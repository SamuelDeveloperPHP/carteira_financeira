import Swal from "sweetalert2";

// Central place for every message shown to the user. Components never talk to
// SweetAlert2 directly, so wording and look stay consistent.

type Kind = "success" | "error" | "info" | "warning";

const colors = { confirm: "#176b57", cancel: "#526777" };

// Small, self-dismissing banner for results that need no decision.
const toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 5000,
  timerProgressBar: true,
});

// Success goes to a toast; failures and warnings use a modal so they are not
// missed (and are announced to screen readers by SweetAlert2).
export function notify(kind: Kind, text: string) {
  if (kind === "success" || kind === "info") {
    void toast.fire({ icon: kind, title: text });
    return;
  }
  void Swal.fire({
    icon: kind,
    title: kind === "error" ? "Não foi possível concluir" : "Atenção",
    text,
    confirmButtonText: "Entendi",
    confirmButtonColor: colors.confirm,
  });
}

// Asks the user to confirm a sensitive action. Resolves true only on "confirm".
export async function confirmAction(options: {
  title: string;
  html: string;
  confirmText: string;
}): Promise<boolean> {
  const result = await Swal.fire({
    icon: "question",
    title: options.title,
    html: options.html,
    showCancelButton: true,
    confirmButtonText: options.confirmText,
    cancelButtonText: "Cancelar",
    confirmButtonColor: colors.confirm,
    cancelButtonColor: colors.cancel,
    focusCancel: true,
  });
  return result.isConfirmed;
}

// Values interpolated into dialog HTML must never be able to inject markup.
export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}
