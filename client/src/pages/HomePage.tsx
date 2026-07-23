import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <div>
      <h1>TaskMesh</h1>
      <p className="muted">Personal projects, ideas, and Markdown — on your server.</p>
      <div className="btn-row" style={{ marginTop: "1rem" }}>
        <Link to="/ideas" className="btn primary">
          Ideas
        </Link>
        <Link to="/projects" className="btn">
          Projects
        </Link>
      </div>
    </div>
  );
}
