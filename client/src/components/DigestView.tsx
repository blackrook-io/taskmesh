import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { apiJson } from "../api/client";
import {
  DIGEST_SECTIONS,
  DIGEST_SECTION_LABELS,
  remainingCount,
  type DigestInbox,
  type DigestItem,
  type DigestPrefs,
} from "../lib/digestView";
import { digestInboxKey, useDigestInbox } from "../lib/useDigestInbox";

function browserTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone || "UTC";
}

export function DigestView({
  limitPerSection,
  showPreferences,
}: {
  limitPerSection?: number;
  showPreferences?: boolean;
}) {
  const qc = useQueryClient();
  const inbox = useDigestInbox();

  const markSeen = useMutation({
    mutationFn: () => apiJson("/api/v1/digests/seen", { method: "POST", body: "{}" }),
    onSuccess: () => {
      qc.setQueryData<DigestInbox>(digestInboxKey, (current) =>
        current ? { ...current, unread: false } : current,
      );
    },
  });

  const digestId = inbox.data?.digest?.id;
  const unread = inbox.data?.unread === true;
  const markSeenMutate = markSeen.mutate;
  useEffect(() => {
    if (!unread || digestId == null) return;
    markSeenMutate();
  }, [unread, digestId, markSeenMutate]);

  const run = useMutation({
    mutationFn: () => apiJson("/api/v1/digests/run", { method: "POST", body: "{}" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: digestInboxKey });
    },
  });

  const hide = useMutation({
    mutationFn: async (args: { path: string; body: object }) => {
      await apiJson(args.path, { method: "POST", body: JSON.stringify(args.body) });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: digestInboxKey });
    },
  });

  if (inbox.isLoading) return <p className="muted">Loading digest…</p>;
  if (inbox.isError) return <p className="error-text">Could not load the digest.</p>;
  const data = inbox.data;
  if (!data?.digest) {
    return (
      <div className="digest-panel">
        <p className="muted">No digest yet.</p>
        {showPreferences ? (
          <button type="button" className="btn primary" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? "Building…" : "Build now"}
          </button>
        ) : (
          <Link to="/digest">Open digest</Link>
        )}
      </div>
    );
  }

  const digest = data.digest;
  return (
    <div className="digest-panel">
      <div className="digest-panel__toolbar">
        {showPreferences ? (
          <button type="button" className="btn ghost small" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? "Building…" : "Build now"}
          </button>
        ) : (
          <Link to="/digest">Open digest</Link>
        )}
      </div>
      {digest.summary ? (
        <blockquote className="digest-summary">
          {digest.summarySource === "model" ? <div className="digest-summary__label">AI-written</div> : null}
          <p>{digest.summary}</p>
        </blockquote>
      ) : null}
      {digest.excludedProjects.length > 0 ? (
        <p className="muted">
          Not summarized: {digest.excludedProjects.map((project) => project.name).join(", ")}
        </p>
      ) : null}
      {DIGEST_SECTIONS.map((section) => {
        const items = digest.sections[section];
        const shown = limitPerSection != null ? items.slice(0, limitPerSection) : items;
        if (shown.length === 0) return null;
        const more = remainingCount(data, section) + (items.length - shown.length);
        return (
          <section key={section} className="digest-section">
            <h2>{DIGEST_SECTION_LABELS[section]}</h2>
            <ul>
              {shown.map((item) => (
                <DigestRow
                  key={`${section}:${item.entityType}:${item.entityId}`}
                  item={item}
                  pending={hide.isPending}
                  onDismiss={() =>
                    hide.mutate({
                      path: "/api/v1/digests/items/dismiss",
                      body: { entityType: item.entityType, entityId: item.entityId, section },
                    })
                  }
                  onSnooze={(span) =>
                    hide.mutate({
                      path: "/api/v1/digests/items/snooze",
                      body: { entityType: item.entityType, entityId: item.entityId, section, span },
                    })
                  }
                />
              ))}
            </ul>
            {more > 0 ? <p className="muted">and {more} more</p> : null}
          </section>
        );
      })}
      {showPreferences ? <DigestPrefsForm prefs={data.prefs} /> : null}
    </div>
  );
}

function DigestRow({
  item,
  pending,
  onDismiss,
  onSnooze,
}: {
  item: DigestItem;
  pending: boolean;
  onDismiss: () => void;
  onSnooze: (span: "tomorrow" | "week") => void;
}) {
  return (
    <li className="digest-item">
      <Link to={item.href}>
        {item.referenceId} {item.title}
      </Link>
      <span className="muted">{item.reason}</span>
      <span className="digest-item__actions">
        <button type="button" className="btn ghost small" disabled={pending} onClick={() => onSnooze("tomorrow")}>
          Tomorrow
        </button>
        <button type="button" className="btn ghost small" disabled={pending} onClick={() => onSnooze("week")}>
          Next week
        </button>
        <button type="button" className="btn ghost small" disabled={pending} onClick={onDismiss}>
          Dismiss
        </button>
      </span>
    </li>
  );
}

function DigestPrefsForm({ prefs }: { prefs: DigestPrefs }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async (body: {
      frequency: DigestPrefs["frequency"];
      summary: boolean;
      sections: DigestPrefs["sections"];
      timeZone: string;
    }) => {
      const res = await apiJson<{ data: DigestPrefs }>("/api/v1/digests/prefs", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return res.data;
    },
    onSuccess: (next) => {
      qc.setQueryData<DigestInbox>(digestInboxKey, (current) => (current ? { ...current, prefs: next } : current));
    },
  });

  return (
    <form
      key={`${prefs.frequency}:${prefs.summary}:${prefs.timeZone}:${DIGEST_SECTIONS.map((section) => (prefs.sections[section] ? "1" : "0")).join("")}`}
      className="digest-prefs"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const sections = { ...prefs.sections };
        for (const section of DIGEST_SECTIONS) {
          sections[section] = form.get(`section-${section}`) === "on";
        }
        save.mutate({
          frequency: form.get("frequency") === "weekly" ? "weekly" : "daily",
          summary: form.get("summary") === "on",
          sections,
          timeZone: browserTimeZone(),
        });
      }}
    >
      <h2>Preferences</h2>
      <p className="muted">The next digest uses these. Build now to refresh the current one. Delivery stays at 07:00 in {browserTimeZone()}.</p>
      <label className="field">
        Frequency
        <select name="frequency" defaultValue={prefs.frequency}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <label className="digest-prefs__check">
        <input type="checkbox" name="summary" defaultChecked={prefs.summary} />
        AI summary
      </label>
      <fieldset>
        <legend>Sections</legend>
        {DIGEST_SECTIONS.map((section) => (
          <label key={section} className="digest-prefs__check">
            <input type="checkbox" name={`section-${section}`} defaultChecked={prefs.sections[section]} />
            {DIGEST_SECTION_LABELS[section]}
          </label>
        ))}
      </fieldset>
      <button type="submit" className="btn primary" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save preferences"}
      </button>
      {save.isError ? <p className="error-text">Could not save preferences.</p> : null}
      {save.isSuccess ? <p className="muted">Saved.</p> : null}
    </form>
  );
}
