import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { compareOptionalYmd, dateOrderViolation } from "../../../src/lib/dateOrder.ts";
import { compareEstimateHours } from "../../../src/lib/estimateHours.ts";
import { apiJson } from "../api/client";
import { DuplicateWarning } from "./shared/DuplicateWarning";
import { useUndoStack } from "../hooks/useUndoStack";
import {
  discardTaskEditSession,
  ensureTaskEditSession,
  flushTaskEditSession,
  replaceTaskEditSessionBaseline,
} from "../lib/taskEditSession";
import type { PatchTaskOptions } from "../lib/patchTask";
import { sanitizePlainText } from "../lib/plainText";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATE_LABELS,
  allowedTaskStates,
  formatTaskNumber,
  isClosedTaskState,
  isDerivedTaskStatus,
  stateChangeNeedsComment,
  stateReasonPrompt,
  TASK_STATE_SORT_RANK,
  type TaskPriority,
  type TaskState,
} from "../lib/taskFields";
import type { Project, ProjectPhase, Task, TaskGroup } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { StateReasonDialog } from "./StateReasonDialog";
import { TaskRollupMeter } from "./TaskRollupMeter";
import { ColorPopover } from "./shared/ColorPopover";
import { HoursInput } from "./shared/HoursInput";
import { PlanMemberships } from "./PlanMemberships";
import { GroupEditModal } from "./GroupEditModal";
import {
  TaskListContextMenu,
  buildCreateGroupMenuItems,
  ctxFieldFromEventTarget,
  manualStatusMenuItem,
  type TaskListContextMenuItem,
  type TaskListContextMenuState,
} from "./TaskListContextMenu";
import { MoveTaskToProjectModal } from "./MoveTaskToProjectModal";
import { SetTaskParentModal } from "./SetTaskParentModal";
import { AssignToUserModal } from "./AssignToUserModal";
import { AssigneeSelectField } from "./AssigneeSelectField";
import { FilterIcon } from "./TaskListFilterBar";
import { usePhaseFilterOptions } from "../lib/usePhaseFilterOptions";
import { useTaskFilterLookups } from "../lib/useTaskFilterLookups";
import { ElementShell } from "./shared/ElementShell";
import { MarkdownEditor } from "./shared/MarkdownEditor";
import {
  loadTaskDescriptionEditorHeight,
  saveTaskDescriptionEditorHeight,
} from "../lib/taskDescriptionEditorHeight";
import {
  TaskListColumnHeaders,
  renderTaskColumnCell,
} from "./shared/TaskListColumnCells";
import { ListViewHeaderMenu, type ListViewHeaderMenuState } from "./shared/ListViewHeaderMenu";
import { ListViewPersonalizeModal } from "./shared/ListViewPersonalizeModal";
import {
  buildTaskListGridTemplate,
  type ResolvedListColumn,
} from "../lib/listViewColumns";
import { hiddenClosedCounts, isHiddenClosedSubtree } from "../lib/hideCompletedTasks";
import { hiddenDescendantCount } from "../lib/hiddenDescendantCount";
import { useListViewColumns } from "../lib/useListViewColumns";
import { useTaskListViewState } from "../lib/useTaskListViewState";
import { EntityLinksPanel } from "./shared/EntityLinksPanel";
import { TagInput } from "./shared/TagInput";
import { TaskDescriptionTemplatesMenu } from "./shared/TaskDescriptionTemplatesMenu";
import {
  fetchOpenDependsOn,
  formatCompleteBlockMessage,
  TaskDependencyLists,
} from "./shared/TaskDependencyLists";
import { TaskHistory } from "./shared/TaskHistory";
import { TaskTimeline } from "./shared/TaskTimeline";
import {
  DEFAULT_PROJECT_TASK_LIST_SORT,
  TASK_LIST_SORT_COLS,
  storageKeyForProjectTaskSort,
  type TaskListSortCol,
} from "../lib/taskListSort";
import { usePersistedTaskListSort } from "../lib/usePersistedTaskListSort";
import {
  ancestorInSection,
  insertDraggedIntoSection,
  reorderSectionRoots,
  resolveOverTarget,
  taskBoardCollisionDetection,
  type DndItemData,
  type DndPlacement,
  type GroupKey,
} from "../lib/taskBoardDnd";
/** T0078: nav sub-list is a flat filtered list (no group bars). */
import {
  emptyTaskListFilter,
  evaluateMergedListAndGroupFilter,
  evaluateTaskListFilter,
  FILTER_FIELD_LABELS,
  FILTER_OPERATOR_LABELS,
  formatFilterBreadcrumb,
  isFilterActive,
  parseTaskListFilterValue,
  taskMatchesFilter,
  type FilterMatchContext,
  type FilterOperator,
  type TaskListFilter,
} from "../lib/taskListFilter";

export type TaskReorderPayload = {
  orderedTaskIds: number[];
  parentId?: number | null;
  phaseId?: number | null;
};

type SortCol = Exclude<TaskListSortCol, "project">;

type TaskPatch = {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  startDate?: string | null;
  estimateHours?: number | null;
  color?: string | null;
  phaseId?: number | null;
  parentId?: number | null;
  projectId?: number | null;
  state?: TaskState;
  stateManual?: boolean;
  stateComment?: string;
  priority?: TaskPriority;
  assigneeId?: number | null;
};

type TaskSnapshot = {
  title: string;
  description: string;
  dueDate: string | null;
  startDate: string | null;
  estimateHours: number | null;
  color: string | null;
  phaseId: number | null;
  projectId: number | null;
  state: TaskState;
  priority: TaskPriority;
  assigneeId: number | null;
};

function taskDue(task: Task): string | null {
  return task.dueDate ?? (task.dueAt ? task.dueAt.slice(0, 10) : null);
}

function snapshotFromTask(task: Task): TaskSnapshot {
  return {
    title: task.title,
    description: task.description ?? "",
    dueDate: taskDue(task),
    startDate: task.startDate ?? null,
    estimateHours: task.estimateHours ?? null,
    color: task.color,
    phaseId: task.phaseId,
    projectId: task.projectId,
    state: task.state,
    priority: task.priority,
    assigneeId: task.assigneeId ?? null,
  };
}

function sortRoots(roots: Task[], col: SortCol | null, dir: 1 | -1): Task[] {
  if (!col) return [...roots].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const priRank: Record<TaskPriority, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
    urgent: 4,
  };
  const stateRank: Record<TaskState, number> = TASK_STATE_SORT_RANK;
  return [...roots].sort((a, b) => {
    let cmp: number;
    if (col === "number") cmp = a.number - b.number;
    else if (col === "title") cmp = a.title.localeCompare(b.title);
    else if (col === "state") cmp = stateRank[a.state] - stateRank[b.state];
    else if (col === "priority") cmp = priRank[a.priority] - priRank[b.priority];
    else if (col === "createdAt") {
      cmp = a.createdAt.localeCompare(b.createdAt);
    } else if (col === "updatedAt") {
      cmp = a.updatedAt.localeCompare(b.updatedAt);
    } else if (col === "phase") {
      cmp = (a.phaseId ?? 0) - (b.phaseId ?? 0);
    } else if (col === "startDate") {
      const dates = compareOptionalYmd(a.startDate, b.startDate, dir);
      if (dates !== 0) return dates;
      cmp = 0;
    } else if (col === "estimateHours") {
      const hours = compareEstimateHours(a.estimateHours, b.estimateHours, dir);
      if (hours !== 0) return hours;
      cmp = 0;
    } else {
      const da = taskDue(a) ?? "";
      const db = taskDue(b) ?? "";
      cmp = da.localeCompare(db);
    }
    return cmp * dir || a.id - b.id;
  });
}

function childrenOf(tasks: Task[], parentId: number): Task[] {
  return tasks
    .filter((t) => t.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

type FlatRow =
  | { kind: "group"; group: TaskGroup | null; key: string; taskCount: number }
  | {
      kind: "task";
      task: Task;
      depth: number;
      key: string;
      groupKey: number | "none";
      duplicate: boolean;
      hasChildren: boolean;
      hiddenCount: number;
      hiddenCompleted: number;
      hiddenCanceled: number;
    };

/** Pixels of title indent per nesting depth (T0103). */
export const CHILD_TITLE_INDENT_PX = 30;

function groupFilter(group: TaskGroup): TaskListFilter {
  return parseTaskListFilterValue(group.filter) ?? emptyTaskListFilter();
}

function buildRows(
  groups: TaskGroup[],
  tasks: Task[],
  listFilter: TaskListFilter,
  collapsed: Set<number | "none">,
  collapsedParents: Set<number>,
  sortCol: SortCol | null,
  sortDir: 1 | -1,
  navListView: boolean,
  hideCompleted: boolean,
  filterCtx?: FilterMatchContext,
): FlatRow[] {
  const rows: FlatRow[] = [];

  if (navListView) {
    const matched = evaluateTaskListFilter(tasks, listFilter, filterCtx);
    const matchedIds = new Set(matched.map((t) => t.id));
    const visualRoots = matched.filter((t) => t.parentId == null || !matchedIds.has(t.parentId));
    const countCache = new Map<number, number>();
    const closedCache = new Map<number, boolean>();
    const visibleKidsOf = (id: number) => childrenOf(tasks, id).filter((c) => matchedIds.has(c.id));
    const walk = (t: Task, depth: number) => {
      if (hideCompleted && isHiddenClosedSubtree(t, visibleKidsOf, closedCache)) return;
      const visibleKids = visibleKidsOf(t.id);
      const shownKids = hideCompleted
        ? visibleKids.filter((child) => !isHiddenClosedSubtree(child, visibleKidsOf, closedCache))
        : visibleKids;
      const hidden = hideCompleted
        ? hiddenClosedCounts(t.id, visibleKidsOf, closedCache)
        : { completed: 0, canceled: 0 };
      rows.push({
        kind: "task",
        task: t,
        depth,
        key: `task-nav-${t.id}`,
        groupKey: "none",
        duplicate: false,
        hasChildren: shownKids.length > 0,
        hiddenCount: hiddenDescendantCount(t.id, visibleKidsOf, countCache),
        hiddenCompleted: hidden.completed,
        hiddenCanceled: hidden.canceled,
      });
      if (collapsedParents.has(t.id)) return;
      for (const c of shownKids) {
        walk(c, depth + 1);
      }
    };
    for (const root of sortRoots(visualRoots, sortCol, sortDir)) {
      walk(root, 0);
    }
    return rows;
  }

  const orderedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
  const allRoots = tasks.filter((t) => t.parentId == null);
  const appearCount = new Map<number, number>();
  const byGroup = new Map<number, Task[]>();

  for (const g of orderedGroups) {
    const gf = groupFilter(g);
    const match = isFilterActive(gf)
      ? evaluateMergedListAndGroupFilter(allRoots, listFilter, gf, filterCtx)
      : evaluateTaskListFilter(
          allRoots.filter((t) => (g.memberTaskIds ?? []).includes(t.id)),
          listFilter,
          filterCtx,
        );
    byGroup.set(g.id, match);
    for (const t of match) {
      appearCount.set(t.id, (appearCount.get(t.id) ?? 0) + 1);
    }
  }
  const claimed = new Set(appearCount.keys());
  const unassigned = evaluateTaskListFilter(allRoots, listFilter, filterCtx).filter((t) => !claimed.has(t.id));

    const countCache = new Map<number, number>();
    const closedCache = new Map<number, boolean>();
    const kidsOf = (id: number) => childrenOf(tasks, id);
    const pushGroup = (group: TaskGroup | null, groupKey: number | "none", groupRoots: Task[]) => {
    rows.push({
      kind: "group",
      group,
      key: `group-${groupKey}`,
      taskCount: groupRoots.length,
    });
    if (collapsed.has(groupKey)) return;
    const pushTree = (t: Task, depth: number) => {
      if (hideCompleted && isHiddenClosedSubtree(t, kidsOf, closedCache)) return;
      const kids = kidsOf(t.id);
      const shownKids = hideCompleted
        ? kids.filter((child) => !isHiddenClosedSubtree(child, kidsOf, closedCache))
        : kids;
      const hidden = hideCompleted
        ? hiddenClosedCounts(t.id, kidsOf, closedCache)
        : { completed: 0, canceled: 0 };
      rows.push({
        kind: "task",
        task: t,
        depth,
        key: `task-${groupKey}-${t.id}`,
        groupKey,
        duplicate: (appearCount.get(t.id) ?? 0) > 1,
        hasChildren: shownKids.length > 0,
        hiddenCount: hiddenDescendantCount(t.id, kidsOf, countCache),
        hiddenCompleted: hidden.completed,
        hiddenCanceled: hidden.canceled,
      });
      if (collapsedParents.has(t.id)) return;
      for (const c of shownKids) {
        pushTree(c, depth + 1);
      }
    };
    for (const root of sortRoots(groupRoots, sortCol, sortDir)) {
      pushTree(root, 0);
    }
  };

  for (const g of orderedGroups) {
    pushGroup(g, g.id, byGroup.get(g.id) ?? []);
  }
  pushGroup(null, "none", unassigned);
  return rows;
}

export function TaskEditorFields({
  task,
  allTasks,
  onSavePatch,
  onRequestClose,
  onDeleted,
  onHeaderActions,
  onOpenTask,
}: {
  task: Task;
  allTasks?: Task[];
  onSavePatch: (
    patch: TaskPatch,
    opts?: PatchTaskOptions,
  ) => Promise<Task | void> | Task | void;
  onRequestClose?: () => void;
  /** Called after the task is deleted successfully (close modal / invalidate). */
  onDeleted?: () => void;
  /** Renders controls into the modal header (left of Close). */
  onHeaderActions?: (node: ReactNode) => void;
  /** Open another task in-place (dependency double-click). */
  onOpenTask?: (taskId: number) => void;
}) {
  const qc = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const initial = snapshotFromTask(task);
  const { push, undo, reset, canUndo, revision } = useUndoStack(initial);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [dueLocal, setDueLocal] = useState(initial.dueDate ?? "");
  const [startLocal, setStartLocal] = useState(initial.startDate ?? "");
  const [hoursLocal, setHoursLocal] = useState(initial.estimateHours);
  const [color, setColor] = useState(initial.color);
  const [phaseId, setPhaseId] = useState(initial.phaseId);
  const [projectId, setProjectId] = useState(initial.projectId);
  const [state, setState] = useState(initial.state);
  const [priority, setPriority] = useState(initial.priority);
  const [assigneeId, setAssigneeId] = useState(initial.assigneeId);
  const [assignee, setAssignee] = useState(task.assignee ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stateReason, setStateReason] = useState<TaskState | null>(null);
  const [allowedNext, setAllowedNext] = useState<string[]>(task.allowedNextStates ?? []);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [completeBlockMsg, setCompleteBlockMsg] = useState<string | null>(null);
  const [descriptionEditorHeight] = useState(() => loadTaskDescriptionEditorHeight());
  const [appliedServerState, setAppliedServerState] = useState<string | null>(null);

  // One History line for the whole time this task editor is open (survives remounts).
  ensureTaskEditSession(task.id, {
    title: task.title,
    description: task.description ?? null,
    state: task.state,
    priority: task.priority,
    dueDate: taskDue(task),
    startDate: task.startDate ?? null,
    estimateHours: task.estimateHours ?? null,
    color: task.color,
    phaseId: task.phaseId,
    parentId: task.parentId,
    projectId: task.projectId,
    assigneeId: task.assigneeId ?? null,
  });

  const flushSessionHistory = async () => {
    try {
      await flushTaskEditSession(task.id);
      void qc.invalidateQueries({ queryKey: ["task-activity", task.id] });
    } catch {
      // Closing should still succeed if History flush fails.
    }
  };
  const flushSessionHistoryRef = useRef(flushSessionHistory);
  // eslint-disable-next-line react-hooks/refs -- latest callback ref
  flushSessionHistoryRef.current = flushSessionHistory;

  const recheckQuery = useQuery({
    queryKey: ["task-blocked-recheck", task.id],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await apiJson<{ data: Task }>(`/api/v1/tasks/${task.id}`);
      if (res.data.state !== task.state) {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
        void qc.invalidateQueries({ queryKey: ["task-activity", task.id] });
        void qc.invalidateQueries({ queryKey: ["task-for-board", task.id] });
        void qc.invalidateQueries({ queryKey: ["task-solo", task.id] });
      }
      return res.data;
    },
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await apiJson<{ data: Project[] }>("/api/v1/projects");
      return res.data;
    },
  });

  const phasesQuery = useQuery({
    queryKey: ["project-phases", projectId],
    enabled: projectId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: ProjectPhase[] }>(`/api/v1/projects/${projectId}/phases`);
      return res.data;
    },
  });

  const knownChildren = (allTasks ?? []).filter((t) => t.parentId === task.id);
  const childrenQuery = useQuery({
    queryKey: ["tasks", "children-of", task.id],
    enabled: deleteOpen && allTasks === undefined,
    queryFn: async () => {
      const res = await apiJson<{ data: Task[] }>("/api/v1/tasks");
      return res.data.filter((t) => t.parentId === task.id);
    },
  });
  const children = allTasks !== undefined ? knownChildren : (childrenQuery.data ?? knownChildren);

  // Call sites key TaskEditorFields by task.id; sync project/phase if props change in place.
  const allowedKey = (task.allowedNextStates ?? []).join(",");
  const [syncedAllowedKey, setSyncedAllowedKey] = useState(allowedKey);
  const propStateIsStale = appliedServerState != null && task.state !== appliedServerState;
  if (!propStateIsStale && allowedKey !== syncedAllowedKey) {
    setSyncedAllowedKey(allowedKey);
    setAllowedNext(task.allowedNextStates ?? []);
  }

  const [syncedTaskState, setSyncedTaskState] = useState(task.state);
  if (!propStateIsStale && task.state !== syncedTaskState) {
    setSyncedTaskState(task.state);
    setState(task.state);
    setAllowedNext(task.allowedNextStates ?? []);
    setSyncedAllowedKey((task.allowedNextStates ?? []).join(","));
  }

  const freshTask = recheckQuery.data;
  if (freshTask && freshTask.state !== appliedServerState) {
    setAppliedServerState(freshTask.state);
    if (freshTask.state !== state) {
      const nextAllowed = freshTask.allowedNextStates ?? [];
      setState(freshTask.state);
      setAllowedNext(nextAllowed);
      setSyncedAllowedKey(nextAllowed.join(","));
      setSyncedTaskState(freshTask.state);
      reset(snapshotFromTask({ ...task, state: freshTask.state }));
      replaceTaskEditSessionBaseline(task.id, {
        title: task.title,
        description: task.description ?? null,
        state: freshTask.state,
        priority: task.priority,
        dueDate: taskDue(task),
        startDate: task.startDate ?? null,
        estimateHours: task.estimateHours ?? null,
        color: task.color,
        phaseId: task.phaseId,
        parentId: task.parentId,
        projectId: task.projectId,
        assigneeId: task.assigneeId ?? null,
      });
    }
  }

  const [syncedProjectId, setSyncedProjectId] = useState(task.projectId);
  const [syncedPhaseId, setSyncedPhaseId] = useState(task.phaseId);
  if (task.projectId !== syncedProjectId || task.phaseId !== syncedPhaseId) {
    setSyncedProjectId(task.projectId);
    setSyncedPhaseId(task.phaseId);
    setProjectId(task.projectId);
    setPhaseId(task.phaseId);
  }

  const currentSnap = (): TaskSnapshot => ({
    title,
    description,
    dueDate: dueLocal || null,
    startDate: startLocal || null,
    estimateHours: hoursLocal,
    color,
    phaseId,
    projectId,
    state,
    priority,
    assigneeId,
  });

  const applySnap = (snap: TaskSnapshot) => {
    setTitle(sanitizePlainText(snap.title));
    setDescription(snap.description);
    setDueLocal(snap.dueDate ?? "");
    setStartLocal(snap.startDate ?? "");
    setHoursLocal(snap.estimateHours);
    setColor(snap.color);
    setPhaseId(snap.phaseId);
    setProjectId(snap.projectId);
    setState(snap.state);
    setPriority(snap.priority);
    setAssigneeId(snap.assigneeId);
  };

  const applyServerTask = (row: Task) => {
    setTitle(sanitizePlainText(row.title));
    setDescription(row.description ?? "");
    setDueLocal(taskDue(row) ?? "");
    setStartLocal(row.startDate ?? "");
    setHoursLocal(row.estimateHours ?? null);
    setColor(row.color);
    setPhaseId(row.phaseId);
    setProjectId(row.projectId);
    setState(row.state);
    setPriority(row.priority);
    setAssigneeId(row.assigneeId ?? null);
    setAssignee(row.assignee ?? null);
    setAllowedNext(row.allowedNextStates ?? []);
  };

  const commit = async (previous: TaskSnapshot, patch: TaskPatch) => {
    push(previous);
    try {
      const updated = await onSavePatch(patch, { deferHistory: true });
      if (updated) applyServerTask(updated);
      setSaveError(null);
      if (patch.projectId !== undefined) {
        void qc.invalidateQueries({ queryKey: ["project-phases", patch.projectId] });
        void qc.invalidateQueries({ queryKey: ["tasks"] });
      }
      if (patch.phaseId !== undefined) {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
      }
    } catch (err) {
      setSaveError((err as Error).message);
      applySnap(previous);
    }
  };

  const handleUndo = async () => {
    const restored = undo();
    applySnap(restored);
    try {
      const updated = await onSavePatch(
        {
          title: restored.title,
          description: restored.description.trim() ? restored.description : null,
          dueDate: restored.dueDate,
          startDate: restored.startDate,
          estimateHours: restored.estimateHours,
          color: restored.color,
          phaseId: restored.phaseId,
          projectId: restored.projectId,
          state: restored.state,
          priority: restored.priority,
        },
        { deferHistory: true },
      );
      if (updated) applyServerTask(updated);
      setSaveError(null);
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  const handleUndoRef = useRef(handleUndo);
  // eslint-disable-next-line react-hooks/refs -- latest callback ref
  handleUndoRef.current = handleUndo;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void (async () => {
          await flushSessionHistoryRef.current();
          onRequestClose?.();
        })();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.(".ProseMirror")) return;
        e.preventDefault();
        void handleUndoRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onRequestClose]);

  // Flush session History when the modal unmounts (Close / backdrop / navigate).
  useEffect(() => {
    return () => {
      void flushSessionHistoryRef.current();
    };
  }, []);

  // When the editor body overflows vertically, widen the modal by the
  // scrollbar width + 10px so the scrollbar doesn't cover content on the right.
  useEffect(() => {
    const el = containerRef.current;
    const dialog = el?.closest('[role="dialog"]') as HTMLElement | null;
    if (!el || !dialog) return;
    let raf = 0;
    const GAP = 20;
    const measure = () => {
      const scrollbarWidth = el.offsetWidth - el.clientWidth;
      const hasScroll = el.scrollHeight > el.clientHeight + 1;
      if (hasScroll) {
        // Gap between content and scrollbar, plus modal growth to keep content width.
        el.style.paddingRight = `${GAP}px`;
        dialog.style.setProperty("--task-modal-extra", `${Math.max(scrollbarWidth, 0) + GAP}px`);
      } else {
        el.style.paddingRight = "";
        dialog.style.setProperty("--task-modal-extra", "0px");
      }
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      dialog.style.removeProperty("--task-modal-extra");
      el.style.paddingRight = "";
    };
  }, []);

  useEffect(() => {
    if (!onHeaderActions) return;
    onHeaderActions(
      <button
        type="button"
        className="btn small ghost"
        disabled={!canUndo || isClosedTaskState(state)}
        onClick={() => void handleUndoRef.current()}
        title="Revert last saved change (Ctrl+Z)"
      >
        Undo
      </button>,
    );
    return () => onHeaderActions(null);
  }, [canUndo, onHeaderActions, state]);

  const closed = isClosedTaskState(state);
  const nextStates = allowedTaskStates(allowedNext).filter((item) => item !== state);
  const stateOptions = [state, ...nextStates];

  const commitState = (next: TaskState, stateComment?: string) => {
    const prev = { ...currentSnap(), state };
    const patch: TaskPatch = stateComment ? { state: next, stateComment } : { state: next };
    if (next === "complete") {
      void (async () => {
        try {
          const blockers = await fetchOpenDependsOn(task.id);
          if (blockers.length > 0) {
            setCompleteBlockMsg(formatCompleteBlockMessage(blockers));
            return;
          }
        } catch (err) {
          setSaveError((err as Error).message);
          return;
        }
        setState(next);
        void commit(prev, patch);
      })();
      return;
    }
    setState(next);
    void commit(prev, patch);
  };

  const requestEditorState = (next: TaskState) => {
    if (next === state) return;
    if (stateChangeNeedsComment(state, next)) {
      setStateReason(next);
      return;
    }
    commitState(next);
  };

  return (
    <div className="task-expand" ref={containerRef}>
      <div className="field">
        <div className="task-expand__title-head">
          <label htmlFor={`t-title-${task.id}`}>Title</label>
          <span className="task-editor-hint">
            {closed
              ? "This task is closed. You can add a comment."
              : "Autosaves on blur · History updates on Close · Esc closes · Ctrl+Z undoes"}
          </span>
        </div>
        <input
          id={`t-title-${task.id}`}
          type="text"
          value={title}
          disabled={closed}
          onChange={(e) => setTitle(sanitizePlainText(e.target.value))}
          onBlur={() => {
            if (title !== task.title) {
              void commit({ ...currentSnap(), title: task.title }, { title });
            }
          }}
        />
        <DuplicateWarning entityType="task" title={title} entityId={task.id} projectId={projectId} />
      </div>
      <div className="task-editor-grid">
        <div className="field">
          <label htmlFor={`t-project-${task.id}`}>Project</label>
          <select
            id={`t-project-${task.id}`}
            value={projectId ?? ""}
            disabled={closed}
            onChange={(e) => {
              const raw = e.target.value;
              const nextProject = raw === "" ? null : Number(raw);
              const prev = { ...currentSnap(), projectId };
              setProjectId(nextProject);
              setPhaseId(null);
              void commit(prev, { projectId: nextProject, phaseId: null });
            }}
          >
            <option value="">No project</option>
            {(projectsQuery.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            </select>
        </div>
        {projectId != null ? (
          <div className="field">
            <label htmlFor={`t-phase-${task.id}`}>Phase</label>
            <select
              id={`t-phase-${task.id}`}
              value={phaseId ?? ""}
              disabled={closed || task.parentId != null}
              title={
                task.parentId != null
                  ? "Children share the parent’s phase"
                  : undefined
              }
              onChange={(e) => {
                const raw = e.target.value;
                const next = raw === "" ? null : Number(raw);
                const prev = { ...currentSnap(), phaseId };
                setPhaseId(next);
                void commit(prev, { phaseId: next });
              }}
            >
              <option value="">None</option>
              {(phasesQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {task.parentId != null ? (
              <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                Inherited from parent
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={`t-state-${task.id}`}>State</label>
          <select
            id={`t-state-${task.id}`}
            value={state}
            disabled={nextStates.length === 0}
            onChange={(e) => requestEditorState(e.target.value as TaskState)}
          >
            {stateOptions.map((s) => (
              <option key={s} value={s}>
                {TASK_STATE_LABELS[s]}
              </option>
            ))}
          </select>
          {task.rollupTotal != null && task.rollupDone != null ? (
            <div className="task-editor-rollup">
              <TaskRollupMeter done={task.rollupDone} total={task.rollupTotal} />
            </div>
          ) : null}
          {isDerivedTaskStatus(task) ? (
            <p className="muted task-editor-derived">Derived from child tasks</p>
          ) : null}
          {task.rollupTotal != null ? (
            <label className="task-editor-manual-status">
              <input
                type="checkbox"
                checked={task.stateManual === true}
                onChange={(e) => {
                  const next = e.target.checked;
                  void (async () => {
                    try {
                      const row = await onSavePatch({ stateManual: next });
                      if (row) applyServerTask(row);
                      setSaveError(null);
                    } catch (err) {
                      setSaveError(err instanceof Error ? err.message : "Could not update status");
                    }
                  })();
                }}
              />
              Manual status
            </label>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor={`t-pri-${task.id}`}>Priority</label>
          <select
            id={`t-pri-${task.id}`}
            value={priority}
            disabled={closed}
            onChange={(e) => {
              const next = e.target.value as TaskPriority;
              const prev = { ...currentSnap(), priority };
              setPriority(next);
              void commit(prev, { priority: next });
            }}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`t-start-${task.id}`}>Start date</label>
          <input
            id={`t-start-${task.id}`}
            type="date"
            value={startLocal}
            disabled={closed}
            onChange={(e) => setStartLocal(e.target.value)}
            onBlur={() => {
              const next = startLocal || null;
              if (next === (task.startDate ?? null)) return;
              const message = dateOrderViolation(next, dueLocal || null);
              if (message) {
                setSaveError(message);
                setStartLocal(task.startDate ?? "");
                return;
              }
              void commit({ ...currentSnap(), startDate: task.startDate ?? null }, { startDate: next });
            }}
          />
        </div>
        <div className="field task-editor-date-color">
          <label htmlFor={`t-due-${task.id}`}>Due date</label>
          <div className="task-editor-date-color__row">
            <input
              id={`t-due-${task.id}`}
              type="date"
              value={dueLocal}
              disabled={closed}
              onChange={(e) => setDueLocal(e.target.value)}
              onBlur={() => {
                const next = dueLocal || null;
                if (next === taskDue(task)) return;
                const message = dateOrderViolation(startLocal || null, next);
                if (message) {
                  setSaveError(message);
                  setDueLocal(taskDue(task) ?? "");
                  return;
                }
                void commit({ ...currentSnap(), dueDate: taskDue(task) }, { dueDate: next });
              }}
            />
            <div className="task-color-swatch" title={color ?? "default"}>
              {closed ? null : (
                <ColorPopover
                  color={color}
                  label="Task color"
                  placement="left"
                  onChange={(c) => {
                    const prev = { ...currentSnap(), color };
                    setColor(c);
                    void commit(prev, { color: c });
                  }}
                />
              )}
              <span className="task-color-swatch__hex muted">{color ?? "default"}</span>
            </div>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`t-hours-${task.id}`}>Hours</label>
          <HoursInput
            id={`t-hours-${task.id}`}
            value={hoursLocal}
            disabled={closed}
            ariaLabel="Hours"
            onCommit={(next) => {
              const prev = { ...currentSnap(), estimateHours: hoursLocal };
              setHoursLocal(next);
              void commit(prev, { estimateHours: next });
            }}
          />
        </div>
        <PlanMemberships entityType="task" entityId={task.id} />
        <AssigneeSelectField
          id={`t-assignee-${task.id}`}
          projectId={projectId}
          assigneeId={assigneeId}
          assignee={assignee}
          disabled={closed}
          onChange={(next) => {
            const prev = { ...currentSnap(), assigneeId };
            setAssigneeId(next);
            void commit(prev, { assigneeId: next });
          }}
        />
      </div>
      <div className="field task-expand__notes">
        <div className="task-expand__notes-head">
          <label>Description</label>
          {closed ? null : (
          <TaskDescriptionTemplatesMenu
            projectId={projectId}
            description={description}
            onApply={(body) => {
              const prev = { ...currentSnap(), description: task.description ?? "" };
              setDescription(body);
              const normalized = body.trim() ? body : null;
              if (normalized !== (task.description ?? "")) {
                void commit(prev, { description: normalized });
              }
            }}
          />
          )}
        </div>
        <MarkdownEditor
          key={`${task.id}-${revision}-description`}
          value={description}
          readOnly={closed}
          onChange={setDescription}
          fill
          height={280}
          initialLockedHeight={descriptionEditorHeight ?? undefined}
          onHeightChange={saveTaskDescriptionEditorHeight}
          placeholder="Task description…"
          onBlur={(v) => {
            setDescription(v);
            const normalized = v.trim() ? v : null;
            if (normalized !== (task.description ?? "")) {
              void commit(
                { ...currentSnap(), description: task.description ?? "" },
                { description: normalized },
              );
            }
          }}
        />
      </div>
      <TaskTimeline task={task} />
      <div className="field field--tags-below">
        <TagInput entityType="task" entityId={task.id} readOnly={closed} />
      </div>
      <EntityLinksPanel entityType="task" entityId={task.id} />
      <TaskDependencyLists taskId={task.id} onOpenTask={onOpenTask} />
      <TaskHistory taskId={task.id} />
      {children.length > 0 ? (
        <div className="field">
          <label>Child tasks</label>
          <ul className="task-child-list">
            {children.map((c) => (
              <li key={c.id}>
                <span className="muted">{formatTaskNumber(c.number)}</span> {c.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {saveError ? (
        <p role="alert" className="tag-input__error">
          {saveError}
        </p>
      ) : null}
      <div className="task-expand__footer">
        <button
          type="button"
          className="btn danger"
          onClick={() => {
            setDeleteError(null);
            setDeleteOpen(true);
          }}
        >
          Delete
        </button>
      </div>
      {deleteError && !deleteOpen ? (
        <p role="alert" className="tag-input__error">
          {deleteError}
        </p>
      ) : null}
      <StateReasonDialog
        open={stateReason != null}
        {...(stateReason != null
          ? stateReasonPrompt(state, stateReason)
          : { title: "", message: "", confirmLabel: "" })}
        onCancel={() => setStateReason(null)}
        onConfirm={(comment) => {
          const next = stateReason;
          setStateReason(null);
          if (next) commitState(next, comment);
        }}
      />
      <ConfirmDialog
        open={completeBlockMsg != null}
        title="Cannot change state"
        message={completeBlockMsg ?? ""}
        alertOnly
        confirmLabel="OK"
        onCancel={() => setCompleteBlockMsg(null)}
        onConfirm={() => setCompleteBlockMsg(null)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="Delete task?"
        message="The task will be hidden from lists and marked Deleted. It can be restored from Administration → Deleted Tasks."
        warning={
          deleteError
            ? deleteError
            : children.length > 0
              ? `Cannot delete while this task has ${children.length} child task${children.length === 1 ? "" : "s"}. Reparent or delete them first.`
              : undefined
        }
        confirmLabel={
          deleteOpen && allTasks === undefined && childrenQuery.isFetching
            ? "Checking…"
            : deleting
              ? "Deleting…"
              : "Delete"
        }
        confirmDisabled={
          deleting ||
          children.length > 0 ||
          (deleteOpen && allTasks === undefined && childrenQuery.isFetching)
        }
        onCancel={() => {
          if (deleting) return;
          setDeleteOpen(false);
          setDeleteError(null);
        }}
        onConfirm={() => {
          if (deleting) return;
          if (children.length > 0) return;
          if (allTasks === undefined && childrenQuery.isFetching) return;
          void (async () => {
            setDeleting(true);
            setDeleteError(null);
            try {
              await apiJson(`/api/v1/tasks/${task.id}`, { method: "DELETE" });
              discardTaskEditSession(task.id);
              setDeleteOpen(false);
              void qc.invalidateQueries({ queryKey: ["tasks"] });
              onDeleted?.();
              onRequestClose?.();
            } catch (err) {
              setDeleteError((err as Error).message);
            } finally {
              setDeleting(false);
            }
          })();
        }}
      />
    </div>
  );
}

function SortableTaskRow({
  task,
  depth,
  duplicate,
  groupKey,
  hasChildren,
  hiddenCount,
  hiddenCompleted,
  hiddenCanceled,
  collapsed,
  onToggleCollapse,
  onOpen,
  onPatch,
  onRequestState,
  onContextMenu,
  visibleColumns,
  phaseName,
  gridTemplate,
}: {
  task: Task;
  depth: number;
  duplicate: boolean;
  groupKey: number | "none";
  hasChildren: boolean;
  hiddenCount: number;
  hiddenCompleted: number;
  hiddenCanceled: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpen: () => void;
  onPatch: (patch: TaskPatch) => void;
  onRequestState: (next: TaskState) => void;
  onContextMenu: (e: React.MouseEvent, task: Task) => void;
  visibleColumns: ResolvedListColumn[];
  phaseName: (id: number | null) => string;
  gridTemplate: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `task-${groupKey}-${task.id}`,
    data: { type: "task", taskId: task.id, parentId: task.parentId, groupKey },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    gridTemplateColumns: gridTemplate,
  };
  const showTagsInTitle = !visibleColumns.some((c) => c.fieldKey === "tags");

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-list-row${isDragging ? " dragging" : ""}${depth > 0 ? " task-list-row--child" : ""}${task.state === "complete" ? " task-list-row--complete" : ""}`}
      onDoubleClick={onOpen}
      onContextMenu={(e) => onContextMenu(e, task)}
      {...attributes}
      {...listeners}
    >
      <span
        className="task-list-row__stripe"
        style={{ background: task.color ?? "transparent" }}
        aria-hidden
      />
      <span className="task-drag-handle" title="Drag to reorder">
        ::
      </span>
      {visibleColumns.map((col) =>
        renderTaskColumnCell(col.fieldKey, {
          task,
          depth,
          duplicate,
          hasChildren,
          hiddenCount,
          hiddenCompleted,
          hiddenCanceled,
          collapsed,
          onToggleCollapse,
          onPatch,
          onRequestState,
          phaseName,
          showTagsInTitle,
          childIndentPx: CHILD_TITLE_INDENT_PX,
        }),
      )}
    </div>
  );
}

function SortableGroupHeader({
  group,
  collapsed,
  taskCount,
  onToggle,
  onOpenEdit,
  onRequestDelete,
  filterCtx,
}: {
  group: TaskGroup | null;
  collapsed: boolean;
  taskCount: number;
  onToggle: () => void;
  onOpenEdit?: () => void;
  onRequestDelete?: () => void;
  filterCtx?: FilterMatchContext;
}) {
  const sortableId = group ? `group-${group.id}` : "group-none";
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: sortableId,
    data: { type: "group", groupId: group?.id ?? null },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(group?.color
      ? { background: `color-mix(in srgb, ${group.color} 42%, var(--bg-elevated, var(--bg)) 58%)` }
      : {}),
  };
  const gf = group ? groupFilter(group) : emptyTaskListFilter();
  const filterOn = group != null && isFilterActive(gf);
  const breadcrumb = filterOn ? formatFilterBreadcrumb(gf, filterCtx) : "";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-phase-header${group == null ? " task-phase-header--unassigned" : ""}${isDragging ? " dragging" : ""}${isOver ? " is-over" : ""}`}
    >
      <button type="button" className="task-phase-header__collapse" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? "▸" : "▾"}
      </button>
      {group ? (
        <span className="task-drag-handle" {...attributes} {...listeners} title="Drag group">
          ::
        </span>
      ) : (
        <span className="task-drag-handle" style={{ visibility: "hidden" }}>
          ::
        </span>
      )}
      <span
        className="task-phase-header__name"
        title={group && onOpenEdit ? "Double-click to edit group" : undefined}
        onDoubleClick={
          group && onOpenEdit
            ? (e) => {
                e.preventDefault();
                onOpenEdit();
              }
            : undefined
        }
      >
        {group?.name ?? "Unassigned"}
      </span>
      <span className="task-phase-header__count muted" aria-label={`${taskCount} tasks`}>
        {taskCount}
      </span>
      {filterOn ? (
        <span className="task-phase-header__filter" title={breadcrumb} aria-label={`Filter: ${breadcrumb}`}>
          <FilterIcon />
        </span>
      ) : null}
      {group?.autoTagId != null ? (
        <span
          className="task-phase-header__auto-tag muted"
          title={`Auto-tag: ${filterCtx?.tagNames?.get(group.autoTagId) ?? `#${group.autoTagId}`}`}
        >
          #{filterCtx?.tagNames?.get(group.autoTagId) ?? group.autoTagId}
        </span>
      ) : null}
      {group && onRequestDelete ? (
        <button
          type="button"
          className="btn small ghost task-phase-header__delete"
          title="Delete group"
          aria-label={`Delete group ${group.name}`}
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

function GroupDropZone({
  groupKey,
  empty,
}: {
  groupKey: GroupKey;
  empty: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-group-${groupKey}`,
    data: { type: "group-drop", groupId: groupKey === "none" ? null : groupKey },
  });
  return (
    <div
      ref={setNodeRef}
      className={`task-group-drop${empty ? " task-group-drop--empty" : ""}${isOver ? " is-over" : ""}`}
    >
      {empty ? <span className="muted">Drop tasks here</span> : null}
    </div>
  );
}

type BoardSection = {
  header: Extract<FlatRow, { kind: "group" }> | null;
  groupKey: GroupKey;
  tasks: Extract<FlatRow, { kind: "task" }>[];
};

function chunkDisplayRows(rows: FlatRow[]): BoardSection[] {
  const sections: BoardSection[] = [];
  for (const row of rows) {
    if (row.kind === "group") {
      sections.push({ header: row, groupKey: row.group?.id ?? "none", tasks: [] });
      continue;
    }
    const last = sections[sections.length - 1];
    if (!last || last.groupKey !== row.groupKey) {
      sections.push({ header: null, groupKey: row.groupKey, tasks: [row] });
    } else {
      last.tasks.push(row);
    }
  }
  return sections;
}

type PendingAutoTagDrop = {
  taskId: number;
  taskTitle: string;
  groupId: number;
  groupName: string;
  tagId: number;
  tagLabel: string;
  addMembership: boolean;
  removeFromGroupId: number | null;
  insert: { placement: DndPlacement; overTaskId?: number };
};

type Props = {
  projectId: number;
  groups: TaskGroup[];
  tasks: Task[];
  listFilter: TaskListFilter;
  /** Nav sub-list: flat filtered list, no Group/Unassigned header bars. */
  navListView?: boolean;
  /** When set, open the Edit Task modal for this task (e.g. after create). */
  requestOpenTask?: Task | null;
  onRequestOpenTaskConsumed?: () => void;
  onReorder: (payload: TaskReorderPayload) => Promise<void>;
  onReorderGroups: (orderedGroupIds: number[]) => Promise<void>;
  onPatchGroup: (
    groupId: number,
    patch: {
      name?: string;
      color?: string | null;
      filter?: TaskListFilter | null;
      showInNav?: boolean;
      autoTagId?: number | null;
    },
  ) => Promise<void>;
  onCreateGroup: (
    name: string,
    filter?: TaskListFilter | null,
  ) => Promise<TaskGroup | void>;
  onDeleteGroup: (groupId: number) => Promise<void>;
  onAttachTaskTag: (taskId: number, tagId: number) => Promise<void>;
  onAddGroupMember: (groupId: number, taskId: number) => Promise<void>;
  onRemoveGroupMember: (groupId: number, taskId: number) => Promise<void>;
  onPatchTask: (
    taskId: number,
    patch: Record<string, unknown>,
    opts?: PatchTaskOptions,
  ) => Promise<Task | void>;
};

export function TaskBoard({
  projectId,
  groups,
  tasks,
  listFilter,
  navListView = false,
  requestOpenTask = null,
  onRequestOpenTaskConsumed,
  onReorder,
  onReorderGroups,
  onPatchGroup,
  onCreateGroup,
  onDeleteGroup,
  onAttachTaskTag,
  onAddGroupMember,
  onRemoveGroupMember,
  onPatchTask,
}: Props) {
  const { phaseNames } = usePhaseFilterOptions(projectId);
  const { filterCtx: tagCtx } = useTaskFilterLookups({ includeProjects: false });
  const filterCtx = useMemo(() => ({ ...tagCtx, phaseNames }), [tagCtx, phaseNames]);
  const {
    visibleColumns,
    personalizeRows,
    save: saveListCols,
    reset: resetListCols,
  } = useListViewColumns("tasks", "project");
  const {
    collapsedGroupIds,
    collapsedUngroupedProjectIds,
    collapsedParents,
    hideCompleted,
    toggle: toggleListState,
  } = useTaskListViewState();
  const collapsed = useMemo(() => {
    const next = new Set<number | "none">(collapsedGroupIds);
    if (collapsedUngroupedProjectIds.includes(projectId)) next.add("none");
    return next;
  }, [collapsedGroupIds, collapsedUngroupedProjectIds, projectId]);
  const gridTemplate = useMemo(
    () => buildTaskListGridTemplate(visibleColumns, "project"),
    [visibleColumns],
  );
  const phaseName = (id: number | null) => (id != null ? (phaseNames.get(id) ?? "") : "");
  const [modalTaskId, setModalTaskId] = useState<number | null>(null);
  const [modalTaskHeld, setModalTaskHeld] = useState<Task | null>(null);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const sortStorageKey = storageKeyForProjectTaskSort(projectId);
  const { sortCol, sortDir, setSort } = usePersistedTaskListSort(
    sortStorageKey,
    DEFAULT_PROJECT_TASK_LIST_SORT,
  );
  const [newGroupName, setNewGroupName] = useState("");
  const [pendingGroupDelete, setPendingGroupDelete] = useState<TaskGroup | null>(null);
  const [editGroup, setEditGroup] = useState<TaskGroup | null>(null);
  const [completeBlockMsg, setCompleteBlockMsg] = useState<string | null>(null);
  const [stateReason, setStateReason] = useState<{ task: Task; to: TaskState } | null>(null);
  const [pendingAutoTagDrop, setPendingAutoTagDrop] = useState<PendingAutoTagDrop | null>(null);
  const [dndInfo, setDndInfo] = useState<{ title: string; message: string } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<TaskListContextMenuState | null>(null);
  const [headerMenu, setHeaderMenu] = useState<ListViewHeaderMenuState>(null);
  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  const [personalizeError, setPersonalizeError] = useState<string | null>(null);
  const [moveTaskId, setMoveTaskId] = useState<number | null>(null);
  const [parentTaskId, setParentTaskId] = useState<number | null>(null);
  const [assignTaskId, setAssignTaskId] = useState<number | null>(null);

  const toggleGroup = (groupKey: number | "none") => {
    if (groupKey === "none") {
      toggleListState({
        kind: "ungrouped",
        id: projectId,
        collapsed: !collapsed.has("none"),
      });
      return;
    }
    toggleListState({
      kind: "group",
      id: groupKey,
      collapsed: !collapsed.has(groupKey),
    });
  };

  const toggleParentCollapse = (taskId: number) => {
    toggleListState({
      kind: "parent",
      id: taskId,
      collapsed: !collapsedParents.has(taskId),
    });
  };

  const rows = useMemo(() => {
    const visibleSortKeys = new Set(visibleColumns.filter((c) => c.sortable).map((c) => c.fieldKey));
    const effectiveSort: SortCol | null =
      sortCol != null && visibleSortKeys.has(sortCol) && sortCol !== "project" ? sortCol : null;
    return buildRows(
      groups,
      tasks,
      listFilter,
      collapsed,
      collapsedParents,
      effectiveSort,
      sortDir,
      navListView,
      hideCompleted,
      filterCtx,
    );
  }, [
    groups,
    tasks,
    listFilter,
    collapsed,
    collapsedParents,
    hideCompleted,
    sortCol,
    sortDir,
    navListView,
    filterCtx,
    visibleColumns,
  ]);

  const displayRows = useMemo(() => {
    if (!navListView) return rows;
    const seen = new Set<number>();
    const out: FlatRow[] = [];
    for (const row of rows) {
      if (row.kind === "group") continue;
      if (!isFilterActive(listFilter) || !taskMatchesFilter(row.task, listFilter, filterCtx)) continue;
      if (seen.has(row.task.id)) continue;
      seen.add(row.task.id);
      out.push({ ...row, duplicate: false, groupKey: "none" });
    }
    return out;
  }, [navListView, rows, listFilter, filterCtx]);

  const onRequestOpenTaskConsumedRef = useRef(onRequestOpenTaskConsumed);
  // eslint-disable-next-line react-hooks/refs -- latest callback ref
  onRequestOpenTaskConsumedRef.current = onRequestOpenTaskConsumed;

  const [prevRequestOpenTask, setPrevRequestOpenTask] = useState(requestOpenTask);
  if (requestOpenTask !== prevRequestOpenTask) {
    setPrevRequestOpenTask(requestOpenTask);
    if (requestOpenTask != null) {
      setModalTaskId(requestOpenTask.id);
      setModalTaskHeld(requestOpenTask);
    }
  }

  useEffect(() => {
    if (requestOpenTask == null) return;
    onRequestOpenTaskConsumedRef.current?.();
  }, [requestOpenTask]);

  const fromList = modalTaskId != null ? (tasks.find((t) => t.id === modalTaskId) ?? null) : null;
  if (fromList != null && fromList !== modalTaskHeld) {
    setModalTaskHeld(fromList);
  }
  const modalTask = fromList ?? (modalTaskId != null ? modalTaskHeld : null);

  const sortableIds = useMemo(() => displayRows.map((r) => r.key), [displayRows]);
  const sections = useMemo(() => chunkDisplayRows(displayRows), [displayRows]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const headerSort = (col: string) => {
    if (!(TASK_LIST_SORT_COLS as readonly string[]).includes(col)) return;
    const sortKey = col as SortCol;
    setSort((prev) =>
      prev.col === sortKey ? { col: sortKey, dir: prev.dir === 1 ? -1 : 1 } : { col: sortKey, dir: 1 },
    );
  };

  const parentIdOf = (id: number) => tasks.find((t) => t.id === id)?.parentId ?? null;

  const sectionRootIds = (groupKey: GroupKey): number[] =>
    displayRows
      .filter(
        (r): r is Extract<FlatRow, { kind: "task" }> =>
          r.kind === "task" && r.groupKey === groupKey && r.depth === 0,
      )
      .map((r) => r.task.id);

  const persistRootOrder = async (orderedTaskIds: number[]) => {
    if (sortCol != null) setSort({ col: null, dir: 1 });
    await onReorder({ orderedTaskIds });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeData = active.data.current as DndItemData | undefined;
    const overData = over.data.current as DndItemData | undefined;
    const overTarget = resolveOverTarget(overData, over.id);

    if (activeData?.type === "group" && typeof activeData.groupId === "number") {
      const groupIds = groups.map((g) => g.id);
      const from = groupIds.indexOf(activeData.groupId);
      let to = from;
      if (overTarget && typeof overTarget.groupKey === "number") {
        to = groupIds.indexOf(overTarget.groupKey);
      }
      if (from < 0 || to < 0 || from === to) return;
      try {
        await onReorderGroups(arrayMove(groupIds, from, to));
      } catch (err) {
        setDndInfo({
          title: "Could not reorder groups",
          message: (err as Error).message || "The drop could not be saved.",
        });
      }
      return;
    }

    if (activeData?.type === "task" && activeData.taskId != null) {
      const task = tasks.find((t) => t.id === activeData.taskId);
      if (!task || task.parentId != null) {
        if (!task?.parentId) return;
        const siblings = childrenOf(tasks, task.parentId).map((t) => t.id);
        const oldIndex = siblings.indexOf(task.id);
        let newIndex = oldIndex;
        if (overTarget?.placement === "before-task" && overTarget.taskId != null) {
          const overTask = tasks.find((t) => t.id === overTarget.taskId);
          if (overTask?.parentId === task.parentId) {
            newIndex = siblings.indexOf(overTask.id);
          }
        }
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
        try {
          await onReorder({
            orderedTaskIds: arrayMove(siblings, oldIndex, newIndex),
            parentId: task.parentId,
          });
        } catch (err) {
          setDndInfo({
            title: "Could not reorder tasks",
            message: (err as Error).message || "The drop could not be saved.",
          });
        }
        return;
      }

      const fromKey = activeData.groupKey;
      if (fromKey == null || !overTarget) return;
      const toKey = overTarget.groupKey;

      if (toKey !== fromKey) {
        const sourceManualId =
          typeof fromKey === "number"
            ? (() => {
                const source = groups.find((g) => g.id === fromKey);
                return source && !isFilterActive(groupFilter(source)) ? source.id : null;
              })()
            : null;

        const applyInsertOrder = async (sectionKey: GroupKey) => {
          const ids = sectionRootIds(sectionKey);
          const overRootId =
            overTarget.placement === "before-task" && overTarget.taskId != null
              ? ancestorInSection(overTarget.taskId, parentIdOf, ids)
              : null;
          const next = insertDraggedIntoSection({
            sectionRootIds: ids,
            draggedId: task.id,
            overTaskId: overRootId,
            placement: overTarget.placement,
          });
          await persistRootOrder(next);
        };

        if (toKey === "none") {
          if (sourceManualId != null) {
            try {
              await onRemoveGroupMember(sourceManualId, task.id);
              await applyInsertOrder("none");
            } catch (err) {
              setDndInfo({
                title: "Could not move task",
                message: (err as Error).message || "The drop could not be saved.",
              });
            }
            return;
          }
          setDndInfo({
            title: "Cannot move to Unassigned",
            message:
              "Unassigned only shows tasks that do not match a group filter. Dragging here does not remove tags or change filters.",
          });
          return;
        }

        const target = groups.find((g) => g.id === toKey);
        if (!target) return;
        const targetManual = !isFilterActive(groupFilter(target));

        if (target.autoTagId != null) {
          const tagLabel = filterCtx.tagNames?.get(target.autoTagId) ?? `#${target.autoTagId}`;
          setPendingAutoTagDrop({
            taskId: task.id,
            taskTitle: task.title,
            groupId: target.id,
            groupName: target.name,
            tagId: target.autoTagId,
            tagLabel,
            addMembership: targetManual,
            removeFromGroupId: sourceManualId,
            insert: {
              placement: overTarget.placement,
              overTaskId: overTarget.taskId,
            },
          });
          return;
        }

        if (targetManual) {
          try {
            await onAddGroupMember(target.id, task.id);
            if (sourceManualId != null && sourceManualId !== target.id) {
              await onRemoveGroupMember(sourceManualId, task.id);
            }
            await applyInsertOrder(target.id);
          } catch (err) {
            setDndInfo({
              title: "Could not move task",
              message: (err as Error).message || "The drop could not be saved.",
            });
          }
          return;
        }

        if (taskMatchesFilter(task, groupFilter(target), filterCtx)) {
          try {
            await applyInsertOrder(target.id);
          } catch (err) {
            setDndInfo({
              title: "Could not reorder tasks",
              message: (err as Error).message || "The drop could not be saved.",
            });
          }
          return;
        }

        setDndInfo({
          title: "Task does not match this group",
          message: `“${target.name}” uses a filter that this task does not match. Edit the task or the group filter, or set an Auto-tag to apply a tag when dropping tasks here.`,
        });
        return;
      }

      const ids = sectionRootIds(fromKey);
      const overRootId =
        overTarget.placement === "before-task" && overTarget.taskId != null
          ? ancestorInSection(overTarget.taskId, parentIdOf, ids)
          : null;
      const next = reorderSectionRoots({
        sectionRootIds: ids,
        draggedId: task.id,
        overTaskId: overRootId,
        placement: overTarget.placement,
      });
      if (!next) return;
      try {
        await persistRootOrder(next);
      } catch (err) {
        setDndInfo({
          title: "Could not reorder tasks",
          message: (err as Error).message || "The drop could not be saved.",
        });
      }
    }
  };

  const confirmAutoTagDrop = () => {
    const pending = pendingAutoTagDrop;
    setPendingAutoTagDrop(null);
    if (!pending) return;
    void (async () => {
      try {
        await onAttachTaskTag(pending.taskId, pending.tagId);
        if (pending.addMembership) {
          await onAddGroupMember(pending.groupId, pending.taskId);
        }
        if (pending.removeFromGroupId != null && pending.removeFromGroupId !== pending.groupId) {
          await onRemoveGroupMember(pending.removeFromGroupId, pending.taskId);
        }
        const ids = sectionRootIds(pending.groupId);
        const overRootId =
          pending.insert.overTaskId != null
            ? ancestorInSection(pending.insert.overTaskId, parentIdOf, ids)
            : null;
        const next = insertDraggedIntoSection({
          sectionRootIds: ids,
          draggedId: pending.taskId,
          overTaskId: overRootId,
          placement: pending.insert.placement,
        });
        await persistRootOrder(next);
      } catch (err) {
        setDndInfo({
          title: "Could not move task",
          message: (err as Error).message || "The drop could not be saved.",
        });
      }
    })();
  };

  const applyTaskState = (task: Task, next: TaskState, stateComment?: string) => {
    const patch = stateComment ? { state: next, stateComment } : { state: next };
    if (next === "complete") {
      void (async () => {
        try {
          const blockers = await fetchOpenDependsOn(task.id);
          if (blockers.length > 0) {
            setCompleteBlockMsg(formatCompleteBlockMessage(blockers));
            return;
          }
          await onPatchTask(task.id, patch);
        } catch (err) {
          setCompleteBlockMsg((err as Error).message);
        }
      })();
      return;
    }
    void onPatchTask(task.id, patch).catch((err: unknown) => {
      setCompleteBlockMsg(err instanceof Error ? err.message : "Could not change state");
    });
  };

  const requestTaskState = (task: Task, next: TaskState) => {
    if (!task.allowedNextStates?.includes(next)) return;
    if (stateChangeNeedsComment(task.state, next)) {
      setStateReason({ task, to: next });
      return;
    }
    applyTaskState(task, next);
  };

  const renderTaskRow = (row: Extract<FlatRow, { kind: "task" }>) => (
    <SortableTaskRow
      key={row.key}
      task={row.task}
      depth={row.depth}
      duplicate={row.duplicate}
      groupKey={row.groupKey}
      hasChildren={row.hasChildren}
      hiddenCount={row.hiddenCount}
      hiddenCompleted={row.hiddenCompleted}
      hiddenCanceled={row.hiddenCanceled}
      collapsed={collapsedParents.has(row.task.id)}
      onToggleCollapse={() => toggleParentCollapse(row.task.id)}
      onOpen={() => setModalTaskId(row.task.id)}
      onPatch={(patch) => void onPatchTask(row.task.id, patch)}
      onRequestState={(next) => requestTaskState(row.task, next)}
      visibleColumns={visibleColumns}
      phaseName={phaseName}
      gridTemplate={gridTemplate}
      onContextMenu={(e, task) => {
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({
          x: e.clientX,
          y: e.clientY,
          taskId: task.id,
          field: ctxFieldFromEventTarget(e.target),
        });
      }}
    />
  );

  const ctxTask = ctxMenu ? (tasks.find((t) => t.id === ctxMenu.taskId) ?? null) : null;
  const moveTask = moveTaskId != null ? (tasks.find((t) => t.id === moveTaskId) ?? null) : null;
  const parentTask =
    parentTaskId != null ? (tasks.find((t) => t.id === parentTaskId) ?? null) : null;
  const assignTask =
    assignTaskId != null ? (tasks.find((t) => t.id === assignTaskId) ?? null) : null;

  const ctxMenuItems: TaskListContextMenuItem[] = (() => {
    if (!ctxMenu || !ctxTask) return [];
    const due = taskDue(ctxTask);
    const stateChoices = allowedTaskStates(ctxTask.allowedNextStates);
    const manualItem = manualStatusMenuItem(ctxTask, (stateManual) => {
      void onPatchTask(ctxTask.id, { stateManual });
    });
    const items: TaskListContextMenuItem[] = [
      ...(stateChoices.length > 0
        ? [
            {
              type: "submenu" as const,
              label: "Set state",
              children: stateChoices.map((next) => ({
                type: "action" as const,
                label: TASK_STATE_LABELS[next],
                onSelect: () => requestTaskState(ctxTask, next),
              })),
            },
            { type: "separator" as const },
          ]
        : []),
      ...(manualItem ? [manualItem, { type: "separator" as const }] : []),
      {
        type: "action",
        label: "Move to…",
        onSelect: () => setMoveTaskId(ctxTask.id),
      },
      {
        type: "action",
        label: "Set Parent…",
        onSelect: () => setParentTaskId(ctxTask.id),
      },
      {
        type: "action",
        label: "Assign to…",
        onSelect: () => setAssignTaskId(ctxTask.id),
      },
    ];
    items.push({ type: "separator" });
    items.push({
      type: "submenu",
      label: "Create Task Group",
      children: buildCreateGroupMenuItems({
        field: ctxMenu.field,
        stateLabel: TASK_STATE_LABELS[ctxTask.state],
        priorityLabel: TASK_PRIORITY_LABELS[ctxTask.priority],
        dueLabel: due,
        onCreate: (field, operator) => {
          void (async () => {
            const value =
              field === "state"
                ? ctxTask.state
                : field === "priority"
                  ? ctxTask.priority
                  : (due ?? "");
            if (field === "dueDate" && !value) return;
            const filter: TaskListFilter = {
              clauses: [{ field, operator: operator as FilterOperator, value }],
              joins: [],
            };
            const name = `${FILTER_FIELD_LABELS[field]} ${FILTER_OPERATOR_LABELS[operator]} ${
              field === "state"
                ? TASK_STATE_LABELS[ctxTask.state]
                : field === "priority"
                  ? TASK_PRIORITY_LABELS[ctxTask.priority]
                  : value
            }`;
            const created = await onCreateGroup(name.slice(0, 200), filter);
            if (created) setEditGroup(created);
          })();
        },
      }),
    });
    return items;
  })();

  return (
    <>
      <div className="task-list">
        <div
          className="task-list-header"
          style={{ gridTemplateColumns: gridTemplate }}
          onContextMenu={(e) => {
            e.preventDefault();
            setHeaderMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <span className="task-list-header__stripe" />
          <span />
          <TaskListColumnHeaders
            columns={visibleColumns}
            sortCol={sortCol}
            sortDir={sortDir}
            onSort={headerSort}
            sortTrigger="doubleClick"
          />
        </div>

        {navListView && hideCompleted && !isFilterActive(listFilter) && displayRows.length === 0 && tasks.length > 0 ? (
          <p className="muted" style={{ padding: "0.75rem 0.5rem" }}>
            Completed and canceled tasks are hidden.
          </p>
        ) : null}

        <DndContext
          sensors={sensors}
          collisionDetection={taskBoardCollisionDetection}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            {sections.map((section) => {
              const group = section.header?.group ?? null;
              return (
              <Fragment key={section.header?.key ?? `sec-${section.groupKey}`}>
                {section.header && !navListView ? (
                  <SortableGroupHeader
                    group={group}
                    collapsed={collapsed.has(section.groupKey)}
                    taskCount={section.header.taskCount}
                    filterCtx={filterCtx}
                    onToggle={() => toggleGroup(section.groupKey)}
                    onOpenEdit={group ? () => setEditGroup(group) : undefined}
                    onRequestDelete={group ? () => setPendingGroupDelete(group) : undefined}
                  />
                ) : null}
                {section.tasks.map(renderTaskRow)}
                <GroupDropZone
                  groupKey={section.groupKey}
                  empty={
                    !navListView &&
                    (section.header?.taskCount ?? section.tasks.length) === 0
                  }
                />
              </Fragment>
              );
            })}
          </SortableContext>
        </DndContext>
      </div>

      {navListView ? null : (
      <div className="task-phase-add">
        <input
          type="text"
          placeholder="New group name"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newGroupName.trim()) {
              e.preventDefault();
              void onCreateGroup(newGroupName.trim()).then(() => setNewGroupName(""));
            }
          }}
        />
        <button
          type="button"
          className="btn small"
          disabled={!newGroupName.trim()}
          onClick={() => void onCreateGroup(newGroupName.trim()).then(() => setNewGroupName(""))}
        >
          Add group
        </button>
      </div>
      )}

      {modalTask ? (
        <ElementShell
          mode="modal"
          entityType="task"
          title={modalTask.title}
          titleLeading={formatTaskNumber(modalTask.number)}
          showType={false}
          accentColor={modalTask.color}
          actions={headerActions}
          open
          onClose={() => {
            setModalTaskId(null);
            setModalTaskHeld(null);
          }}
        >
          <TaskEditorFields
            key={modalTask.id}
            task={modalTask}
            allTasks={tasks}
            onRequestClose={() => {
              setModalTaskId(null);
              setModalTaskHeld(null);
            }}
            onDeleted={() => {
              setModalTaskId(null);
              setModalTaskHeld(null);
            }}
            onHeaderActions={setHeaderActions}
            onOpenTask={(id) => {
              setModalTaskHeld(null);
              setModalTaskId(id);
            }}
            onSavePatch={async (p, opts) => {
              const updated = await onPatchTask(modalTask.id, { ...p }, opts);
              if (updated) setModalTaskHeld(updated);
              return updated;
            }}
          />
        </ElementShell>
      ) : null}

      {editGroup ? (
        <GroupEditModal
          group={editGroup}
          onClose={() => setEditGroup(null)}
          onSave={async (patch) => {
            await onPatchGroup(editGroup.id, patch);
          }}
        />
      ) : null}

      <StateReasonDialog
        open={stateReason != null}
        {...(stateReason != null
          ? stateReasonPrompt(stateReason.task.state, stateReason.to)
          : { title: "", message: "", confirmLabel: "" })}
        onCancel={() => setStateReason(null)}
        onConfirm={(comment) => {
          const pending = stateReason;
          setStateReason(null);
          if (pending) applyTaskState(pending.task, pending.to, comment);
        }}
      />
      <ConfirmDialog
        open={completeBlockMsg != null}
        title="Cannot change state"
        message={completeBlockMsg ?? ""}
        alertOnly
        confirmLabel="OK"
        onCancel={() => setCompleteBlockMsg(null)}
        onConfirm={() => setCompleteBlockMsg(null)}
      />
      <ConfirmDialog
        open={pendingAutoTagDrop != null}
        title="Apply Auto-tag?"
        message={
          pendingAutoTagDrop
            ? `Group “${pendingAutoTagDrop.groupName}” applies Auto-tag “${pendingAutoTagDrop.tagLabel}” to tasks dropped here. Confirm to tag “${pendingAutoTagDrop.taskTitle}” and move it into this group if it matches the group filter.`
            : ""
        }
        confirmLabel="Confirm"
        confirmTone="primary"
        onCancel={() => setPendingAutoTagDrop(null)}
        onConfirm={confirmAutoTagDrop}
      />
      <ConfirmDialog
        open={dndInfo != null}
        title={dndInfo?.title ?? ""}
        message={dndInfo?.message ?? ""}
        alertOnly
        confirmLabel="OK"
        onCancel={() => setDndInfo(null)}
        onConfirm={() => setDndInfo(null)}
      />
      <ConfirmDialog
        open={pendingGroupDelete != null}
        title="Delete group?"
        message={
          pendingGroupDelete
            ? `Delete group “${pendingGroupDelete.name}”? Tasks are not assigned to groups; only this section is removed.`
            : ""
        }
        confirmLabel="Delete"
        onCancel={() => setPendingGroupDelete(null)}
        onConfirm={() => {
          if (!pendingGroupDelete) return;
          const id = pendingGroupDelete.id;
          setPendingGroupDelete(null);
          void onDeleteGroup(id);
        }}
      />

      <TaskListContextMenu
        menu={ctxMenu}
        onClose={() => setCtxMenu(null)}
        items={ctxMenuItems}
      />
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
        title="Personalize task list"
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

      <MoveTaskToProjectModal
        open={moveTask != null}
        currentProjectId={moveTask?.projectId ?? projectId}
        onClose={() => setMoveTaskId(null)}
        onSave={async (nextProjectId) => {
          if (!moveTask) return;
          await onPatchTask(moveTask.id, { projectId: nextProjectId, phaseId: null });
        }}
      />

      <SetTaskParentModal
        open={parentTask != null}
        taskId={parentTask?.id ?? 0}
        currentParentId={parentTask?.parentId ?? null}
        onClose={() => setParentTaskId(null)}
        onSave={async (nextParentId) => {
          if (!parentTask) return;
          await onPatchTask(parentTask.id, { parentId: nextParentId });
        }}
      />

      <AssignToUserModal
        open={assignTask != null}
        projectId={assignTask?.projectId ?? null}
        currentAssigneeId={assignTask?.assigneeId ?? null}
        currentAssignee={assignTask?.assignee ?? null}
        onClose={() => setAssignTaskId(null)}
        onSave={async (nextAssigneeId) => {
          if (!assignTask) return;
          await onPatchTask(assignTask.id, { assigneeId: nextAssigneeId });
        }}
      />
    </>
  );
}
