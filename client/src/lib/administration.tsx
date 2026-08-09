import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const ADMIN_SECTIONS = [
  "users",
  "keys",
  "apis",
  "logging",
  "backups",
  "system-properties",
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export const ADMIN_SECTION_LABELS: Record<AdminSection, string> = {
  users: "Users",
  keys: "Keys",
  apis: "APIs",
  logging: "Logging",
  backups: "Backups",
  "system-properties": "System Properties",
};

export function isAdminSection(value: string): value is AdminSection {
  return (ADMIN_SECTIONS as readonly string[]).includes(value);
}

export function adminSectionFromPath(pathname: string): AdminSection | null {
  if (pathname === "/admin" || pathname === "/admin/") return "users";
  if (pathname === "/admin/users") return "users";
  if (pathname === "/admin/keys") return "keys";
  if (pathname === "/admin/apis") return "apis";
  if (pathname === "/admin/logging") return "logging";
  if (pathname === "/admin/backups") return "backups";
  if (pathname === "/admin/system-properties") return "system-properties";
  return null;
}

type AdminContextValue = {
  open: boolean;
  section: AdminSection;
  openAdmin: (section?: AdminSection) => void;
  setSection: (section: AdminSection) => void;
  closeAdmin: () => void;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdministrationProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [section, setSectionState] = useState<AdminSection>("users");

  const openAdmin = useCallback((next: AdminSection = "users") => {
    setSectionState(next);
    setOpen(true);
  }, []);

  const setSection = useCallback((next: AdminSection) => {
    setSectionState(next);
    setOpen(true);
  }, []);

  const closeAdmin = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ section?: AdminSection }>).detail;
      const next =
        detail?.section && isAdminSection(detail.section) ? detail.section : "users";
      openAdmin(next);
    };
    window.addEventListener("taskmesh:open-admin", onOpen);
    return () => window.removeEventListener("taskmesh:open-admin", onOpen);
  }, [openAdmin]);

  const value = useMemo(
    () => ({ open, section, openAdmin, setSection, closeAdmin }),
    [open, section, openAdmin, setSection, closeAdmin],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdministration(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdministration must be used within AdministrationProvider");
  return ctx;
}

export function dispatchOpenAdmin(section: AdminSection = "users"): void {
  window.dispatchEvent(
    new CustomEvent("taskmesh:open-admin", { detail: { section } }),
  );
}
