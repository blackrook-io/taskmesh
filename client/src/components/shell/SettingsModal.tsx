import { useEffect, useId, useRef } from "react";
import { NavIcon } from "./NavIcon";
import { shellIcons } from "./shellIcons";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { AssistantSettingsPage } from "../../pages/AssistantSettingsPage";
import { BackupsPage } from "../../pages/BackupsPage";
import { ImportExportPage } from "../../pages/ImportExportPage";
import { ProfileSettingsPage } from "../../pages/ProfileSettingsPage";
import {
  SETTINGS_SECTION_LABELS,
  SETTINGS_SECTIONS,
  type SettingsSection,
  useSettings,
} from "../../lib/settings";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

const SECTION_ICONS: Record<SettingsSection, IconDefinition> = {
  profile: shellIcons.profile,
  appearance: shellIcons.imageBoard,
  "import-export": shellIcons.filesystem,
  backups: shellIcons.documents,
  assistant: shellIcons.assistant,
};

function AppearancePanel() {
  return (
    <div className="settings-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Dark themes with different accent colors. Preference is saved on this device.
      </p>
      <ThemeSwitcher />
    </div>
  );
}

export function SettingsModal() {
  const { open, section, setSection, closeSettings } = useSettings();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

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
        closeSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeSettings]);

  if (!open) return null;

  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeSettings();
      }}
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="settings-modal__head">
          <h2 id={titleId}>Settings</h2>
          <button
            ref={closeRef}
            type="button"
            className="btn ghost small"
            onClick={closeSettings}
            aria-label="Close settings"
          >
            Close
          </button>
        </header>
        <div className="settings-modal__body">
          <nav className="settings-modal__nav" aria-label="Settings sections">
            {SETTINGS_SECTIONS.map((id) => (
              <button
                key={id}
                type="button"
                className={`settings-modal__nav-item${section === id ? " is-active" : ""}`}
                onClick={() => setSection(id)}
              >
                <NavIcon icon={SECTION_ICONS[id]} className="settings-modal__nav-icon" />
                {SETTINGS_SECTION_LABELS[id]}
              </button>
            ))}
          </nav>
          <div className="settings-modal__content">
            <h3 className="settings-modal__section-title">{SETTINGS_SECTION_LABELS[section]}</h3>
            {section === "profile" ? <ProfileSettingsPage embedded /> : null}
            {section === "appearance" ? <AppearancePanel /> : null}
            {section === "import-export" ? <ImportExportPage embedded /> : null}
            {section === "backups" ? <BackupsPage embedded /> : null}
            {section === "assistant" ? <AssistantSettingsPage embedded /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
