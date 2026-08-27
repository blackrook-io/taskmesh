import { useEffect, useId, useRef } from "react";
import { NavIcon } from "./NavIcon";
import { shellIcons } from "./shellIcons";
import { AdminApisPanel } from "../admin/AdminApisPanel";
import { AdminDatabasePanel } from "../admin/AdminDatabasePanel";
import { AdminDeletedTasksPanel } from "../admin/AdminDeletedTasksPanel";
import { AdminKeysPanel } from "../admin/AdminKeysPanel";
import { AdminLoggingPanel } from "../admin/AdminLoggingPanel";
import { AdminSystemPropertiesPanel } from "../admin/AdminSystemPropertiesPanel";
import { AdminTemplatesPanel } from "../admin/AdminTemplatesPanel";
import { AdminUsersPanel } from "../admin/AdminUsersPanel";
import { BackupsPage } from "../../pages/BackupsPage";
import { useModalScrollbarGutter } from "../../lib/useModalScrollbarGutter";
import {
  ADMIN_SECTION_LABELS,
  ADMIN_SECTIONS,
  type AdminSection,
  useAdministration,
} from "../../lib/administration";
import { useAuth } from "../../lib/auth";
import { userIsAdministrator } from "../../lib/roles";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

const SECTION_ICONS: Record<AdminSection, IconDefinition> = {
  users: shellIcons.profile,
  keys: shellIcons.keys,
  apis: shellIcons.chart,
  database: shellIcons.database,
  logging: shellIcons.logging,
  backups: shellIcons.documents,
  "system-properties": shellIcons.admin,
  templates: shellIcons.templates,
  "deleted-tasks": shellIcons.tasks,
};

export function AdministrationModal() {
  const { open, section, setSection, closeAdmin } = useAdministration();
  const { user } = useAuth();
  const allowed = userIsAdministrator(user);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  useModalScrollbarGutter(contentRef, { enabled: open && allowed });

  useEffect(() => {
    if (open && !allowed) closeAdmin();
  }, [open, allowed, closeAdmin]);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeAdmin();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeAdmin]);

  if (!open || !allowed) return null;

  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeAdmin();
      }}
    >
      <div
        className="settings-modal settings-modal--admin"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="settings-modal__head">
          <h2 id={titleId}>Administration</h2>
          <button
            ref={closeRef}
            type="button"
            className="btn ghost small"
            onClick={closeAdmin}
            aria-label="Close administration"
          >
            Close
          </button>
        </header>
        <div className="settings-modal__body">
          <nav className="settings-modal__nav" aria-label="Administration sections">
            {ADMIN_SECTIONS.map((id) => (
              <button
                key={id}
                type="button"
                className={`settings-modal__nav-item${section === id ? " is-active" : ""}`}
                onClick={() => setSection(id)}
              >
                <NavIcon icon={SECTION_ICONS[id]} className="settings-modal__nav-icon" />
                {ADMIN_SECTION_LABELS[id]}
              </button>
            ))}
          </nav>
          <div className="settings-modal__content" ref={contentRef}>
            <h3 className="settings-modal__section-title">{ADMIN_SECTION_LABELS[section]}</h3>
            {section === "users" ? <AdminUsersPanel /> : null}
            {section === "keys" ? <AdminKeysPanel /> : null}
            {section === "apis" ? <AdminApisPanel /> : null}
            {section === "database" ? <AdminDatabasePanel /> : null}
            {section === "logging" ? <AdminLoggingPanel /> : null}
            {section === "backups" ? <BackupsPage embedded /> : null}
            {section === "system-properties" ? <AdminSystemPropertiesPanel /> : null}
            {section === "templates" ? <AdminTemplatesPanel /> : null}
            {section === "deleted-tasks" ? <AdminDeletedTasksPanel /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
