import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "../api/client";

type Identity = {
  id: number;
  providerSlug: string;
  providerName: string;
  emailAtLink: string | null;
  linkedAt: string;
};

type PublicProvider = { slug: string; name: string };

export function ProfileLinkedAccountsSection() {
  const qc = useQueryClient();

  const identitiesQuery = useQuery({
    queryKey: ["users", "me", "identities"],
    queryFn: async () => {
      const res = await apiJson<{ data: Identity[] }>("/api/v1/users/me/identities");
      return res.data;
    },
  });

  const providersQuery = useQuery({
    queryKey: ["auth", "oauth-providers"],
    queryFn: async () => {
      const res = await apiJson<{ data: PublicProvider[] }>("/api/v1/auth/oauth/providers");
      return res.data;
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/users/me/identities/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users", "me", "identities"] });
    },
  });

  const linked = identitiesQuery.data ?? [];
  const linkedSlugs = new Set(linked.map((i) => i.providerSlug));
  const available = (providersQuery.data ?? []).filter((p) => !linkedSlugs.has(p.slug));

  return (
    <section className="profile-settings__section">
      <h3>Linked accounts</h3>
      <p className="muted">
        Sign in with Google, Apple, or GitHub. You cannot unlink your last sign-in method if you
        have no password.
      </p>
      {identitiesQuery.isError ? (
        <p className="error-text">{(identitiesQuery.error as Error).message}</p>
      ) : null}
      {unlinkMutation.isError ? (
        <p className="error-text">{(unlinkMutation.error as Error).message}</p>
      ) : null}
      {linked.length === 0 ? <p className="muted">No linked providers yet.</p> : null}
      <ul className="profile-linked-list">
        {linked.map((i) => (
          <li key={i.id} className="profile-linked-list__item">
            <div>
              <strong>{i.providerName}</strong>
              {i.emailAtLink ? <span className="muted"> · {i.emailAtLink}</span> : null}
            </div>
            <button
              type="button"
              className="btn ghost small"
              disabled={unlinkMutation.isPending}
              onClick={() => {
                if (window.confirm(`Unlink ${i.providerName}?`)) {
                  unlinkMutation.mutate(i.id);
                }
              }}
            >
              Unlink
            </button>
          </li>
        ))}
      </ul>
      {available.length > 0 ? (
        <div className="profile-linked-actions">
          {available.map((p) => (
            <a
              key={p.slug}
              className="btn secondary small"
              href={`/api/v1/auth/oauth/${p.slug}/start?mode=link&returnTo=${encodeURIComponent("/settings/profile")}`}
            >
              Link {p.name}
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}
