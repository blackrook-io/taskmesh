import type { CSSProperties, ReactNode } from "react";
import type { EntityType } from "../../lib/entityType";

export type ElementMode = "card" | "modal" | "page";

type Props = {
  mode: ElementMode;
  entityType: EntityType;
  title: string;
  /** Left accent / color bar (card) or header chip color */
  accentColor?: string | null;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Required for modal mode — closes the overlay */
  onClose?: () => void;
  open?: boolean;
};

export function ElementShell({
  mode,
  entityType,
  title,
  accentColor,
  actions,
  footer,
  children,
  className,
  onClose,
  open = true,
}: Props) {
  if (mode === "modal" && !open) return null;

  const accent = accentColor?.trim() || undefined;
  const classes = [
    "element-shell",
    `element-shell--${mode}`,
    `element-shell--${entityType}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <div
      className={classes}
      style={accent ? ({ "--element-accent": accent } as CSSProperties) : undefined}
      data-entity-type={entityType}
      data-mode={mode}
    >
      {mode !== "card" ? (
        <header className="element-shell__header">
          <div className="element-shell__title-row">
            <span className="element-shell__accent" aria-hidden />
            <h2 className="element-shell__title">{title}</h2>
            <span className="element-shell__type muted">{entityType}</span>
          </div>
          <div className="element-shell__actions">
            {actions}
            {mode === "modal" && onClose ? (
              <button type="button" className="btn small ghost" onClick={onClose} aria-label="Close">
                Close
              </button>
            ) : null}
          </div>
        </header>
      ) : (
        <div className="element-shell__card-chrome">
          <span className="element-shell__accent" aria-hidden />
          <div className="element-shell__card-main">
            <div className="element-shell__title-row">
              <strong className="element-shell__title">{title}</strong>
              {actions ? <div className="element-shell__actions">{actions}</div> : null}
            </div>
            <div className="element-shell__body">{children}</div>
            {footer ? <div className="element-shell__footer">{footer}</div> : null}
          </div>
        </div>
      )}

      {mode !== "card" ? (
        <>
          <div className="element-shell__body">{children}</div>
          {footer ? <div className="element-shell__footer">{footer}</div> : null}
        </>
      ) : null}
    </div>
  );

  if (mode === "modal") {
    return (
      <div className="modal-backdrop element-shell-backdrop" role="presentation" onMouseDown={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {body}
        </div>
      </div>
    );
  }

  return body;
}
