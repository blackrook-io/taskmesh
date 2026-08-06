import { Link } from "react-router-dom";

type Props = {
  compact?: boolean;
};

export function BrandWordmark({ compact = false }: Props) {
  return (
    <Link to="/" className={`brand-wordmark${compact ? " brand-wordmark--compact" : ""}`}>
      <span className="brand-wordmark__title">
        <span className="brand-wordmark__task">Task</span>
        <span className="brand-wordmark__mesh">Mesh</span>
      </span>
      {compact ? null : (
        <span className="brand-wordmark__tagline">
          Every task. Every idea. <span className="brand-wordmark__connected">Connected.</span>
        </span>
      )}
    </Link>
  );
}
