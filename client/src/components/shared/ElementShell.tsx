import type { CSSProperties, ReactNode } from "react";
import type { EntityType } from "../../lib/entityType";

export type ElementMode = "card" | "modal" | "page";

type Props = {
  mode: ElementMode;
  entityType: EntityType;
  title: string;
  /** Shown before the title (e.g. task number T0013). */
  titleLeading?: string | null;
  /** Show entity type chip next to the title (modal/page). Default true. */
  showType?: boolean;
  /** Left accent / color bar (card) or header chip color */
  accentColor?: string | null;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Required for modal mode — closes the overlay */
  onClose?: () => void;
  open?: boolean;
  /** Card title click (e.g. open modal editor) */
  onTitleClick?: () => void;
  /** Absolute top-right control on card (e.g. dismiss ×) */
  cornerAction?: ReactNode;
};

export function ElementShell({
  mode,
  entityType,
  title,
  titleLeading,
  showType = true,
  accentColor,
  actions,
  footer,
  children,
  className,
  onClose,
  open = true,
  onTitleClick,
  cornerAction,
}: Props) {
  if (mode === "modal" && !open) return null;

  const accent = accentColor?.trim() || undefined;
  const classes = [
    "element-shell",
    `element-shell--${mode}`,
    `element-shell--${entityType}`,
    onTitleClick ? "element-shell--title-clickable" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const titleNode =
    onTitleClick && mode === "card" ? (
      <button type="button" className="element-shell__title element-shell__title-btn" onClick={onTitleClick}>
        {title}
      </button>
    ) : (
      <strong className="element-shell__title">{title}</strong>
    );

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
            {titleLeading ? (
              <span className="element-shell__leading muted">{titleLeading}</span>
            ) : null}
            <h2 className="element-shell__title">{title}</h2>
            {showType ? <span className="element-shell__type muted">{entityType}</span> : null}
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
        <>
          {cornerAction ? <div className="element-shell__corner">{cornerAction}</div> : null}
          <div className="element-shell__card-chrome">
            <span className="element-shell__accent" aria-hidden />
            <div className="element-shell__card-main">
              <div className="element-shell__title-row">
                {titleNode}
                {actions ? <div className="element-shell__actions">{actions}</div> : null}
              </div>
              {children ? <div className="element-shell__body">{children}</div> : null}
              {footer ? <div className="element-shell__footer">{footer}</div> : null}
            </div>
          </div>
        </>
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
