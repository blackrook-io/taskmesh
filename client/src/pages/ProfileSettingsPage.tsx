import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "../api/client";
import type { UserProfile } from "../types";

type Props = {
  embedded?: boolean;
};

export function ProfileSettingsPage({ embedded = false }: Props) {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["users", "me"],
    queryFn: async () => {
      const res = await apiJson<{ data: UserProfile }>("/api/v1/users/me");
      return res.data;
    },
  });

  useEffect(() => {
    if (profileQuery.data) {
      setDisplayName(profileQuery.data.displayName);
    }
  }, [profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (nextName: string) => {
      const res = await apiJson<{ data: UserProfile }>("/api/v1/users/me", {
        method: "PATCH",
        body: JSON.stringify({ displayName: nextName }),
      });
      return res.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["users", "me"], data);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
    },
  });

  const body = (
    <div className="settings-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Your profile is used for Created by / Updated by on tasks. Sign-in comes later;
        for now there is a single local user.
      </p>
      {profileQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {profileQuery.isError ? (
        <p role="alert" className="tag-input__error">
          Could not load profile.
        </p>
      ) : null}
      {profileQuery.data ? (
        <div className="profile-settings">
          <div className="field">
            <label htmlFor="profile-ref">Reference ID</label>
            <input
              id="profile-ref"
              type="text"
              value={profileQuery.data.referenceId}
              readOnly
              disabled
            />
          </div>
          <div className="field">
            <label htmlFor="profile-display-name">Display name</label>
            <input
              id="profile-display-name"
              type="text"
              value={displayName}
              maxLength={200}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={() => {
                const next = displayName.trim();
                if (!next || next === profileQuery.data.displayName) {
                  setDisplayName(profileQuery.data.displayName);
                  return;
                }
                void saveMutation.mutateAsync(next);
              }}
            />
          </div>
          {saveMutation.isError ? (
            <p role="alert" className="tag-input__error">
              Could not save display name.
            </p>
          ) : null}
          {savedFlash ? <p className="muted">Saved.</p> : null}
        </div>
      ) : null}
    </div>
  );

  if (embedded) return body;
  return (
    <div className="page">
      <h1>Profile</h1>
      {body}
    </div>
  );
}
