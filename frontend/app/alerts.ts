import Swal from "sweetalert2";

// Único lugar que fala com o SweetAlert2. Os componentes chamam `notify` e
// `confirmAction`, então texto, cores e comportamento dos avisos ficam
// consistentes e podem ser trocados em um só arquivo.

type Kind = "success" | "error" | "info" | "warning";

// Cores alinhadas à identidade visual (verde = ação principal, cinza = cancelar).
const colors = { confirm: "#176b57", cancel: "#526777" };

// Aviso pequeno no canto da tela que some sozinho em 5 s, com barra de tempo.
// Usado para resultados que não exigem decisão (sucesso, informação).
const toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 5000,
  timerProgressBar: true,
});

// Sucesso e informação vão para o toast. Erros e alertas usam um MODAL, que
// exige um clique: o usuário não deixa passar uma falha (e o SweetAlert2 já a
// anuncia para leitores de tela). O texto do erro vem da API, já seguro.
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

// Pede confirmação antes de uma ação sensível (transferir, devolver). Devolve
// true somente se o usuário clicar em confirmar. O foco inicial fica em
// "Cancelar": apertar Enter sem pensar não move dinheiro.
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

// O SweetAlert2 interpreta `html` como HTML. Qualquer valor vindo do usuário
// (e-mail do destinatário, nome) tem de passar por aqui antes de entrar no
// texto, senão seria possível injetar marcação (XSS) no diálogo.
export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

// Pede um texto ao usuário (senha ou código) num diálogo. Devolve o que foi
// digitado, ou null se cancelar. Nada é guardado: o valor só segue para a API.
// `password` oculta a digitação; a mensagem explica por que o dado é pedido.
export async function askInput(options: {
  title: string;
  text: string;
  label: string;
  password?: boolean;
  confirmText?: string;
}): Promise<string | null> {
  const result = await Swal.fire({
    icon: "question",
    title: options.title,
    text: options.text,
    input: options.password ? "password" : "text",
    inputLabel: options.label,
    inputAttributes: { autocomplete: options.password ? "current-password" : "one-time-code", maxlength: "128" },
    showCancelButton: true,
    confirmButtonText: options.confirmText ?? "Confirmar",
    cancelButtonText: "Cancelar",
    confirmButtonColor: colors.confirm,
    cancelButtonColor: colors.cancel,
    inputValidator: (v: string) => (v ? undefined : "Preencha este campo."),
  });
  return result.isConfirmed ? String(result.value) : null;
}
