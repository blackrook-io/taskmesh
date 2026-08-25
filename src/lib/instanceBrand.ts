import { type ThemeId } from "./theme.js";

export type InstanceId = "dev" | "prod";

/** Accent used as DEV instance default (does not write `system_properties`). */
export const DEV_INSTANCE_THEME: ThemeId = "yellow";

/** systemd / `npm start` default — see `src/index.ts`. */
export const PROD_API_PORT = 3000;

/**
 * Runtime instance identity. Optional `TASKMESH_INSTANCE=dev|prod` wins;
 * otherwise `PORT===3000` (or unset, matching Express) is prod, any other port is dev.
 */
export function resolveInstanceId(env: NodeJS.ProcessEnv = process.env): InstanceId {
  const raw = env.TASKMESH_INSTANCE?.trim().toLowerCase();
  if (raw === "dev" || raw === "prod") return raw;
  const port = Number(env.PORT);
  if (Number.isFinite(port) && port > 0) {
    return port === PROD_API_PORT ? "prod" : "dev";
  }
  return "prod";
}

export function instanceThemeFor(instance: InstanceId): ThemeId | null {
  return instance === "dev" ? DEV_INSTANCE_THEME : null;
}

export function instanceBrand(env: NodeJS.ProcessEnv = process.env): {
  instance: InstanceId;
  instanceTheme: ThemeId | null;
} {
  const instance = resolveInstanceId(env);
  return { instance, instanceTheme: instanceThemeFor(instance) };
}
