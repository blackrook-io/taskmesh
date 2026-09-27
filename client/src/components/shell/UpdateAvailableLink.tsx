import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../../api/client";
import { useAuth } from "../../lib/auth";
import { userIsAdministrator } from "../../lib/roles";

type UpdateCheck = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
};

function githubReleaseUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") return null;
    if (!parsed.pathname.includes("/releases/")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

type Props = {
  compact?: boolean;
};

export function UpdateAvailableLink({ compact = false }: Props) {
  const { user } = useAuth();
  const isAdmin = userIsAdministrator(user);
  const query = useQuery({
    queryKey: ["system-update"],
    enabled: isAdmin,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: () => apiJson<{ data: UpdateCheck }>("/api/v1/system/update"),
  });

  const data = query.data?.data;
  const href = data?.updateAvailable ? githubReleaseUrl(data.releaseUrl) : null;
  if (!href) return null;

  const label = data?.latestVersion ? `Update to ${data.latestVersion}` : "Update available";
  return (
    <a
      className={compact ? "app-nav__update app-nav__update--less" : "app-nav__update"}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
    >
      Update
    </a>
  );
}
