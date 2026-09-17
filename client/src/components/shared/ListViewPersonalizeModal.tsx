import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState } from "react";
import type { ResolvedListColumn } from "../../lib/listViewColumns";

type Props = {
  open: boolean;
  title?: string;
  rows: ResolvedListColumn[];
  saving?: boolean;
  resetting?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (columns: { fieldKey: string; visible: boolean }[]) => void;
  onReset: () => void;
};

function SortableColumnRow({
  row,
  onToggle,
}: {
  row: ResolvedListColumn;
  onToggle: (visible: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.fieldKey,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`list-view-personalize__row${isDragging ? " dragging" : ""}`}
    >
      <span className="task-drag-handle" {...attributes} {...listeners} title="Drag to reorder">
        ::
      </span>
      <label className="list-view-personalize__label">
        <input
          type="checkbox"
          checked={row.visible}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span>{row.label}</span>
        {row.scope === "global" ? (
          <span className="muted list-view-personalize__scope">Global lists only</span>
        ) : null}
      </label>
    </li>
  );
}

export function ListViewPersonalizeModal({
  open,
  title = "Personalize list",
  rows,
  saving = false,
  resetting = false,
  error = null,
  onClose,
  onSave,
  onReset,
}: Props) {
  const [draft, setDraft] = useState<ResolvedListColumn[]>(rows);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (open) setDraft(rows);
  }, [open, rows]);

  if (!open) return null;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraft((prev) => {
      const oldIndex = prev.findIndex((r) => r.fieldKey === active.id);
      const newIndex = prev.findIndex((r) => r.fieldKey === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal list-view-personalize-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="list-view-personalize-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="list-view-personalize-title">{title}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Choose which columns appear and drag to reorder. Layout is saved for your account on
          every list of this type.
        </p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={draft.map((r) => r.fieldKey)} strategy={verticalListSortingStrategy}>
            <ul className="list-view-personalize__list">
              {draft.map((row) => (
                <SortableColumnRow
                  key={row.fieldKey}
                  row={row}
                  onToggle={(visible) =>
                    setDraft((prev) =>
                      prev.map((r) => (r.fieldKey === row.fieldKey ? { ...r, visible } : r)),
                    )
                  }
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        {error ? (
          <p className="confirm-dialog__warning" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button
            type="button"
            className="btn ghost"
            disabled={saving || resetting}
            onClick={onReset}
          >
            Reset to defaults
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" disabled={saving || resetting} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={saving || resetting}
            onClick={() =>
              onSave(draft.map((r) => ({ fieldKey: r.fieldKey, visible: r.visible })))
            }
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
