import { Browser, expect, Page, test } from "@playwright/test";
import * as OTPAuth from "otpauth";

/*
 * Fluxo do cliente, pela interface, com navegador real:
 *   cadastro -> 2FA -> adicionar saldo -> saldo insuficiente -> transferência
 *   -> notificação -> devolução -> aviso da devolução -> F5 e rotas protegidas.
 * Duas contas novas por execução (e-mails únicos), cada uma em seu contexto
 * de navegador (cookies separados).
 */

const PASSWORD = "Senha de teste e2e 123!";
const money = (v: string) => new RegExp(`R\\$\\s*${v.replace(".", "\\.")}`);

/** Código do autenticador a partir do segredo exibido na tela de cadastro do 2FA. */
const totp = (secret: string) =>
  new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  }).generate();

/** Cria a conta, entra, cadastra o autenticador e chega à carteira. */
async function signUpAndEnter(browser: Browser, name: string, email: string): Promise<Page> {
  // Geolocalização concedida: o login registra a posição na trilha de acesso.
  const context = await browser.newContext({
    geolocation: { latitude: -15.7939, longitude: -47.8828, accuracy: 25 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator(".auth-tabs").getByRole("button", { name: "Criar conta" }).click();
  await page.locator("input[autocomplete=name]").fill(name);
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Criar conta" }).click();
  await expect(page.locator(".swal2-toast")).toContainText("Conta criada");

  await page.locator(".auth-tabs").getByRole("button", { name: "Entrar" }).click();
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Continuar" }).click();

  // Primeiro acesso: o QR code vem com a chave manual, de onde tiramos o segredo.
  await page.getByText("Inserir a chave manualmente").click();
  const secret = (await page.locator("code.secret").innerText()).trim();
  await page.locator("input[autocomplete=one-time-code]").fill(totp(secret));
  await page.getByRole("button", { name: "Confirmar acesso" }).click();

  await expect(page).toHaveURL(/\/carteira$/);
  await page.getByRole("button", { name: "Já guardei os códigos" }).click();
  return page;
}

test("cliente: cadastro, saldo, transferência, notificação e devolução", async ({ browser }) => {
  const id = Date.now().toString(36);
  const emailA = `ana-${id}@example.test`;
  const emailB = `bia-${id}@example.test`;
  const ana = await signUpAndEnter(browser, "Ana E2E", emailA);
  const bia = await signUpAndEnter(browser, "Bia E2E", emailB);

  await test.step("a carteira nova começa com saldo zero", async () => {
    await expect(ana.locator(".balance")).toHaveText(money("0,00"));
    await expect(ana.locator("h1")).toHaveText("Minha carteira");
  });

  await test.step("Ana adiciona R$ 100,00 (com confirmação)", async () => {
    const form = ana.locator("form.balance-note");
    await form.locator("input").fill("100,00");
    await form.getByRole("button", { name: "Adicionar saldo" }).click();
    await ana.locator(".swal2-confirm").click();
    await expect(ana.locator(".swal2-toast")).toContainText("Saldo adicionado");
    await expect(ana.locator(".balance")).toHaveText(money("100,00"));
  });

  const transferForm = ana.locator("form").filter({ has: ana.locator("input[type=email]") });

  await test.step("saldo insuficiente é recusado sem alterar o saldo", async () => {
    await transferForm.locator("input[type=email]").fill(emailB);
    await transferForm.locator("input").nth(1).fill("999,00");
    await transferForm.getByRole("button", { name: "Transferir" }).click();
    await expect(ana.locator(".swal2-popup")).toContainText("Saldo insuficiente");
    await ana.locator(".swal2-confirm").click();
    await expect(ana.locator(".balance")).toHaveText(money("100,00"));
  });

  await test.step("cancelar a confirmação não move dinheiro", async () => {
    await transferForm.locator("input").nth(1).fill("30,00");
    await transferForm.getByRole("button", { name: "Transferir" }).click();
    await expect(ana.locator(".swal2-popup")).toContainText("Enviar");
    await ana.locator(".swal2-cancel").click();
    await expect(ana.locator(".balance")).toHaveText(money("100,00"));
  });

  await test.step("Ana transfere R$ 30,00 para Bia", async () => {
    await transferForm.getByRole("button", { name: "Transferir" }).click();
    await ana.locator(".swal2-confirm").click();
    await expect(ana.locator(".swal2-toast")).toContainText("Transferência concluída");
    await expect(ana.locator(".balance")).toHaveText(money("70,00"));
    await expect(ana.locator("tbody tr").first()).toContainText("-R$");
  });

  await test.step("Bia vê o saldo, o sino e a notificação; ao ler, ela some", async () => {
    await bia.reload();
    await expect(bia.locator(".balance")).toHaveText(money("30,00"));
    await expect(bia.locator(".bell-badge")).toHaveText("1");
    await bia.locator(".sidebar").getByRole("link", { name: /Notificações/ }).click();
    await expect(bia).toHaveURL(/\/notificacoes$/);
    await expect(bia.locator(".notice-list")).toContainText("enviou R$ 30,00 para você");
    await bia.getByRole("button", { name: "Marcar como lida" }).click();
    await expect(bia.getByText("Nenhuma notificação nova")).toBeVisible();
    await expect(bia.locator(".bell-badge")).toHaveCount(0);
  });

  await test.step("Bia devolve a transferência (integral e única)", async () => {
    await bia.locator(".sidebar").getByRole("link", { name: "Minha carteira" }).click();
    await bia.getByRole("button", { name: "Devolver" }).click();
    await expect(bia.locator(".swal2-popup")).toContainText("integral");
    await bia.locator(".swal2-confirm").click();
    await expect(bia.locator(".swal2-toast")).toContainText("devolvido integralmente");
    await expect(bia.locator(".balance")).toHaveText(money("0,00"));
    await expect(bia.getByRole("button", { name: "Devolver" })).toHaveCount(0);
  });

  await test.step("Ana recebe o aviso da devolução e o saldo volta", async () => {
    await ana.reload();
    await expect(ana.locator(".balance")).toHaveText(money("100,00"));
    await expect(ana.locator(".bell-badge")).toHaveText("1");
    await ana.locator(".sidebar").getByRole("link", { name: /Notificações/ }).click();
    await expect(ana.locator(".notice-list")).toContainText("devolveu R$ 30,00");
  });

  await test.step("o painel de BI reflete as movimentações", async () => {
    await ana.locator(".sidebar").getByRole("link", { name: "Painel de BI" }).click();
    await expect(ana).toHaveURL(/\/bi$/);
    await expect(ana.locator(".metric-grid")).toContainText("Entradas");
    await expect(ana.locator(".suggestions")).toContainText("Você recebeu devoluções");
  });

  await test.step("a trilha de acesso registra o login com localização", async () => {
    await ana.locator(".sidebar").getByRole("link", { name: "Meu perfil" }).click();
    await ana.getByRole("link", { name: "Trilha de acesso" }).click();
    await expect(ana).toHaveURL(/\/perfil\/acessos$/);
    await expect(ana.getByText("Localização registrada").first()).toBeVisible();
    await expect(ana.locator(".leaflet-container").first()).toBeVisible();
  });

  await test.step("F5 mantém a página e o logout encerra a sessão", async () => {
    await ana.reload();
    await expect(ana).toHaveURL(/\/perfil\/acessos$/);
    await expect(ana.locator("h1")).toHaveText("Meu perfil");
    await ana.getByRole("button", { name: "Sair" }).click();
    await expect(ana).toHaveURL(/\/$/);
    await ana.goto("/carteira");
    await expect(ana).toHaveURL(/\/$/);
    await expect(ana.getByRole("heading", { name: "Acesse sua carteira" })).toBeVisible();
  });

  await ana.context().close();
  await bia.context().close();
});

test("rotas protegidas redirecionam quem não entrou", async ({ page }) => {
  for (const path of ["/carteira", "/bi", "/perfil/bancario", "/contas"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Acesse sua carteira" })).toBeVisible();
  }
});
