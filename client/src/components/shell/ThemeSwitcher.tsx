import type { CSSProperties } from "react";
import { THEME_IDS, THEME_LABELS, THEME_SWATCHES } from "../../lib/theme";
import { useTheme } from "../../lib/themeContext";

type Props = {
  /** Compact swatch row for AppNav; fuller for Settings */
  compact?: boolean;
};

export function ThemeSwitcher({ compact = false }: Props) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className={`theme-switcher${compact ? " theme-switcher--compact" : ""}`}
      role="group"
      aria-label="Accent theme"
    >
      {compact ? null : <p className="theme-switcher__label muted">Accent color</p>}
      <div className="theme-switcher__swatches">
        {THEME_IDS.map((id) => {
          const selected = theme === id;
          return (
            <button
              key={id}
              type="button"
              className={`theme-switcher__swatch${selected ? " is-selected" : ""}`}
              style={{ "--swatch": THEME_SWATCHES[id] } as CSSProperties}
              title={THEME_LABELS[id]}
              aria-label={THEME_LABELS[id]}
              aria-pressed={selected}
              onClick={() => setTheme(id)}
            />
          );
        })}
      </div>
    </div>
  );
}
