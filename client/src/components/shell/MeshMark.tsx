type Props = {
  className?: string;
  title?: string;
};

/** Hex wireframe mesh mark — brand identity (not Font Awesome). */
export function MeshMark({ className, title = "TaskMesh" }: Props) {
  return (
    <svg
      className={className ? `mesh-mark ${className}` : "mesh-mark"}
      viewBox="0 0 64 64"
      width="1.25rem"
      height="1.25rem"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <polygon points="32,6 54,19 54,45 32,58 10,45 10,19" />
        <polygon points="32,18 44,25 44,39 32,46 20,39 20,25" />
        <line x1="32" y1="6" x2="32" y2="18" />
        <line x1="54" y1="19" x2="44" y2="25" />
        <line x1="54" y1="45" x2="44" y2="39" />
        <line x1="32" y1="58" x2="32" y2="46" />
        <line x1="10" y1="45" x2="20" y2="39" />
        <line x1="10" y1="19" x2="20" y2="25" />
      </g>
      <g fill="currentColor">
        <circle cx="32" cy="6" r="2.2" />
        <circle cx="54" cy="19" r="2.2" />
        <circle cx="54" cy="45" r="2.2" />
        <circle cx="32" cy="58" r="2.2" />
        <circle cx="10" cy="45" r="2.2" />
        <circle cx="10" cy="19" r="2.2" />
        <circle cx="32" cy="18" r="1.8" />
        <circle cx="44" cy="25" r="1.8" />
        <circle cx="44" cy="39" r="1.8" />
        <circle cx="32" cy="46" r="1.8" />
        <circle cx="20" cy="39" r="1.8" />
        <circle cx="20" cy="25" r="1.8" />
      </g>
    </svg>
  );
}
