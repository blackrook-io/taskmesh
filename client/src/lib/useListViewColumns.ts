import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiJson } from "../api/client";
import {
  resolvePersonalizeRows,
  resolveVisibleColumns,
  type ListViewField,
  type ListViewKey,
  type ListViewPrefsPayload,
  type ListViewSurface,
  type ResolvedListColumn,
} from "./listViewColumns";

export function useListViewColumns(listViewKey: ListViewKey, surface: ListViewSurface) {
  const qc = useQueryClient();

  const fieldsQuery = useQuery({
    queryKey: ["list-view-fields", listViewKey],
    queryFn: async () => {
      const res = await apiJson<{ data: ListViewField[] }>(
        `/api/v1/list-views/${listViewKey}/fields`,
      );
      return res.data;
    },
  });

  const prefsQuery = useQuery({
    queryKey: ["list-view-prefs", listViewKey],
    queryFn: async () => {
      const res = await apiJson<{ data: ListViewPrefsPayload }>(
        `/api/v1/list-views/${listViewKey}/prefs`,
      );
      return res.data;
    },
  });

  const fields = fieldsQuery.data ?? [];
  const prefs = prefsQuery.data?.columns ?? [];

  const visibleColumns: ResolvedListColumn[] = useMemo(
    () => resolveVisibleColumns(fields, prefs, surface),
    [fields, prefs, surface],
  );

  const personalizeRows: ResolvedListColumn[] = useMemo(
    () => resolvePersonalizeRows(fields, prefs, surface),
    [fields, prefs, surface],
  );

  const save = useMutation({
    mutationFn: async (columns: { fieldKey: string; visible: boolean }[]) => {
      const res = await apiJson<{ data: ListViewPrefsPayload }>(
        `/api/v1/list-views/${listViewKey}/prefs`,
        { method: "PUT", body: JSON.stringify({ columns }) },
      );
      return res.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["list-view-prefs", listViewKey], data);
    },
  });

  const reset = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: ListViewPrefsPayload }>(
        `/api/v1/list-views/${listViewKey}/prefs`,
        { method: "DELETE" },
      );
      return res.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["list-view-prefs", listViewKey], data);
    },
  });

  return {
    fields,
    prefs,
    visibleColumns,
    personalizeRows,
    isLoading: fieldsQuery.isLoading || prefsQuery.isLoading,
    error: (fieldsQuery.error ?? prefsQuery.error) as Error | null,
    save,
    reset,
    isDefault: prefsQuery.data?.isDefault ?? true,
  };
}
