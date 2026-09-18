/** Display form: G + zero-padded number (at least 4 digits). */
export function formatGroupNumber(n: number): string {
  return `G${String(n).padStart(4, "0")}`;
}

export type GroupRef = {
  id: number;
  referenceId: string;
  name: string;
};

export function toGroupRef(group: { id: number; number: number; name: string }): GroupRef {
  return {
    id: group.id,
    referenceId: formatGroupNumber(group.number),
    name: group.name,
  };
}
