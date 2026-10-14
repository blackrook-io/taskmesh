import { DigestView } from "../components/DigestView";

export function HomePage() {
  return (
    <div className="home-landing">
      <h1>
        <span className="brand-wordmark__task">Task</span>
        <span className="brand-wordmark__mesh">Mesh</span>
      </h1>
      <p className="muted">Personal projects, ideas, and Markdown — on your server.</p>
      <DigestView limitPerSection={3} />
      <p className="muted" style={{ marginTop: "1rem" }}>
        Use the left rail to open a project and its modules, or Settings. Administrators can press ⌘K
        / Ctrl+K to search globally.
      </p>
    </div>
  );
}
