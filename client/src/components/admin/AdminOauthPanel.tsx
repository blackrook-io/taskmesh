import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { faCircleQuestion } from "@fortawesome/free-solid-svg-icons";
import { apiJson } from "../../api/client";
import { NavIcon } from "../shell/NavIcon";

type AdminOauthProvider = {
  id: number;
  slug: string;
  name: string;
  protocol: string;
  enabled: boolean;
  clientId: string | null;
  hasClientSecret: boolean;
  appleTeamId: string | null;
  appleKeyId: string | null;
  hasApplePrivateKey: boolean;
  scopes: string | null;
  jitEnabled: boolean;
  defaultRoleId: number | null;
  sortOrder: number;
  updatedAt: string;
  kekConfigured: boolean;
};

type RoleRef = { id: number; name: string; slug: string };

function OauthHelpDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    left0: number;
    top0: number;
    width: number;
    height: number;
  } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function onDragHandlePointerDown(e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    const el = panelRef.current;
    if (!el) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: offset.x,
      origY: offset.y,
      left0: rect.left,
      top0: rect.top,
      width: rect.width,
      height: rect.height,
    };
    setDragging(true);
  }

  function onDragHandlePointerMove(e: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const margin = 8;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    let left = drag.left0 + dx;
    let top = drag.top0 + dy;
    left = Math.min(window.innerWidth - drag.width - margin, Math.max(margin, left));
    top = Math.min(window.innerHeight - drag.height - margin, Math.max(margin, top));
    setOffset({
      x: drag.origX + (left - drag.left0),
      y: drag.origY + (top - drag.top0),
    });
  }

  function endDrag(e: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    dragRef.current = null;
    setDragging(false);
  }

  return createPortal(
    <div
      ref={panelRef}
      className={`admin-oauth-help-panel modal modal--wide${dragging ? " is-dragging" : ""}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <header
        className="admin-oauth-help__head admin-oauth-help__drag"
        onPointerDown={onDragHandlePointerDown}
        onPointerMove={onDragHandlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <h2 id={titleId}>OAuth field guide</h2>
        <button
          ref={closeRef}
          type="button"
          className="btn ghost small"
          onClick={onClose}
          aria-label="Close help"
        >
          Close
        </button>
      </header>
      <p className="muted small admin-oauth-help__hint">
        Drag the title bar to move this panel. Settings behind it stay usable.
      </p>

      <div className="admin-oauth-help">
          <section>
            <h3>Before you start</h3>
            <ul>
              <li>
                Set <code>OAUTH_CREDENTIALS_KEY</code> in the server <code>.env</code> (long random
                secret). Provider secrets are encrypted with it; without it you cannot enable a
                provider.
              </li>
              <li>
                Optionally set <code>OAUTH_PUBLIC_BASE_URL</code> to your public HTTPS origin (no
                trailing slash) if redirects must use a host different from the API request.
              </li>
              <li>
                In each IdP console, register the callback URL shown on the provider card (full
                URL = public origin + path).
              </li>
              <li>
                Full console walkthroughs, account/fee requirements, and vendor links:{" "}
                <code>docs/OAUTH_SETUP.md</code> in the repository (also linked from{" "}
                <code>docs/README.md</code>).
              </li>
            </ul>
          </section>

        <section>
          <h3>Shared fields</h3>
          <dl>
            <dt>Enabled</dt>
            <dd>
              When on (and credentials are valid), a “Continue with …” button appears on the
              Login page for users who are not signed in.
            </dd>
            <dt>Client ID</dt>
            <dd>
              Public client identifier from the IdP. For Apple this is the <strong>Services
              ID</strong> (not the App ID).
            </dd>
            <dt>Client secret</dt>
            <dd>
              Google and GitHub only. Paste once to set or rotate; leave blank to keep the
              current secret. Never shown again after save.
            </dd>
            <dt>Scopes</dt>
            <dd>
              Space-separated OAuth scopes. Defaults are usually fine (
              <code>openid email profile</code> for Google, <code>name email</code> for Apple,{" "}
              <code>read:user user:email</code> for GitHub).
            </dd>
            <dt>JIT create users</dt>
            <dd>
              Off by default. When on, a successful IdP sign-in for an unknown verified email
              creates a TaskMesh user with no password and assigns the JIT default role
              (Editor if unset).
            </dd>
            <dt>JIT default role</dt>
            <dd>
              Role granted to newly created JIT users. Leave as “Editor (auto)” unless you
              need a different seeded/custom role.
            </dd>
            <dt>Callback URL</dt>
            <dd>
              Exact path the IdP must redirect to after consent. Copy the full public URL into
              the provider’s authorized redirect URIs.
            </dd>
          </dl>
        </section>

        <section>
          <h3>Google</h3>
          <p>
            Create an OAuth 2.0 Client ID (Web application) in Google Cloud Console. Enable the
            Google identity / OIDC scopes. Use the Client ID and Client secret here.
          </p>
        </section>

        <section>
          <h3>Apple (Sign in with Apple)</h3>
          <dl>
            <dt>Services ID (Client ID)</dt>
            <dd>Identifier configured for web Sign in with Apple.</dd>
            <dt>Team ID</dt>
            <dd>Your Apple Developer Team ID (Membership details).</dd>
            <dt>Key ID</dt>
            <dd>Key ID of the Sign in with Apple private key you created.</dd>
            <dt>Private key (.p8 PEM)</dt>
            <dd>
              Full contents of the downloaded <code>.p8</code> file, including{" "}
              <code>BEGIN/END PRIVATE KEY</code> lines. Write-only after save; paste again to
              rotate.
            </dd>
          </dl>
          <p className="muted">
            Apple may return the user’s name only on the first authorization. Email can be a
            private relay address — TaskMesh still treats it as the account email when present.
          </p>
        </section>

        <section>
          <h3>GitHub</h3>
          <p>
            Create an OAuth App under GitHub Developer Settings. Homepage and callback must
            match your TaskMesh origin. Users need a <strong>verified</strong> primary email
            (or another verified email) for sign-in to succeed.
          </p>
        </section>

        <section>
          <h3>How sign-in works</h3>
          <ul>
            <li>
              After IdP consent, TaskMesh creates the same session cookie as password login.
            </li>
            <li>
              Matching prefers an existing linked identity, then a user with the same verified
              email (and links the provider). Otherwise JIT (if enabled) or a “no account”
              error.
            </li>
            <li>
              Users can link or unlink providers under Profile → Linked accounts (cannot remove
              the last sign-in method if they have no password).
            </li>
          </ul>
        </section>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function AdminOauthPanel() {
  const qc = useQueryClient();
  const [flash, setFlash] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});

  const providersQuery = useQuery({
    queryKey: ["admin", "oauth-providers"],
    queryFn: async () => {
      const res = await apiJson<{ data: AdminOauthProvider[] }>(
        "/api/v1/admin/oauth-providers",
      );
      return res.data;
    },
  });

  const rolesQuery = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: async () => {
      const res = await apiJson<{ data: RoleRef[] }>("/api/v1/admin/roles");
      return res.data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async ({
      slug,
      body,
    }: {
      slug: string;
      body: Record<string, unknown>;
    }) => {
      const res = await apiJson<{ data: AdminOauthProvider }>(
        `/api/v1/admin/oauth-providers/${slug}`,
        { method: "PATCH", body: JSON.stringify(body) },
      );
      return res.data;
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["admin", "oauth-providers"] });
      setDrafts((d) => {
        const next = { ...d };
        delete next[data.slug];
        return next;
      });
      setFlash(`${data.name} saved.`);
      window.setTimeout(() => setFlash(null), 2000);
    },
  });

  function draft(slug: string) {
    return drafts[slug] ?? {};
  }

  function setDraft(slug: string, key: string, value: string) {
    setDrafts((d) => ({
      ...d,
      [slug]: { ...(d[slug] ?? {}), [key]: value },
    }));
  }

  function save(p: AdminOauthProvider) {
    const d = draft(p.slug);
    const body: Record<string, unknown> = {
      enabled: d.enabled !== undefined ? d.enabled === "true" : p.enabled,
      clientId: d.clientId !== undefined ? d.clientId || null : undefined,
      scopes: d.scopes !== undefined ? d.scopes || null : undefined,
      jitEnabled: d.jitEnabled !== undefined ? d.jitEnabled === "true" : p.jitEnabled,
    };
    if (d.clientSecret) body.clientSecret = d.clientSecret;
    if (p.slug === "apple") {
      if (d.appleTeamId !== undefined) body.appleTeamId = d.appleTeamId || null;
      if (d.appleKeyId !== undefined) body.appleKeyId = d.appleKeyId || null;
      if (d.applePrivateKey) body.applePrivateKey = d.applePrivateKey;
    }
    if (d.defaultRoleId !== undefined) {
      body.defaultRoleId = d.defaultRoleId ? Number(d.defaultRoleId) : null;
    }
    saveMutation.mutate({ slug: p.slug, body });
  }

  if (providersQuery.isLoading) return <p className="muted">Loading…</p>;
  if (providersQuery.isError) {
    return <p className="form-error">Could not load OAuth providers.</p>;
  }

  const providers = providersQuery.data ?? [];

  return (
    <div className="admin-panel">
      <div className="admin-oauth-title-row">
        <h2>OAuth providers</h2>
        <button
          type="button"
          className="btn ghost small admin-oauth-help-btn"
          aria-label="OAuth field help"
          title="Field help"
          onClick={() => setHelpOpen(true)}
        >
          <NavIcon icon={faCircleQuestion} size={16} />
        </button>
      </div>
      <p className="muted">
        Google, Apple, and GitHub sign-in. Secrets are write-only and encrypted with{" "}
        <code>OAUTH_CREDENTIALS_KEY</code>
        {providers[0]?.kekConfigured ? " (configured)." : " (not set — required to enable)."}
      </p>
      {flash ? <p className="form-success">{flash}</p> : null}
      {saveMutation.isError ? (
        <p className="form-error">{(saveMutation.error as Error).message}</p>
      ) : null}

      <div className="admin-oauth-list">
        {providers.map((p) => {
          const d = draft(p.slug);
          const enabled =
            d.enabled !== undefined ? d.enabled === "true" : p.enabled;
          const jit =
            d.jitEnabled !== undefined ? d.jitEnabled === "true" : p.jitEnabled;
          return (
            <section key={p.slug} className="admin-oauth-card">
              <header className="admin-oauth-card__head">
                <h3>{p.name}</h3>
                <span className="muted">{p.protocol.toUpperCase()}</span>
              </header>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) =>
                    setDraft(p.slug, "enabled", e.target.checked ? "true" : "false")
                  }
                />
                Enabled
              </label>
              <label>
                Client ID {p.slug === "apple" ? "(Services ID)" : ""}
                <input
                  type="text"
                  value={d.clientId ?? p.clientId ?? ""}
                  onChange={(e) => setDraft(p.slug, "clientId", e.target.value)}
                  autoComplete="off"
                />
              </label>
              {p.slug !== "apple" ? (
                <label>
                  Client secret {p.hasClientSecret ? "(set — leave blank to keep)" : ""}
                  <input
                    type="password"
                    value={d.clientSecret ?? ""}
                    onChange={(e) => setDraft(p.slug, "clientSecret", e.target.value)}
                    autoComplete="new-password"
                    placeholder={p.hasClientSecret ? "••••••••" : ""}
                  />
                </label>
              ) : (
                <>
                  <label>
                    Team ID
                    <input
                      type="text"
                      value={d.appleTeamId ?? p.appleTeamId ?? ""}
                      onChange={(e) => setDraft(p.slug, "appleTeamId", e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Key ID
                    <input
                      type="text"
                      value={d.appleKeyId ?? p.appleKeyId ?? ""}
                      onChange={(e) => setDraft(p.slug, "appleKeyId", e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Private key (.p8 PEM){" "}
                    {p.hasApplePrivateKey ? "(set — paste to rotate)" : ""}
                    <textarea
                      rows={4}
                      value={d.applePrivateKey ?? ""}
                      onChange={(e) => setDraft(p.slug, "applePrivateKey", e.target.value)}
                      placeholder={
                        p.hasApplePrivateKey ? "••••••••" : "-----BEGIN PRIVATE KEY-----"
                      }
                      autoComplete="off"
                    />
                  </label>
                </>
              )}
              <label>
                Scopes
                <input
                  type="text"
                  value={d.scopes ?? p.scopes ?? ""}
                  onChange={(e) => setDraft(p.slug, "scopes", e.target.value)}
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={jit}
                  onChange={(e) =>
                    setDraft(p.slug, "jitEnabled", e.target.checked ? "true" : "false")
                  }
                />
                JIT create users (default role Editor)
              </label>
              <label>
                JIT default role
                <select
                  value={
                    d.defaultRoleId ??
                    (p.defaultRoleId != null ? String(p.defaultRoleId) : "")
                  }
                  onChange={(e) => setDraft(p.slug, "defaultRoleId", e.target.value)}
                >
                  <option value="">Editor (auto)</option>
                  {(rolesQuery.data ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted small">
                Callback URL:{" "}
                <code>/api/v1/auth/oauth/{p.slug}/callback</code>
              </p>
              <button
                type="button"
                className="btn primary"
                disabled={saveMutation.isPending}
                onClick={() => save(p)}
              >
                Save {p.name}
              </button>
            </section>
          );
        })}
      </div>

      {helpOpen ? <OauthHelpDialog onClose={() => setHelpOpen(false)} /> : null}
    </div>
  );
}
