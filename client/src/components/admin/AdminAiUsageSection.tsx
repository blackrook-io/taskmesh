import { useQuery } from "@tanstack/react-query";
import { fetchAdminAiUsage, formatUsdFromMicro } from "../../api/aiUsage";

export function AdminAiUsageSection() {
  const usageQuery = useQuery({
    queryKey: ["admin", "ai-usage"],
    queryFn: fetchAdminAiUsage,
  });

  return (
    <section>
      <h2>AI usage today</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        UTC day starting {usageQuery.data ? new Date(usageQuery.data.dayStart).toISOString() : "…"}.
        Instance-key spend is estimated from tokens. User keys and local models are not included in
        that spend.
      </p>
      {usageQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {usageQuery.isError ? <p role="alert">{(usageQuery.error as Error).message}</p> : null}
      {usageQuery.data ? (
        <>
          <p>
            Instance-key spend today:{" "}
            <strong>{formatUsdFromMicro(usageQuery.data.instanceSpendMicroUsd)}</strong>
          </p>
          {usageQuery.data.rows.length === 0 ? (
            <p className="muted">No plugin calls recorded today.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Feature</th>
                    <th>Provider</th>
                    <th>Key</th>
                    <th>Tokens in</th>
                    <th>Tokens out</th>
                    <th>Est. spend</th>
                  </tr>
                </thead>
                <tbody>
                  {usageQuery.data.rows.map((row) => (
                    <tr
                      key={`${row.userId ?? "none"}-${row.feature}-${row.provider ?? "none"}-${row.keySource ?? "none"}`}
                    >
                      <td>{row.displayName ?? (row.userId == null ? "Unknown" : `User ${row.userId}`)}</td>
                      <td>{row.feature}</td>
                      <td>{row.provider ?? "—"}</td>
                      <td>{row.keySource ?? "—"}</td>
                      <td>{row.tokensIn}</td>
                      <td>{row.tokensOut}</td>
                      <td>{formatUsdFromMicro(row.costMicrousd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
