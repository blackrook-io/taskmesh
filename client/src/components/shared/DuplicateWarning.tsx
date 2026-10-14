import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  fetchDuplicateCheck,
  fetchDuplicatePairs,
  ignoreDuplicatePair,
  linkDuplicatePair,
  type DuplicateHit,
} from "../../api/duplicates";

type Kind = "task" | "todo";

function mergeHits(live: DuplicateHit[], stored: DuplicateHit[]): DuplicateHit[] {
  const seen = new Set<string>();
  const out: DuplicateHit[] = [];
  for (const hit of [...stored, ...live]) {
    const key = `${hit.entityType}:${hit.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out.slice(0, 3);
}

export function DuplicateWarning({
  entityType,
  title,
  entityId,
  projectId,
  onResolve,
}: {
  entityType: Kind;
  title: string;
  entityId?: number;
  projectId?: number | null;
  /** Draft create: parent saves the record, then this resolves the pair. */
  onResolve?: (action: "link" | "ignore", hit: DuplicateHit) => Promise<void>;
}) {
  const qc = useQueryClient();
  const [debounced, setDebounced] = useState(title.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(title.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [title]);

  const live = useQuery({
    queryKey: ["duplicate-check", entityType, debounced, entityId ?? null, projectId ?? null],
    enabled: debounced.length >= 3,
    queryFn: () =>
      fetchDuplicateCheck({
        entityType,
        title: debounced,
        excludeId: entityId,
        projectId,
      }),
  });
  const stored = useQuery({
    queryKey: ["duplicate-pairs", entityType, entityId],
    enabled: entityId != null,
    queryFn: () => fetchDuplicatePairs(entityType, entityId!),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["duplicate-check"] });
    void qc.invalidateQueries({ queryKey: ["duplicate-pairs", entityType, entityId] });
    void qc.invalidateQueries({ queryKey: ["entity-links"] });
  };

  const ignore = useMutation({
    mutationFn: async (hit: DuplicateHit) => {
      if (onResolve) {
        await onResolve("ignore", hit);
        return;
      }
      if (entityId == null) return;
      await ignoreDuplicatePair({
        entityType,
        entityId,
        matchType: hit.entityType,
        matchId: hit.entityId,
      });
    },
    onSuccess: refresh,
  });
  const link = useMutation({
    mutationFn: async (hit: DuplicateHit) => {
      if (onResolve) {
        await onResolve("link", hit);
        return;
      }
      if (entityId == null) return;
      await linkDuplicatePair({
        entityType,
        entityId,
        matchType: hit.entityType,
        matchId: hit.entityId,
      });
    },
    onSuccess: refresh,
  });

  const hits = mergeHits(live.data ?? [], stored.data ?? []);
  if (hits.length === 0) return null;
  const hit = hits[0]!;
  const busy = ignore.isPending || link.isPending;

  return (
    <div className="duplicate-warning" role="status">
      <p>
        Looks like {hit.referenceId} {hit.title}
      </p>
      {(ignore.error || link.error) && (
        <p className="tag-input__error" role="alert">
          {(ignore.error ?? link.error)?.message}
        </p>
      )}
      <div className="duplicate-warning__actions">
        <Link className="btn" to={hit.href}>
          Open
        </Link>
        <button type="button" className="btn" disabled={busy} onClick={() => link.mutate(hit)}>
          Link as duplicate
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => ignore.mutate(hit)}>
          Ignore
        </button>
      </div>
    </div>
  );
}
