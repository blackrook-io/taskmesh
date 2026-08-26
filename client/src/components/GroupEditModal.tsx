import { useEffect, useId, useState } from "react";
import { GroupAutoTagPicker } from "./GroupAutoTagPicker";
import { ColorPopover } from "./shared/ColorPopover";
import { FilterClauseValueInput } from "./TaskListFilterBar";
import {
  FILTER_FIELD_LABELS,
  FILTER_JOIN_LABELS,
  FILTER_OPERATOR_LABELS,
  applyClausePatch,
  emptyTaskListFilter,
  filterFieldsForScope,
  isFilterActive,
  newFilterClause,
  operatorsForField,
  parseTaskListFilterValue,
  type FilterClause,
  type FilterField,
  type FilterJoin,
  type FilterOperator,
  type TaskListFilter,
} from "../lib/taskListFilter";
import { usePhaseFilterOptions } from "../lib/usePhaseFilterOptions";
import { useTaskFilterLookups } from "../lib/useTaskFilterLookups";
import type { Tag, TaskGroup } from "../types";

type Props = {
  group: TaskGroup;
  onClose: () => void;
  onSave: (patch: {
    name: string;
    color: string | null;
    filter: TaskListFilter | null;
    showInNav: boolean;
    autoTagId: number | null;
  }) => Promise<void>;
};

function draftFromGroup(group: TaskGroup): TaskListFilter {
  const parsed = parseTaskListFilterValue(group.filter);
  if (!parsed || !isFilterActive(parsed)) {
    return emptyTaskListFilter();
  }
  return { clauses: parsed.clauses.map((c) => ({ ...c })), joins: [...parsed.joins] };
}

export function GroupEditModal({ group, onClose, onSave }: Props) {
  const titleId = useId();
  const fields = filterFieldsForScope(false);
  const { phases } = usePhaseFilterOptions(group.projectId);
  const { tags } = useTaskFilterLookups({ includeProjects: false });
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState<string | null>(group.color);
  const [draft, setDraft] = useState<TaskListFilter>(() => draftFromGroup(group));
  const [showInNav, setShowInNav] = useState(group.showInNav);
  const [autoTag, setAutoTag] = useState<Pick<Tag, "id" | "name" | "color"> | null>(() => {
    if (group.autoTagId == null) return null;
    const found = tags.find((t) => t.id === group.autoTagId);
    return found
      ? { id: found.id, name: found.name, color: null }
      : { id: group.autoTagId, name: `#${group.autoTagId}`, color: null };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const updateClause = (index: number, patch: Partial<FilterClause>) => {
    setDraft((prev) => ({
      ...prev,
      clauses: prev.clauses.map((c, i) => (i === index ? applyClausePatch(c, patch) : c)),
    }));
  };

  const addClause = (join: FilterJoin) => {
    setDraft((prev) => {
      if (prev.clauses.length === 0) {
        return { clauses: [newFilterClause()], joins: [] };
      }
      return {
        clauses: [...prev.clauses, newFilterClause()],
        joins: [...prev.joins, join],
      };
    });
  };

  const removeClause = (index: number) => {
    setDraft((prev) => {
      const clauses = prev.clauses.filter((_, i) => i !== index);
      if (clauses.length === 0) return emptyTaskListFilter();
      const joins = prev.joins.filter((_, i) => {
        if (index === 0) return i !== 0;
        return i !== index - 1;
      });
      return { clauses, joins };
    });
  };

  const filterDraftActive = isFilterActive({
    clauses: draft.clauses,
    joins: draft.joins.slice(0, Math.max(0, draft.clauses.length - 1)),
  });

  const save = async (clearFilter: boolean) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    const filter = clearFilter
      ? null
      : isFilterActive({
          clauses: draft.clauses,
          joins: draft.joins.slice(0, Math.max(0, draft.clauses.length - 1)),
        })
        ? {
            clauses: draft.clauses.map((c) => ({ ...c })),
            joins: draft.joins.slice(0, Math.max(0, draft.clauses.length - 1)),
          }
        : emptyTaskListFilter();
    const toStore =
      filter && isFilterActive(filter) ? filter : null;
    const pin = toStore != null && showInNav;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        name: trimmed,
        color,
        filter: toStore,
        showInNav: pin,
        autoTagId: autoTag?.id ?? null,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal task-list-filter-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Edit group</h2>
        <div className="field">
          <label htmlFor={`group-name-${group.id}`}>Name</label>
          <input
            id={`group-name-${group.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field" style={{ marginTop: "0.75rem" }}>
          <span className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
            Color
          </span>
          <ColorPopover color={color} onChange={setColor} label="Group color" />
        </div>
        <div className="field" style={{ marginTop: "0.75rem" }}>
          <span className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
            Auto-tag
          </span>
          <p className="muted" style={{ margin: "0 0 0.35rem", fontSize: "0.85rem" }}>
            Applied to tasks that match this group’s filter, and when a task is dragged into this
            group. Existing tags are not removed if a task later leaves the filter.
          </p>
          <GroupAutoTagPicker tag={autoTag} onChange={setAutoTag} disabled={busy} />
        </div>
        <p className="muted task-list-filter-modal__hint" style={{ marginTop: "1rem" }}>
          The list Filter is the base for this section. This group’s filter is ANDed on; if it sets
          the same field as the list Filter, that field comes from the group only. No filter means
          manual membership (still limited by the list Filter). Use AND / OR to add conditions.
        </p>
        <div className="task-list-filter-modal__rows">
          {draft.clauses.map((clause, index) => (
            <div key={index} className="task-list-filter-modal__row">
              {index > 0 ? (
                <span className="task-list-filter-modal__join-label">
                  {FILTER_JOIN_LABELS[draft.joins[index - 1] ?? "and"]}
                </span>
              ) : (
                <span className="task-list-filter-modal__join-label task-list-filter-modal__join-label--spacer" />
              )}
              <select
                aria-label="Field"
                value={clause.field}
                onChange={(e) => updateClause(index, { field: e.target.value as FilterField })}
              >
                {fields.map((f) => (
                  <option key={f} value={f}>
                    {FILTER_FIELD_LABELS[f]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Operator"
                value={clause.operator}
                onChange={(e) => updateClause(index, { operator: e.target.value as FilterOperator })}
              >
                {(operatorsForField(clause.field).includes(clause.operator)
                  ? operatorsForField(clause.field)
                  : [...operatorsForField(clause.field), clause.operator]
                ).map((op) => (
                  <option key={op} value={op}>
                    {FILTER_OPERATOR_LABELS[op]}
                  </option>
                ))}
              </select>
              <FilterClauseValueInput
                clause={clause}
                phases={phases}
                tags={tags}
                onChange={(value) => updateClause(index, { value })}
              />
              <button
                type="button"
                className="btn ghost task-list-filter-modal__remove"
                aria-label="Remove condition"
                onClick={() => removeClause(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="btn-row task-list-filter-modal__add">
          <button type="button" className="btn ghost" onClick={() => addClause("and")}>
            AND
          </button>
          <button type="button" className="btn ghost" onClick={() => addClause("or")}>
            OR
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <label className="group-edit-nav-toggle">
          <input
            type="checkbox"
            checked={showInNav && filterDraftActive}
            disabled={!filterDraftActive || busy}
            onChange={(e) => setShowInNav(e.target.checked)}
          />
          <span>
            Show under Tasks in Project menu
            <span className="muted group-edit-nav-toggle__hint">
              {filterDraftActive
                ? "Adds a list view that opens this project’s Tasks with this group’s filter applied."
                : "Save a filter first to pin this group in the menu."}
            </span>
          </span>
        </label>
        <div className="modal-actions task-list-filter-modal__actions">
          <button type="button" className="btn ghost" onClick={() => void save(true)} disabled={busy}>
            Clear filter
          </button>
          <div className="task-list-filter-modal__actions-right">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={() => void save(false)} disabled={busy}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
