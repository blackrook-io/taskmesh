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
  return useFeatureBlockedTitle("assistant");
}

/** Null when quick capture can open. */
export function useCaptureBlockedTitle(): string | null {
  return useFeatureBlockedTitle("capture");
}

function useFeatureBlockedTitle(featureId: string): string | null {
  const { pathname } = useLocation();
  const projectId = useMemo(() => projectIdFromPath(pathname), [pathname]);
  const query = useQuery({
    queryKey: ["ai-capabilities", projectId],
    queryFn: () => fetchAiCapabilities(projectId),
  });
  const feature = query.data?.find((row) => row.id === featureId);
  if (!feature || feature.available) return null;
  return aiUnavailableTitle(feature.reason);
}
