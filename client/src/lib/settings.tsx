import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const SETTINGS_SECTIONS = [
  "profile",
  "appearance",
  "tags",
  "import-export",
  "assistant",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  profile: "Profile",
  appearance: "Appearance",
  tags: "Tags",
  "import-export": "Import / Export",
  assistant: "Assistant",
};

export function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export function sectionFromPath(pathname: string): SettingsSection | null {
  if (pathname === "/settings" || pathname === "/settings/") return "appearance";
  if (pathname === "/settings/profile") return "profile";
  if (pathname === "/settings/tags") return "tags";
  if (pathname === "/settings/import-export") return "import-export";
  if (pathname === "/settings/assistant") return "assistant";
  return null;
}

type SettingsContextValue = {
  open: boolean;
  section: SettingsSection;
  openSettings: (section?: SettingsSection) => void;
  setSection: (section: SettingsSection) => void;
  closeSettings: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [section, setSectionState] = useState<SettingsSection>("appearance");

  const openSettings = useCallback((next: SettingsSection = "appearance") => {
    setSectionState(next);
    setOpen(true);
  }, []);

  const setSection = useCallback((next: SettingsSection) => {
    setSectionState(next);
    setOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ section?: SettingsSection }>).detail;
      const next =
        detail?.section && isSettingsSection(detail.section) ? detail.section : "appearance";
      openSettings(next);
    };
    window.addEventListener("taskmesh:open-settings", onOpen);
    return () => window.removeEventListener("taskmesh:open-settings", onOpen);
  }, [openSettings]);

  const value = useMemo(
    () => ({ open, section, openSettings, setSection, closeSettings }),
    [open, section, openSettings, setSection, closeSettings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

export function dispatchOpenSettings(section: SettingsSection = "appearance"): void {
  window.dispatchEvent(
    new CustomEvent("taskmesh:open-settings", { detail: { section } }),
  );
}
