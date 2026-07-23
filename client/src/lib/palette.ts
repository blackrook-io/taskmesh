/** Default 16-color palette for tags, task accents, and canvas shapes. */
export const DEFAULT_COLOR_PALETTE = [
  "#7dd87d",
  "#4a9d4f",
  "#5ec8d8",
  "#3b82f6",
  "#818cf8",
  "#a78bfa",
  "#e879f9",
  "#f472b6",
  "#fb7185",
  "#e57373",
  "#fb923c",
  "#fbbf24",
  "#a3e635",
  "#94a3b8",
  "#e2e8f0",
  "#1e1f24",
] as const;

export type PaletteColor = (typeof DEFAULT_COLOR_PALETTE)[number] | string;
