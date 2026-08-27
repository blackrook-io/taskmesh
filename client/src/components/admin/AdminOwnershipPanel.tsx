import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiJson } from "../../api/client";
import { ConfirmDialog } from "../ConfirmDialog";

type AdminUser = {
  id: number;
  referenceId: string;
  displayName: string;
  email: string | null;
  deactivatedAt: string | null;
};

const ENTITY_TYPES = [
  { value: "project", label: "Project" },
  { value: "idea", label: "Idea" },
  { value: "task", label: "Task" },
  { value: "todo", label: "Todo" },
  { value: "todo_list", label: "Todo list" },
  { value: "image_board", label: "Image board" },
  { value: "upload", label: "Upload" },
  { value: "tag", label: "Tag" },
  { value: "template", label: "Template" },
] as const;

type EntityType = (typeof ENTITY_TYPES)[number]["value"];

type TransferResult = {
  entityType: EntityType;
  entityId: number;
  previousOwnerId: number;
  newOwnerId: number;
};

export function AdminOwnershipPanel() {
  const [entityType, setEntityType] = useState<EntityType>("project");
  const [entityId, setEntityId] = useState("");
  const [newOwnerId, setNewOwnerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const res = await apiJson<{ data: AdminUser[] }>("/api/v1/admin/users");
      return res.data;
    },
  });

  const activeUsers = useMemo(
    () => (usersQuery.data ?? []).filter((u) => u.deactivatedAt == null),
    [usersQuery.data],
  );

  const parsedEntityId = Number(entityId);
  const parsedOwnerId = Number(newOwnerId);
  const canSubmit =
    Number.isInteger(parsedEntityId) &&
    parsedEntityId > 0 &&
    Number.isInteger(parsedOwnerId) &&
    parsedOwnerId > 0;

  const selectedOwner = activeUsers.find((u) => u.id === parsedOwnerId) ?? null;
  const entityLabel =
    ENTITY_TYPES.find((e) => e.value === entityType)?.label ?? entityType;

  const transferMutation = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: TransferResult }>(
        "/api/v1/admin/ownership/transfer",
        {
          method: "POST",
          body: JSON.stringify({
            entityType,
            entityId: parsedEntityId,
            newOwnerId: parsedOwnerId,
          }),
        },
      );
      return res.data;
    },
    onSuccess: (data) => {
      setError(null);
      setResult(data);
      setConfirmOpen(false);
    },
    onError: (err: Error) => {
      setError(err.message);
      setConfirmOpen(false);
    },
  });

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Reassign <code>ownerId</code> on a top-level record. Nested project content
        inherits access from the project owner and is not rewritten.
      </p>

      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <p className="muted" role="status">
          Transferred {result.entityType} #{result.entityId}: owner{" "}
          {result.previousOwnerId} → {result.newOwnerId}.
        </p>
      ) : null}

      <div className="admin-form-grid" style={{ display: "grid", gap: "0.75rem", maxWidth: 420 }}>
        <label>
          Entity type
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as EntityType)}
          >
            {ENTITY_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Entity id
          <input
            type="number"
            min={1}
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="Database id"
          />
        </label>

        <label>
          New owner
          <select
            value={newOwnerId}
            onChange={(e) => setNewOwnerId(e.target.value)}
            disabled={usersQuery.isLoading}
          >
            <option value="">Select user…</option>
            {activeUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} ({u.referenceId})
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="btn primary"
          disabled={!canSubmit || transferMutation.isPending}
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
        >
          Transfer ownership…
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Transfer ownership?"
        message={`Reassign ${entityLabel} #${parsedEntityId} to ${
          selectedOwner
            ? `${selectedOwner.displayName} (${selectedOwner.referenceId})`
            : `user #${parsedOwnerId}`
        }.`}
        confirmLabel="Transfer"
        confirmTone="primary"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => transferMutation.mutate()}
      />
    </div>
  );
}
