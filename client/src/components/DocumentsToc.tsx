/* eslint-disable react-refresh/only-export-components -- intentional co-exports (helpers/hooks with components) */
import { useMemo, useState } from "react";
import { formatEntityRef } from "../lib/entityRef";
import { formatTimelineWhen } from "../lib/taskTimeline";
import type { ProjectDocument } from "../types";

const DB_SCHEMA_PREFIX = /^DB Schema\s*[—–-]\s*(.+)$/i;

export function getDbSchemaChildTitle(title: string): string | null {
  const match = title.match(DB_SCHEMA_PREFIX);
  return match?.[1]?.trim() ?? null;
}

export function documentDisplayTitle(doc: ProjectDocument): string {
  return getDbSchemaChildTitle(doc.title) ?? doc.title;
}

export function documentTooltip(doc: ProjectDocument): string {
  const ref = formatEntityRef("document", doc.number);
  const when = formatTimelineWhen(doc.updatedAt);
  const who = doc.updatedBy?.displayName?.trim() || "Unknown";
  return `${ref}\nLast edited ${when}\nBy ${who}`;
}

type TocFolder = { kind: "folder"; label: string; docs: ProjectDocument[] };
type TocDoc = { kind: "doc"; doc: ProjectDocument };
export type DocumentsTocEntry = TocFolder | TocDoc;

export function buildDocumentsTocEntries(docs: ProjectDocument[]): DocumentsTocEntry[] {
  const schemaDocs = docs.filter((d) => getDbSchemaChildTitle(d.title) != null);
  const schemaIds = new Set(schemaDocs.map((d) => d.id));
  let folderEmitted = false;
  const entries: DocumentsTocEntry[] = [];

  for (const doc of docs) {
    if (schemaIds.has(doc.id)) {
      if (!folderEmitted) {
        entries.push({ kind: "folder", label: "DB Schema", docs: schemaDocs });
        folderEmitted = true;
      }
      continue;
    }
    entries.push({ kind: "doc", doc });
  }
  return entries;
}

type Props = {
  documents: ProjectDocument[];
  selectedId: number | null;
  onSelect: (id: number) => void;
};

export function DocumentsToc({ documents, selectedId, onSelect }: Props) {
  const entries = useMemo(() => buildDocumentsTocEntries(documents), [documents]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [autoExpandForId, setAutoExpandForId] = useState<number | null>(null);

  if (selectedId !== autoExpandForId) {
    setAutoExpandForId(selectedId);
    if (selectedId != null) {
      const doc = documents.find((d) => d.id === selectedId);
      if (doc && getDbSchemaChildTitle(doc.title) != null && collapsedFolders.has("DB Schema")) {
        const next = new Set(collapsedFolders);
        next.delete("DB Schema");
        setCollapsedFolders(next);
      }
    }
  }

  const toggleFolder = (label: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  if (documents.length === 0) {
    return <p className="muted documents-toc__empty">No documents yet.</p>;
  }

  return (
    <nav className="documents-toc" aria-label="Document table of contents">
      {entries.map((entry) => {
        if (entry.kind === "doc") {
          return (
            <DocumentsTocRow
              key={entry.doc.id}
              doc={entry.doc}
              depth={0}
              selected={selectedId === entry.doc.id}
              onSelect={() => onSelect(entry.doc.id)}
            />
          );
        }

        const collapsed = collapsedFolders.has(entry.label);
        return (
          <div key={entry.label} className="documents-toc__group">
            <div className="documents-toc__row documents-toc__row--folder">
              <button
                type="button"
                className="documents-toc__twist"
                aria-label={collapsed ? "Expand folder" : "Collapse folder"}
                aria-expanded={!collapsed}
                onClick={() => toggleFolder(entry.label)}
              >
                {collapsed ? "▸" : "▾"}
              </button>
              <span className="documents-toc__folder-label">{entry.label}</span>
            </div>
            {!collapsed
              ? entry.docs.map((doc) => (
                  <DocumentsTocRow
                    key={doc.id}
                    doc={doc}
                    depth={1}
                    selected={selectedId === doc.id}
                    onSelect={() => onSelect(doc.id)}
                  />
                ))
              : null}
          </div>
        );
      })}
    </nav>
  );
}

function DocumentsTocRow({
  doc,
  depth,
  selected,
  onSelect,
}: {
  doc: ProjectDocument;
  depth: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`documents-toc__row${selected ? " is-selected" : ""}`}
      style={{ paddingLeft: `${0.35 + depth * 1.1}rem` }}
    >
      <span className="documents-toc__twist documents-toc__twist--leaf" aria-hidden="true">
        ·
      </span>
      <button
        type="button"
        className="documents-toc__title"
        title={documentTooltip(doc)}
        onClick={onSelect}
      >
        {documentDisplayTitle(doc)}
        {(doc.kind ?? "markdown") === "epub" ? (
          <span className="documents-toc__kind">EPUB</span>
        ) : (doc.kind ?? "markdown") === "pdf" ? (
          <span className="documents-toc__kind">PDF</span>
        ) : null}
      </button>
    </div>
  );
}
