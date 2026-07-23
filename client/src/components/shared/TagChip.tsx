import type { CSSProperties, MouseEvent } from "react";
import { ColorPopover } from "./ColorPopover";
import type { Tag } from "../../types";

type Props = {
  tag: Pick<Tag, "id" | "name" | "color">;
  onRemove?: () => void;
  onColorChange?: (color: string | null) => void;
  /** When true, chip links visually as removable on hover. */
  removable?: boolean;
  className?: string;
};

function contrastText(bg: string | null | undefined): string {
  if (!bg?.trim()) return "var(--text)";
  const hex = bg.trim().replace("#", "");
  if (hex.length !== 6 && hex.length !== 3) return "#0f140f";
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#0f140f" : "#f0f2f5";
}

export function TagChip({
  tag,
  onRemove,
  onColorChange,
  removable = Boolean(onRemove),
  className,
}: Props) {
  const bg = tag.color?.trim() || undefined;
  const style: CSSProperties = bg
    ? {
        background: bg,
        borderColor: "transparent",
        color: contrastText(bg),
      }
    : {};

  const chip = (
    <span
      className={`tag-chip${removable ? " tag-chip--removable" : ""}${className ? ` ${className}` : ""}`}
      style={style}
      title={onColorChange ? "Right-click to change color" : tag.name}
    >
      <span className="tag-chip__name">{tag.name}</span>
      {removable && onRemove ? (
        <button
          type="button"
          className="tag-chip__remove"
          aria-label={`Remove tag ${tag.name}`}
          onClick={(e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      ) : null}
    </span>
  );

  if (!onColorChange) return chip;

  return (
    <ColorPopover
      color={tag.color}
      onChange={onColorChange}
      openOn="contextmenu"
      allowClear
      label={`Color for ${tag.name}`}
      className="tag-chip-color"
    >
      {chip}
    </ColorPopover>
  );
}
