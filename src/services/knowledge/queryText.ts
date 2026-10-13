/** `simple` tsquery. The last token is a prefix (`taskm:*`). Null when nothing is searchable. */
export function toSimpleTsQuery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.replace(/[&|!():*]/g, ""))
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  return tokens
    .map((token, index) => (index === tokens.length - 1 ? `${token}:*` : token))
    .join(" & ");
}
