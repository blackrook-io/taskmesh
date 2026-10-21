import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiJson, ApiRequestError } from "../api/client";
import { MeshMark } from "../components/shell/MeshMark";

export function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get("token")?.trim() ?? "";
  const result = useQuery({
    queryKey: ["unsubscribe", token],
    enabled: token.length > 0,
    retry: false,
    queryFn: () =>
      apiJson<{ data: { label: string } }>("/api/v1/notifications/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),
  });

  let message = "This unsubscribe link is missing a token.";
  if (token && result.isLoading) message = "Updating your email preference…";
  if (result.isSuccess) {
    message = `You will no longer receive ${result.data.data.label.toLowerCase()} emails. In-app notices for that type stay as they were.`;
  }
  if (result.isError) {
    message =
      result.error instanceof ApiRequestError
        ? result.error.message
        : "This unsubscribe link is invalid.";
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__header">
          <MeshMark className="login-card__mark" title="" />
          <h1>Email preference</h1>
        </div>
        <p>{message}</p>
        <p>
          <Link to="/login">Sign in</Link>
          {" · "}
          <Link to="/settings/notifications">Notification settings</Link>
        </p>
      </div>
    </div>
  );
}
