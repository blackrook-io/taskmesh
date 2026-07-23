import { useEffect, useRef, useState } from "react";

type Phase = "prompt" | "naming";

type Props = {
  phase: Phase;
  name: string;
  onNameChange: (value: string) => void;
  onStartNaming: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy?: boolean;
};

export function KanbanColumnGhost({
  phase,
  name,
  onNameChange,
  onStartNaming,
  onSubmit,
  onCancel,
  busy = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    if (phase === "naming") inputRef.current?.focus();
  }, [phase]);

  const finish = (fn: () => void) => {
    if (doneRef.current || busy) return;
    doneRef.current = true;
    fn();
  };

  return (
    <div
      className={`kanban-column kanban-column-ghost${phase === "naming" ? " is-naming" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {phase === "prompt" ? (
        <button type="button" className="kanban-column-ghost__prompt" onClick={onStartNaming}>
          + Add column here
        </button>
      ) : (
        <div className="kanban-column-ghost__form">
          <label className="muted" htmlFor="kanban-ghost-name">
            Column name
          </label>
          <input
            id="kanban-ghost-name"
            ref={inputRef}
            type="text"
            value={name}
            disabled={busy}
            placeholder="e.g. Review"
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                e.preventDefault();
                finish(onSubmit);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                finish(onCancel);
              }
            }}
            onBlur={() => {
              if (!name.trim()) finish(onCancel);
              else finish(onSubmit);
            }}
          />
        </div>
      )}
    </div>
  );
}

const HOVER_MS = 500;

/** Manages 500ms blank-hover → prompt → naming for insert-at column ghost. */
export function useColumnGhostHover(opts: {
  suppress: boolean;
  onCreate: (insertAt: number, name: string) => Promise<void> | void;
}) {
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [phase, setPhase] = useState<"hidden" | "prompt" | "naming">("hidden");
  const [name, setName] = useState("");
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const pendingInsert = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const reset = () => {
    clearTimer();
    setPhase("hidden");
    setInsertAt(null);
    setArmedAt(null);
    setName("");
    pendingInsert.current = null;
  };

  useEffect(() => () => clearTimer(), []);

  useEffect(() => {
    if (opts.suppress && phase !== "naming") reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to suppress
  }, [opts.suppress]);

  const onBlankHover = (nextInsertAt: number | null) => {
    if (opts.suppress || phase === "naming") return;

    if (nextInsertAt == null) {
      clearTimer();
      setPhase("hidden");
      setInsertAt(null);
      setArmedAt(null);
      pendingInsert.current = null;
      return;
    }

    if (phase === "prompt" && insertAt === nextInsertAt) return;

    if (armedAt === nextInsertAt && timerRef.current != null) {
      pendingInsert.current = nextInsertAt;
      return;
    }

    clearTimer();
    setPhase("hidden");
    setInsertAt(null);
    setArmedAt(nextInsertAt);
    pendingInsert.current = nextInsertAt;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const at = pendingInsert.current;
      if (at == null) return;
      setInsertAt(at);
      setPhase("prompt");
    }, HOVER_MS);
  };

  return {
    ghostInsertAt: phase === "hidden" ? null : insertAt,
    phase,
    name,
    setName,
    lockGhost: phase === "naming",
    onBlankHover,
    startNaming: () => setPhase("naming"),
    cancel: reset,
    submit: async () => {
      const at = insertAt;
      const trimmed = name.trim();
      if (at == null || !trimmed) {
        reset();
        return;
      }
      await opts.onCreate(at, trimmed);
      reset();
    },
  };
}
