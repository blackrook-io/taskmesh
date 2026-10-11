import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiJson } from "../../api/client";
import { ENTITY_TYPES, isEntityType, type EntityType } from "../../lib/entityType";
import { ConfirmDialog } from "../ConfirmDialog";

const RELATIONS = ["relates_to", "references", "supports", "part_of"] as const;
type LinkRelation = (typeof RELATIONS)[number];
type LinkOrigin = "manual" | "mention";

const TYPE_LABELS: Record<EntityType, string> = {
  idea: "Idea",
  project: "Project",
  task: "Task",
  todo: "ToDo",
  document: "Document",
  todo_list: "ToDo List",
  board: "Board",
  canvas: "Canvas",
  wiki_node: "Wiki",
  image_board: "Image board",
};

const RELATION_LABELS: Record<LinkRelation, string> = {
  relates_to: "Relates to",
  references: "References",
  supports: "Supports",
  part_of: "Part of",
};

type LinkEnd = {
  entityType: EntityType;
  id: number;
  referenceId: string;
  title: string;
  href: string;
  projectId: number | null;
};

type LinkListItem = {
  id: number;
  relation: LinkRelation;
  origin: LinkOrigin;
  entity: LinkEnd;
};

type LinksPayload = {
  outgoing: LinkListItem[];
  incoming: LinkListItem[];
};

type ReferenceHit = {
  entityType: string;
  id: number;
  title: string;
  referenceId: string;
  href: string;
};

type Props = {
  entityType: EntityType;
  entityId: number;
};

function isRelation(value: string): value is LinkRelation {
  return (RELATIONS as readonly string[]).includes(value);
}

function hitLabel(hit: ReferenceHit): string {
  return `${hit.referenceId} ${hit.title}`;
}

function groupByType(items: LinkListItem[]): { type: EntityType; items: LinkListItem[] }[] {
  const buckets = new Map<EntityType, LinkListItem[]>();
  for (const item of items) {
    const list = buckets.get(item.entity.entityType) ?? [];
    list.push(item);
    buckets.set(item.entity.entityType, list);
  }
  return ENTITY_TYPES.filter((type) => buckets.has(type)).map((type) => ({
    type,
    items: buckets.get(type) ?? [],
  }));
}

export function EntityLinksPanel({ entityType, entityId }: Props) {
  const qc = useQueryClient();
  const searchId = useId();
  const typeId = useId();
  const relationId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [targetType, setTargetType] = useState<EntityType>("task");
  const [relation, setRelation] = useState<LinkRelation>("relates_to");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReferenceHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<LinkListItem | null>(null);

  const linksKey = ["entity-links", entityType, entityId] as const;

  const linksQuery = useQuery({
    queryKey: linksKey,
    queryFn: async () => {
      const res = await apiJson<{ data: LinksPayload }>(
        `/api/v1/links?entityType=${encodeURIComponent(entityType)}&entityId=${entityId}`,
      );
      return res.data;
    },
  });

  const suggestQ = query.trim();
  const suggestQuery = useQuery({
    queryKey: ["entity-link-search", targetType, suggestQ, entityType, entityId],
    enabled: open && suggestQ.length >= 1 && selected == null,
    queryFn: async () => {
      const res = await apiJson<{ data: ReferenceHit[] }>(
        `/api/v1/references/search?type=${encodeURIComponent(targetType)}&q=${encodeURIComponent(suggestQ)}`,
      );
      return res.data.filter((hit) => !(hit.entityType === entityType && hit.id === entityId));
    },
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["entity-links"] });
    void qc.invalidateQueries({ queryKey: ["graph"] });
  };

  const add = useMutation({
    mutationFn: async (hit: ReferenceHit) => {
      if (!isEntityType(hit.entityType)) {
        throw new Error("That record type cannot be linked.");
      }
      await apiJson("/api/v1/links", {
        method: "POST",
        body: JSON.stringify({
          srcType: entityType,
          srcId: entityId,
          dstType: hit.entityType,
          dstId: hit.id,
          relation,
        }),
      });
    },
    onSuccess: () => {
      setQuery("");
      setSelected(null);
      setOpen(false);
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: async (linkId: number) => {
      await apiJson(`/api/v1/links/${linkId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      setPendingRemove(null);
      setError(null);
      invalidate();
    },
    onError: (err: Error) => {
      setPendingRemove(null);
      setError(err.message);
    },
  });

  const incoming = linksQuery.data?.incoming ?? [];
  const outgoing = linksQuery.data?.outgoing ?? [];
  const hits = suggestQuery.data ?? [];

  const renderRow = (row: LinkListItem) => {
    const end = row.entity;
    const relationLabel = isRelation(row.relation) ? RELATION_LABELS[row.relation] : row.relation;
    return (
      <li key={row.id} className="entity-links__row">
        <Link className="entity-links__ref" to={end.href}>
          <span className="entity-links__num muted">{end.referenceId}</span>
          <span className="entity-links__title">{end.title}</span>
        </Link>
        <span className="entity-links__relation muted">{relationLabel}</span>
        <span
          className={`entity-links__origin entity-links__origin--${row.origin}`}
          title={row.origin === "mention" ? "From a mention in text" : "Added by hand"}
        >
          {row.origin === "mention" ? "mention" : "manual"}
        </span>
        {row.origin === "manual" ? (
          <button
            type="button"
            className="btn small ghost entity-links__remove"
            aria-label={`Remove link to ${end.referenceId}`}
            disabled={remove.isPending}
            onClick={() => setPendingRemove(row)}
          >
            ×
          </button>
        ) : (
          <span className="entity-links__remove-spacer" aria-hidden />
        )}
      </li>
    );
  };

  const renderList = (items: LinkListItem[]) => {
    if (linksQuery.isLoading) {
      return <p className="entity-links__empty muted">Loading…</p>;
    }
    if (linksQuery.isError) {
      return null;
    }
    if (items.length === 0) {
      return <p className="entity-links__empty muted">None</p>;
    }
    return groupByType(items).map((group) => (
      <div key={group.type} className="entity-links__group">
        <span className="entity-links__group-label">{TYPE_LABELS[group.type]}</span>
        <ul className="entity-links__list">{group.items.map(renderRow)}</ul>
      </div>
    ));
  };

  return (
    <section className="entity-links" ref={rootRef} aria-label="Links">
      <div className="entity-links__columns">
        <div className="entity-links__section">
          <span className="entity-links__label">Linked from</span>
          {renderList(incoming)}
        </div>
        <div className="entity-links__section">
          <span className="entity-links__label">Links to</span>
          {renderList(outgoing)}
        </div>
      </div>

      <div className="entity-links__add">
        <span className="entity-links__label" id={`${searchId}-label`}>
          Add link
        </span>
        <div className="entity-links__add-row">
          <label className="sr-only" htmlFor={typeId}>
            Record type
          </label>
          <select
            id={typeId}
            value={targetType}
            onChange={(event) => {
              const next = event.target.value;
              if (!isEntityType(next)) return;
              setTargetType(next);
              setQuery("");
              setSelected(null);
              setOpen(false);
            }}
          >
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <input
            id={searchId}
            type="text"
            className="entity-links__search"
            placeholder="Title or number…"
            aria-labelledby={`${searchId}-label`}
            value={query}
            autoComplete="off"
            disabled={add.isPending}
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              setOpen(true);
              setError(null);
              if (selected && next !== hitLabel(selected)) setSelected(null);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          />
          <label className="sr-only" htmlFor={relationId}>
            Relation
          </label>
          <select
            id={relationId}
            value={relation}
            onChange={(event) => {
              const next = event.target.value;
              if (isRelation(next)) setRelation(next);
            }}
          >
            {RELATIONS.map((value) => (
              <option key={value} value={value}>
                {RELATION_LABELS[value]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn small"
            disabled={selected == null || add.isPending}
            onClick={() => {
              if (selected) add.mutate(selected);
            }}
          >
            Add
          </button>
        </div>
        {open && selected == null && suggestQ.length >= 1 ? (
          <ul className="entity-links__suggest" role="listbox">
            {suggestQuery.isFetching ? (
              <li className="entity-links__suggest-empty muted">Searching…</li>
            ) : hits.length === 0 ? (
              <li className="entity-links__suggest-empty muted">No matches</li>
            ) : (
              hits.map((hit) => (
                <li key={`${hit.entityType}-${hit.id}`}>
                  <button
                    type="button"
                    className="entity-links__suggest-item"
                    onClick={() => {
                      setSelected(hit);
                      setQuery(hitLabel(hit));
                      setOpen(false);
                      setError(null);
                    }}
                  >
                    <span className="muted">{hit.referenceId}</span> {hit.title}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      {linksQuery.isError ? (
        <p role="alert" className="tag-input__error">
          {(linksQuery.error as Error).message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="tag-input__error">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={pendingRemove != null}
        title="Remove link"
        message={
          pendingRemove
            ? `Remove the manual link to ${pendingRemove.entity.referenceId} ${pendingRemove.entity.title}?`
            : ""
        }
        confirmLabel="Remove"
        confirmDisabled={remove.isPending}
        onConfirm={() => {
          if (pendingRemove) remove.mutate(pendingRemove.id);
        }}
        onCancel={() => setPendingRemove(null)}
      />
    </section>
  );
}
