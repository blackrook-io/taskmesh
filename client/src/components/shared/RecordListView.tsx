import type { MouseEvent, ReactNode } from "react";
import type { ResolvedListColumn } from "../../lib/listViewColumns";
import { TaskListSortHeaderBtn } from "./TaskListSortHeaderBtn";

type HeaderProps = {
  gridTemplate: string;
  columns: ResolvedListColumn[];
  sortCol: string | null;
  sortDir: 1 | -1;
  onCycleSort: (fieldKey: string) => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  /** Fixed chrome before the personalizable columns (drag handle, checkbox). */
  before?: ReactNode;
  /** Fixed chrome after the columns (row actions). */
  after?: ReactNode;
};

/** Column header for a reusable record list. Right-click opens Personalize. */
export function RecordListHeader({
  gridTemplate,
  columns,
  sortCol,
  sortDir,
  onCycleSort,
  onContextMenu,
  before,
  after,
}: HeaderProps) {
  return (
    <div
      className="task-list-header record-list-header"
      style={{ gridTemplateColumns: gridTemplate }}
      onContextMenu={onContextMenu}
    >
      {before}
      {columns.map((col) =>
        col.sortable ? (
          <TaskListSortHeaderBtn
            key={col.fieldKey}
            sorted={sortCol === col.fieldKey}
            dir={sortDir}
            onClick={() => onCycleSort(col.fieldKey)}
          >
            {col.label}
          </TaskListSortHeaderBtn>
        ) : (
          <span key={col.fieldKey}>{col.label}</span>
        ),
      )}
      {after}
    </div>
  );
}

type ModeBarProps = {
  columnSortActive: boolean;
  onManualOrder: () => void;
  /** Shown when drag is unavailable for a reason other than column sort (for example an active filter). */
  dragNote?: string | null;
};

/** Manual-order control and short notes when drag reorder is off. */
export function RecordListModeBar({ columnSortActive, onManualOrder, dragNote }: ModeBarProps) {
  if (!columnSortActive && !dragNote) return null;
  return (
    <div className="record-list__mode">
      {columnSortActive ? (
        <button type="button" className="btn small ghost" onClick={onManualOrder}>
          Manual order
        </button>
      ) : null}
      {columnSortActive ? (
        <span className="muted">Column sort is on. Drag stays off until you return to manual order.</span>
      ) : null}
      {dragNote ? <span className="muted">{dragNote}</span> : null}
    </div>
  );
}
