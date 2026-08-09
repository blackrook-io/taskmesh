import type { ReactNode } from "react";

/** Compact double-caret used for active column sort direction. */
function DoubleCaretIcon({ ascending }: { ascending: boolean }) {
  return (
    <svg
      className={`task-list-header__sort-icon${ascending ? "" : " task-list-header__sort-icon--desc"}`}
      width={10}
      height={12}
      viewBox="0 0 10 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1.5 5 L5 1.5 L8.5 5" />
      <path d="M1.5 10 L5 6.5 L8.5 10" />
    </svg>
  );
}

type Props = {
  children: ReactNode;
  /** Whether this column is the active sort key. */
  sorted: boolean;
  /** `1` ascending, `-1` descending. */
  dir: 1 | -1;
  onClick?: () => void;
  onDoubleClick?: () => void;
};

/** Sortable task-list column header with accent double-caret when active. */
export function TaskListSortHeaderBtn({ children, sorted, dir, onClick, onDoubleClick }: Props) {
  const ariaSort = !sorted ? "none" : dir === 1 ? "ascending" : "descending";
  return (
    <button
      type="button"
      role="columnheader"
      className={`task-list-header__btn${sorted ? " task-list-header__btn--sorted" : ""}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-sort={ariaSort}
    >
      <span className="task-list-header__label">{children}</span>
      {sorted ? <DoubleCaretIcon ascending={dir === 1} /> : null}
    </button>
  );
}
