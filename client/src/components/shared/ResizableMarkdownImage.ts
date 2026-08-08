import Image from "@tiptap/extension-image";

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function dimensionAttr(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * TipTap Image with corner resize handles (display size only) and Markdown
 * round-trip: sized images serialize as HTML `<img width height>` so reload
 * restores display dimensions without altering the upload file.
 */
export const ResizableMarkdownImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => dimensionAttr(element.getAttribute("width")),
        renderHTML: (attributes) => {
          const width = dimensionAttr(attributes.width);
          return width != null ? { width: String(width) } : {};
        },
      },
      height: {
        default: null,
        parseHTML: (element) => dimensionAttr(element.getAttribute("height")),
        renderHTML: (attributes) => {
          const height = dimensionAttr(attributes.height);
          return height != null ? { height: String(height) } : {};
        },
      },
    };
  },

  renderMarkdown(node) {
    const src = String(node.attrs?.src ?? "");
    const alt = String(node.attrs?.alt ?? "");
    const title = String(node.attrs?.title ?? "");
    const width = dimensionAttr(node.attrs?.width);
    const height = dimensionAttr(node.attrs?.height);

    if (width != null || height != null) {
      const parts = [`src="${escapeAttr(src)}"`, `alt="${escapeAttr(alt)}"`];
      if (title) parts.push(`title="${escapeAttr(title)}"`);
      if (width != null) parts.push(`width="${width}"`);
      if (height != null) parts.push(`height="${height}"`);
      return `<img ${parts.join(" ")} />`;
    }

    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
  },
}).configure({
  allowBase64: false,
  resize: {
    enabled: true,
    alwaysPreserveAspectRatio: true,
    minWidth: 48,
    minHeight: 48,
    directions: ["top-left", "top-right", "bottom-left", "bottom-right"],
  },
});
