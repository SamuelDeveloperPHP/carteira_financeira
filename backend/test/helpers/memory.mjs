// In-memory doubles for the repositories, so service rules can be unit-tested
// without PostgreSQL. `transaction` snapshots the state and restores it when the
// work throws, which is the behaviour the real database guarantees with ROLLBACK.
import ledgerService from "../../dist/wallet/ledger.service.js";
import idempotencyService from "../../dist/wallet/idempotency.service.js";
import transfersService from "../../dist/wallet/transfers.service.js";
import depositsService from "../../dist/wallet/deposits.service.js";

export function createWorld(wallets = {}) {
  const state = {
    wallets: new Map(Object.entries(wallets)),
    users: new Map(),
    movements: [],
    entries: [],
    idem: new Map(),
    audit: [],
    notifications: [],
  };
  const world = { state, failOnCredit: false };
  const snapshot = () => ({
    wallets: new Map(state.wallets),
    movements: [...state.movements],
    entries: [...state.entries],
    idem: new Map(state.idem),
    audit: [...state.audit],
    notifications: [...state.notifications],
  });
  const db = {
    async transaction(work) {
      const before = snapshot();
      try {
        return await work({});
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
  };
  const ledgerRepo = {
    async lockWallets(_q, ids) {
      return new Map(
        ids.filter(id => state.wallets.has(id)).map(id => [id, state.wallets.get(id)])
      );
    },
    async insertMovement(_q, m) {
      const row = {
        id: m.id,
        kind: m.kind,
        sender_id: m.senderId,
        recipient_id: m.recipientId,
        amount: String(m.amount),
        original_id: m.originalId,
        reference: m.reference,
      };
      state.movements.push(row);
      return row;
    },
    async applyDelta(_q, id, delta) {
      if (world.failOnCredit && delta > 0) throw new Error("falha injetada");
      state.wallets.set(id, state.wallets.get(id) + delta);
      return state.wallets.get(id);
    },
    async insertEntry(_q, movementId, userId, delta, balanceAfter) {
      state.entries.push({ movementId, userId, delta, balanceAfter });
    },
    async findMovement(_q, id) {
      return state.movements.find(m => m.id === id);
    },
    async hasRefund(_q, id) {
      return state.movements.some(m => m.original_id === id);
    },
  };
  const idemRepo = {
    async lock() {},
    async find(_q, scope, key) {
      return state.idem.get(`${scope}|${key}`);
    },
    async save(_q, scope, key, fingerprint, movementId) {
      state.idem.set(`${scope}|${key}`, {
        fingerprint,
        movement: state.movements.find(m => m.id === movementId),
      });
    },
  };
  const users = {
    async findCustomerIdByEmail(email) {
      return state.users.get(email);
    },
  };
  const audit = {
    async record(action, actor, resource, _ctx, _details, outcome = "success") {
      state.audit.push({ action, actor, resource, outcome });
    },
  };
  const ledger = new ledgerService.LedgerService(ledgerRepo);
  const idempotency = new idempotencyService.IdempotencyService(idemRepo);
  world.transfers = new transfersService.TransfersService(
    db,
    users,
    ledger,
    ledgerRepo,
    idempotency,
    audit,
    {
      // Dublê do NotificationsService: guarda no mesmo estado que o rollback restaura.
      create: async (_tx, kind, userId, movementId) =>
        state.notifications.push({ kind, userId, movementId }),
    }
  );
  world.deposits = (provider = { name: "test", confirm: async () => {} }) =>
    new depositsService.DepositsService(
      db,
      users,
      ledger,
      idempotency,
      audit,
      { throttle: async (...args) => world.throttled.push(args) },
      provider
    );
  world.throttled = [];
  world.addUser = (name, email, balance = 0) => {
    state.users.set(email, name);
    state.wallets.set(name, balance);
  };
  world.balance = id => state.wallets.get(id);
  world.ctx = { correlationId: "test", ip: "127.0.0.1", device: "unit", location: {} };
  return world;
}

export const status = error => error?.getStatus?.();
