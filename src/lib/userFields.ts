/** Display form: U + zero-padded number (at least 4 digits). */
export function formatUserNumber(n: number): string {
  return `U${String(n).padStart(4, "0")}`;
}

export type UserRef = {
  id: number;
  referenceId: string;
  displayName: string;
};

export function toUserRef(user: {
  id: number;
  number: number;
  displayName: string;
}): UserRef {
  return {
    id: user.id,
    referenceId: formatUserNumber(user.number),
    displayName: user.displayName,
  };
}
