import { useCallback, useRef, useState } from "react";

const MAX_STEPS = 10;

/**
 * Session undo ring for an open editor. Baseline is the initial value;
 * push before each committed change; undo restores the previous snapshot.
 */
export function useUndoStack<T>(initial: T, maxSteps = MAX_STEPS) {
  const baselineRef = useRef(initial);
  const stackRef = useRef<T[]>([]);
  const [depth, setDepth] = useState(0);
  const [revision, setRevision] = useState(0);

  const reset = useCallback((value: T) => {
    baselineRef.current = value;
    stackRef.current = [];
    setDepth(0);
    setRevision((r) => r + 1);
  }, []);

  const push = useCallback(
    (previous: T) => {
      const next = [...stackRef.current, previous];
      stackRef.current = next.length > maxSteps ? next.slice(next.length - maxSteps) : next;
      setDepth(stackRef.current.length);
    },
    [maxSteps],
  );

  const undo = useCallback((): T => {
    if (stackRef.current.length === 0) {
      setRevision((r) => r + 1);
      return structuredClone(baselineRef.current);
    }
    const copy = [...stackRef.current];
    const restored = copy.pop() as T;
    stackRef.current = copy;
    setDepth(copy.length);
    setRevision((r) => r + 1);
    return restored;
  }, []);

  return {
    push,
    undo,
    reset,
    canUndo: depth > 0,
    revision,
    baseline: baselineRef.current,
  };
}
