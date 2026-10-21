import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiJson } from "../api/client";
import { NOTIFICATION_TYPE_LABELS, type NotificationType } from "../lib/notifications";

type InboxItem = {
  id: number;
  type: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

type InboxResponse = {
  data: InboxItem[];
  unread: number;
};

/** A notice that only points at this inbox is not a navigation target. */
function destination(href: string | null): string | null {
  if (!href) return null;
  const path = href.split(/[?#]/)[0] || "/";
  if (path === "/notifications") return null;
  return href;
}

function withRead(current: InboxResponse | undefined, id: number | "all"): InboxResponse | undefined {
  if (!current) return current;
  const now = new Date().toISOString();
  let marked = 0;
  const data = current.data.map((item) => {
    if (item.readAt) return item;
    if (id !== "all" && item.id !== id) return item;
    marked += 1;
    return { ...item, readAt: now };
  });
  if (marked === 0) return current;
  return { ...current, data, unread: Math.max(0, current.unread - marked) };
}

function typeLabel(type: string): string {
  if (type in NOTIFICATION_TYPE_LABELS) {
    return NOTIFICATION_TYPE_LABELS[type as NotificationType];
  }
  return type;
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiJson<InboxResponse>("/api/v1/notifications?limit=50"),
  });

  const markRead = useMutation({
    mutationFn: (id: number) =>
      apiJson(`/api/v1/notifications/${id}/read`, { method: "POST", body: "{}" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["notifications"] });
      const previous = qc.getQueryData<InboxResponse>(["notifications"]);
      qc.setQueryData<InboxResponse>(["notifications"], withRead(previous, id));
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) qc.setQueryData(["notifications"], context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAll = useMutation({
    mutationFn: () =>
      apiJson("/api/v1/notifications/read-all", { method: "POST", body: "{}" }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["notifications"] });
      const previous = qc.getQueryData<InboxResponse>(["notifications"]);
      qc.setQueryData<InboxResponse>(["notifications"], withRead(previous, "all"));
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) qc.setQueryData(["notifications"], context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const unread = query.data?.unread ?? 0;

  return (
    <div className="notifications-page">
      <div className="notifications-page__head">
        <h1>Notifications</h1>
        <button
          type="button"
          className="btn ghost small"
          disabled={unread === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          Mark all read
        </button>
      </div>
      {query.isLoading ? <p className="muted">Loading…</p> : null}
      {query.isError ? <p className="error-text">Could not load notifications.</p> : null}
      {query.isSuccess && query.data.data.length === 0 ? (
        <p className="muted">No notifications yet.</p>
      ) : null}
      <ul className="notification-list">
        {query.data?.data.map((item) => {
          const unreadItem = item.readAt == null;
          const openHref = destination(item.href);
          const body = (
            <>
              <span className="notification-card__type">{typeLabel(item.type)}</span>
              <span className="notification-card__status">{unreadItem ? "Unread" : "Read"}</span>
              <span className="notification-card__title">{item.title}</span>
              <span className="notification-card__body">{item.body}</span>
              <time className="muted" dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString()}
              </time>
            </>
          );
          const className = `notification-card${unreadItem ? " notification-card--unread" : " notification-card--read"}`;
          const mark = () => {
            if (unreadItem) markRead.mutate(item.id);
          };
          return (
            <li key={item.id}>
              {openHref ? (
                <Link to={openHref} className={className} onClick={mark}>
                  {body}
                </Link>
              ) : (
                <button type="button" className={className} onClick={mark}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
