import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiJson } from "../../api/client";

type SystemProperties = {
  apiRateLimitPerMinute: number;
  loginFailureThreshold: number;
  updatedAt: string | null;
};

export function AdminSystemPropertiesPanel() {
  const qc = useQueryClient();
  const [rate, setRate] = useState("60");
  const [threshold, setThreshold] = useState("5");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const propsQuery = useQuery({
    queryKey: ["admin", "system-properties"],
    queryFn: async () => {
      const res = await apiJson<{ data: SystemProperties }>(
        "/api/v1/admin/system-properties",
      );
      return res.data;
    },
  });

  useEffect(() => {
    if (!propsQuery.data) return;
    setRate(String(propsQuery.data.apiRateLimitPerMinute));
    setThreshold(String(propsQuery.data.loginFailureThreshold));
  }, [propsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const apiRateLimitPerMinute = Number(rate);
      const loginFailureThreshold = Number(threshold);
      if (!Number.isInteger(apiRateLimitPerMinute) || apiRateLimitPerMinute < 1) {
        throw new Error("API rate limit must be a positive integer");
      }
      if (!Number.isInteger(loginFailureThreshold) || loginFailureThreshold < 1) {
        throw new Error("Login failure threshold must be a positive integer");
      }
      const res = await apiJson<{ data: SystemProperties }>(
        "/api/v1/admin/system-properties",
        {
          method: "PATCH",
          body: JSON.stringify({ apiRateLimitPerMinute, loginFailureThreshold }),
        },
      );
      return res.data;
    },
    onSuccess: async () => {
      setError(null);
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ["admin", "system-properties"] });
      window.setTimeout(() => setSaved(false), 2000);
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        System-level thresholds. Values are stored now; auth and API-key middleware will
        enforce them in later work.
      </p>

      {propsQuery.isLoading ? <p className="muted">Loading…</p> : null}

      <label className="field">
        <span>API rate limit (requests per minute, per key)</span>
        <input
          type="number"
          min={1}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Login failure threshold (locks account and API keys)</span>
        <input
          type="number"
          min={1}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
        />
      </label>

      {propsQuery.data?.updatedAt ? (
        <p className="muted small">
          Last saved: {new Date(propsQuery.data.updatedAt).toLocaleString()}
        </p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {saved ? <p className="ok-text">Saved.</p> : null}

      <button
        type="button"
        className="btn primary small"
        disabled={saveMutation.isPending}
        onClick={() => saveMutation.mutate()}
      >
        Save
      </button>
    </div>
  );
}
