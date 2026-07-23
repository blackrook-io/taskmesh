import type { Editor, TLDefaultColorStyle } from "tldraw";
import { DefaultColorStyle, DefaultFillStyle } from "tldraw";
import { ColorPopover } from "./shared/ColorPopover";

const PREFS_KEY = "taskmesh.canvas.layout";

export type CanvasLayoutPrefs = {
  snap: boolean;
  grid: boolean;
};

const DEFAULT_PREFS: CanvasLayoutPrefs = { snap: true, grid: true };

/** Map platform palette hex → nearest tldraw named color. */
const HEX_TO_TLDRAW: Record<string, TLDefaultColorStyle> = {
  "#7dd87d": "light-green",
  "#4a9d4f": "green",
  "#5ec8d8": "light-blue",
  "#3b82f6": "blue",
  "#818cf8": "light-violet",
  "#a78bfa": "violet",
  "#e879f9": "violet",
  "#f472b6": "light-red",
  "#fb7185": "light-red",
  "#e57373": "red",
  "#fb923c": "orange",
  "#fbbf24": "yellow",
  "#a3e635": "light-green",
  "#94a3b8": "grey",
  "#e2e8f0": "grey",
  "#1e1f24": "black",
};

export function loadCanvasLayoutPrefs(): CanvasLayoutPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<CanvasLayoutPrefs>;
    return {
      snap: parsed.snap ?? DEFAULT_PREFS.snap,
      grid: parsed.grid ?? DEFAULT_PREFS.grid,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveCanvasLayoutPrefs(prefs: CanvasLayoutPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function applyCanvasLayoutPrefs(editor: Editor, prefs: CanvasLayoutPrefs) {
  editor.user.updateUserPreferences({ colorScheme: "dark", isSnapMode: prefs.snap });
  editor.updateInstanceState({
    isGridMode: prefs.grid,
  });
}

function hexToTldrawColor(hex: string | null): TLDefaultColorStyle | null {
  if (!hex) return null;
  const key = hex.trim().toLowerCase();
  if (HEX_TO_TLDRAW[key]) return HEX_TO_TLDRAW[key];
  // nearest by simple RGB distance against known palette keys
  const target = parseHex(key);
  if (!target) return "green";
  let best: TLDefaultColorStyle = "green";
  let bestDist = Infinity;
  for (const [h, name] of Object.entries(HEX_TO_TLDRAW)) {
    const c = parseHex(h);
    if (!c) continue;
    const d = (c.r - target.r) ** 2 + (c.g - target.g) ** 2 + (c.b - target.b) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

type Props = {
  editor: Editor | null;
  prefs: CanvasLayoutPrefs;
  onPrefsChange: (prefs: CanvasLayoutPrefs) => void;
  disabled?: boolean;
  /** Bumps when selection changes so enable/disable updates. */
  selectionTick?: number;
};

function AssistBtn({
  label,
  title,
  active,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`btn small canvas-assist__btn${active ? " is-active" : ""}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function CanvasLayoutBar({
  editor,
  prefs,
  onPrefsChange,
  disabled,
  selectionTick: _selectionTick = 0,
}: Props) {
  const selectedCount = editor?.getSelectedShapeIds().length ?? 0;
  const multi = selectedCount >= 2;
  const anySelected = selectedCount >= 1;

  const setPrefs = (patch: Partial<CanvasLayoutPrefs>) => {
    const next = { ...prefs, ...patch };
    onPrefsChange(next);
    if (editor) applyCanvasLayoutPrefs(editor, next);
  };

  const run = (fn: (ed: Editor) => void) => {
    if (!editor || disabled) return;
    fn(editor);
  };

  return (
    <div className="canvas-assist" role="toolbar" aria-label="Canvas layout assists">
      <div className="canvas-assist__group">
        <AssistBtn
          label="Snap"
          title="Snap to shapes and gaps"
          active={prefs.snap}
          disabled={disabled}
          onClick={() => setPrefs({ snap: !prefs.snap })}
        />
        <AssistBtn
          label="Grid"
          title="Show grid"
          active={prefs.grid}
          disabled={disabled}
          onClick={() => setPrefs({ grid: !prefs.grid })}
        />
      </div>

      <div className="canvas-assist__group" title="Align selection">
        <AssistBtn
          label="⟸"
          title="Align left"
          disabled={disabled || !multi}
          onClick={() => run((ed) => ed.alignShapes(ed.getSelectedShapeIds(), "left"))}
        />
        <AssistBtn
          label="⇔"
          title="Align center horizontal"
          disabled={disabled || !multi}
          onClick={() => run((ed) => ed.alignShapes(ed.getSelectedShapeIds(), "center-horizontal"))}
        />
        <AssistBtn
          label="⟹"
          title="Align right"
          disabled={disabled || !multi}
          onClick={() => run((ed) => ed.alignShapes(ed.getSelectedShapeIds(), "right"))}
        />
        <AssistBtn
          label="⤒"
          title="Align top"
          disabled={disabled || !multi}
          onClick={() => run((ed) => ed.alignShapes(ed.getSelectedShapeIds(), "top"))}
        />
        <AssistBtn
          label="⇕"
          title="Align center vertical"
          disabled={disabled || !multi}
          onClick={() => run((ed) => ed.alignShapes(ed.getSelectedShapeIds(), "center-vertical"))}
        />
        <AssistBtn
          label="⤓"
          title="Align bottom"
          disabled={disabled || !multi}
          onClick={() => run((ed) => ed.alignShapes(ed.getSelectedShapeIds(), "bottom"))}
        />
      </div>

      <div className="canvas-assist__group">
        <AssistBtn
          label="Dist ↔"
          title="Distribute horizontally"
          disabled={disabled || selectedCount < 3}
          onClick={() => run((ed) => ed.distributeShapes(ed.getSelectedShapeIds(), "horizontal"))}
        />
        <AssistBtn
          label="Dist ↕"
          title="Distribute vertically"
          disabled={disabled || selectedCount < 3}
          onClick={() => run((ed) => ed.distributeShapes(ed.getSelectedShapeIds(), "vertical"))}
        />
        <AssistBtn
          label="Stack ↔"
          title="Stack horizontally"
          disabled={disabled || !multi}
          onClick={() => run((ed) => ed.stackShapes(ed.getSelectedShapeIds(), "horizontal", 16))}
        />
        <AssistBtn
          label="Stack ↕"
          title="Stack vertically"
          disabled={disabled || !multi}
          onClick={() => run((ed) => ed.stackShapes(ed.getSelectedShapeIds(), "vertical", 16))}
        />
        <AssistBtn
          label="Pack"
          title="Pack selection tightly"
          disabled={disabled || !multi}
          onClick={() => run((ed) => ed.packShapes(ed.getSelectedShapeIds(), 16))}
        />
      </div>

      <div
        className={`canvas-assist__group canvas-assist__color${!anySelected || disabled ? " is-disabled" : ""}`}
      >
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          Fill
        </span>
        <ColorPopover
          color={null}
          label="Shape fill"
          openOn="click"
          allowClear={false}
          onChange={(hex) => {
            if (!anySelected || disabled) return;
            const named = hexToTldrawColor(hex);
            if (!named || !editor) return;
            editor.setStyleForSelectedShapes(DefaultColorStyle, named);
            editor.setStyleForSelectedShapes(DefaultFillStyle, "solid");
            editor.setStyleForNextShapes(DefaultColorStyle, named);
          }}
        />
      </div>
    </div>
  );
}
