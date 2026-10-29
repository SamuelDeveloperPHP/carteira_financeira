"use client";
// Notificações: só as NÃO lidas; ao ler, o aviso some e o sino diminui.
import { useEffect, useState } from "react";
import { api } from "../../api";
import { notify } from "../../alerts";
import { Pager } from "../../components/ui";
import { date, labels } from "../../lib/format";
import type { AppNotification, List } from "../../lib/types";
import { useSession } from "../../session";

export default function NotificationsPage() {
  const { busy, work, setUnread } = useSession();
  const [notes, setNotes] = useState<List<AppNotification>>({
    items: [],
    page: 1,
    hasMore: false,
  });
  // Carrega os avisos NÃO lidos e sincroniza o contador do sino. Se a página
  // ficou vazia (acabou de ler o último aviso dela), volta uma página.
  async function loadNotifications(p = 1): Promise<void> {
    const r = await api<List<AppNotification> & { unread: number }>(
      `/notifications?page=${p}`
    );
    if (!r.items.length && p > 1) return loadNotifications(p - 1);
    setNotes(r);
    setUnread(r.unread);
  }
  useEffect(() => {
    work(() => loadNotifications());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Marca UM aviso como lido: ele some da lista e o sino diminui.
  async function markRead(id: string) {
    await work(async () => {
      await api(`/notifications/${id}/read`, "POST", {});
      await loadNotifications(notes.page);
    });
  }
  // Marca TODOS os avisos pendentes como lidos e mostra a mensagem da API.
  async function markAllRead() {
    await work(async () => {
      const r = await api<{ message: string }>(
        "/notifications/read-all",
        "POST",
        {}
      );
      await loadNotifications(1);
      notify("success", r.message);
    });
  }
  return (
    <section className="panel">
      <div className="section-head">
        <h2>Notificações novas</h2>
        <button
          className="btn btn-sm btn-outline-secondary"
          disabled={busy || !notes.items.length}
          onClick={markAllRead}
        >
          Marcar todas como lidas
        </button>
      </div>
      {notes.items.length ? (
        <ul className="notice-list">
          {notes.items.map(n => (
            <li key={n.id}>
              <div>
                <span className="tag">{labels[n.kind]}</span>
                <strong className="d-block">{n.message}</strong>
                <small className="d-block muted">{date(n.createdAt)}</small>
              </div>
              <button
                className="btn btn-sm btn-outline-secondary"
                disabled={busy}
                onClick={() => markRead(n.id)}
              >
                Marcar como lida
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">
          <h3>Nenhuma notificação nova</h3>
          <p>
            Avisaremos aqui quando você receber uma transferência ou uma
            devolução.
          </p>
        </div>
      )}
      {(notes.page > 1 || notes.hasMore) && (
        <Pager
          value={notes}
          busy={busy}
          change={p => work(() => loadNotifications(p))}
        />
      )}
    </section>
  );
}
