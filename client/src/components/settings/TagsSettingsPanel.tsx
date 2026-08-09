import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiJson } from "../../api/client";
import { ConfirmDialog } from "../ConfirmDialog";
import { ColorPopover } from "../shared/ColorPopover";
import { TagChip } from "../shared/TagChip";
import type { Tag } from "../../types";

type TagRow = Tag & { usageCount: number };

function invalidateTagQueries(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["tags"] });
  void qc.invalidateQueries({ queryKey: ["tags-suggest"] });
  void qc.invalidateQueries({ queryKey: ["taggings"] });
  void qc.invalidateQueries({ queryKey: ["ideas", "with-tags"] });
  void qc.invalidateQueries({ queryKey: ["search"] });
}

export function TagsSettingsPanel() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TagRow | null>(null);
  const [pendingMerge, setPendingMerge] = useState<TagRow | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<number | "">("");

  const listQuery = useQuery({
    queryKey: ["tags"],
    queryFn: async () => {
      const res = await apiJson<{ data: TagRow[] }>("/api/v1/tags");
      return res.data;
    },
  });

  const tags = listQuery.data ?? [];
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, filter]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const name = newName.trim();
      if (!name) throw new Error("Name is required");
      const res = await apiJson<{ data: TagRow }>("/api/v1/tags", {
        method: "POST",
        body: JSON.stringify({ name, color: newColor }),
      });
      return res.data;
    },
    onSuccess: () => {
      setNewName("");
      setNewColor(null);
      setError(null);
      invalidateTagQueries(qc);
    },
    onError: (e: Error) => setError(e.message),
  });

  const patchMutation = useMutation({
    mutationFn: async ({
      id,
      name,
      color,
    }: {
      id: number;
      name?: string;
      color?: string | null;
    }) => {
      const body: { name?: string; color?: string | null } = {};
      if (name !== undefined) body.name = name;
      if (color !== undefined) body.color = color;
      const res = await apiJson<{ data: TagRow }>(`/api/v1/tags/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return res.data;
    },
    onSuccess: () => {
      setEditingId(null);
      setError(null);
      invalidateTagQueries(qc);
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/tags/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      setPendingDelete(null);
      setError(null);
      invalidateTagQueries(qc);
    },
    onError: (e: Error) => setError(e.message),
  });

  const mergeMutation = useMutation({
    mutationFn: async ({
      sourceTagId,
      targetTagId,
    }: {
      sourceTagId: number;
      targetTagId: number;
    }) => {
      const res = await apiJson<{ data: TagRow }>("/api/v1/tags/merge", {
        method: "POST",
        body: JSON.stringify({ sourceTagId, targetTagId }),
      });
      return res.data;
    },
    onSuccess: () => {
      setPendingMerge(null);
      setMergeTargetId("");
      setError(null);
      invalidateTagQueries(qc);
    },
    onError: (e: Error) => setError(e.message),
  });

  const startEdit = (tag: TagRow) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setError(null);
  };

  const commitEdit = (tag: TagRow) => {
    const name = editName.trim();
    if (!name || name === tag.name) {
      setEditingId(null);
      return;
    }
    patchMutation.mutate({ id: tag.id, name });
  };

  const mergeTarget = tags.find((t) => t.id === mergeTargetId) ?? null;

  return (
    <div className="settings-panel tags-settings">
      <p className="muted" style={{ marginTop: 0 }}>
        Manage tags across the whole system. Renames and colors apply everywhere; deleting a tag
        removes it from all records.
      </p>

      <form
        className="tags-settings__create"
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
      >
        <input
          type="text"
          className="input"
          placeholder="New tag name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={100}
          aria-label="New tag name"
        />
        <ColorPopover
          color={newColor}
          onChange={setNewColor}
          openOn="click"
          allowClear
          label="New tag color"
        />
        <button
          type="submit"
          className="btn"
          disabled={!newName.trim() || createMutation.isPending}
        >
          Create
        </button>
      </form>

      <div className="tags-settings__toolbar">
        <input
          type="search"
          className="input"
          placeholder="Filter tags…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter tags"
        />
        <span className="muted tags-settings__count">
          {filtered.length}
          {filtered.length !== tags.length ? ` of ${tags.length}` : ""} tag
          {filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {error ? (
        <p className="tag-input__error" role="alert">
          {error}
        </p>
      ) : null}

      {listQuery.isLoading ? <p className="muted">Loading tags…</p> : null}
      {listQuery.isError ? (
        <p className="tag-input__error" role="alert">
          {(listQuery.error as Error).message}
        </p>
      ) : null}

      {!listQuery.isLoading && filtered.length === 0 ? (
        <p className="muted">No tags yet. Create one above.</p>
      ) : null}

      {filtered.length > 0 ? (
        <div className="table-scroll">
          <table className="data-table tags-settings__table">
            <thead>
              <tr>
                <th>Tag</th>
                <th className="tags-settings__col-usage">Used</th>
                <th className="tags-settings__col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tag) => (
                <tr key={tag.id}>
                  <td>
                    <div className="tags-settings__name-cell">
                      <TagChip
                        tag={tag}
                        removable={false}
                        onColorChange={(color) =>
                          patchMutation.mutate({ id: tag.id, color })
                        }
                      />
                      {editingId === tag.id ? (
                        <input
                          type="text"
                          className="input tags-settings__rename"
                          value={editName}
                          autoFocus
                          maxLength={100}
                          aria-label={`Rename ${tag.name}`}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={() => commitEdit(tag)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitEdit(tag);
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingId(null);
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="btn ghost small tags-settings__rename-btn"
                          onClick={() => startEdit(tag)}
                        >
                          Rename
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="tags-settings__col-usage">{tag.usageCount}</td>
                  <td className="tags-settings__col-actions">
                    <div className="tags-settings__actions">
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={tags.length < 2}
                        onClick={() => {
                          setPendingMerge(tag);
                          setMergeTargetId("");
                          setError(null);
                        }}
                      >
                        Merge
                      </button>
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => {
                          setPendingDelete(tag);
                          setError(null);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete tag?"
        message={
          pendingDelete
            ? `Delete “${pendingDelete.name}”? It is used on ${pendingDelete.usageCount} record${
                pendingDelete.usageCount === 1 ? "" : "s"
              }. This removes the tag from all of them.`
            : ""
        }
        confirmLabel="Delete"
        confirmDisabled={deleteMutation.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />

      {pendingMerge ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingMerge(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="merge-tag-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="merge-tag-title">Merge tag</h2>
            <p>
              Merge <strong>{pendingMerge.name}</strong> into another tag. Attachments move to the
              target (duplicates skipped), then “{pendingMerge.name}” is deleted.
            </p>
            <label className="field">
              <span className="field-label">Merge into</span>
              <select
                className="input"
                value={mergeTargetId === "" ? "" : String(mergeTargetId)}
                onChange={(e) =>
                  setMergeTargetId(e.target.value ? Number(e.target.value) : "")
                }
              >
                <option value="">Select target…</option>
                {tags
                  .filter((t) => t.id !== pendingMerge.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.usageCount})
                    </option>
                  ))}
              </select>
            </label>
            {mergeTarget ? (
              <p className="muted">
                Result will keep “{mergeTarget.name}” and remove “{pendingMerge.name}”.
              </p>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setPendingMerge(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={!mergeTargetId || mergeMutation.isPending}
                onClick={() => {
                  if (typeof mergeTargetId === "number") {
                    mergeMutation.mutate({
                      sourceTagId: pendingMerge.id,
                      targetTagId: mergeTargetId,
                    });
                  }
                }}
              >
                Merge
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
