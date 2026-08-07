import { useEffect, useRef, useState } from "react";
import type { ImageBoardText } from "../../lib/imageBoardDocument";

type Props = {
  text: ImageBoardText;
  onChange: (patch: Partial<ImageBoardText>) => void;
};

export function TextToolbar({ text, onChange }: Props) {
  const [color, setColor] = useState(text.color);

  useEffect(() => {
    setColor(text.color);
  }, [text.color]);

  return (
    <div className="ib-text-toolbar" role="toolbar" aria-label="Text formatting">
      <label className="ib-text-toolbar__field">
        Size
        <input
          type="number"
          min={8}
          max={96}
          value={text.fontSize}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) || 16 })}
        />
      </label>
      <label className="ib-text-toolbar__field">
        Color
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#d4e8d4"}
          onChange={(e) => {
            setColor(e.target.value);
            onChange({ color: e.target.value });
          }}
        />
      </label>
      <div className="ib-text-toolbar__group">
        {(["left", "center", "right"] as const).map((align) => (
          <button
            key={align}
            type="button"
            className={`btn small ${text.align === align ? "primary" : "ghost"}`}
            onClick={() => onChange({ align })}
          >
            {align[0]!.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="ib-text-toolbar__group">
        <button
          type="button"
          className={`btn small ${text.bold ? "primary" : "ghost"}`}
          onClick={() => onChange({ bold: !text.bold })}
        >
          B
        </button>
        <button
          type="button"
          className={`btn small ${text.italic ? "primary" : "ghost"}`}
          onClick={() => onChange({ italic: !text.italic })}
        >
          I
        </button>
        <button
          type="button"
          className={`btn small ${text.underline ? "primary" : "ghost"}`}
          onClick={() => onChange({ underline: !text.underline })}
        >
          U
        </button>
      </div>
      <div className="ib-text-toolbar__group">
        <button
          type="button"
          className={`btn small ${text.list === "ul" ? "primary" : "ghost"}`}
          onClick={() => onChange({ list: text.list === "ul" ? null : "ul" })}
        >
          • List
        </button>
        <button
          type="button"
          className={`btn small ${text.list === "ol" ? "primary" : "ghost"}`}
          onClick={() => onChange({ list: text.list === "ol" ? null : "ol" })}
        >
          1. List
        </button>
      </div>
    </div>
  );
}

type BoxMenuProps = {
  x: number;
  y: number;
  title: string;
  color: string;
  onSave: (title: string, color: string) => void;
  onClose: () => void;
};

export function BoxContextMenu({ x, y, title, color, onSave, onClose }: BoxMenuProps) {
  const [localTitle, setLocalTitle] = useState(title);
  const [localColor, setLocalColor] = useState(color);
  const [alpha, setAlpha] = useState(() => parseAlpha(color));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const hex = toHex(localColor);

  return (
    <div
      ref={rootRef}
      className="ib-box-menu"
      style={{ left: x, top: y }}
      role="dialog"
      aria-label="Box settings"
    >
      <label>
        Title
        <input
          className="input"
          value={localTitle}
          onChange={(e) => setLocalTitle(e.target.value)}
          autoFocus
        />
      </label>
      <label>
        Color
        <input
          type="color"
          value={hex}
          onChange={(e) => setLocalColor(withAlpha(e.target.value, alpha))}
        />
      </label>
      <label>
        Opacity
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={alpha}
          onChange={(e) => {
            const a = Number(e.target.value);
            setAlpha(a);
            setLocalColor(withAlpha(hex, a));
          }}
        />
      </label>
      <div className="btn-row">
        <button
          type="button"
          className="btn small primary"
          onClick={() => onSave(localTitle.trim(), withAlpha(hex, alpha))}
        >
          Save
        </button>
        <button type="button" className="btn small ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function parseAlpha(color: string): number {
  const m = color.match(/rgba?\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/);
  if (m) return Math.min(1, Math.max(0, Number(m[1])));
  return 0.35;
}

function toHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return "#50785a";
  const r = Number(m[1]).toString(16).padStart(2, "0");
  const g = Number(m[2]).toString(16).padStart(2, "0");
  const b = Number(m[3]).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function withAlpha(hex: string, alpha: number): string {
  const h = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#50785a";
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
