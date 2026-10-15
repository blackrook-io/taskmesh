import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../api/client";

export type PlanMembership = {
  id: number;
  number: number;
  title: string;
};

export function usePlanMemberships(entityType: "task" | "todo", entityId: number) {
  return useQuery({
    queryKey: ["plan-memberships", entityType, entityId],
    queryFn: async () => {
      const params = new URLSearchParams({ entityType, entityId: String(entityId) });
      const res = await apiJson<{ data: PlanMembership[] }>(`/api/v1/plans?${params}`);
      return res.data;
    },
  });
}
