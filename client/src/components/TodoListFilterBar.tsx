import { useEffect, useId, useState } from "react";
import { FilterIcon } from "./TaskListFilterBar";
import {
  DUE_PRESETS,
  DUE_PRESET_LABELS,
  ENTITY_TYPE_FILTER_LABELS,
  ENTITY_TYPE_FILTER_VALUES,
  INLINE_TODO_LIST_STATES,
  TODO_FILTER_FIELD_LABELS,
  TODO_FILTER_FIELDS,
  TODO_FILTER_JOIN_LABELS,
  TODO_FILTER_OPERATOR_LABELS,
  applyTodoClausePatch,
  clauseValueUsesTodoPicker,
  formatTodoFilterBreadcrumb,
  isTodoFilterActive,
  newTodoFilterClause,
  operatorsForTodoField,
  type TodoFilterClause,
  type TodoFilterField,
  type TodoFilterJoin,
  type TodoFilterOperator,
  type TodoListFilter,
} from "../lib/todoListFilter";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATE_LABELS,
} from "../lib/taskFields";
import { useTodoListFilterLookups, type FilterTagOption } from "../lib/useTodoListFilterLookups";

type Props = {
  filter: TodoListFilter;
  onApply: (filter: TodoListFilter) => void;
  onClear: () => void;
};

function TodoFilterClauseValueInput({
  clause,
  onChange,
  tags,
}: {
  clause: TodoFilterClause;
  onChange: (value: string) => void;
  tags: FilterTagOption[];
}) {
  if (clause.field === "state") {
    return (
      <select aria-label="Filter value" value={clause.value} onChange={(e) => onChange(e.target.value)}>
        {INLINE_TODO_LIST_STATES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATE_LABELS[s]}
          </option>
        ))}
      </select>
    );
  }
  if (clause.field === "priority") {
    return (
      <select aria-label="Filter value" value={clause.value} onChange={(e) => onChange(e.target.value)}>
        {TASK_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {TASK_PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>
    );
  }
  if (clause.field === "dueDate") {
    return (
      <select aria-label="Filter value" value={clause.value} onChange={(e) => onChange(e.target.value)}>
        {DUE_PRESETS.map((p) => (
          <option key={p} value={p}>
            {DUE_PRESET_LABELS[p]}
          </option>
        ))}
      </select>
    );
  }
  if (clause.field === "checked") {
    return (
      <select aria-label="Filter value" value={clause.value} onChange={(e) => onChange(e.target.value)}>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (clause.field === "entityType") {
    return (
      <select aria-label="Filter value" value={clause.value} onChange={(e) => onChange(e.target.value)}>
        {ENTITY_TYPE_FILTER_VALUES.map((t) => (
          <option key={t} value={t}>
            {ENTITY_TYPE_FILTER_LABELS[t]}
          </option>
        ))}
      </select>
    );
  }
  if (clause.field === "tags") {
    if (!clauseValueUsesTodoPicker("tags", clause.operator)) {
      return (
        <input
          type="text"
          aria-label="Filter value"
          placeholder="Tag name prefix"
          value={clause.value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    return (
      <select aria-label="Filter value" value={clause.value} onChange={(e) => onChange(e.target.value)}>
        <option value="">None</option>
        {tags.map((t) => (
          <option key={t.id} value={String(t.id)}>
            {t.name}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type="text"
      aria-label="Filter value"
      placeholder="Value"
      value={clause.value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function draftFromFilter(filter: TodoListFilter): TodoListFilter {
  if (!isTodoFilterActive(filter)) {
    return { clauses: [newTodoFilterClause()], joins: [] };
  }
  return {
    clauses: filter.clauses.map((c) => ({ ...c })),
    joins: [...filter.joins],
  };
}

export function TodoListFilterBar({ filter, onApply, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TodoListFilter>(() => draftFromFilter(filter));
  const titleId = useId();
  const { tags, filterCtx } = useTodoListFilterLookups();
  const breadcrumb = formatTodoFilterBreadcrumb(filter, filterCtx);
  const active = isTodoFilterActive(filter);

  useEffect(() => {
    if (!open) return;
    setDraft(draftFromFilter(filter));
  }, [open, filter]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const updateClause = (index: number, patch: Partial<TodoFilterClause>) => {
    setDraft((prev) => ({
      ...prev,
      clauses: prev.clauses.map((c, i) => (i === index ? applyTodoClausePatch(c, patch) : c)),
    }));
  };

  const addClause = (join: TodoFilterJoin) => {
    setDraft((prev) => ({
      clauses: [...prev.clauses, newTodoFilterClause()],
      joins: [...prev.joins, join],
    }));
  };

  const removeClause = (index: number) => {
    setDraft((prev) => {
      if (prev.clauses.length <= 1) {
        return { clauses: [newTodoFilterClause()], joins: [] };
      }
      const clauses = prev.clauses.filter((_, i) => i !== index);
      const joins = prev.joins.filter((_, i) => {
        if (index === 0) return i !== 0;
        return i !== index - 1;
      });
      return { clauses, joins };
    });
  };

  const apply = () => {
    const cleaned: TodoListFilter = {
      clauses: draft.clauses.map((c) => ({ ...c })),
      joins: draft.joins.slice(0, Math.max(0, draft.clauses.length - 1)),
    };
    onApply(cleaned);
    setOpen(false);
  };

  const clear = () => {
    onClear();
    setDraft({ clauses: [newTodoFilterClause()], joins: [] });
    setOpen(false);
  };

  return (
    <>
      <div className="task-list-filter-bar">
        <div className="task-list-filter-bar__trail" title={breadcrumb || undefined}>
          {breadcrumb || null}
        </div>
        <button
          type="button"
          className={`btn ghost task-list-filter-bar__btn${active ? " task-list-filter-bar__btn--active" : ""}`}
          aria-label={active ? "Edit list filter" : "Filter list"}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <FilterIcon />
          <span>Filter</span>
        </button>
      </div>

      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <div
            className="modal task-list-filter-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id={titleId}>Filter</h2>
            <p className="muted task-list-filter-modal__hint">
              Match list items with field conditions. AND / OR combine lines left to right.
            </p>

            <div className="task-list-filter-modal__rows">
              {draft.clauses.map((clause, index) => {
                const fieldOptions = TODO_FILTER_FIELDS.includes(clause.field)
                  ? TODO_FILTER_FIELDS
                  : [...TODO_FILTER_FIELDS, clause.field];
                return (
                  <div key={index} className="task-list-filter-modal__row">
                    {index > 0 ? (
                      <span className="task-list-filter-modal__join-label">
                        {TODO_FILTER_JOIN_LABELS[draft.joins[index - 1] ?? "and"]}
                      </span>
                    ) : (
                      <span className="task-list-filter-modal__join-label task-list-filter-modal__join-label--spacer" />
                    )}
                    <select
                      aria-label="Field"
                      value={clause.field}
                      onChange={(e) =>
                        updateClause(index, { field: e.target.value as TodoFilterField })
                      }
                    >
                      {fieldOptions.map((f) => (
                        <option key={f} value={f}>
                          {TODO_FILTER_FIELD_LABELS[f]}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Operator"
                      value={clause.operator}
                      onChange={(e) =>
                        updateClause(index, { operator: e.target.value as TodoFilterOperator })
                      }
                    >
                      {(operatorsForTodoField(clause.field).includes(clause.operator)
                        ? operatorsForTodoField(clause.field)
                        : [...operatorsForTodoField(clause.field), clause.operator]
                      ).map((op) => (
                        <option key={op} value={op}>
                          {TODO_FILTER_OPERATOR_LABELS[op]}
                        </option>
                      ))}
                    </select>
                    <TodoFilterClauseValueInput
                      clause={clause}
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
                );
              })}
            </div>

            <div className="btn-row task-list-filter-modal__add">
              <button type="button" className="btn ghost" onClick={() => addClause("and")}>
                AND
              </button>
              <button type="button" className="btn ghost" onClick={() => addClause("or")}>
                OR
              </button>
            </div>

            <div className="modal-actions task-list-filter-modal__actions">
              <button type="button" className="btn ghost" onClick={clear}>
                Clear filter
              </button>
              <div className="task-list-filter-modal__actions-right">
                <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="btn primary" onClick={apply}>
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
