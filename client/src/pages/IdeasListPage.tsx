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
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiJson } from "../api/client";
import { IdeaListFilterBar } from "../components/IdeaListFilterBar";
import { ListViewHeaderMenu, type ListViewHeaderMenuState } from "../components/shared/ListViewHeaderMenu";
import { ListViewPersonalizeModal } from "../components/shared/ListViewPersonalizeModal";
import { RecordListHeader, RecordListModeBar } from "../components/shared/RecordListView";
import { formatEntityRef } from "../lib/entityRef";
import {
  IDEAS_LIST_FILTER_STORAGE_KEY,
  evaluateIdeaListFilter,
  isIdeaFilterActive,
  type IdeaFilterAssigneeOption,
  type IdeaFilterTagOption,
} from "../lib/ideaListFilter";
import { sortIdeas, type IdeaListRow } from "../lib/ideaListSort";
import {
  buildIdeasListGridTemplate,
  formatListDate,
  type ResolvedListColumn,
} from "../lib/listViewColumns";
import {
  cycleRecordListSort,
  IDEAS_LIST_SORT_STORAGE_KEY,
  MANUAL_RECORD_LIST_SORT,
} from "../lib/recordListSort";
import { reorderVisibleAmongAll } from "../lib/todoListFilter";
import { useListViewColumns } from "../lib/useListViewColumns";
import { usePersistedIdeaListFilter } from "../lib/usePersistedIdeaListFilter";
import { usePersistedRecordListSort } from "../lib/usePersistedRecordListSort";
import type { Idea, Tag } from "../types";

type TaggingRow = Tag & { entityId: number };

function renderIdeaCell(col: ResolvedListColumn, idea: IdeaListRow, numberVisible: boolean) {
  switch (col.fieldKey) {
    case "title":
      return (
        <span key="title" className="ideas-list-row__title">
          {!numberVisible ? (
            <span className="muted">{formatEntityRef("idea", idea.number)} </span>
          ) : null}
          {idea.title}
        </span>
      );
    case "tags":
      return (
        <span key="tags" className="ideas-list-row__tags">
          {idea.tags.map((t) => (
            <span key={t.id} className="chip" style={{ background: t.color ?? undefined }}>
              {t.name}
            </span>
          ))}
        </span>
      );
    case "createdAt":
      return (
        <span key="createdAt" className="ideas-list-row__date muted">
          {new Date(idea.createdAt).toLocaleDateString()}
        </span>
      );
    case "updatedAt":
      return (
        <span key="updatedAt" className="ideas-list-row__date muted">
          {formatListDate(idea.updatedAt)}
        </span>
      );
    case "number":
      return (
        <span key="number" className="muted">
          {formatEntityRef("idea", idea.number)}
        </span>
      );
    case "assignee":
      return (
        <span key="assignee" className="muted" title={idea.assignee?.displayName}>
          {idea.assignee?.displayName ?? "—"}
        </span>
      );
    default:
      return <span key={col.fieldKey} />;
  }
}

function SortableIdeaRow({
  idea,
  dragDisabled,
  gridTemplate,
  numberVisible,
  columns,
  onOpen,
  onArm,
}: {
  idea: IdeaListRow;
  dragDisabled: boolean;
  gridTemplate: string;
  numberVisible: boolean;
  columns: ResolvedListColumn[];
  onOpen: () => void;
  onArm: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: idea.id,
    disabled: dragDisabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    gridTemplateColumns: gridTemplate,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`ideas-list-row${isDragging ? " dragging" : ""}`}
      onDoubleClick={onOpen}
      onClick={onArm}
    >
      {!dragDisabled ? (
        <span className="task-drag-handle" {...attributes} {...listeners} title="Drag to reorder">
          ::
        </span>
      ) : (
        <span className="task-drag-handle" style={{ visibility: "hidden" }} aria-hidden>
          ::
        </span>
      )}
      {columns.map((col) => renderIdeaCell(col, idea, numberVisible))}
      <Link to={`/ideas/${idea.id}`} className="btn small ghost" onClick={(e) => e.stopPropagation()}>
        Open
      </Link>
    </div>
  );
}

export function IdeasListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pendingOpen, setPendingOpen] = useState<number | null>(null);
  const [headerMenu, setHeaderMenu] = useState<ListViewHeaderMenuState>(null);
  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  const [personalizeError, setPersonalizeError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const {
    visibleColumns,
    personalizeRows,
    save: saveListCols,
    reset: resetListCols,
  } = useListViewColumns("ideas", "ideas");
  const gridTemplate = useMemo(() => buildIdeasListGridTemplate(visibleColumns), [visibleColumns]);
  const numberVisible = visibleColumns.some((c) => c.fieldKey === "number");
  const { sortCol, sortDir, setSort } = usePersistedRecordListSort(
    IDEAS_LIST_SORT_STORAGE_KEY,
    MANUAL_RECORD_LIST_SORT,
  );
  const { filter, applyFilter, clearFilter } = usePersistedIdeaListFilter(IDEAS_LIST_FILTER_STORAGE_KEY);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const { data, isLoading, error } = useQuery({
    queryKey: ["ideas", "with-tags"],
    queryFn: async () => {
      const [ideasRes, tagsRes] = await Promise.all([
        apiJson<{ data: Idea[] }>("/api/v1/ideas"),
        apiJson<{ data: TaggingRow[] }>("/api/v1/taggings?entityType=idea"),
      ]);
      const byIdea = new Map<number, Tag[]>();
      for (const row of tagsRes.data) {
        const list = byIdea.get(row.entityId) ?? [];
        list.push(row);
        byIdea.set(row.entityId, list);
      }
      return ideasRes.data.map((idea) => ({ ...idea, tags: byIdea.get(idea.id) ?? [] }));
    },
  });

  const ideas = useMemo(() => data ?? [], [data]);
  const effectiveSortCol = useMemo(() => {
    if (sortCol == null) return null;
    return visibleColumns.some((c) => c.sortable && c.fieldKey === sortCol) ? sortCol : null;
  }, [sortCol, visibleColumns]);
  const filterActive = isIdeaFilterActive(filter);
  const visibleIdeas = useMemo(() => evaluateIdeaListFilter(ideas, filter), [ideas, filter]);
  const displayIdeas = useMemo(
    () => sortIdeas(visibleIdeas, effectiveSortCol, sortDir),
    [visibleIdeas, effectiveSortCol, sortDir],
  );
  const manualOrder = effectiveSortCol == null;
  const dragEnabled = manualOrder && !filterActive;

  const tagOptions = useMemo((): IdeaFilterTagOption[] => {
    const map = new Map<number, string>();
    for (const idea of ideas) {
      for (const tag of idea.tags) map.set(tag.id, tag.name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [ideas]);

  const assigneeOptions = useMemo((): IdeaFilterAssigneeOption[] => {
    const map = new Map<number, string>();
    for (const idea of ideas) {
      if (idea.assigneeId != null && idea.assignee?.displayName) {
        map.set(idea.assigneeId, idea.assignee.displayName);
      }
    }
    return [...map.entries()]
      .map(([id, displayName]) => ({ id, displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
  }, [ideas]);

  const reorder = useMutation({
    mutationFn: async (orderedIds: number[]) => {
      await apiJson("/api/v1/ideas/reorder", {
        method: "PATCH",
        body: JSON.stringify({ orderedIds }),
      });
    },
    onSuccess: async () => {
      setReorderError(null);
      await qc.invalidateQueries({ queryKey: ["ideas", "with-tags"] });
    },
    onError: (err) => setReorderError((err as Error).message),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const next = reorderVisibleAmongAll(ideas, displayIdeas, Number(active.id), Number(over.id));
    if (!next) return;
    void reorder.mutateAsync(next.map((idea) => idea.id));
  };

  if (isLoading) return <p className="muted">Loading ideas…</p>;
  if (error) return <p role="alert">{(error as Error).message}</p>;

  const rows = displayIdeas.map((idea) => (
    <SortableIdeaRow
      key={idea.id}
      idea={idea}
      dragDisabled={!dragEnabled}
      gridTemplate={gridTemplate}
      numberVisible={numberVisible}
      columns={visibleColumns}
      onOpen={() => navigate(`/ideas/${idea.id}`)}
      onArm={() => setPendingOpen(idea.id)}
    />
  ));

  return (
    <div>
      <div className="page-head">
        <h1>Ideas</h1>
        <Link to="/ideas/new" className="btn primary">
          New idea
        </Link>
      </div>
      <IdeaListFilterBar
        filter={filter}
        tags={tagOptions}
        assignees={assigneeOptions}
        onApply={applyFilter}
        onClear={clearFilter}
      />
      {reorderError ? (
        <p className="tag-input__error" role="alert">
          {reorderError}
        </p>
      ) : null}
      <RecordListModeBar
        columnSortActive={!manualOrder}
        onManualOrder={() => setSort(MANUAL_RECORD_LIST_SORT)}
        dragNote={filterActive ? "Clear the filter to drag ideas into a new order." : null}
      />
      <div className="ideas-list">
        <RecordListHeader
          className="ideas-list-header"
          gridTemplate={gridTemplate}
          columns={visibleColumns}
          sortCol={effectiveSortCol}
          sortDir={sortDir}
          onCycleSort={(fieldKey) => {
            const col = visibleColumns.find((c) => c.fieldKey === fieldKey);
            if (!col?.sortable) return;
            setSort((prev) => cycleRecordListSort(prev, fieldKey));
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setHeaderMenu({ x: e.clientX, y: e.clientY });
          }}
          before={<span />}
          after={<span />}
        />
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={displayIdeas.map((idea) => idea.id)} strategy={verticalListSortingStrategy}>
            {rows}
          </SortableContext>
        </DndContext>
      </div>
      {ideas.length === 0 ? (
        <p className="muted">No ideas yet.</p>
      ) : displayIdeas.length === 0 && filterActive ? (
        <p className="muted">No ideas match this filter.</p>
      ) : null}
      {pendingOpen != null ? (
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
          Double-click a row to open · or use Open
        </p>
      ) : null}
      <ListViewHeaderMenu
        menu={headerMenu}
        onClose={() => setHeaderMenu(null)}
        onPersonalize={() => {
          setPersonalizeError(null);
          setPersonalizeOpen(true);
        }}
      />
      <ListViewPersonalizeModal
        open={personalizeOpen}
        title="Personalize ideas list"
        rows={personalizeRows}
        saving={saveListCols.isPending}
        resetting={resetListCols.isPending}
        error={personalizeError}
        onClose={() => setPersonalizeOpen(false)}
        onSave={(columns) => {
          setPersonalizeError(null);
          saveListCols.mutate(columns, {
            onSuccess: () => setPersonalizeOpen(false),
            onError: (err) => setPersonalizeError((err as Error).message),
          });
        }}
        onReset={() => {
          setPersonalizeError(null);
          resetListCols.mutate(undefined, {
            onSuccess: () => setPersonalizeOpen(false),
            onError: (err) => setPersonalizeError((err as Error).message),
          });
        }}
      />
    </div>
  );
}
