import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type TaskListCtxField = "state" | "priority" | "dueDate";

export type TaskListContextMenuState = {
  x: number;
  y: number;
  taskId: number;
  /** Column/cell that was right-clicked, when known. */
  field: TaskListCtxField | null;
};

type MenuItem =
  | { type: "action"; label: string; disabled?: boolean; onSelect: () => void }
  | { type: "submenu"; label: string; disabled?: boolean; children: MenuItem[] }
  | { type: "separator" };

type Props = {
  menu: TaskListContextMenuState | null;
  onClose: () => void;
  items: MenuItem[];
};

const MENU_PAD = 8;

function clampPosition(x: number, y: number, width: number, height: number) {
  const maxX = window.innerWidth - width - MENU_PAD;
  const maxY = window.innerHeight - height - MENU_PAD;
  return {
    left: Math.max(MENU_PAD, Math.min(x, maxX)),
    top: Math.max(MENU_PAD, Math.min(y, maxY)),
  };
}

function MenuList({
  items,
  onClose,
  nested,
}: {
  items: MenuItem[];
  onClose: () => void;
  nested?: boolean;
}) {
  const [openSub, setOpenSub] = useState<number | null>(null);

  return (
    <ul
      className={`task-list-ctx-menu__list${nested ? " task-list-ctx-menu__list--nested" : ""}`}
      role="menu"
    >
      {items.map((item, i) => {
        if (item.type === "separator") {
          return <li key={`sep-${i}`} className="task-list-ctx-menu__sep" role="separator" />;
        }
        if (item.type === "submenu") {
          return (
            <li
              key={`sub-${i}`}
              className={`task-list-ctx-menu__item task-list-ctx-menu__item--submenu${
                item.disabled ? " is-disabled" : ""
              }`}
              role="menuitem"
              aria-haspopup="true"
              aria-expanded={openSub === i}
              onMouseEnter={() => {
                if (!item.disabled) setOpenSub(i);
              }}
              onMouseLeave={() => setOpenSub(null)}
            >
              <button
                type="button"
                className="task-list-ctx-menu__btn"
                disabled={item.disabled}
                onClick={(e) => {
                  e.preventDefault();
                  if (!item.disabled) setOpenSub((v) => (v === i ? null : i));
                }}
              >
                <span>{item.label}</span>
                <span className="task-list-ctx-menu__chevron" aria-hidden>
                  ▸
                </span>
              </button>
              {openSub === i && !item.disabled ? (
                <div className="task-list-ctx-menu__flyout">
                  <MenuList items={item.children} onClose={onClose} nested />
                </div>
              ) : null}
            </li>
          );
        }
        return (
          <li
            key={`act-${i}`}
            className={`task-list-ctx-menu__item${item.disabled ? " is-disabled" : ""}`}
            role="none"
          >
            <button
              type="button"
              className="task-list-ctx-menu__btn"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                item.onSelect();
                onClose();
              }}
            >
              {item.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function TaskListContextMenu({ menu, onClose, items }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!menu || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    setPos(clampPosition(menu.x, menu.y, rect.width, rect.height));
  }, [menu, items]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return createPortal(
    <div
      ref={rootRef}
      className="task-list-ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      role="presentation"
    >
      <MenuList items={items} onClose={onClose} />
    </div>,
    document.body,
  );
}

export function ctxFieldFromEventTarget(target: EventTarget | null): TaskListCtxField | null {
  const el = target instanceof Element ? target.closest("[data-ctx-field]") : null;
  const raw = el?.getAttribute("data-ctx-field");
  if (raw === "state" || raw === "priority" || raw === "dueDate") return raw;
  return null;
}

export function buildCreateGroupMenuItems(opts: {
  field: TaskListCtxField | null;
  stateLabel: string;
  priorityLabel: string;
  dueLabel: string | null;
  onCreate: (field: TaskListCtxField, operator: "is" | "is_not" | "before" | "after") => void;
}): MenuItem[] {
  const { field, stateLabel, priorityLabel, dueLabel, onCreate } = opts;

  const stateItems: MenuItem[] = [
    {
      type: "action",
      label: `IS ${stateLabel}`,
      onSelect: () => onCreate("state", "is"),
    },
    {
      type: "action",
      label: `IS NOT ${stateLabel}`,
      onSelect: () => onCreate("state", "is_not"),
    },
  ];
  const priorityItems: MenuItem[] = [
    {
      type: "action",
      label: `IS ${priorityLabel}`,
      onSelect: () => onCreate("priority", "is"),
    },
    {
      type: "action",
      label: `IS NOT ${priorityLabel}`,
      onSelect: () => onCreate("priority", "is_not"),
    },
  ];
  const dateItems: MenuItem[] = [
    {
      type: "action",
      label: dueLabel ? `Before ${dueLabel}` : "Before (no due date)",
      disabled: !dueLabel,
      onSelect: () => onCreate("dueDate", "before"),
    },
    {
      type: "action",
      label: dueLabel ? `After ${dueLabel}` : "After (no due date)",
      disabled: !dueLabel,
      onSelect: () => onCreate("dueDate", "after"),
    },
  ];

  if (field === "state") return stateItems;
  if (field === "priority") return priorityItems;
  if (field === "dueDate") return dateItems;

  return [
    { type: "submenu", label: "State", children: stateItems },
    { type: "submenu", label: "Priority", children: priorityItems },
    { type: "submenu", label: "Due date", children: dateItems, disabled: !dueLabel },
  ];
}

export type TaskListContextMenuItem = MenuItem;
