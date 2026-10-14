import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";
import type { EntityType } from "../../lib/entityType";
import {
  MESH_APPEARANCE_DEFAULTS,
  contrastBelowMinimum,
  isMeshHex,
  meshAppearanceStyle,
  normalizeMeshAppearance,
  type MeshAppearance,
} from "../../lib/meshAppearance";
import { ColorPopover } from "../shared/ColorPopover";
import { MeshShape } from "../MeshShape";

const TYPE_FIELDS: { key: EntityType; label: string }[] = [
  { key: "project", label: "Project" },
  { key: "todo_list", label: "ToDo List" },
  { key: "task", label: "Task" },
  { key: "todo", label: "ToDo" },
  { key: "document", label: "Document" },
  { key: "idea", label: "Idea" },
  { key: "board", label: "Board" },
  { key: "canvas", label: "Canvas" },
  { key: "wiki_node", label: "Wiki" },
  { key: "image_board", label: "Image board" },
];

const LINE_FIELDS: { key: keyof MeshAppearance["lines"]; label: string; css: string }[] = [
  { key: "tree", label: "Tree", css: "tree" },
  { key: "ref", label: "References", css: "ref" },
  { key: "dep", label: "Depends on (blocking)", css: "dep" },
  { key: "depDone", label: "Completed dependencies", css: "dep-done" },
  { key: "suggested", label: "Suggested", css: "suggested" },
];

function canvasBackground(): string {
  if (typeof document === "undefined") return "#1e1f24";
  const value = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  return isMeshHex(value) ? value.toLowerCase() : "#1e1f24";
}

function appearanceError(value: MeshAppearance): string | null {
  const colors = [
    ...TYPE_FIELDS.map((field) => value.types[field.key]),
    value.suggestion,
    value.depDone,
    value.signals.overdue,
    value.signals.risk,
    value.signals.stale,
  ];
  if (colors.some((color) => !isMeshHex(color))) return "Each color must be a #rrggbb value";
  for (const field of LINE_FIELDS) {
    const weight = value.lines[field.key];
    if (typeof weight !== "number" || weight < 0.5 || weight > 4) {
      return `${field.label} line weight must be from 0.5 to 4`;
    }
  }
  if (value.glyphScale < 0.75 || value.glyphScale > 1.5) {
    return "Glyph scale must be from 0.75 to 1.5";
  }
  if (value.labelSizeRem < 0.7 || value.labelSizeRem > 1.2) {
    return "Label size must be from 0.7 to 1.2 rem";
  }
  if (!Number.isInteger(value.badgePx) || value.badgePx < 8 || value.badgePx > 24) {
    return "Badge size must be an integer from 8 to 24";
  }
  if (!Number.isInteger(value.staleDays) || value.staleDays < 1 || value.staleDays > 365) {
    return "Stale threshold must be an integer from 1 to 365 days";
  }
  return null;
}

function ColorField({
  label,
  color,
  background,
  onChange,
}: {
  label: string;
  color: string;
  background: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="mesh-appearance-color">
      <ColorPopover
        color={color}
        allowClear={false}
        openOn="click"
        label={label}
        contrastAgainst={background}
        onChange={(next) => {
          if (next && isMeshHex(next)) onChange(next.toLowerCase());
        }}
      />
      <span>{label}</span>
      {contrastBelowMinimum(color, background) ? (
        <span className="mesh-appearance-contrast">Below 3:1</span>
      ) : null}
    </div>
  );
}

function MeshPreview({ appearance }: { appearance: MeshAppearance }) {
  return (
    <div
      className={
        appearance.labelHalo
          ? "mesh-appearance-preview"
          : "mesh-appearance-preview mesh-panel--no-halo"
      }
      style={meshAppearanceStyle(appearance)}
    >
      <div className="mesh-appearance-preview__nodes">
        <div className="mesh-node">
          <span className="mesh-mark">
            <span
              className={
                appearance.overduePulse
                  ? "mesh-ring mesh-ring--overdue mesh-ring--pulse"
                  : "mesh-ring mesh-ring--overdue"
              }
            />
            <MeshShape type="task" color="var(--mesh-type-task)" hollow={false} />
          </span>
          <span className="mesh-copy">
            <span className="mesh-title">Sample task</span>
            <span className="mesh-ref">T0001</span>
          </span>
        </div>
        <div className="mesh-node">
          <span className="mesh-mark">
            <span className="mesh-ring mesh-ring--risk" />
            <MeshShape type="idea" color="var(--mesh-type-idea)" hollow={false} />
            <svg className="mesh-stale" viewBox="0 0 12 12" aria-hidden>
              <circle cx="6" cy="6" r="5" />
              <path d="M6 3.4 V6.2 L8 7.3" />
            </svg>
          </span>
          <span className="mesh-copy">
            <span className="mesh-title">Sample idea</span>
            <span className="mesh-ref" style={{ fontSize: "var(--mesh-label-size-focus)" }}>
              Focus label
            </span>
          </span>
        </div>
      </div>
      <ul className="mesh-appearance-preview__lines">
        {LINE_FIELDS.map((field) => (
          <li key={field.key}>
            <svg width="72" height="14" aria-hidden>
              <line
                x1="0"
                y1="7"
                x2="72"
                y2="7"
                style={{
                  stroke:
                    field.key === "suggested"
                      ? "var(--mesh-rel-suggested)"
                      : field.key === "ref"
                        ? "var(--mesh-rel-ref)"
                        : field.key === "dep"
                          ? "var(--mesh-signal-overdue)"
                          : field.key === "depDone"
                            ? "var(--mesh-rel-dep-done)"
                            : "var(--mesh-rel-tree)",
                  strokeWidth: `var(--mesh-line-${field.css})`,
                  strokeDasharray:
                    field.key === "ref"
                      ? "5 4"
                      : field.key === "depDone"
                        ? "4 5"
                        : field.key === "suggested"
                          ? "1 5"
                          : undefined,
                  strokeLinecap: field.key === "suggested" ? "round" : undefined,
                }}
              />
            </svg>
            <span>{field.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminMeshPanel() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<MeshAppearance>(MESH_APPEARANCE_DEFAULTS);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const background = canvasBackground();

  const propsQuery = useQuery({
    queryKey: ["admin", "system-properties"],
    queryFn: async () => {
      const res = await apiJson<{ data: { meshAppearance?: unknown; updatedAt: string | null } }>(
        "/api/v1/admin/system-properties",
      );
      return res.data;
    },
  });

  const [prevData, setPrevData] = useState(propsQuery.data);
  if (propsQuery.data !== prevData) {
    setPrevData(propsQuery.data);
    if (propsQuery.data) setDraft(normalizeMeshAppearance(propsQuery.data.meshAppearance));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const message = appearanceError(draft);
      if (message) throw new Error(message);
      const res = await apiJson<{ data: { meshAppearance?: unknown } }>(
        "/api/v1/admin/system-properties",
        {
          method: "PATCH",
          body: JSON.stringify({ meshAppearance: draft }),
        },
      );
      return normalizeMeshAppearance(res.data.meshAppearance);
    },
    onSuccess: async (next) => {
      setDraft(next);
      setError(null);
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ["admin", "system-properties"] });
      await qc.invalidateQueries({ queryKey: ["config"] });
      window.setTimeout(() => setSaved(false), 2000);
    },
    onError: (err: Error) => setError(err.message),
  });

  const setType = (key: EntityType, color: string) => {
    setDraft((current) => ({ ...current, types: { ...current.types, [key]: color } }));
  };

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Colors and readability for every project Mesh. One set is used on all accent packs. Priority
        and state colors stay with the rest of the app.
      </p>
      {propsQuery.isLoading ? <p className="muted">Loading…</p> : null}

      <h4 className="mesh-appearance-heading">Colors</h4>
      <div className="mesh-appearance-colors">
        {TYPE_FIELDS.map((field) => (
          <ColorField
            key={field.key}
            label={field.label}
            color={draft.types[field.key]}
            background={background}
            onChange={(color) => setType(field.key, color)}
          />
        ))}
        <ColorField
          label="AI suggestion"
          color={draft.suggestion}
          background={background}
          onChange={(color) => setDraft((current) => ({ ...current, suggestion: color }))}
        />
        <ColorField
          label="Completed dependencies"
          color={draft.depDone}
          background={background}
          onChange={(color) => setDraft((current) => ({ ...current, depDone: color }))}
        />
        <ColorField
          label="Overdue"
          color={draft.signals.overdue}
          background={background}
          onChange={(color) =>
            setDraft((current) => ({
              ...current,
              signals: { ...current.signals, overdue: color },
            }))
          }
        />
        <ColorField
          label="At risk"
          color={draft.signals.risk}
          background={background}
          onChange={(color) =>
            setDraft((current) => ({
              ...current,
              signals: { ...current.signals, risk: color },
            }))
          }
        />
        <ColorField
          label="Stale"
          color={draft.signals.stale}
          background={background}
          onChange={(color) =>
            setDraft((current) => ({
              ...current,
              signals: { ...current.signals, stale: color },
            }))
          }
        />
      </div>

      <h4 className="mesh-appearance-heading">Accessibility</h4>
      <div className="mesh-appearance-metrics">
        {LINE_FIELDS.map((field) => (
          <label className="field" key={field.key}>
            <span>{field.label} line weight</span>
            <input
              type="number"
              min={0.5}
              max={4}
              step={0.1}
              value={draft.lines[field.key]}
              onChange={(e) => {
                const weight = e.target.valueAsNumber;
                if (!Number.isFinite(weight)) return;
                setDraft((current) => ({
                  ...current,
                  lines: { ...current.lines, [field.key]: weight },
                }));
              }}
            />
          </label>
        ))}
        <label className="field">
          <span>Glyph scale (0.75–1.5)</span>
          <input
            type="number"
            min={0.75}
            max={1.5}
            step={0.05}
            value={draft.glyphScale}
            onChange={(e) => {
              const glyphScale = e.target.valueAsNumber;
              if (!Number.isFinite(glyphScale)) return;
              setDraft((current) => ({ ...current, glyphScale }));
            }}
          />
        </label>
        <label className="field">
          <span>Label size (rem)</span>
          <input
            type="number"
            min={0.7}
            max={1.2}
            step={0.05}
            value={draft.labelSizeRem}
            onChange={(e) => {
              const labelSizeRem = e.target.valueAsNumber;
              if (!Number.isFinite(labelSizeRem)) return;
              setDraft((current) => ({ ...current, labelSizeRem }));
            }}
          />
        </label>
        <label className="field">
          <span>Badge size (px)</span>
          <input
            type="number"
            min={8}
            max={24}
            step={1}
            value={draft.badgePx}
            onChange={(e) => {
              const badgePx = e.target.valueAsNumber;
              if (!Number.isFinite(badgePx)) return;
              setDraft((current) => ({ ...current, badgePx }));
            }}
          />
        </label>
        <label className="field">
          <span>Stale threshold (days)</span>
          <input
            type="number"
            min={1}
            max={365}
            step={1}
            value={draft.staleDays}
            onChange={(e) => {
              const staleDays = e.target.valueAsNumber;
              if (!Number.isFinite(staleDays)) return;
              setDraft((current) => ({ ...current, staleDays }));
            }}
          />
        </label>
      </div>
      <label className="mesh-appearance-check">
        <input
          type="checkbox"
          checked={draft.labelHalo}
          onChange={(e) => setDraft((current) => ({ ...current, labelHalo: e.target.checked }))}
        />
        <span>Label halo</span>
      </label>
      <label className="mesh-appearance-check">
        <input
          type="checkbox"
          checked={draft.overduePulse}
          onChange={(e) =>
            setDraft((current) => ({ ...current, overduePulse: e.target.checked }))
          }
        />
        <span>Overdue pulse</span>
      </label>
      <p className="muted small">
        Reduced-motion settings in the browser turn the overdue pulse off even when this is
        checked.
      </p>

      <h4 className="mesh-appearance-heading">Preview</h4>
      <MeshPreview appearance={draft} />

      {propsQuery.data?.updatedAt ? (
        <p className="muted small">
          Last saved: {new Date(propsQuery.data.updatedAt).toLocaleString()}
        </p>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
      {saved ? <p className="ok-text">Saved.</p> : null}
      <div className="mesh-appearance-actions">
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setDraft(structuredClone(MESH_APPEARANCE_DEFAULTS));
            setError(null);
            setSaved(false);
          }}
        >
          Reset to defaults
        </button>
        <button
          type="button"
          className="btn primary small"
          disabled={saveMutation.isPending || propsQuery.isLoading}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
