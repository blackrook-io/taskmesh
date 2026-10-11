/** Type glyph for a Mesh node. viewBox is centered so CSS can scale it. */

const STROKE = "var(--surface)";

function shape(type: string, fill: string, stroke: string) {
  const common = { fill, stroke, strokeWidth: 1.6, strokeLinejoin: "round" as const };
  switch (type) {
    case "project":
      return (
        <polygon
          points="10,0 5,8.7 -5,8.7 -10,0 -5,-8.7 5,-8.7"
          {...common}
        />
      );
    case "todo_list":
      return <polygon points="0,-11 11,0 0,11 -11,0" {...common} />;
    case "todo":
      return <rect x="-8" y="-8" width="16" height="16" rx="3" {...common} />;
    case "document":
      return (
        <path
          d="M-7,-10 H2 L8,-4 V10 H-7 Z M2,-10 V-4 H8"
          fill={fill}
          stroke={stroke}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      );
    case "idea":
      return <polygon points="0,-11 10,8 -10,8" {...common} />;
    case "board":
      return <rect x="-11" y="-5" width="22" height="10" rx="2" {...common} />;
    case "canvas":
      return <polygon points="-8,-9 11,-9 8,9 -11,9" {...common} />;
    case "wiki_node":
      return (
        <path
          d="M-7,-10 H7 V6 L0,10 L-7,6 Z"
          {...common}
        />
      );
    case "image_board":
      return (
        <>
          <rect x="-11" y="-8" width="22" height="16" rx="2" {...common} />
          <rect x="-4" y="-3" width="8" height="6" fill={stroke} stroke="none" />
        </>
      );
    default:
      return <circle r="9" {...common} />;
  }
}

export function MeshShape({
  type,
  color,
  hollow,
}: {
  type: string;
  color: string;
  hollow: boolean;
}) {
  const fill = hollow ? "var(--surface)" : color;
  const stroke = hollow ? color : STROKE;
  return (
    <svg className="mesh-shape" viewBox="-12 -12 24 24" aria-hidden>
      {shape(type, fill, stroke)}
    </svg>
  );
}
