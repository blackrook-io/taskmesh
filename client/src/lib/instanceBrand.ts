import { DEFAULT_THEME, isThemeId, type ThemeId } from "./theme";

export type InstanceId = "dev" | "prod";

const DEV_FAVICON = "/favicon-dev.svg";
const PROD_FAVICON = "/favicon.svg";

/** Vite serve (`:5173`) is always the DEV UI; production builds are PROD. */
export function isViteDevInstance(): boolean {
  return import.meta.env.DEV;
}

export function viteDevSystemDefault(): ThemeId {
  return isViteDevInstance() ? "yellow" : DEFAULT_THEME;
}

export function resolveSystemDefaultFromConfig(data: {
  defaultTheme?: string;
  instanceTheme?: string | null;
}): ThemeId {
  if (isThemeId(data.instanceTheme)) return data.instanceTheme;
  if (isThemeId(data.defaultTheme)) return data.defaultTheme;
  return viteDevSystemDefault();
}

export function applyInstanceFavicon(instance: InstanceId): void {
  if (typeof document === "undefined") return;
  const href = instance === "dev" ? DEV_FAVICON : PROD_FAVICON;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== href) {
    link.type = "image/svg+xml";
    link.setAttribute("href", href);
  }
}
