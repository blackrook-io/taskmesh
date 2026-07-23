import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "../api/client";
import { ENTITY_TYPES } from "../lib/entityType";
import { DEFAULT_COLOR_PALETTE } from "../lib/palette";
import { ColorPopover } from "../components/shared/ColorPopover";
import { ElementShell } from "../components/shared/ElementShell";
import { MarkdownEditor } from "../components/shared/MarkdownEditor";
import { TagChip } from "../components/shared/TagChip";
import { TagInput } from "../components/shared/TagInput";
import type { Idea, Tag } from "../types";

const SAMPLE_TASK = {
  id: 0,
  title: "Sample task",
  notes: "Phase 0 playground — shared ColorPopover + ElementShell.",
  color: "#7dd87d" as string | null,
};

export function PlaygroundPage() {
  const qc = useQueryClient();
  const [chipColor, setChipColor] = useState<string | null>("#3b82f6");
  const [taskColor, setTaskColor] = useState<string | null>(SAMPLE_TASK.color);
  const [modalOpen, setModalOpen] = useState(false);
  const [pageDemo, setPageDemo] = useState(false);
  const [md, setMd] = useState(
    "## TipTap notes\n\nPaste an **image** from the clipboard, or use the Image button.\n\n- [ ] Checklist item\n",
  );
  const [localTagName, setLocalTagName] = useState("playground");
  const [demoTag, setDemoTag] = useState<Tag | null>(null);

  const ideasQuery = useQuery({
    queryKey: ["ideas"],
    queryFn: async () => {
      const res = await apiJson<{ data: Idea[] }>("/api/v1/ideas");
      return res.data;
    },
  });

  const sampleIdea = ideasQuery.data?.[0] ?? null;

  const ensureDemoTag = useMutation({
    mutationFn: async () => {
      const name = localTagName.trim() || "playground";
      const list = await apiJson<{ data: Tag[] }>("/api/v1/tags");
      const existing = list.data.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing;
      const created = await apiJson<{ data: Tag }>("/api/v1/tags", {
        method: "POST",
        body: JSON.stringify({ name, color: "#7dd87d" }),
      });
      return created.data;
    },
    onSuccess: (tag) => {
      setDemoTag(tag);
      void qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });

  const recolorDemo = useMutation({
    mutationFn: async (color: string | null) => {
      if (!demoTag) throw new Error("Create a demo tag first");
      const res = await apiJson<{ data: Tag }>(`/api/v1/tags/${demoTag.id}`, {
        method: "PATCH",
        body: JSON.stringify({ color }),
      });
      return res.data;
    },
    onSuccess: (tag) => {
      setDemoTag(tag);
      void qc.invalidateQueries({ queryKey: ["tags"] });
      void qc.invalidateQueries({ queryKey: ["taggings"] });
    },
  });

  return (
    <div>
      <div className="page-head">
        <h1>Shared primitives playground</h1>
      </div>
      <p className="muted">
        Manual QA for ColorPopover, TagChip/TagInput, ElementShell, TipTap MarkdownEditor.
      </p>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>TagChip + TagInput</h2>
        <p className="muted">
          Type ≥3 chars for autocomplete; Enter creates/attaches; hover × removes; right-click chip opens
          ColorPopover. Recolor updates the shared tag everywhere.
        </p>

        <div className="field" style={{ marginTop: "0.75rem" }}>
          <label>Standalone TagChip (create then right-click to recolor)</label>
          <div className="btn-row" style={{ marginBottom: "0.5rem" }}>
            <input
              type="text"
              value={localTagName}
              onChange={(e) => setLocalTagName(e.target.value)}
              placeholder="Tag name"
              style={{ maxWidth: "12rem" }}
            />
            <button
              type="button"
              className="btn small"
              disabled={ensureDemoTag.isPending}
              onClick={() => ensureDemoTag.mutate()}
            >
              Load / create tag
            </button>
          </div>
          {demoTag ? (
            <div className="tag-input__chips">
              <TagChip
                tag={demoTag}
                removable={false}
                onColorChange={(c) => recolorDemo.mutate(c)}
              />
              <TagChip
                tag={demoTag}
                removable={false}
                onColorChange={(c) => recolorDemo.mutate(c)}
              />
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                Both chips share color — recolor either
              </span>
            </div>
          ) : (
            <p className="muted">Create a tag to demo shared recolor.</p>
          )}
          {ensureDemoTag.isError ? (
            <p role="alert">{(ensureDemoTag.error as Error).message}</p>
          ) : null}
        </div>

        <div className="field" style={{ marginTop: "1rem" }}>
          <label>Entity TagInput</label>
          {sampleIdea ? (
            <>
              <p className="muted">
                Wired to idea{" "}
                <Link to={`/ideas/${sampleIdea.id}`}>#{sampleIdea.id} {sampleIdea.title}</Link>
              </p>
              <TagInput entityType="idea" entityId={sampleIdea.id} />
            </>
          ) : (
            <p className="muted">
              Create an <Link to="/ideas/new">idea</Link> first to exercise live TagInput attach/detach.
            </p>
          )}
        </div>
      </section>

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
