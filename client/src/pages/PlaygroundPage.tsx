import { useState } from "react";
import { ENTITY_TYPES } from "../lib/entityType";
import { DEFAULT_COLOR_PALETTE } from "../lib/palette";
import { ColorPopover } from "../components/shared/ColorPopover";
import { ElementShell } from "../components/shared/ElementShell";
import { MarkdownEditor } from "../components/shared/MarkdownEditor";

const SAMPLE_TASK = {
  id: 0,
  title: "Sample task",
  notes: "Phase 0 playground — shared ColorPopover + ElementShell.",
  color: "#7dd87d" as string | null,
};

export function PlaygroundPage() {
  const [chipColor, setChipColor] = useState<string | null>("#3b82f6");
  const [taskColor, setTaskColor] = useState<string | null>(SAMPLE_TASK.color);
  const [modalOpen, setModalOpen] = useState(false);
  const [pageDemo, setPageDemo] = useState(false);
  const [md, setMd] = useState(
    "## TipTap notes\n\nPaste an **image** from the clipboard, or use the Image button.\n\n- [ ] Checklist item\n",
  );

  return (
    <div>
      <div className="page-head">
        <h1>Shared primitives playground</h1>
      </div>
      <p className="muted">
        Manual QA for ColorPopover, ElementShell, TipTap MarkdownEditor (paste image → /api/v1/uploads).
      </p>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>MarkdownEditor (TipTap)</h2>
        <p className="muted">Same toolbar used by documents, ideas, project description, and task notes.</p>
        <MarkdownEditor value={md} onChange={setMd} height={280} />
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Entity types</h2>
        <div className="btn-row">
          {ENTITY_TYPES.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>ColorPopover</h2>
        <p className="muted">Click or right-click the swatch. Palette has {DEFAULT_COLOR_PALETTE.length} defaults.</p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
          <ColorPopover color={chipColor} onChange={setChipColor} label="Demo chip color" />
          <span
            className="chip chip--color"
            style={{ background: chipColor ?? "var(--border)", color: chipColor ? "#0f140f" : undefined }}
          >
            Demo chip
          </span>
          <code>{chipColor ?? "(none)"}</code>
        </div>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Canvas token preview</h2>
        <div className="playground-canvas-demo">--canvas-bg / --canvas-grid</div>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>ElementShell — card</h2>
        <ElementShell
          mode="card"
          entityType="task"
          title={SAMPLE_TASK.title}
          accentColor={taskColor}
          actions={
            <>
              <ColorPopover color={taskColor} onChange={setTaskColor} label="Task accent" />
              <button type="button" className="btn small ghost" onClick={() => setModalOpen(true)}>
                Open modal
              </button>
              <button type="button" className="btn small ghost" onClick={() => setPageDemo((v) => !v)}>
                Toggle page mode
              </button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            {SAMPLE_TASK.notes}
          </p>
        </ElementShell>
      </section>

      {pageDemo ? (
        <section style={{ marginTop: "1rem" }}>
          <ElementShell
            mode="page"
            entityType="task"
            title="Sample task (page mode)"
            accentColor={taskColor}
            actions={
              <button type="button" className="btn small ghost" onClick={() => setPageDemo(false)}>
                Hide
              </button>
            }
          >
            <p>Full-width page chrome for future detail routes.</p>
          </ElementShell>
        </section>
      ) : null}

      {modalOpen ? (
        <ElementShell
          mode="modal"
          entityType="task"
          title="Sample task (modal)"
          accentColor={taskColor}
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          footer={
            <div className="btn-row">
              <ColorPopover color={taskColor} onChange={setTaskColor} />
              <button type="button" className="btn primary" onClick={() => setModalOpen(false)}>
                Done
              </button>
            </div>
          }
        >
          <p>Modal ElementShell wraps shared editing chrome for tasks (and later other entities).</p>
        </ElementShell>
      ) : null}
    </div>
  );
}
