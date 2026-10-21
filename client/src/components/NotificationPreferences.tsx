import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../api/client";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_LABELS,
  type NotificationPreference,
  type NotificationType,
} from "../lib/notifications";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function HourSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="notification-prefs__hour">
      <span>{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === "" ? null : Number(next));
        }}
      >
        <option value="">None</option>
        {HOURS.map((hour) => (
          <option key={hour} value={hour}>
            {String(hour).padStart(2, "0")}:00
          </option>
        ))}
      </select>
    </label>
  );
}

export function NotificationPreferences() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: async () => {
      const res = await apiJson<{ data: NotificationPreference[] }>(
        "/api/v1/notifications/preferences",
      );
      return res.data;
    },
  });
  const [draft, setDraft] = useState<NotificationPreference[] | null>(null);
  const [tab, setTab] = useState<NotificationType>("digest");
  const items = draft ?? query.data ?? [];
  const selected = items.find((item) => item.type === tab) ?? items[0] ?? null;

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: NotificationPreference[] }>(
        "/api/v1/notifications/preferences",
        { method: "PUT", body: JSON.stringify({ items }) },
      );
      return res.data;
    },
    onSuccess: (saved) => {
      setDraft(null);
      qc.setQueryData(["notification-preferences"], saved);
    },
  });

  const update = (type: NotificationType, patch: Partial<NotificationPreference>) => {
    setDraft(items.map((item) => (item.type === type ? { ...item, ...patch } : item)));
  };

  if (query.isLoading) return <p className="muted">Loading preferences…</p>;
  if (query.isError) return <p className="error-text">Could not load notification preferences.</p>;

  return (
    <form
      className="notification-prefs"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        In-app notices arrive immediately. Email follows the frequency and quiet hours for that
        type. Daily and weekly email goes out at 08:00 in the time zone, or when quiet hours end
        if that hour is quiet.
      </p>
      {selected ? (
        <>
          <div
            className="notification-prefs__tabs"
            role="tablist"
            aria-label="Notification types"
            onKeyDown={(event) => {
              const index = NOTIFICATION_TYPES.indexOf(selected.type);
              if (index < 0) return;
              const next =
                event.key === "ArrowRight"
                  ? NOTIFICATION_TYPES[(index + 1) % NOTIFICATION_TYPES.length]
                  : event.key === "ArrowLeft"
                    ? NOTIFICATION_TYPES[(index - 1 + NOTIFICATION_TYPES.length) % NOTIFICATION_TYPES.length]
                    : null;
              if (!next) return;
              event.preventDefault();
              setTab(next);
              document.getElementById(`notification-tab-${next}`)?.focus();
            }}
          >
            {NOTIFICATION_TYPES.map((type) => {
              const active = type === selected.type;
              return (
                <button
                  key={type}
                  type="button"
                  className={`notification-prefs__tab${active ? " is-active" : ""}`}
                  role="tab"
                  id={`notification-tab-${type}`}
                  aria-selected={active}
                  aria-controls={`notification-panel-${type}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setTab(type)}
                >
                  {NOTIFICATION_TYPE_LABELS[type]}
                </button>
              );
            })}
          </div>
          <div
            className="notification-prefs__type"
            role="tabpanel"
            id={`notification-panel-${selected.type}`}
            aria-labelledby={`notification-tab-${selected.type}`}
          >
            <label className="digest-prefs__check">
              <input
                type="checkbox"
                checked={selected.inApp}
                onChange={(event) => update(selected.type, { inApp: event.target.checked })}
              />
              <span>In the app</span>
            </label>
            <label className="digest-prefs__check">
              <input
                type="checkbox"
                checked={selected.email}
                onChange={(event) => update(selected.type, { email: event.target.checked })}
              />
              <span>Email</span>
            </label>
            <label className="notification-prefs__hour">
              <span>Frequency</span>
              <select
                value={selected.frequency}
                onChange={(event) =>
                  update(selected.type, {
                    frequency: event.target.value as NotificationPreference["frequency"],
                  })
                }
              >
                <option value="immediate">Immediate</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            <div className="notification-prefs__hours">
              <HourSelect
                label="Quiet from"
                value={selected.quietStart}
                onChange={(quietStart) => update(selected.type, { quietStart })}
              />
              <HourSelect
                label="Until"
                value={selected.quietEnd}
                onChange={(quietEnd) => update(selected.type, { quietEnd })}
              />
            </div>
            <label className="notification-prefs__hour">
              <span>Time zone</span>
              <input
                value={selected.timeZone}
                onChange={(event) => update(selected.type, { timeZone: event.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
        </>
      ) : null}
      <button type="submit" className="btn primary" disabled={save.isPending || items.length === 0}>
        {save.isPending ? "Saving…" : "Save preferences"}
      </button>
      {save.isError ? (
        <p className="error-text">
          {save.error instanceof Error ? save.error.message : "Could not save preferences."}
        </p>
      ) : null}
    </form>
  );
}
