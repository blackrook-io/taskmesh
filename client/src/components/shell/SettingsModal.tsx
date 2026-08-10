import { useEffect, useId, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavIcon } from "./NavIcon";
import { shellIcons } from "./shellIcons";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { AssistantSettingsPage } from "../../pages/AssistantSettingsPage";
import { ImportExportPage } from "../../pages/ImportExportPage";
import { ProfileSettingsPage } from "../../pages/ProfileSettingsPage";
import { TagsSettingsPanel } from "../settings/TagsSettingsPanel";
import { useModalScrollbarGutter } from "../../lib/useModalScrollbarGutter";
import {
  SETTINGS_SECTION_LABELS,
  SETTINGS_SECTIONS,
  type SettingsSection,
  useSettings,
} from "../../lib/settings";
import { useTheme } from "../../lib/themeContext";
import { apiJson } from "../../api/client";
import type { Project } from "../../types";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

const SECTION_ICONS: Record<SettingsSection, IconDefinition> = {
  profile: shellIcons.profile,
  appearance: shellIcons.imageBoard,
  tags: shellIcons.tags,
  "import-export": shellIcons.filesystem,
  assistant: shellIcons.assistant,
};

function AppearancePanel() {
  const {
    platformTheme,
    setPlatformTheme,
    separateProjectThemes,
    setSeparateProjectThemes,
    getProjectTheme,
    setProjectTheme,
  } = useTheme();

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    enabled: separateProjectThemes,
    queryFn: async () => {
      const res = await apiJson<{ data: Project[] }>("/api/v1/projects");
      return res.data;
    },
  });

  return (
    <div className="settings-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Dark themes with different accent colors. Choosing a platform theme saves a personal
        preference on this device and overrides the system default.
      </p>
      <ThemeSwitcher
        label="Platform theme"
        aria-label="Platform theme"
        value={platformTheme}
        onChange={setPlatformTheme}
      />

      <label className="appearance-separate">
        <input
          type="checkbox"
          checked={separateProjectThemes}
          onChange={(e) => setSeparateProjectThemes(e.target.checked)}
        />
        <span>Separate Project Themes</span>
      </label>

      {separateProjectThemes ? (
        <div className="appearance-project-themes">
          <p className="muted appearance-project-themes__hint">
            Set a theme per project. Defaults match the platform theme. Entering a project with its
            own theme keeps that look until you open another themed project or turn this off.
          </p>
          {projectsQuery.isLoading ? <p className="muted">Loading projects…</p> : null}
          {projectsQuery.isError ? (
            <p className="muted">Could not load projects.</p>
          ) : null}
          {projectsQuery.data != null && projectsQuery.data.length === 0 ? (
            <p className="muted">No projects yet.</p>
          ) : null}
          {projectsQuery.data != null && projectsQuery.data.length > 0 ? (
            <ul className="appearance-project-themes__list">
              {projectsQuery.data.map((project) => {
                const override = getProjectTheme(project.id);
                const value = override ?? platformTheme;
                return (
                  <li key={project.id} className="appearance-project-themes__row">
                    <div className="appearance-project-themes__name">
                      <span className="appearance-project-themes__number">#{project.number}</span>
                      <span>{project.name}</span>
                    </div>
                    <ThemeSwitcher
                      compact
                      label=""
                      aria-label={`Theme for ${project.name}`}
                      value={value}
                      onChange={(theme) => setProjectTheme(project.id, theme)}
                    />
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SettingsModal() {
  const { open, section, setSection, closeSettings } = useSettings();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  useModalScrollbarGutter(contentRef, { enabled: open });

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
          <div className="settings-modal__content" ref={contentRef}>
            <h3 className="settings-modal__section-title">{SETTINGS_SECTION_LABELS[section]}</h3>
            {section === "profile" ? <ProfileSettingsPage embedded /> : null}
            {section === "appearance" ? <AppearancePanel /> : null}
            {section === "tags" ? <TagsSettingsPanel /> : null}
            {section === "import-export" ? <ImportExportPage embedded /> : null}
            {section === "assistant" ? <AssistantSettingsPage embedded /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
