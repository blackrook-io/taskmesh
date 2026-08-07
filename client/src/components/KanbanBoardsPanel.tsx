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
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { apiJson } from "../api/client";
import { formatTaskNumber } from "../lib/taskFields";
import type {
  Board,
  BoardCard,
  BoardColumn,
  BoardDetail,
  BoardLane,
  Idea,
  ProjectPhase,
  Task,
  TodoList,
} from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ElementShell } from "./shared/ElementShell";
import { MarkdownEditor } from "./shared/MarkdownEditor";
import { TagInput } from "./shared/TagInput";
import { TaskEditorFields } from "./TaskBoard";
import { KanbanBoardCarousel } from "./KanbanBoardCarousel";
import { KanbanColumnGhost, useColumnGhostHover } from "./KanbanColumnGhost";

type CardEntityType = "task" | "idea" | "todo_list";

function cellKey(columnId: number, laneId: number | null): string {
  return `${columnId}:${laneId ?? "null"}`;
}

function parseCellDropId(id: string | number): { columnId: number; laneId: number | null } | null {
  if (typeof id !== "string" || !id.startsWith("cell-")) return null;
  const rest = id.slice(5);
  const sep = rest.lastIndexOf("-");
  if (sep < 0) return null;
  const columnId = Number(rest.slice(0, sep));
  const lanePart = rest.slice(sep + 1);
  const laneId = lanePart === "null" ? null : Number(lanePart);
  if (!Number.isFinite(columnId)) return null;
  if (laneId != null && !Number.isFinite(laneId)) return null;
  return { columnId, laneId };
}

function dropId(columnId: number, laneId: number | null): string {
  return `cell-${columnId}-${laneId ?? "null"}`;
}

function cardIdsByCell(
  columns: BoardColumn[],
  lanes: BoardLane[],
  cards: BoardCard[],
): Record<string, number[]> {
  const laneKeys: (number | null)[] =
    lanes.length === 0 ? [null] : [null, ...lanes.map((l) => l.id)];
  const map: Record<string, number[]> = {};
  for (const col of columns) {
    for (const lk of laneKeys) {
      map[cellKey(col.id, lk)] = [];
    }
  }
  const sorted = [...cards].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const knownLanes = new Set(lanes.map((l) => l.id));
  for (const card of sorted) {
    const effective =
      lanes.length === 0
        ? null
        : card.laneId != null && knownLanes.has(card.laneId)
          ? card.laneId
          : null;
    const key = cellKey(card.columnId, effective);
    if (!map[key]) map[key] = [];
    map[key].push(card.id);
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

function entityLabel(entityType: string): string {
  if (entityType === "idea") return "Idea";
  if (entityType === "todo_list") return "List";
  return "Task";
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
    data: { type: "card", columnId: card.columnId, laneId: card.laneId },
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
        <span className="kanban-card__type muted">{entityLabel(card.entityType)}</span>
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
  laneId,
  cardIds,
  cardsById,
  onOpenCard,
  onRemoveCard,
  onAddCard,
  onRename,
  onSetWip,
  onDeleteColumn,
  showColumnChrome,
}: {
  column: BoardColumn;
  laneId: number | null;
  cardIds: number[];
  cardsById: Map<number, BoardCard>;
  onOpenCard: (card: BoardCard) => void;
  onRemoveCard: (card: BoardCard) => void;
  onAddCard: (title: string, entityType: CardEntityType) => void;
  onRename: (name: string) => void;
  onSetWip: (wip: number | null) => void;
  onDeleteColumn: () => void;
  showColumnChrome: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: dropId(column.id, laneId),
    data: { type: "cell", columnId: column.id, laneId },
  });
  const [draft, setDraft] = useState("");
  const [addType, setAddType] = useState<CardEntityType>("task");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(column.name);
  const overLimit = column.wipLimit != null && cardIds.length > column.wipLimit;
  const atLimit = column.wipLimit != null && cardIds.length >= column.wipLimit;

  return (
    <div className={`kanban-column${isOver ? " is-over" : ""}${overLimit ? " is-wip-over" : ""}`}>
      {showColumnChrome ? (
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
          <button
            type="button"
            className="btn small ghost"
            title="Set WIP limit"
            onClick={() => {
              const raw = window.prompt("WIP limit (blank to clear)", column.wipLimit?.toString() ?? "");
              if (raw === null) return;
              const trimmed = raw.trim();
              if (!trimmed) onSetWip(null);
              else {
                const n = Number(trimmed);
                if (Number.isFinite(n) && n > 0) onSetWip(Math.floor(n));
              }
            }}
          >
            WIP
          </button>
          <button type="button" className="btn small ghost" aria-label="Delete column" onClick={onDeleteColumn}>
            ×
          </button>
        </div>
      ) : (
        <div className="kanban-column__head kanban-column__head--compact">
          <span className="muted" style={{ fontSize: "0.75rem" }}>
            {column.name}
          </span>
          <span className={`kanban-column__count${overLimit ? " is-over" : ""}`}>{cardIds.length}</span>
        </div>
      )}
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
        <select
          className="kanban-column__type"
          value={addType}
          aria-label="Card type"
          disabled={atLimit}
          onChange={(e) => setAddType(e.target.value as CardEntityType)}
        >
          <option value="task">Task</option>
          <option value="idea">Idea</option>
        </select>
        <input
          type="text"
          placeholder={atLimit ? "WIP limit reached" : `Add ${addType}…`}
          value={draft}
          disabled={atLimit}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              onAddCard(draft.trim(), addType);
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
            onAddCard(draft.trim(), addType);
            setDraft("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function LaneHead({
  lane,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  lane: BoardLane | null;
  onRename: (name: string) => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lane?.name ?? "Unassigned");

  useEffect(() => {
    if (!editing) setDraft(lane?.name ?? "Unassigned");
  }, [lane?.name, editing]);

  if (lane == null) {
    return (
      <div className="kanban-lane__head">
        <span className="kanban-lane__title muted">Unassigned</span>
      </div>
    );
  }

  return (
    <div className="kanban-lane__head">
      {editing ? (
        <input
          className="kanban-lane__name-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft.trim() && draft.trim() !== lane.name) onRename(draft.trim());
            else setDraft(lane.name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(lane.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button type="button" className="kanban-lane__title" onClick={() => setEditing(true)}>
          {lane.name}
        </button>
      )}
      <div className="kanban-lane__actions">
        <button type="button" className="btn small ghost" disabled={!canMoveUp} onClick={onMoveUp} aria-label="Move lane up">
          ↑
        </button>
        <button
          type="button"
          className="btn small ghost"
          disabled={!canMoveDown}
          onClick={onMoveDown}
          aria-label="Move lane down"
        >
          ↓
        </button>
        <button type="button" className="btn small ghost" aria-label="Delete lane" onClick={onDelete}>
          ×
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
  const [pendingDeleteBoard, setPendingDeleteBoard] = useState<Board | null>(null);
  const [pendingRemoveCard, setPendingRemoveCard] = useState<BoardCard | null>(null);
  const [openCard, setOpenCard] = useState<BoardCard | null>(null);
  const [taskHeaderActions, setTaskHeaderActions] = useState<ReactNode>(null);
  const [activeCardId, setActiveCardId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boardOrder, setBoardOrder] = useState<number[]>([]);
  const [cellsState, setCellsState] = useState<Record<string, number[]>>({});
  const cellsRef = useRef(cellsState);
  cellsRef.current = cellsState;

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
    setCellsState(cardIdsByCell(detail.columns, detail.lanes, detail.cards));
  }, [detail]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["boards", projectId] });
    void qc.invalidateQueries({ queryKey: ["board", projectId, activeBoardId] });
    void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    void qc.invalidateQueries({ queryKey: ["ideas"] });
    void qc.invalidateQueries({ queryKey: ["todo-lists"] });
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
    mutationFn: async ({ name, insertAt }: { name: string; insertAt: number }) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${activeBoardId}/columns`, {
        method: "POST",
        body: JSON.stringify({ name, insertAt }),
      });
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const columnGhost = useColumnGhostHover({
    suppress: activeCardId != null,
    onCreate: async (insertAt, name) => {
      await addColumn.mutateAsync({ name, insertAt });
    },
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

  const addLane = useMutation({
    mutationFn: async (name: string) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${activeBoardId}/lanes`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => setError(err.message),
  });

  const patchLane = useMutation({
    mutationFn: async ({ laneId, name }: { laneId: number; name: string }) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${activeBoardId}/lanes/${laneId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => setError(err.message),
  });

  const deleteLane = useMutation({
    mutationFn: async (laneId: number) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${activeBoardId}/lanes/${laneId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => setError(err.message),
  });

  const reorderLanes = useMutation({
    mutationFn: async (orderedLaneIds: number[]) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${activeBoardId}/lanes/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ orderedLaneIds }),
      });
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => {
      setError(err.message);
      invalidate();
    },
  });

  const addCard = useMutation({
    mutationFn: async ({
      columnId,
      laneId,
      title,
      entityType,
    }: {
      columnId: number;
      laneId: number | null;
      title: string;
      entityType: CardEntityType;
    }) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${activeBoardId}/cards`, {
        method: "POST",
        body: JSON.stringify({ columnId, laneId, entityType, title }),
      });
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const moveCards = useMutation({
    mutationFn: async ({
      columnId,
      laneId,
      orderedCardIds,
    }: {
      columnId: number;
      laneId: number | null;
      orderedCardIds: number[];
    }) => {
      await apiJson(`/api/v1/projects/${projectId}/boards/${activeBoardId}/cards/move`, {
        method: "PATCH",
        body: JSON.stringify({ columnId, laneId, orderedCardIds }),
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

  const openIdeaQuery = useQuery({
    queryKey: ["idea-for-board", openCard?.entityId],
    enabled: openCard?.entityType === "idea" && openCard != null,
    queryFn: async () => {
      const res = await apiJson<{ data: Idea }>(`/api/v1/ideas/${openCard!.entityId}`);
      return res.data;
    },
  });

  const openListQuery = useQuery({
    queryKey: ["todo-list-for-board", openCard?.entityId],
    enabled: openCard?.entityType === "todo_list" && openCard != null,
    queryFn: async () => {
      const res = await apiJson<{ data: TodoList }>(`/api/v1/todo-lists/${openCard!.entityId}`);
      return res.data;
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

  const findCellOfCard = (
    cardId: number,
    state: Record<string, number[]> = cellsState,
  ): { columnId: number; laneId: number | null; key: string } | null => {
    for (const [key, ids] of Object.entries(state)) {
      if (!ids.includes(cardId)) continue;
      const [colPart, lanePart] = key.split(":");
      const columnId = Number(colPart);
      const laneId = lanePart === "null" ? null : Number(lanePart);
      return { columnId, laneId, key };
    }
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(Number(event.active.id));
  };

  const resolveOverCell = (
    overId: string | number,
  ): { columnId: number; laneId: number | null; key: string } | null => {
    const parsed = parseCellDropId(overId);
    if (parsed) {
      return { ...parsed, key: cellKey(parsed.columnId, parsed.laneId) };
    }
    return findCellOfCard(Number(overId));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = Number(active.id);
    const from = findCellOfCard(activeId);
    const to = resolveOverCell(over.id);
    if (!from || !to || from.key === to.key) return;

    setCellsState((prev) => {
      const next = { ...prev };
      const source = [...(next[from.key] ?? [])];
      const dest = [...(next[to.key] ?? [])];
      const idx = source.indexOf(activeId);
      if (idx < 0) return prev;
      source.splice(idx, 1);
      const overIndex = parseCellDropId(over.id)
        ? dest.length
        : Math.max(0, dest.indexOf(Number(over.id)));
      dest.splice(overIndex >= 0 ? overIndex : dest.length, 0, activeId);
      next[from.key] = source;
      next[to.key] = dest;
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
    let nextState = { ...cellsRef.current };
    const from = findCellOfCard(activeId, nextState);
    if (!from) {
      invalidate();
      return;
    }

    const to = resolveOverCell(over.id) ?? from;

    if (from.key === to.key) {
      const list = [...(nextState[from.key] ?? [])];
      const oldIndex = list.indexOf(activeId);
      const newIndex = parseCellDropId(over.id)
        ? list.length - 1
        : list.indexOf(Number(over.id));
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        nextState = { ...nextState, [from.key]: arrayMove(list, oldIndex, newIndex) };
        setCellsState(nextState);
      }
    }

    const ordered = nextState[to.key] ?? [];
    try {
      await moveCards.mutateAsync({
        columnId: to.columnId,
        laneId: to.laneId,
        orderedCardIds: ordered,
      });
    } catch {
      /* error handled by mutation */
    }
  };

  const activeCard = activeCardId != null ? cardsById.get(activeCardId) : null;
  const hasLanes = (detail?.lanes.length ?? 0) > 0;
  const laneRows: (BoardLane | null)[] = hasLanes
    ? [null, ...(detail?.lanes ?? [])]
    : [null];

  const renderColumnsForLane = (laneId: number | null, showChrome: boolean) => {
    if (!detail) return null;
    return (
      <KanbanBoardCarousel
        boardKey={`${activeBoardId}-${laneId ?? "null"}`}
        columnCount={detail.columns.length}
        suppressBlankHover={activeCardId != null || !showChrome}
        lockGhost={columnGhost.lockGhost}
        ghostInsertAt={columnGhost.ghostInsertAt}
        onBlankHover={showChrome ? columnGhost.onBlankHover : () => undefined}
        ghost={
          showChrome && (columnGhost.phase === "prompt" || columnGhost.phase === "naming") ? (
            <KanbanColumnGhost
              phase={columnGhost.phase}
              name={columnGhost.name}
              onNameChange={columnGhost.setName}
              onStartNaming={columnGhost.startNaming}
              onSubmit={() => void columnGhost.submit()}
              onCancel={columnGhost.cancel}
              busy={addColumn.isPending}
            />
          ) : null
        }
      >
        {detail.columns.map((col) => (
          <ColumnDroppable
            key={`${col.id}-${laneId ?? "null"}`}
            column={col}
            laneId={laneId}
            cardIds={cellsState[cellKey(col.id, laneId)] ?? []}
            cardsById={cardsById}
            showColumnChrome={showChrome}
            onOpenCard={setOpenCard}
            onRemoveCard={setPendingRemoveCard}
            onAddCard={(title, entityType) =>
              addCard.mutate({ columnId: col.id, laneId, title, entityType })
            }
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
    );
  };

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

      {activeBoardId != null ? (
        <div className="field field--tags-below" style={{ marginBottom: "0.75rem" }}>
          <TagInput entityType="board" entityId={activeBoardId} />
        </div>
      ) : null}

      {activeBoardId == null ? (
        <p className="muted">Create a board with + to start planning.</p>
      ) : detailQuery.isLoading ? (
        <p className="muted">Loading board…</p>
      ) : detail ? (
        <>
          <div className="kanban-lane-toolbar">
            <button
              type="button"
              className="btn small"
              disabled={addLane.isPending}
              onClick={() => {
                const name = window.prompt("Lane name", "New lane");
                if (name?.trim()) addLane.mutate(name.trim());
              }}
            >
              Add lane
            </button>
            <span className="muted" style={{ fontSize: "0.8rem" }}>
              Cards can be tasks or ideas; drag across columns and lanes.
            </span>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={(e) => void handleDragEnd(e)}
          >
            <div className={`kanban-lanes${hasLanes ? " has-lanes" : ""}`}>
              {laneRows.map((lane, laneIndex) => {
                const laneId = lane?.id ?? null;
                const namedLanes = detail.lanes;
                const namedIndex = lane ? namedLanes.findIndex((l) => l.id === lane.id) : -1;
                return (
                  <div key={laneId ?? "unassigned"} className="kanban-lane">
                    {hasLanes ? (
                      <LaneHead
                        lane={lane}
                        onRename={(name) => {
                          if (lane) patchLane.mutate({ laneId: lane.id, name });
                        }}
                        onDelete={
                          lane
                            ? () => {
                                if (
                                  window.confirm(
                                    `Delete lane “${lane.name}”? Cards move to Unassigned.`,
                                  )
                                ) {
                                  deleteLane.mutate(lane.id);
                                }
                              }
                            : undefined
                        }
                        onMoveUp={
                          lane && namedIndex > 0
                            ? () => {
                                const ids = namedLanes.map((l) => l.id);
                                const next = arrayMove(ids, namedIndex, namedIndex - 1);
                                void reorderLanes.mutateAsync(next);
                              }
                            : undefined
                        }
                        onMoveDown={
                          lane && namedIndex >= 0 && namedIndex < namedLanes.length - 1
                            ? () => {
                                const ids = namedLanes.map((l) => l.id);
                                const next = arrayMove(ids, namedIndex, namedIndex + 1);
                                void reorderLanes.mutateAsync(next);
                              }
                            : undefined
                        }
                        canMoveUp={namedIndex > 0}
                        canMoveDown={namedIndex >= 0 && namedIndex < namedLanes.length - 1}
                      />
                    ) : null}
                    {renderColumnsForLane(laneId, !hasLanes || laneIndex === 0)}
                  </div>
                );
              })}
            </div>
            <DragOverlay>
              {activeCard ? (
                <div className="kanban-card kanban-card--overlay">
                  <span className="kanban-card__type muted">{entityLabel(activeCard.entityType)}</span>
                  <span className="kanban-card__title">{activeCard.title}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      ) : (
        <p className="muted">Board not found.</p>
      )}

      {openCard?.entityType === "task" && openTaskQuery.data ? (
        <ElementShell
          mode="modal"
          entityType="task"
          title={openTaskQuery.data.title}
          titleLeading={formatTaskNumber(openTaskQuery.data.number)}
          showType={false}
          accentColor={openTaskQuery.data.color}
          actions={taskHeaderActions}
          open
          onClose={() => setOpenCard(null)}
        >
          <TaskEditorFields
            key={openTaskQuery.data.id}
            task={openTaskQuery.data}
            phases={phases}
            onRequestClose={() => setOpenCard(null)}
            onHeaderActions={setTaskHeaderActions}
            onSavePatch={async (p) => {
              await patchTask.mutateAsync({ taskId: openTaskQuery.data!.id, body: p });
            }}
          />
        </ElementShell>
      ) : null}

      {openCard?.entityType === "idea" ? (
        <ElementShell
          mode="modal"
          entityType="idea"
          title={openIdeaQuery.data?.title ?? openCard.title}
          open
          onClose={() => setOpenCard(null)}
          footer={
            <div className="btn-row">
              <Link
                to={`/ideas/${openCard.entityId}`}
                className="btn primary"
                onClick={() => setOpenCard(null)}
              >
                Open full record
              </Link>
              <button type="button" className="btn ghost" onClick={() => setOpenCard(null)}>
                Close
              </button>
            </div>
          }
        >
          {openIdeaQuery.isLoading ? (
            <p className="muted">Loading…</p>
          ) : openIdeaQuery.data ? (
            <div className="task-expand">
              <div className="field">
                <label>Title</label>
                <input
                  type="text"
                  defaultValue={openIdeaQuery.data.title}
                  onBlur={(e) => {
                    const title = e.target.value.trim();
                    if (title && title !== openIdeaQuery.data!.title) {
                      void apiJson(`/api/v1/ideas/${openIdeaQuery.data!.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ title }),
                      }).then(() => invalidate());
                    }
                  }}
                />
              </div>
              <div className="field">
                <label>Notes</label>
                <MarkdownEditor
                  value={openIdeaQuery.data.body ?? ""}
                  onChange={() => {}}
                  height={180}
                  onBlur={(v) => {
                    void apiJson(`/api/v1/ideas/${openIdeaQuery.data!.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ body: v.trim() ? v : null }),
                    }).then(() => invalidate());
                  }}
                />
              </div>
              <TagInput entityType="idea" entityId={openIdeaQuery.data.id} />
            </div>
          ) : (
            <p className="muted">Idea not found.</p>
          )}
        </ElementShell>
      ) : null}

      {openCard?.entityType === "todo_list" ? (
        <ElementShell
          mode="modal"
          entityType="todo_list"
          title={openListQuery.data?.title ?? openCard.title}
          open
          onClose={() => setOpenCard(null)}
          footer={
            <div className="btn-row">
              {openListQuery.data ? (
                <Link
                  to={
                    openListQuery.data.projectId != null
                      ? `/projects/${openListQuery.data.projectId}?tab=todo_lists`
                      : `/todos/${openListQuery.data.id}`
                  }
                  className="btn primary"
                  onClick={() => setOpenCard(null)}
                >
                  Open list
                </Link>
              ) : null}
              <button type="button" className="btn ghost" onClick={() => setOpenCard(null)}>
                Close
              </button>
            </div>
          }
        >
          {openListQuery.isLoading ? (
            <p className="muted">Loading…</p>
          ) : openListQuery.data ? (
            <p className="muted">
              To-do list “{openListQuery.data.title}” — open it to manage items.
            </p>
          ) : (
            <p className="muted">List not found.</p>
          )}
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
        message="The record stays elsewhere — only this board card is removed."
        confirmLabel="Remove"
        onCancel={() => setPendingRemoveCard(null)}
        onConfirm={() => {
          if (pendingRemoveCard) removeCard.mutate(pendingRemoveCard.id);
        }}
      />
    </div>
  );
}
