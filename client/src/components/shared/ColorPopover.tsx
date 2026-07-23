import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { DEFAULT_COLOR_PALETTE } from "../../lib/palette";

type Props = {
  color: string | null;
  onChange: (color: string | null) => void;
  /** Anchor element; if omitted, renders a swatch button that opens the popover. */
  children?: ReactNode;
  allowClear?: boolean;
  className?: string;
  label?: string;
};

export function ColorPopover({
  color,
  onChange,
  children,
  allowClear = true,
  className,
  label = "Color",
}: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(color ?? "");
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    setCustom(color ?? "");
  }, [color]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openAt = (e?: ReactMouseEvent) => {
    e?.preventDefault();
    setOpen(true);
  };

  return (
    <div className={`color-popover-root${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button
        type="button"
        className="color-popover-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        title={`${label} (right-click also opens)`}
        onClick={() => setOpen((v) => !v)}
        onContextMenu={openAt}
        style={
          {
            "--swatch": color?.trim() || "var(--border)",
          } as CSSProperties
        }
      >
        {children ?? <span className="color-popover-swatch" />}
      </button>
      {open ? (
        <div className="color-popover-panel" id={panelId} role="dialog" aria-label={label}>
          <div className="color-popover-grid">
            {DEFAULT_COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-popover-cell${color === c ? " selected" : ""}`}
                style={{ background: c }}
                title={c}
                aria-label={c}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <div className="color-popover-custom">
            <label htmlFor={`${panelId}-hex`}>Custom</label>
            <input
              id={`${panelId}-hex`}
              type="text"
              value={custom}
              placeholder="#7dd87d"
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = custom.trim();
                  onChange(v || null);
                  setOpen(false);
                }
              }}
            />
            <button
              type="button"
              className="btn small"
              onClick={() => {
                const v = custom.trim();
                onChange(v || null);
                setOpen(false);
              }}
            >
              Apply
            </button>
          </div>
          {allowClear ? (
            <button
              type="button"
              className="btn small ghost"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Clear color
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
