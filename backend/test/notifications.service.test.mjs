import test from "node:test";
import assert from "node:assert/strict";
import serviceModule from "../dist/notifications/notifications.service.js";

// Repositório em memória: guarda avisos e aplica as mesmas regras de leitura do SQL.
function setup() {
  const rows = [];
  const repo = {
    async insert(_q, n) {
      if (
        rows.some(r => r.userId === n.userId && r.movementId === n.movementId)
      )
        return;
      rows.push({ ...n, readAt: null, createdAt: new Date(rows.length) });
    },
    async listUnread(userId, offset, limit) {
      return rows
        .filter(r => r.userId === userId && !r.readAt)
        .reverse()
        .slice(offset, offset + limit + 1)
        .map(r => ({
          id: r.id,
          kind: r.kind,
          movement_id: r.movementId,
          amount: r.amount ?? "2550",
          counterpart_name: r.counterpart ?? "Ana Souza",
          created_at: r.createdAt,
        }));
    },
    async countUnread(userId) {
      return rows.filter(r => r.userId === userId && !r.readAt).length;
    },
    async markRead(userId, id) {
      const row = rows.find(r => r.id === id && r.userId === userId);
      if (!row) return false;
      row.readAt ??= new Date();
      return true;
    },
    async markAllRead(userId) {
      const pending = rows.filter(r => r.userId === userId && !r.readAt);
      pending.forEach(r => (r.readAt = new Date()));
      return pending.length;
    },
  };
  return { rows, service: new serviceModule.NotificationsService(repo) };
}

test("a mensagem de cada tipo vem pronta, em português e com o valor formatado", async () => {
  const { service } = setup();
  await service.create({}, "transfer_received", "bia", "mov-1");
  await service.create({}, "refund_received", "bia", "mov-2");
  const { items, unread } = await service.list("bia");
  assert.equal(unread, 2);
  // Mais nova primeiro.
  assert.equal(
    items[0].message,
    "Ana Souza devolveu R$ 25,50 da transferência que você enviou."
  );
  assert.equal(items[1].message, "Ana Souza enviou R$ 25,50 para você.");
});

test("marcar como lida tira o aviso da lista e reduz o contador", async () => {
  const { service } = setup();
  await service.create({}, "transfer_received", "bia", "mov-1");
  await service.create({}, "transfer_received", "bia", "mov-2");
  const [first] = (await service.list("bia")).items;
  assert.equal(
    (await service.markRead("bia", first.id)).message,
    "Notificação marcada como lida."
  );
  const after = await service.list("bia");
  assert.equal(after.unread, 1);
  assert(!after.items.some(i => i.id === first.id));
  // Repetir não dá erro nem muda nada.
  await service.markRead("bia", first.id);
  assert.equal((await service.unread("bia")).unread, 1);
});

test("cada usuário só vê e altera os próprios avisos", async () => {
  const { service } = setup();
  await service.create({}, "transfer_received", "bia", "mov-1");
  const [mine] = (await service.list("bia")).items;
  assert.equal((await service.list("ana")).items.length, 0);
  await assert.rejects(
    service.markRead("ana", mine.id),
    e => e.getStatus() === 404
  );
  assert.equal((await service.unread("bia")).unread, 1);
});

test("marcar todas como lidas esvazia a lista", async () => {
  const { service } = setup();
  await service.create({}, "transfer_received", "bia", "mov-1");
  await service.create({}, "transfer_received", "bia", "mov-2");
  const result = await service.markAllRead("bia");
  assert.equal(result.updated, 2);
  assert.equal(
    result.message,
    "Todas as notificações foram marcadas como lidas."
  );
  assert.equal((await service.list("bia")).items.length, 0);
  assert.equal(
    (await service.markAllRead("bia")).message,
    "Você não tem notificações novas."
  );
});

test("o mesmo movimento avisa a mesma pessoa uma única vez", async () => {
  const { service, rows } = setup();
  await service.create({}, "transfer_received", "bia", "mov-1");
  await service.create({}, "transfer_received", "bia", "mov-1");
  assert.equal(rows.length, 1);
});

test("a paginação indica quando há mais avisos", async () => {
  const { service } = setup();
  for (let i = 0; i < 21; i++)
    await service.create({}, "transfer_received", "bia", `mov-${i}`);
  const page1 = await service.list("bia", 1);
  assert.equal(page1.items.length, 20);
  assert.equal(page1.hasMore, true);
  assert.equal((await service.list("bia", 2)).items.length, 1);
});
