import { DigestView } from "../components/DigestView";

export function DigestPage() {
  return (
    <div className="digest-page">
      <h1>Digest</h1>
      <DigestView showPreferences />
    </div>
  );
}
