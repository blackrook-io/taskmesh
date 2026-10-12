import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { fetchAiCapabilities, aiUnavailableTitle } from "../api/aiCapabilities";

export function projectIdFromPath(pathname: string): number | null {
  const match = pathname.match(/^\/projects\/(\d+)(?:\/|$)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

/** Null when the assistant can open. A sentence when the AI button should stay disabled. */
export function useAssistantBlockedTitle(): string | null {
  const { pathname } = useLocation();
  const projectId = useMemo(() => projectIdFromPath(pathname), [pathname]);
  const query = useQuery({
    queryKey: ["ai-capabilities", projectId],
    queryFn: () => fetchAiCapabilities(projectId),
  });
  const assistant = query.data?.find((row) => row.id === "assistant");
  if (!assistant || assistant.available) return null;
  return aiUnavailableTitle(assistant.reason);
}
