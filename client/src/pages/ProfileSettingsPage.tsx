import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "../api/client";
import {
  PASSWORD_GUIDELINES,
  validateEmailClient,
  validatePasswordClient,
} from "../lib/password";
import type { UserProfile } from "../types";

type Props = {
  embedded?: boolean;
};

export function ProfileSettingsPage({ embedded = false }: Props) {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

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
      setEmail(profileQuery.data.email ?? "");
    }
  }, [profileQuery.data]);

  function flash(message: string) {
    setSavedFlash(message);
    window.setTimeout(() => setSavedFlash(null), 1500);
  }

  const saveNameMutation = useMutation({
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
      flash("Display name saved.");
    },
  });

  const saveEmailMutation = useMutation({
    mutationFn: async (nextEmail: string) => {
      const res = await apiJson<{ data: UserProfile }>("/api/v1/users/me", {
        method: "PATCH",
        body: JSON.stringify({ email: nextEmail }),
      });
      return res.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["users", "me"], data);
      flash("Email saved.");
    },
  });

  const savePasswordMutation = useMutation({
    mutationFn: async (nextPassword: string) => {
      const res = await apiJson<{ data: UserProfile }>("/api/v1/users/me/password", {
        method: "POST",
        body: JSON.stringify({ password: nextPassword }),
      });
      return res.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["users", "me"], data);
      setPassword("");
      setPassword2("");
      setPasswordFocused(false);
      flash("Password saved.");
    },
  });

  const emailError = emailTouched || email.length > 0 ? validateEmailClient(email) : null;
  const emailDirty =
    email.trim() !== (profileQuery.data?.email ?? "").trim();
  const emailCanSave =
    !emailError && emailDirty && email.trim().length > 0 && !saveEmailMutation.isPending;

  const passwordsMatch = password.length > 0 && password2.length > 0 && password === password2;
  const passwordsMismatch = password.length > 0 && password2.length > 0 && password !== password2;
  const passwordRuleError =
    password.length > 0 ? validatePasswordClient(password) : null;
  const showPasswordHelp = passwordFocused || password.length > 0 || password2.length > 0;
  const passwordCanSave =
    passwordsMatch && !passwordRuleError && !savePasswordMutation.isPending;

  const body = (
    <div className="settings-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Your profile is used for Created by / Updated by on tasks. Email and password are
        stored for future sign-in; passwords are never shown after you save them.
      </p>
      {profileQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {profileQuery.isError ? (
        <p role="alert" className="error-text">
          Could not load profile.
        </p>
      ) : null}
      {profileQuery.data ? (
        <div className="profile-settings">
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
                void saveNameMutation.mutateAsync(next);
              }}
            />
            <p className="profile-settings__ref" aria-label="Reference ID">
              Reference ID: {profileQuery.data.referenceId}
            </p>
          </div>
          {saveNameMutation.isError ? (
            <p role="alert" className="error-text">
              Could not save display name.
            </p>
          ) : null}

          <div className="field">
            <label htmlFor="profile-email">Email</label>
            <input
              id="profile-email"
              type="email"
              autoComplete="email"
              value={email}
              maxLength={320}
              required
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailTouched(true);
              }}
              onBlur={() => setEmailTouched(true)}
            />
          </div>
          {emailError ? (
            <p role="alert" className="error-text">
              {emailError}
            </p>
          ) : null}
          {saveEmailMutation.isError ? (
            <p role="alert" className="error-text">
              {(saveEmailMutation.error as Error).message || "Could not save email."}
            </p>
          ) : null}
          {emailCanSave ? (
            <div className="profile-settings__actions">
              <button
                type="button"
                className="btn primary small"
                onClick={() => void saveEmailMutation.mutateAsync(email.trim())}
              >
                Save email
              </button>
            </div>
          ) : null}

          <div className="profile-settings__section">
            <h3 className="profile-settings__heading">Password</h3>
            <p className="muted small" style={{ marginTop: 0 }}>
              {profileQuery.data.hasPassword
                ? "A password is set. Enter a new one below to change it."
                : "No password set yet."}{" "}
              Passwords cannot be viewed after saving.
            </p>
            {showPasswordHelp ? (
              <p className="profile-settings__help">{PASSWORD_GUIDELINES}</p>
            ) : null}
            <div className="field">
              <label htmlFor="profile-password">New password</label>
              <input
                id="profile-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setPasswordFocused(true)}
              />
            </div>
            <div className="field">
              <label htmlFor="profile-password2">Confirm password</label>
              <input
                id="profile-password2"
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                onFocus={() => setPasswordFocused(true)}
              />
            </div>
            {passwordsMismatch ? (
              <p role="alert" className="error-text">
                Passwords do not match
              </p>
            ) : null}
            {passwordsMatch && passwordRuleError ? (
              <p role="alert" className="error-text">
                {passwordRuleError}
              </p>
            ) : null}
            {savePasswordMutation.isError ? (
              <p role="alert" className="error-text">
                {(savePasswordMutation.error as Error).message || "Could not save password."}
              </p>
            ) : null}
            {passwordCanSave ? (
              <div className="profile-settings__actions">
                <button
                  type="button"
                  className="btn primary small"
                  onClick={() => void savePasswordMutation.mutateAsync(password)}
                >
                  Save
                </button>
              </div>
            ) : null}
          </div>

          {savedFlash ? <p className="muted">{savedFlash}</p> : null}
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
