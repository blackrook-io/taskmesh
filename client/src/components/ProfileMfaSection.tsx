import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { apiJson } from "../api/client";

type MfaStatus = {
  enrolled: boolean;
  enabledAt: string | null;
  enforcementApplies: boolean;
  graceStartedAt: string | null;
  graceEndsAt: string | null;
  enrollmentRequired: boolean;
  canDisable: boolean;
  serverKeyConfigured: boolean;
  hasRecoveryCodes: boolean;
  recoveryCodesRemaining: number;
};

type EnrollStart = { secret: string; otpauthUri: string };

type MfaWithCodes = MfaStatus & { recoveryCodes: string[] };

export function ProfileMfaSection() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [regenCode, setRegenCode] = useState("");
  const [regenOpen, setRegenOpen] = useState(false);
  const [enroll, setEnroll] = useState<EnrollStart | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [recoveryOnce, setRecoveryOnce] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["users", "me", "mfa"],
    queryFn: async () => {
      const res = await apiJson<{ data: MfaStatus }>("/api/v1/users/me/mfa");
      return res.data;
    },
  });

  useEffect(() => {
    const uri = enroll?.otpauthUri;
    if (!uri) return;
    let cancelled = false;
    void QRCode.toDataURL(uri, { width: 200, margin: 1 }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [enroll?.otpauthUri]);

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: EnrollStart }>("/api/v1/users/me/mfa/enroll/start", {
        method: "POST",
        body: "{}",
      });
      return res.data;
    },
    onSuccess: (data) => {
      setError(null);
      setQrDataUrl(null);
      setEnroll(data);
      setCode("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: MfaWithCodes }>("/api/v1/users/me/mfa/enroll/confirm", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      return res.data;
    },
    onSuccess: async (data) => {
      setEnroll(null);
      setQrDataUrl(null);
      setCode("");
      setRecoveryOnce(data.recoveryCodes);
      setFlash(null);
      await qc.invalidateQueries({ queryKey: ["users", "me", "mfa"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      await apiJson("/api/v1/users/me/mfa/enroll/cancel", { method: "POST", body: "{}" });
    },
    onSuccess: () => {
      setEnroll(null);
      setQrDataUrl(null);
      setCode("");
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: MfaStatus }>("/api/v1/users/me/mfa/disable", {
        method: "POST",
        body: JSON.stringify({ code: disableCode }),
      });
      return res.data;
    },
    onSuccess: async () => {
      setDisableCode("");
      setFlash("MFA disabled.");
      window.setTimeout(() => setFlash(null), 2000);
      await qc.invalidateQueries({ queryKey: ["users", "me", "mfa"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const regenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: MfaWithCodes }>(
        "/api/v1/users/me/mfa/recovery-codes/regenerate",
        {
          method: "POST",
          body: JSON.stringify({ code: regenCode }),
        },
      );
      return res.data;
    },
    onSuccess: async (data) => {
      setRegenCode("");
      setRegenOpen(false);
      setRecoveryOnce(data.recoveryCodes);
      await qc.invalidateQueries({ queryKey: ["users", "me", "mfa"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const revokeTrustMutation = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: { revoked: number } }>(
        "/api/v1/users/me/mfa/trusted-devices/revoke-all",
        { method: "POST", body: "{}" },
      );
      return res.data;
    },
    onSuccess: (data) => {
      setFlash(
        data.revoked === 0
          ? "No trusted devices to revoke."
          : `Revoked ${data.revoked} trusted device${data.revoked === 1 ? "" : "s"}.`,
      );
      window.setTimeout(() => setFlash(null), 2500);
    },
    onError: (err: Error) => setError(err.message),
  });

  const status = statusQuery.data;

  if (recoveryOnce) {
    const copyAll = recoveryOnce.join("\n");
    return (
      <section className="profile-settings__section">
        <h3 className="profile-settings__heading">Multi-factor authentication</h3>
        <div className="admin-form-card admin-form-card--warn">
          <h4 className="admin-form-card__title">Save your backup codes</h4>
          <p className="muted small">
            Store these codes somewhere safe. Each code works once if you lose your authenticator.
            They will not be shown again.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "0.75rem 0", fontFamily: "monospace" }}>
            {recoveryOnce.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
          <div className="profile-settings__actions">
            <button
              type="button"
              className="btn small"
              onClick={() => {
                void navigator.clipboard.writeText(copyAll);
                setFlash("Codes copied.");
                window.setTimeout(() => setFlash(null), 1500);
              }}
            >
              Copy all
            </button>
            <button
              type="button"
              className="btn primary small"
              onClick={() => {
                setRecoveryOnce(null);
                setFlash("Authenticator enrolled. Backup codes saved.");
                window.setTimeout(() => setFlash(null), 2500);
              }}
            >
              I saved my codes
            </button>
          </div>
          {flash ? <p className="ok-text">{flash}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="profile-settings__section">
      <h3 className="profile-settings__heading">Multi-factor authentication</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        Use Google Authenticator, Microsoft Authenticator, or any TOTP app. After setup you will
        receive backup codes to keep somewhere safe.
      </p>
      {statusQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {statusQuery.isError ? (
        <p className="error-text">{(statusQuery.error as Error).message}</p>
      ) : null}
      {flash ? <p className="ok-text">{flash}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {status && !enroll ? (
        <>
          <p>
            Status: <strong>{status.enrolled ? "Enrolled" : "Not enrolled"}</strong>
            {status.enabledAt ? (
              <span className="muted">
                {" "}
                since {new Date(status.enabledAt).toLocaleString()}
              </span>
            ) : null}
          </p>
          {status.enrolled ? (
            <p className="muted small">
              Backup codes remaining:{" "}
              <strong>{status.recoveryCodesRemaining}</strong>
              {!status.hasRecoveryCodes
                ? " — regenerate a new set so you can recover without an administrator."
                : null}
            </p>
          ) : null}
          {status.enrollmentRequired && !status.enrolled ? (
            <p className="error-text" role="status">
              MFA is required for your account
              {status.graceEndsAt
                ? ` by ${new Date(status.graceEndsAt).toLocaleString()}`
                : ""}
              . Enroll an authenticator below.
            </p>
          ) : null}
          {!status.serverKeyConfigured ? (
            <p className="error-text" role="status">
              Server MFA key is not configured (MFA_TOTP_KEY). Ask an administrator before
              enrolling.
            </p>
          ) : null}
          {!status.enrolled ? (
            <button
              type="button"
              className="btn primary small"
              disabled={startMutation.isPending || !status.serverKeyConfigured}
              onClick={() => {
                setError(null);
                startMutation.mutate();
              }}
            >
              Set up authenticator
            </button>
          ) : null}
          {status.enrolled ? (
            <div style={{ marginTop: "0.75rem" }}>
              {!regenOpen ? (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Generate a new set of backup codes? The previous codes will stop working immediately.",
                      )
                    ) {
                      return;
                    }
                    setError(null);
                    setRegenOpen(true);
                    setRegenCode("");
                  }}
                >
                  Regenerate backup codes
                </button>
              ) : (
                <div>
                  <div className="field">
                    <label htmlFor="mfa-regen-code">
                      Enter current authenticator code to regenerate backup codes
                    </label>
                    <input
                      id="mfa-regen-code"
                      value={regenCode}
                      onChange={(e) => setRegenCode(e.target.value)}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6-digit code"
                    />
                  </div>
                  <div className="profile-settings__actions">
                    <button
                      type="button"
                      className="btn primary small"
                      disabled={regenMutation.isPending || regenCode.trim().length < 6}
                      onClick={() => {
                        setError(null);
                        regenMutation.mutate();
                      }}
                    >
                      Generate new codes
                    </button>
                    <button
                      type="button"
                      className="btn ghost small"
                      disabled={regenMutation.isPending}
                      onClick={() => {
                        setRegenOpen(false);
                        setRegenCode("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
          {status.canDisable ? (
            <div style={{ marginTop: "0.75rem" }}>
              <div className="field">
                <label htmlFor="mfa-disable-code">Disable MFA — enter current code</label>
                <input
                  id="mfa-disable-code"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                />
              </div>
              <button
                type="button"
                className="btn small"
                disabled={disableMutation.isPending || disableCode.trim().length < 6}
                onClick={() => {
                  setError(null);
                  disableMutation.mutate();
                }}
              >
                Disable MFA
              </button>
            </div>
          ) : null}
          {status.enrolled && !status.canDisable ? (
            <p className="muted small">
              MFA is required for your account and cannot be disabled here. Use a backup code if you
              lose your authenticator, or ask an administrator to clear MFA.
            </p>
          ) : null}
          {status.enrolled ? (
            <div style={{ marginTop: "0.75rem" }}>
              <p className="muted small" style={{ marginTop: 0 }}>
                Trusted devices can skip MFA for a limited time after you check “Trust this device”
                at sign-in. Logout does not clear them.
              </p>
              <button
                type="button"
                className="btn small"
                disabled={revokeTrustMutation.isPending}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Revoke all trusted devices? You will need an authenticator code on the next sign-in from every browser.",
                    )
                  ) {
                    return;
                  }
                  setError(null);
                  revokeTrustMutation.mutate();
                }}
              >
                Revoke all trusted devices
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {enroll ? (
        <>
          <p className="muted">
            Scan this QR code with your authenticator app, or enter the secret manually. After you
            confirm, you will receive backup codes — save them securely.
          </p>
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="MFA QR code"
              width={200}
              height={200}
              style={{ background: "#fff", borderRadius: 8 }}
            />
          ) : null}
          <p>
            <code style={{ wordBreak: "break-all" }}>{enroll.secret}</code>
          </p>
          <div className="field">
            <label htmlFor="mfa-enroll-code">Enter the 6-digit code to confirm</label>
            <input
              id="mfa-enroll-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
            />
          </div>
          <div className="profile-settings__actions">
            <button
              type="button"
              className="btn primary small"
              disabled={confirmMutation.isPending || code.trim().length < 6}
              onClick={() => {
                setError(null);
                confirmMutation.mutate();
              }}
            >
              Confirm enrollment
            </button>
            <button
              type="button"
              className="btn ghost small"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
