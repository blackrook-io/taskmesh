import type { CSSProperties } from "react";
import { THEME_IDS, THEME_LABELS, THEME_SWATCHES, type ThemeId } from "../../lib/theme";
import { useTheme } from "../../lib/themeContext";

type Props = {
  /** Compact swatch row for AppNav; fuller for Settings */
  compact?: boolean;
  /** Controlled value; defaults to applied theme from context when omitted. */
  value?: ThemeId;
  /** Controlled change handler; defaults to `setPlatformTheme` when omitted. */
  onChange?: (theme: ThemeId) => void;
  /** Accessible name for the swatch group. */
  "aria-label"?: string;
  /** Optional label above swatches (ignored when compact). */
  label?: string;
};

export function ThemeSwitcher({
  compact = false,
  value,
  onChange,
  "aria-label": ariaLabel = "Accent theme",
  label = "Accent color",
}: Props) {
  const { theme, setPlatformTheme } = useTheme();
  const selectedTheme = value ?? theme;
  const handleChange = onChange ?? setPlatformTheme;

  return (
    <div
      className={`theme-switcher${compact ? " theme-switcher--compact" : ""}`}
      role="group"
      aria-label={ariaLabel}
    >
      {compact ? null : <p className="theme-switcher__label muted">{label}</p>}
      <div className="theme-switcher__swatches">
        {THEME_IDS.map((id) => {
          const selected = selectedTheme === id;
          return (
            <button
              key={id}
              type="button"
              className={`theme-switcher__swatch${selected ? " is-selected" : ""}`}
              style={{ "--swatch": THEME_SWATCHES[id] } as CSSProperties}
              title={THEME_LABELS[id]}
              aria-label={THEME_LABELS[id]}
              aria-pressed={selected}
              onClick={() => handleChange(id)}
            />
          );
        })}
      </div>
    </div>
  );
}
