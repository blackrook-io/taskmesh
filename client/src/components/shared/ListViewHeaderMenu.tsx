import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ListViewHeaderMenuState = { x: number; y: number } | null;

type Props = {
  menu: ListViewHeaderMenuState;
  onClose: () => void;
  onPersonalize: () => void;
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

export function ListViewHeaderMenu({ menu, onClose, onPersonalize }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos(clampPosition(menu.x, menu.y, rect.width, rect.height));
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return createPortal(
    <div
      ref={ref}
      className="task-list-ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
    >
      <ul className="task-list-ctx-menu__list" role="menu">
        <li className="task-list-ctx-menu__item" role="menuitem">
          <button
            type="button"
            className="task-list-ctx-menu__btn"
            onClick={() => {
              onPersonalize();
              onClose();
            }}
          >
            Personalize…
          </button>
        </li>
      </ul>
    </div>,
    document.body,
  );
}
