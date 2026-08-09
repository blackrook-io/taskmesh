import { useEffect, useId, useState } from "react";
import {
  FILTER_FIELDS,
  FILTER_FIELD_LABELS,
  FILTER_JOIN_LABELS,
  FILTER_OPERATORS,
  FILTER_OPERATOR_LABELS,
  formatFilterBreadcrumb,
  isFilterActive,
  newFilterClause,
  type FilterClause,
  type FilterField,
  type FilterJoin,
  type FilterOperator,
  type TaskListFilter,
} from "../lib/taskListFilter";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATE_LABELS,
  SELECTABLE_TASK_STATES,
} from "../lib/taskFields";

type Props = {
  filter: TaskListFilter;
  onApply: (filter: TaskListFilter) => void;
  onClear: () => void;
};

function defaultValueForField(field: FilterField): string {
  if (field === "state") return "new";
  if (field === "priority") return "none";
  return "";
}

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M2 3.5h12l-4.2 5.1v3.4L6.2 13V8.6L2 3.5zm1.7.9 3.3 4v2.8l1.6-.9V8.4l3.3-4H3.7z"
      />
    </svg>
  );
}

function ValueInput({
  clause,
  onChange,
}: {
  clause: FilterClause;
  onChange: (value: string) => void;
}) {
  if (clause.field === "state") {
    return (
      <select
        aria-label="Filter value"
        value={clause.value}
        onChange={(e) => onChange(e.target.value)}
      >
        {SELECTABLE_TASK_STATES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATE_LABELS[s]}
          </option>
        ))}
      </select>
    );
  }
  if (clause.field === "priority") {
    return (
      <select
        aria-label="Filter value"
        value={clause.value}
        onChange={(e) => onChange(e.target.value)}
      >
        {TASK_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {TASK_PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type="text"
      aria-label="Filter value"
      placeholder={clause.field === "number" ? "T0053 or 53" : "Value"}
      value={clause.value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function draftFromFilter(filter: TaskListFilter): TaskListFilter {
  if (!isFilterActive(filter)) {
    return { clauses: [newFilterClause()], joins: [] };
  }
  return {
    clauses: filter.clauses.map((c) => ({ ...c })),
    joins: [...filter.joins],
  };
}

export function TaskListFilterBar({ filter, onApply, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TaskListFilter>(() => draftFromFilter(filter));
  const titleId = useId();
  const breadcrumb = formatFilterBreadcrumb(filter);
  const active = isFilterActive(filter);

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

  const updateClause = (index: number, patch: Partial<FilterClause>) => {
    setDraft((prev) => {
      const clauses = prev.clauses.map((c, i) => {
        if (i !== index) return c;
        const next = { ...c, ...patch };
        if (patch.field && patch.field !== c.field) {
          next.value = defaultValueForField(patch.field);
          if (
            (patch.field === "state" || patch.field === "priority") &&
            (next.operator === "contains" || next.operator === "starts_with")
          ) {
            /* keep operator; value reset above */
          }
        }
        return next;
      });
      return { ...prev, clauses };
    });
  };

  const addClause = (join: FilterJoin) => {
    setDraft((prev) => ({
      clauses: [...prev.clauses, newFilterClause()],
      joins: [...prev.joins, join],
    }));
  };

  const removeClause = (index: number) => {
    setDraft((prev) => {
      if (prev.clauses.length <= 1) {
        return { clauses: [newFilterClause()], joins: [] };
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
    const cleaned: TaskListFilter = {
      clauses: draft.clauses.map((c) => ({
        ...c,
        value: c.field === "title" || c.field === "number" ? c.value : c.value,
      })),
      joins: draft.joins.slice(0, Math.max(0, draft.clauses.length - 1)),
    };
    onApply(cleaned);
    setOpen(false);
  };

  const clear = () => {
    onClear();
    setDraft({ clauses: [newFilterClause()], joins: [] });
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
              Match tasks with field conditions. AND / OR combine lines left to right.
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
                    {FILTER_FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {FILTER_FIELD_LABELS[f]}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Operator"
                    value={clause.operator}
                    onChange={(e) =>
                      updateClause(index, { operator: e.target.value as FilterOperator })
                    }
                  >
                    {FILTER_OPERATORS.map((op) => (
                      <option key={op} value={op}>
                        {FILTER_OPERATOR_LABELS[op]}
                      </option>
                    ))}
                  </select>
                  <ValueInput
                    clause={clause}
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
