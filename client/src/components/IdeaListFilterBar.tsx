import { useId, useState } from "react";
import { FilterIcon } from "./TaskListFilterBar";
import {
  IDEA_FILTER_FIELD_LABELS,
  IDEA_FILTER_FIELDS,
  IDEA_FILTER_JOIN_LABELS,
  IDEA_FILTER_OPERATOR_LABELS,
  applyIdeaClausePatch,
  formatIdeaFilterBreadcrumb,
  isIdeaFilterActive,
  newIdeaFilterClause,
  operatorsForIdeaField,
  type IdeaFilterAssigneeOption,
  type IdeaFilterClause,
  type IdeaFilterField,
  type IdeaFilterJoin,
  type IdeaFilterOperator,
  type IdeaFilterTagOption,
  type IdeaListFilter,
} from "../lib/ideaListFilter";

type Props = {
  filter: IdeaListFilter;
  tags: IdeaFilterTagOption[];
  assignees: IdeaFilterAssigneeOption[];
  onApply: (filter: IdeaListFilter) => void;
  onClear: () => void;
};

function draftFromFilter(filter: IdeaListFilter): IdeaListFilter {
  if (filter.clauses.length === 0) return { clauses: [newIdeaFilterClause()], joins: [] };
  return {
    clauses: filter.clauses.map((c) => ({ ...c })),
    joins: [...filter.joins],
  };
}

function IdeaFilterValueInput({
  clause,
  tags,
  assignees,
  onChange,
}: {
  clause: IdeaFilterClause;
  tags: IdeaFilterTagOption[];
  assignees: IdeaFilterAssigneeOption[];
  onChange: (value: string) => void;
}) {
  if (clause.operator === "is_empty" || clause.operator === "is_not_empty") {
    return <span className="muted" aria-hidden />;
  }
  if (clause.field === "createdAt" || clause.field === "updatedAt") {
    return (
      <input
        type="date"
        aria-label="Filter value"
        value={clause.value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (clause.field === "tags" && (clause.operator === "contains" || clause.operator === "does_not_contain")) {
    return (
      <select aria-label="Filter value" value={clause.value} onChange={(e) => onChange(e.target.value)}>
        <option value="none">None</option>
        {tags.map((t) => (
          <option key={t.id} value={String(t.id)}>
            {t.name}
          </option>
        ))}
      </select>
    );
  }
  if (clause.field === "assignee" && (clause.operator === "is" || clause.operator === "is_not")) {
    return (
      <select aria-label="Filter value" value={clause.value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select assignee</option>
        {assignees.map((a) => (
          <option key={a.id} value={String(a.id)}>
            {a.displayName}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type="text"
      aria-label="Filter value"
      value={clause.value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function IdeaListFilterBar({ filter, tags, assignees, onApply, onClear }: Props) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<IdeaListFilter>(() => draftFromFilter(filter));
  const active = isIdeaFilterActive(filter);
  const breadcrumb = formatIdeaFilterBreadcrumb(filter, tags, assignees);

  const updateClause = (index: number, patch: Partial<IdeaFilterClause>) => {
    setDraft((prev) => ({
      ...prev,
      clauses: prev.clauses.map((c, i) => (i === index ? applyIdeaClausePatch(c, patch) : c)),
    }));
  };

  const addClause = (join: IdeaFilterJoin) => {
    setDraft((prev) => {
      if (prev.clauses.length === 0) return { clauses: [newIdeaFilterClause()], joins: [] };
      return {
        clauses: [...prev.clauses, newIdeaFilterClause()],
        joins: [...prev.joins, join],
      };
    });
  };

  const removeClause = (index: number) => {
    setDraft((prev) => {
      const clauses = prev.clauses.filter((_, i) => i !== index);
      if (clauses.length === 0) return { clauses: [newIdeaFilterClause()], joins: [] };
      const joins = prev.joins.filter((_, i) => (index === 0 ? i !== 0 : i !== index - 1));
      return { clauses, joins };
    });
  };

  const apply = () => {
    onApply({
      clauses: draft.clauses.map((c) => ({ ...c })),
      joins: draft.joins.slice(0, Math.max(0, draft.clauses.length - 1)),
    });
    setOpen(false);
  };

  const clear = () => {
    onClear();
    setDraft({ clauses: [newIdeaFilterClause()], joins: [] });
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
          onClick={() => {
            setDraft(draftFromFilter(filter));
            setOpen(true);
          }}
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
            <h2 id={titleId}>Filter ideas</h2>
            <p className="muted task-list-filter-modal__hint">
              Match ideas with field conditions. AND / OR combine lines left to right.
            </p>
            <div className="task-list-filter-modal__rows">
              {draft.clauses.map((clause, index) => (
                <div key={index} className="task-list-filter-modal__row">
                  {index > 0 ? (
                    <span className="task-list-filter-modal__join-label">
                      {IDEA_FILTER_JOIN_LABELS[draft.joins[index - 1] ?? "and"]}
                    </span>
                  ) : (
                    <span className="task-list-filter-modal__join-label task-list-filter-modal__join-label--spacer" />
                  )}
                  <select
                    aria-label="Field"
                    value={clause.field}
                    onChange={(e) => updateClause(index, { field: e.target.value as IdeaFilterField })}
                  >
                    {IDEA_FILTER_FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {IDEA_FILTER_FIELD_LABELS[f]}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Operator"
                    value={clause.operator}
                    onChange={(e) => updateClause(index, { operator: e.target.value as IdeaFilterOperator })}
                  >
                    {operatorsForIdeaField(clause.field).map((op) => (
                      <option key={op} value={op}>
                        {IDEA_FILTER_OPERATOR_LABELS[op]}
                      </option>
                    ))}
                  </select>
                  <IdeaFilterValueInput
                    clause={clause}
                    tags={tags}
                    assignees={assignees}
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
