import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "../api/client";
import type { Board, BoardCard, BoardColumn, BoardDetail, ProjectPhase, Task } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ElementShell } from "./shared/ElementShell";
import { TaskEditorFields } from "./TaskBoard";
import { KanbanBoardCarousel } from "./KanbanBoardCarousel";

function cardIdsByColumn(columns: BoardColumn[], cards: BoardCard[]): Record<number, number[]> {
  const map: Record<number, number[]> = {};
  for (const col of columns) map[col.id] = [];
  const sorted = [...cards].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  for (const card of sorted) {
    if (!map[card.columnId]) map[card.columnId] = [];
    map[card.columnId]!.push(card.id);
  }
  return map;
}

function SortableBoardTab({
  board,
  active,
  onSelect,
  onRename,
  onRequestDelete,
}: {
  board: Board;
  active: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRequestDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: board.id,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(board.name);
  const empty = (board.cardCount ?? 0) === 0;

  useEffect(() => {
    if (!editing) setDraft(board.name);
  }, [board.name, editing]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  };

  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== board.name) onRename(next);
    else setDraft(board.name);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`board-tab${active ? " active" : ""}${isDragging ? " is-dragging" : ""}`}
      {...attributes}
      {...listeners}
    >
      {editing ? (
        <input
          className="board-tab__rename"
          value={draft}
          autoFocus
          aria-label="Rename board"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setDraft(board.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="board-tab__label"
          onClick={onSelect}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {board.name}
        </button>
      )}
      {empty ? (
        <button
          type="button"
          className="board-tab__close"
          aria-label={`Delete ${board.name}`}
          title="Delete empty board"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete();
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function SortableCard({
  card,
  onOpen,
  onRemove,
}: {
  card: BoardCard;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card", columnId: card.columnId },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="kanban-card">
      <span className="task-drag-handle" {...attributes} {...listeners} title="Drag card">
        ::
      </span>
      <button type="button" className="kanban-card__body" onClick={onOpen}>
        <span className="kanban-card__title">{card.title}</span>
        {card.dueAt ? (
          <span className="muted kanban-card__meta">
            Due {new Date(card.dueAt).toLocaleDateString()}
          </span>
        ) : null}
      </button>
      {card.color ? (
        <span className="kanban-card__swatch" style={{ background: card.color }} aria-hidden />
      ) : null}
      <button type="button" className="task-card-dismiss" aria-label="Remove from board" onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

function ColumnDroppable({
  column,
  cardIds,
  cardsById,
  onOpenCard,
  onRemoveCard,
  onAddTask,
  onRename,
  onSetWip,
  onDeleteColumn,
}: {
  column: BoardColumn;
  cardIds: number[];
  cardsById: Map<number, BoardCard>;
  onOpenCard: (card: BoardCard) => void;
  onRemoveCard: (card: BoardCard) => void;
  onAddTask: (title: string) => void;
  onRename: (name: string) => void;
  onSetWip: (wip: number | null) => void;
  onDeleteColumn: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col-${column.id}`,
    data: { type: "column", columnId: column.id },
  });
  const [draft, setDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(column.name);
  const overLimit = column.wipLimit != null && cardIds.length > column.wipLimit;
  const atLimit = column.wipLimit != null && cardIds.length >= column.wipLimit;

  return (
    <div className={`kanban-column${isOver ? " is-over" : ""}${overLimit ? " is-wip-over" : ""}`}>
      <div className="kanban-column__head">
        {editingName ? (
          <input
            className="kanban-column__name-input"
            value={nameDraft}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              setEditingName(false);
              if (nameDraft.trim() && nameDraft.trim() !== column.name) onRename(nameDraft.trim());
              else setNameDraft(column.name);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setNameDraft(column.name);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <button type="button" className="kanban-column__title" onClick={() => setEditingName(true)}>
            {column.name}
          </button>
        )}
        <span className={`kanban-column__count${overLimit ? " is-over" : ""}`}>
          {cardIds.length}
          {column.wipLimit != null ? ` / ${column.wipLimit}` : ""}
        </span>
        <button type="button" className="btn small ghost" title="Set WIP limit" onClick={() => {
          const raw = window.prompt("WIP limit (blank to clear)", column.wipLimit?.toString() ?? "");
          if (raw === null) return;
          const trimmed = raw.trim();
          if (!trimmed) onSetWip(null);
          else {
            const n = Number(trimmed);
            if (Number.isFinite(n) && n > 0) onSetWip(Math.floor(n));
          }
        }}>
          WIP
        </button>
        <button type="button" className="btn small ghost" aria-label="Delete column" onClick={onDeleteColumn}>
          ×
        </button>
      </div>
      <div ref={setNodeRef} className="kanban-column__body">
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {cardIds.map((id) => {
            const card = cardsById.get(id);
            if (!card) return null;
            return (
              <SortableCard
                key={id}
                card={card}
                onOpen={() => onOpenCard(card)}
                onRemove={() => onRemoveCard(card)}
              />
            );
          })}
        </SortableContext>
      </div>
      <div className="kanban-column__add">
        <input
          type="text"
          placeholder={atLimit ? "WIP limit reached" : "Add task…"}
          value={draft}
          disabled={atLimit}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              onAddTask(draft.trim());
              setDraft("");
            }
          }}
        />
        <button
          type="button"
          className="btn small primary"
          disabled={!draft.trim() || atLimit}
          onClick={() => {
            if (!draft.trim()) return;
            onAddTask(draft.trim());
            setDraft("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

type Props = {
  projectId: number;
  phases: ProjectPhase[];
};

export function KanbanBoardsPanel({ projectId, phases }: Props) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newBoardName, setNewBoardName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [pendingDeleteBoard, setPendingDeleteBoard] = useState<Board | null>(null);
  const [pendingRemoveCard, setPendingRemoveCard] = useState<BoardCard | null>(null);
  const [openCard, setOpenCard] = useState<BoardCard | null>(null);
  const [activeCardId, setActiveCardId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boardOrder, setBoardOrder] = useState<number[]>([]);
  const [columnsState, setColumnsState] = useState<Record<number, number[]>>({});
  const columnsRef = useRef(columnsState);
  columnsRef.current = columnsState;

  const boardsQuery = useQuery({
    queryKey: ["boards", projectId],
    queryFn: async () => {
      const res = await apiJson<{ data: Board[] }>(`/api/v1/projects/${projectId}/boards`);
      return res.data;
    },
  });

  const boards = boardsQuery.data ?? [];
  const boardsById = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);
  const orderedBoards = useMemo(
    () =>
      (boardOrder.length ? boardOrder : boards.map((b) => b.id))
        .map((id) => boardsById.get(id))
        .filter((b): b is Board => b != null),
    [boardOrder, boards, boardsById],
  );
  const activeBoardId = selectedId ?? orderedBoards[0]?.id ?? null;

  useEffect(() => {
    setBoardOrder(boards.map((b) => b.id));
  }, [boards]);

  const detailQuery = useQuery({
    queryKey: ["board", projectId, activeBoardId],
    enabled: activeBoardId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: BoardDetail }>(
        `/api/v1/projects/${projectId}/boards/${activeBoardId}`,
      );
      return res.data;
    },
  });

  const detail = detailQuery.data;
  const cardsById = useMemo(() => {
    const m = new Map<number, BoardCard>();
    for (const c of detail?.cards ?? []) m.set(c.id, c);
    return m;
  }, [detail?.cards]);

  useEffect(() => {
    if (!detail) return;
    setColumnsState(cardIdsByColumn(detail.columns, detail.cards));
  }, [detail]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["boards", projectId] });
    void qc.invalidateQueries({ queryKey: ["board", projectId, activeBoardId] });
    void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
  };

  const createBoard = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: BoardDetail }>(`/api/v1/projects/${projectId}/boards`, {
        method: "POST",
        body: JSON.stringify({ name: newBoardName.trim() }),
      });
      return res.data;
    },
    onSuccess: (board) => {
      setNewBoardName("");
      setCreateOpen(false);
      setSelectedId(board.id);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const renameBoard = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => setError(err.message),
  });

  const reorderBoards = useMutation({
    mutationFn: async (orderedBoardIds: number[]) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ orderedBoardIds }),
      });
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => {
      setError(err.message);
      invalidate();
    },
  });

  const deleteBoard = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      if (pendingDeleteBoard && selectedId === pendingDeleteBoard.id) setSelectedId(null);
      setPendingDeleteBoard(null);
      invalidate();
    },
    onError: (err: Error) => {
      setError(err.message);
      setPendingDeleteBoard(null);
    },
  });

  const addColumn = useMutation({
    mutationFn: async () => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${activeBoardId}/columns`, {
        method: "POST",
        body: JSON.stringify({ name: newColName.trim() }),
      });
    },
    onSuccess: () => {
      setNewColName("");
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const patchColumn = useMutation({
    mutationFn: async ({
      columnId,
      body,
    }: {
      columnId: number;
      body: { name?: string; wipLimit?: number | null };
    }) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${activeBoardId}/columns/${columnId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => setError(err.message),
  });

  const deleteColumn = useMutation({
    mutationFn: async (columnId: number) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${activeBoardId}/columns/${columnId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => setError(err.message),
  });

  const addCard = useMutation({
    mutationFn: async ({ columnId, title }: { columnId: number; title: string }) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${activeBoardId}/cards`, {
        method: "POST",
        body: JSON.stringify({ columnId, entityType: "task", title }),
      });
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const moveCards = useMutation({
    mutationFn: async ({ columnId, orderedCardIds }: { columnId: number; orderedCardIds: number[] }) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${activeBoardId}/cards/move`, {
        method: "PATCH",
        body: JSON.stringify({ columnId, orderedCardIds }),
      });
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => {
      setError(err.message);
      invalidate();
    },
  });

  const removeCard = useMutation({
    mutationFn: async (cardId: number) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${activeBoardId}/cards/${cardId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      setPendingRemoveCard(null);
      invalidate();
    },
  });

  const openTaskQuery = useQuery({
    queryKey: ["task-for-board", openCard?.entityId],
    enabled: openCard?.entityType === "task" && openCard != null,
    queryFn: async () => {
      const res = await apiJson<{ data: Task[] }>(`/api/v1/projects/${projectId}/tasks`);
      const found = res.data.find((t) => t.id === openCard!.entityId);
      if (!found) throw new Error("Task not found");
      return found;
    },
  });

  const patchTask = useMutation({
    mutationFn: async ({ taskId, body }: { taskId: number; body: Record<string, unknown> }) => {
      const res = await apiJson<{ data: Task }>(`/api/v1/projects/${projectId}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return res.data;
    },
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ["task-for-board", openCard?.entityId] });
    },
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const tabSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleBoardTabDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = boardOrder.indexOf(Number(active.id));
    const newIndex = boardOrder.indexOf(Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(boardOrder, oldIndex, newIndex);
    setBoardOrder(next);
    void reorderBoards.mutateAsync(next);
  };

  const findColumnOfCard = (cardId: number): number | null => {
    for (const [colId, ids] of Object.entries(columnsState)) {
      if (ids.includes(cardId)) return Number(colId);
    }
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(Number(event.active.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = Number(active.id);
    const overId = over.id;

    const activeCol = findColumnOfCard(activeId);
    if (activeCol == null) return;

    let overCol: number | null = null;
    if (typeof overId === "string" && overId.startsWith("col-")) {
      overCol = Number(overId.slice(4));
    } else {
      overCol = findColumnOfCard(Number(overId));
    }
    if (overCol == null || activeCol === overCol) return;

    setColumnsState((prev) => {
      const next = { ...prev };
      const from = [...(next[activeCol] ?? [])];
      const to = [...(next[overCol!] ?? [])];
      const idx = from.indexOf(activeId);
      if (idx < 0) return prev;
      from.splice(idx, 1);
      const overIndex =
        typeof overId === "string" && overId.startsWith("col-")
          ? to.length
          : Math.max(0, to.indexOf(Number(overId)));
      to.splice(overIndex >= 0 ? overIndex : to.length, 0, activeId);
      next[activeCol] = from;
      next[overCol!] = to;
      return next;
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);
    if (!over || activeBoardId == null) {
      invalidate();
      return;
    }

    const activeId = Number(active.id);
    let nextState = { ...columnsRef.current };
    const activeCol = (() => {
      for (const [colId, ids] of Object.entries(nextState)) {
        if (ids.includes(activeId)) return Number(colId);
      }
      return null;
    })();
    if (activeCol == null) {
      invalidate();
      return;
    }

    let overCol = activeCol;
    if (typeof over.id === "string" && over.id.startsWith("col-")) {
      overCol = Number(over.id.slice(4));
    } else {
      for (const [colId, ids] of Object.entries(nextState)) {
        if (ids.includes(Number(over.id))) {
          overCol = Number(colId);
          break;
        }
      }
    }

    if (activeCol === overCol) {
      const list = [...(nextState[activeCol] ?? [])];
      const oldIndex = list.indexOf(activeId);
      const newIndex =
        typeof over.id === "string" && over.id.startsWith("col-")
          ? list.length - 1
          : list.indexOf(Number(over.id));
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        nextState = { ...nextState, [activeCol]: arrayMove(list, oldIndex, newIndex) };
        setColumnsState(nextState);
      }
    }

    const ordered = nextState[overCol] ?? [];
    try {
      await moveCards.mutateAsync({ columnId: overCol, orderedCardIds: ordered });
    } catch {
      /* error handled by mutation */
    }
  };

  const activeCard = activeCardId != null ? cardsById.get(activeCardId) : null;

  return (
    <div className="kanban-panel">
      <div className="board-tabs" role="tablist" aria-label="Project boards">
        <DndContext sensors={tabSensors} collisionDetection={closestCorners} onDragEnd={handleBoardTabDragEnd}>
          <SortableContext items={boardOrder} strategy={horizontalListSortingStrategy}>
            {orderedBoards.map((b) => {
              const cardCount =
                b.id === activeBoardId && detail ? detail.cards.length : (b.cardCount ?? 0);
              return (
                <SortableBoardTab
                  key={b.id}
                  board={{ ...b, cardCount }}
                  active={activeBoardId === b.id}
                  onSelect={() => setSelectedId(b.id)}
                  onRename={(name) => renameBoard.mutate({ id: b.id, name })}
                  onRequestDelete={() => setPendingDeleteBoard(b)}
                />
              );
            })}
          </SortableContext>
        </DndContext>
        <button
          type="button"
          className="board-tab board-tab--add"
          aria-label="Create board"
          title="New board"
          onClick={() => {
            setNewBoardName("");
            setCreateOpen(true);
          }}
        >
          +
        </button>
      </div>

      {error ? (
        <p className="tag-input__error" role="alert">
          {error}
        </p>
      ) : null}

      {activeBoardId == null ? (
        <p className="muted">Create a board with + to start planning.</p>
      ) : detailQuery.isLoading ? (
        <p className="muted">Loading board…</p>
      ) : detail ? (
        <>
          <div className="todo-add-row" style={{ marginBottom: "0.75rem" }}>
            <input
              type="text"
              placeholder="New column"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newColName.trim()) addColumn.mutate();
              }}
            />
            <button
              type="button"
              className="btn"
              disabled={!newColName.trim() || addColumn.isPending}
              onClick={() => addColumn.mutate()}
            >
              Add column
            </button>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={(e) => void handleDragEnd(e)}
          >
            <KanbanBoardCarousel boardKey={activeBoardId ?? 0} columnCount={detail.columns.length}>
              {detail.columns.map((col) => (
                <ColumnDroppable
                  key={col.id}
                  column={col}
                  cardIds={columnsState[col.id] ?? []}
                  cardsById={cardsById}
                  onOpenCard={setOpenCard}
                  onRemoveCard={setPendingRemoveCard}
                  onAddTask={(title) => addCard.mutate({ columnId: col.id, title })}
                  onRename={(name) => patchColumn.mutate({ columnId: col.id, body: { name } })}
                  onSetWip={(wipLimit) => patchColumn.mutate({ columnId: col.id, body: { wipLimit } })}
                  onDeleteColumn={() => {
                    if (window.confirm(`Delete column “${col.name}”? Cards move to another column.`)) {
                      deleteColumn.mutate(col.id);
                    }
                  }}
                />
              ))}
            </KanbanBoardCarousel>
            <DragOverlay>
              {activeCard ? (
                <div className="kanban-card kanban-card--overlay">
                  <span className="kanban-card__title">{activeCard.title}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      ) : (
        <p className="muted">Board not found.</p>
      )}

      {openCard && openTaskQuery.data ? (
        <ElementShell
          mode="modal"
          entityType="task"
          title={openTaskQuery.data.title}
          accentColor={openTaskQuery.data.color}
          open
          onClose={() => setOpenCard(null)}
        >
          <TaskEditorFields
            key={openTaskQuery.data.id}
            task={openTaskQuery.data}
            phases={phases}
            onRequestClose={() => setOpenCard(null)}
            onSavePatch={async (p) => {
              await patchTask.mutateAsync({ taskId: openTaskQuery.data!.id, body: p });
            }}
          />
        </ElementShell>
      ) : null}

      {createOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            setCreateOpen(false);
            setNewBoardName("");
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-board-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="new-board-title">New board</h2>
            <div className="field">
              <label htmlFor="new-board-name">Name</label>
              <input
                id="new-board-name"
                type="text"
                value={newBoardName}
                autoFocus
                placeholder="e.g. Sprint A"
                onChange={(e) => setNewBoardName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newBoardName.trim()) createBoard.mutate();
                  if (e.key === "Escape") {
                    setCreateOpen(false);
                    setNewBoardName("");
                  }
                }}
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setCreateOpen(false);
                  setNewBoardName("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!newBoardName.trim() || createBoard.isPending}
                onClick={() => createBoard.mutate()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingDeleteBoard != null}
        title="Delete board?"
        message={`Delete “${pendingDeleteBoard?.name ?? "this board"}”? Only empty boards can be removed.`}
        onCancel={() => setPendingDeleteBoard(null)}
        onConfirm={() => {
          if (pendingDeleteBoard) deleteBoard.mutate(pendingDeleteBoard.id);
        }}
      />

      <ConfirmDialog
        open={pendingRemoveCard != null}
        title="Remove from board?"
        message="The task stays on the project — only this board card is removed."
        confirmLabel="Remove"
        onCancel={() => setPendingRemoveCard(null)}
        onConfirm={() => {
          if (pendingRemoveCard) removeCard.mutate(pendingRemoveCard.id);
        }}
      />
    </div>
  );
}
