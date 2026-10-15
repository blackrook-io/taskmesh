import { Link } from "react-router-dom";
import { formatEntityRef } from "../lib/entityRef";
import { usePlanMemberships } from "../lib/planMemberships";

export function PlanMemberships({
  entityType,
  entityId,
}: {
  entityType: "task" | "todo";
  entityId: number;
}) {
  const query = usePlanMemberships(entityType, entityId);
  return (
    <div className="field">
      <span className="field-label">Plans</span>
      {query.isLoading ? <p className="muted">Loading plans…</p> : null}
      {query.isError ? <p className="plan-board__notice">{(query.error as Error).message}</p> : null}
      {query.data && query.data.length === 0 ? <p className="muted">Not in a plan.</p> : null}
      {query.data && query.data.length > 0 ? (
        <ul className="plan-memberships">
          {query.data.map((plan) => (
            <li key={plan.id}>
              <Link to={`/plans/${plan.id}`}>
                {formatEntityRef("plan", plan.number)} {plan.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
