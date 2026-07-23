import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

export type AssistantAttachTarget = {
  key: string;
  label: string;
  /** Fresh snapshot of the page/editor content when sending a message */
  getContext: () => string;
};

type AssistantAttachValue = {
  target: AssistantAttachTarget | null;
  setTarget: Dispatch<SetStateAction<AssistantAttachTarget | null>>;
};

const AssistantAttachContext = createContext<AssistantAttachValue | null>(null);

export function AssistantAttachProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<AssistantAttachTarget | null>(null);
  const value = useMemo(() => ({ target, setTarget }), [target]);
  return (
    <AssistantAttachContext.Provider value={value}>{children}</AssistantAttachContext.Provider>
  );
}

export function useAssistantAttachTarget(): AssistantAttachTarget | null {
  return useContext(AssistantAttachContext)?.target ?? null;
}

/**
 * Register the current page/editor as attachable assistant context.
 * Clears on unmount when this registration still owns the slot.
 */
export function useRegisterAssistantAttach(target: AssistantAttachTarget | null) {
  const ctx = useContext(AssistantAttachContext);
  const setTarget = ctx?.setTarget;

  const getContext = target?.getContext;
  const key = target?.key;
  const label = target?.label;

  const stableGet = useCallback(() => (getContext ? getContext() : ""), [getContext]);

  useEffect(() => {
    if (!setTarget) return;
    if (!key || !label) {
      setTarget(null);
      return;
    }
    setTarget({ key, label, getContext: stableGet });
    return () => {
      setTarget((prev) => (prev?.key === key ? null : prev));
    };
  }, [setTarget, key, label, stableGet]);
}
