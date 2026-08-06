import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

type Props = {
  icon: IconDefinition;
  className?: string;
  title?: string;
  /** Pixel size; defaults to 1em via CSS */
  size?: number;
};

/** Thin wrapper so the icon set can be swapped later (e.g. Fugue). Uses currentColor. */
export function NavIcon({ icon, className, title, size }: Props) {
  return (
    <FontAwesomeIcon
      icon={icon}
      className={className ? `nav-icon ${className}` : "nav-icon"}
      title={title}
      style={size != null ? { width: size, height: size, fontSize: size } : undefined}
      fixedWidth
    />
  );
}
