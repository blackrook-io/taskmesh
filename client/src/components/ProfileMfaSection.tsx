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
};

type EnrollStart = { secret: string; otpauthUri: string };

export function ProfileMfaSection() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [enroll, setEnroll] = useState<EnrollStart | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
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
    if (!enroll?.otpauthUri) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(enroll.otpauthUri, { width: 200, margin: 1 }).then((url) => {
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
      setEnroll(data);
      setCode("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: MfaStatus }>("/api/v1/users/me/mfa/enroll/confirm", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      return res.data;
    },
    onSuccess: async () => {
      setEnroll(null);
      setCode("");
      setFlash("Authenticator enrolled.");
      window.setTimeout(() => setFlash(null), 2000);
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

  const status = statusQuery.data;

  return (
    <section className="profile-settings__section">
      <h3 className="profile-settings__heading">Multi-factor authentication</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        Use Google Authenticator, Microsoft Authenticator, or any TOTP app.
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
              MFA is required for your account and cannot be disabled here. An administrator can
              clear MFA if you lose access to your authenticator.
            </p>
          ) : null}
        </>
      ) : null}

      {enroll ? (
        <>
          <p className="muted">
            Scan this QR code with your authenticator app, or enter the secret manually:
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
