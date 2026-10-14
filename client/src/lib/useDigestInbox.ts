import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../api/client";
import type { DigestInbox } from "./digestView";

export const digestInboxKey = ["digest-inbox"] as const;

export function useDigestInbox() {
  return useQuery({
    queryKey: digestInboxKey,
    queryFn: async () => {
      const res = await apiJson<{ data: DigestInbox }>("/api/v1/digests/inbox");
      return res.data;
    },
  });
}
