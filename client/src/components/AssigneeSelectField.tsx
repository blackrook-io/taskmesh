import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../api/client";
import type { UserRef } from "../types";

type Props = {
  projectId: number | null;
  assigneeId: number | null;
  assignee: UserRef | null;
  disabled?: boolean;
  disabledHint?: string;
  onChange?: (assigneeId: number | null) => void;
  id?: string;
};

/** Compact Assigned-to select for edit forms (project Owner/Managers/Members). */
export function AssigneeSelectField({
  projectId,
  assigneeId,
  assignee,
  disabled,
  disabledHint,
  onChange,
  id,
}: Props) {
  const usersQuery = useQuery({
    queryKey: ["assignable-users", projectId],
    enabled: projectId != null && !disabled,
    queryFn: async () => {
      const res = await apiJson<{ data: UserRef[] }>(
        `/api/v1/projects/${projectId}/assignable-users`,
      );
      return res.data;
    },
  });

  const locked = disabled || projectId == null;

  return (
    <div className="field">
      <label htmlFor={id}>Assigned to</label>
      {locked ? (
        <>
          <input
            id={id}
            type="text"
            value={assignee?.displayName ?? "Unassigned"}
            disabled
            readOnly
          />
          {disabledHint || projectId == null ? (
            <p className="muted" style={{ margin: "0.25rem 0 0" }}>
              {disabledHint ?? "Link to a project to assign"}
            </p>
          ) : null}
        </>
      ) : (
        <select
          id={id}
          value={assigneeId ?? ""}
          onChange={(e) => {
            if (!onChange) return;
            const raw = e.target.value;
            onChange(raw === "" ? null : Number(raw));
          }}
        >
          <option value="">Unassigned</option>
          {(usersQuery.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
          {assigneeId != null &&
          !(usersQuery.data ?? []).some((u) => u.id === assigneeId) &&
          assignee ? (
            <option value={assigneeId}>{assignee.displayName} (not in pool)</option>
          ) : null}
        </select>
      )}
    </div>
  );
}
