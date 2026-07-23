import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api/client";
import type { Canvas, ProjectDocument, WikiNode, WikiTreeNode, WikiTreeResponse } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { CanvasEditor } from "./CanvasEditor";
import { MarkdownEditor } from "./shared/MarkdownEditor";
import { PencilIcon } from "./shared/PencilIcon";
import { TagInput } from "./shared/TagInput";

type FlatRow = { node: WikiTreeNode; depth: number; parentId: number | null };

function flattenTree(
  nodes: WikiTreeNode[],
  collapsed: Set<number>,
  parentId: number | null = null,
  depth = 0,
): FlatRow[] {
  const out: FlatRow[] = [];
  for (const node of nodes) {
    out.push({ node, depth, parentId });
    if (!collapsed.has(node.id) && node.children.length > 0) {
      out.push(...flattenTree(node.children, collapsed, node.id, depth + 1));
    }
  }
  return out;
}

function collectDescendantIds(node: WikiTreeNode): Set<number> {
  const ids = new Set<number>();
  const walk = (n: WikiTreeNode) => {
    for (const c of n.children) {
      ids.add(c.id);
      walk(c);
    }
  };
  walk(node);
  return ids;
}

function SortableTocRow({
  row,
  selected,
  collapsed,
  structureEdit,
  onSelect,
  onToggle,
  onMoveSibling,
  onRequestDelete,
}: {
  row: FlatRow;
  selected: boolean;
  collapsed: boolean;
  structureEdit: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onMoveSibling: (dir: -1 | 1) => void;
  onRequestDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.node.id,
    disabled: !structureEdit,
    data: { parentId: row.parentId, depth: row.depth },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    paddingLeft: `${0.5 + row.depth * 1.1}rem`,
  };
  const hasKids = row.node.children.length > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`wiki-toc__row${selected ? " is-selected" : ""}${isDragging ? " is-dragging" : ""}`}
    >
      <button
        type="button"
        className="wiki-toc__twist"
        aria-label={collapsed ? "Expand" : "Collapse"}
        disabled={!hasKids}
        onClick={onToggle}
      >
        {hasKids ? (collapsed ? "▸" : "▾") : "·"}
      </button>
      {structureEdit ? (
        <span className="task-drag-handle" title="Drag onto another page to nest" {...attributes} {...listeners}>
          ::
        </span>
      ) : null}
      <button type="button" className="wiki-toc__title" onClick={onSelect}>
        {row.node.pinned ? "📌 " : ""}
        {row.node.entityType === "canvas" ? "◫ " : ""}
        {row.node.title}
      </button>
      {structureEdit ? (
        <>
          <button type="button" className="btn small ghost" title="Move up" onClick={() => onMoveSibling(-1)}>
            ↑
          </button>
          <button type="button" className="btn small ghost" title="Move down" onClick={() => onMoveSibling(1)}>
            ↓
          </button>
          <button
            type="button"
            className="task-card-dismiss"
            aria-label="Remove from wiki"
            onClick={onRequestDelete}
          >
            ×
          </button>
        </>
      ) : null}
    </div>
  );
}

type Props = { projectId: number };

export function WikiPanel({ projectId }: Props) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<WikiNode | null>(null);
  const [structureEdit, setStructureEdit] = useState(false);
  const [pageEdit, setPageEdit] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const treeQuery = useQuery({
    queryKey: ["wiki", projectId],
    queryFn: async () => {
      const res = await apiJson<{ data: WikiTreeResponse }>(`/api/v1/projects/${projectId}/wiki`);
      return res.data;
    },
  });

  const tree = treeQuery.data?.tree ?? [];
  const nodes = treeQuery.data?.nodes ?? [];
  const flat = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);
  const byId = useMemo(() => {
    const m = new Map<number, WikiTreeNode>();
    const walk = (list: WikiTreeNode[]) => {
      for (const n of list) {
        m.set(n.id, n);
        walk(n.children);
      }
    };
    walk(tree);
    return m;
  }, [tree]);

  const activeId = selectedId ?? flat[0]?.node.id ?? null;

  const detailQuery = useQuery({
    queryKey: ["wiki-node", projectId, activeId],
    enabled: activeId != null,
    queryFn: async () => {
      const res = await apiJson<{
        data: {
          node: WikiNode;
          document: ProjectDocument | null;
          canvas: Canvas | null;
          breadcrumb: WikiNode[];
        };
      }>(`/api/v1/projects/${projectId}/wiki/nodes/${activeId}`);
      return res.data;
    },
  });

  useEffect(() => {
    const doc = detailQuery.data?.document;
    const node = detailQuery.data?.node;
    if (node) setTitleDraft(node.title);
    if (doc) setBodyDraft(doc.body ?? "");
    else if (node) setBodyDraft("");
  }, [detailQuery.data?.node?.id, detailQuery.data?.document?.id, pageEdit]);

  const selectPage = (id: number) => {
    setSelectedId(id);
    setPageEdit(false);
  };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["wiki", projectId] });
    void qc.invalidateQueries({ queryKey: ["wiki-node", projectId] });
    void qc.invalidateQueries({ queryKey: ["documents", projectId] });
    void qc.invalidateQueries({ queryKey: ["canvases", projectId] });
    void qc.invalidateQueries({ queryKey: ["canvas", projectId] });
  };

  const createPage = useMutation({
    mutationFn: async (parentId: number | null) => {
      const res = await apiJson<{ data: { node: WikiNode; document: ProjectDocument } }>(
        `/api/v1/projects/${projectId}/wiki/pages`,
        {
          method: "POST",
          body: JSON.stringify({ title: "Untitled page", parentId, body: "" }),
        },
      );
      return res.data;
    },
    onSuccess: (data) => {
      setSelectedId(data.node.id);
      setPageEdit(true);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const createCanvasPage = useMutation({
    mutationFn: async (parentId: number | null) => {
      const res = await apiJson<{ data: { node: WikiNode; canvas: Canvas } }>(
        `/api/v1/projects/${projectId}/wiki/canvases`,
        {
          method: "POST",
          body: JSON.stringify({ title: "Untitled canvas", parentId }),
        },
      );
      return res.data;
    },
    onSuccess: (data) => {
      setSelectedId(data.node.id);
      setPageEdit(true);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const moveNode = useMutation({
    mutationFn: async (body: {
      nodeId: number;
      parentId: number | null;
      orderedSiblingIds: number[];
    }) => {
      await apiJson(`/api/v1/projects/${projectId}/wiki/nodes/${body.nodeId}/move`, {
        method: "PATCH",
        body: JSON.stringify({
          parentId: body.parentId,
          orderedSiblingIds: body.orderedSiblingIds,
        }),
      });
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const patchNode = useMutation({
    mutationFn: async ({ nodeId, title }: { nodeId: number; title: string }) => {
      await apiJson(`/api/v1/projects/${projectId}/wiki/nodes/${nodeId}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => setError(err.message),
  });

  const saveDocument = useMutation({
    mutationFn: async () => {
      const doc = detailQuery.data?.document;
      if (!doc) throw new Error("No document");
      await apiJson(`/api/v1/projects/${projectId}/documents/${doc.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: titleDraft.trim() || doc.title, body: bodyDraft }),
      });
      if (activeId != null && titleDraft.trim()) {
        await patchNode.mutateAsync({ nodeId: activeId, title: titleDraft.trim() });
      }
    },
    onSuccess: () => {
      setPageEdit(false);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteNode = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/projects/${projectId}/wiki/nodes/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      if (pendingDelete && selectedId === pendingDelete.id) setSelectedId(null);
      setPendingDelete(null);
      invalidate();
    },
  });

  const togglePin = useMutation({
    mutationFn: async ({ nodeId, pinned }: { nodeId: number; pinned: boolean }) => {
      await apiJson(`/api/v1/projects/${projectId}/wiki/nodes/${nodeId}`, {
        method: "PATCH",
        body: JSON.stringify({ pinned }),
      });
    },
    onSuccess: () => invalidate(),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    if (!structureEdit) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeNodeId = Number(active.id);
    const overNodeId = Number(over.id);
    const activeNode = byId.get(activeNodeId);
    const overNode = byId.get(overNodeId);
    if (!activeNode || !overNode) return;
    if (collectDescendantIds(activeNode).has(overNodeId)) {
      setError("Cannot move a page under its own descendant");
      return;
    }
    // Drop onto another page → nest as last child
    const childIds = overNode.children.map((c) => c.id).filter((id) => id !== activeNodeId);
    void moveNode.mutateAsync({
      nodeId: activeNodeId,
      parentId: overNodeId,
      orderedSiblingIds: [...childIds, activeNodeId],
    });
  };

  const moveSibling = (nodeId: number, dir: -1 | 1) => {
    const row = flat.find((f) => f.node.id === nodeId);
    if (!row) return;
    const siblings = nodes
      .filter((n) => n.parentId === row.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    const idx = siblings.findIndex((s) => s.id === nodeId);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= siblings.length) return;
    const ordered = siblings.map((s) => s.id);
    const tmp = ordered[idx]!;
    ordered[idx] = ordered[swap]!;
    ordered[swap] = tmp;
    void moveNode.mutateAsync({
      nodeId,
      parentId: row.parentId,
      orderedSiblingIds: ordered,
    });
  };

  const breadcrumb = detailQuery.data?.breadcrumb ?? [];
  const ids = flat.map((f) => f.node.id);
  const displayTitle = detailQuery.data?.node.title ?? titleDraft;

  const cancelPageEdit = () => {
    const doc = detailQuery.data?.document;
    const node = detailQuery.data?.node;
    if (node) setTitleDraft(node.title);
    if (doc) setBodyDraft(doc.body ?? "");
    else setBodyDraft("");
    setPageEdit(false);
  };

  return (
    <div className="wiki-panel">
      <div className="wiki-panel__toc card">
        <div className="wiki-panel__toc-head">
          <h3 style={{ margin: 0 }}>Wiki</h3>
          <div className="wiki-panel__toc-actions">
            <button
              type="button"
              className={`btn small btn-icon${structureEdit ? " primary" : " ghost"}`}
              aria-label={structureEdit ? "Done editing wiki structure" : "Edit wiki structure"}
              title={structureEdit ? "Done" : "Edit"}
              onClick={() => setStructureEdit((v) => !v)}
            >
              {structureEdit ? "✓" : <PencilIcon />}
            </button>
            <button
              type="button"
              className="btn small btn-add"
              aria-label="New Markdown page"
              title="New Markdown page"
              disabled={createPage.isPending}
              onClick={() => createPage.mutate(null)}
            >
              +
            </button>
            <button
              type="button"
              className="btn small btn-add"
              aria-label="New canvas page"
              title="New canvas page"
              disabled={createCanvasPage.isPending}
              onClick={() => createCanvasPage.mutate(null)}
            >
              ◫
            </button>
          </div>
        </div>
        {structureEdit ? (
          <p className="muted" style={{ fontSize: "0.8rem", margin: "0.35rem 0 0.65rem" }}>
            Drag a page onto another to nest it. Use ↑↓ to reorder siblings. + adds Markdown; ◫ adds a canvas.
          </p>
        ) : null}
        {treeQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {flat.length === 0 && !treeQuery.isLoading ? (
          <p className="muted">No pages yet — use + to start the TOC.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {flat.map((row) => (
                <SortableTocRow
                  key={row.node.id}
                  row={row}
                  selected={activeId === row.node.id}
                  collapsed={collapsed.has(row.node.id)}
                  structureEdit={structureEdit}
                  onSelect={() => selectPage(row.node.id)}
                  onToggle={() => {
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.node.id)) next.delete(row.node.id);
                      else next.add(row.node.id);
                      return next;
                    });
                  }}
                  onMoveSibling={(dir) => moveSibling(row.node.id, dir)}
                  onRequestDelete={() => setPendingDelete(row.node)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
        {structureEdit && activeId != null ? (
          <div className="wiki-panel__toc-child-actions">
            <button
              type="button"
              className="btn small btn-add"
              aria-label="New child Markdown page"
              title="New child Markdown page"
              disabled={createPage.isPending}
              onClick={() => createPage.mutate(activeId)}
            >
              +
            </button>
            <button
              type="button"
              className="btn small btn-add"
              aria-label="New child canvas"
              title="New child canvas"
              disabled={createCanvasPage.isPending}
              onClick={() => createCanvasPage.mutate(activeId)}
            >
              ◫
            </button>
          </div>
        ) : null}
      </div>

      <div className="wiki-panel__main card">
        {error ? (
          <p className="tag-input__error" role="alert">
            {error}
          </p>
        ) : null}
        {activeId == null ? (
          <p className="muted">Select or create a wiki page.</p>
        ) : detailQuery.isLoading ? (
          <p className="muted">Loading page…</p>
        ) : detailQuery.data?.document ? (
          <>
            <div className="wiki-panel__main-head">
              <nav className="wiki-breadcrumb" aria-label="Breadcrumb">
                {breadcrumb.map((b, i) => (
                  <span key={b.id}>
                    {i > 0 ? <span className="muted"> / </span> : null}
                    <button type="button" className="wiki-breadcrumb__link" onClick={() => selectPage(b.id)}>
                      {b.title}
                    </button>
                  </span>
                ))}
              </nav>
              <div className="wiki-panel__main-actions">
                {pageEdit ? (
                  <>
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() =>
                        togglePin.mutate({
                          nodeId: activeId,
                          pinned: !detailQuery.data?.node.pinned,
                        })
                      }
                    >
                      {detailQuery.data?.node.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button type="button" className="btn small ghost" onClick={cancelPageEdit}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={saveDocument.isPending}
                      onClick={() => saveDocument.mutate()}
                    >
                      Save page
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn small btn-icon"
                    aria-label="Edit page"
                    title="Edit"
                    onClick={() => setPageEdit(true)}
                  >
                    <PencilIcon />
                  </button>
                )}
              </div>
            </div>

            {pageEdit ? (
              <>
                <div className="field">
                  <label htmlFor="wiki-title">Title</label>
                  <input
                    id="wiki-title"
                    type="text"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                  />
                </div>
                <div className="field field--tags-below">
                  <TagInput entityType="document" entityId={detailQuery.data.document.id} />
                </div>
                <div className="field">
                  <label>Body</label>
                  <MarkdownEditor value={bodyDraft} onChange={setBodyDraft} height={420} />
                </div>
              </>
            ) : (
              <>
                <h1 className="wiki-page-title">{displayTitle}</h1>
                <div className="field field--tags-below">
                  <TagInput entityType="document" entityId={detailQuery.data.document.id} readOnly />
                </div>
                <MarkdownEditor value={bodyDraft} onChange={() => undefined} height={420} readOnly />
              </>
            )}
          </>
        ) : detailQuery.data?.canvas ? (
          <>
            <div className="wiki-panel__main-head">
              <nav className="wiki-breadcrumb" aria-label="Breadcrumb">
                {breadcrumb.map((b, i) => (
                  <span key={b.id}>
                    {i > 0 ? <span className="muted"> / </span> : null}
                    <button type="button" className="wiki-breadcrumb__link" onClick={() => selectPage(b.id)}>
                      {b.title}
                    </button>
                  </span>
                ))}
              </nav>
              <div className="wiki-panel__main-actions">
                {pageEdit ? (
                  <>
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() =>
                        togglePin.mutate({
                          nodeId: activeId,
                          pinned: !detailQuery.data?.node.pinned,
                        })
                      }
                    >
                      {detailQuery.data?.node.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() => {
                        setTitleDraft(detailQuery.data?.node.title ?? "");
                        setPageEdit(false);
                      }}
                    >
                      Done
                    </button>
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={!titleDraft.trim() || patchNode.isPending}
                      onClick={() => {
                        if (activeId != null && titleDraft.trim()) {
                          void patchNode.mutateAsync({ nodeId: activeId, title: titleDraft.trim() }).then(() => {
                            setPageEdit(false);
                          });
                        }
                      }}
                    >
                      Save title
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn small btn-icon"
                    aria-label="Edit canvas title"
                    title="Edit"
                    onClick={() => setPageEdit(true)}
                  >
                    <PencilIcon />
                  </button>
                )}
              </div>
            </div>
            {pageEdit ? (
              <div className="field">
                <label htmlFor="wiki-canvas-title">Title</label>
                <input
                  id="wiki-canvas-title"
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                />
              </div>
            ) : (
              <h1 className="wiki-page-title">{displayTitle}</h1>
            )}
            <CanvasEditor
              key={detailQuery.data.canvas.id}
              canvasId={detailQuery.data.canvas.id}
              document={detailQuery.data.canvas.document ?? {}}
              readOnly={!pageEdit}
              onSaveDocument={(document) => {
                void apiJson(`/api/v1/projects/${projectId}/canvases/${detailQuery.data!.canvas!.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ document }),
                }).then(() => {
                  void qc.invalidateQueries({ queryKey: ["canvas", projectId] });
                  void qc.invalidateQueries({ queryKey: ["canvases", projectId] });
                });
              }}
            />
          </>
        ) : (
          <p className="muted">This wiki entry has no document or canvas body yet.</p>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete != null}
        title="Remove from wiki?"
        message="Nested pages under this entry are also removed from the wiki. The Markdown document itself is kept under Documents."
        confirmLabel="Remove"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteNode.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
