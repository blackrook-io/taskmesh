import { useEffect, useState } from "react";
import { installDomInputSanitizer } from "../lib/sanitizeDomInputs";
import { ThemeProvider } from "../lib/ThemeProvider";
import { AdministrationProvider } from "../lib/administration";
import { useAuth } from "../lib/auth";
import { userIsAdministrator } from "../lib/roles";
import { SettingsProvider } from "../lib/settings";
import { AssistantAttachProvider } from "../lib/assistantAttach";
import { AssistantPanel } from "./AssistantPanel";
import { CommandPalette } from "./CommandPalette";
import { AppShell } from "./shell/AppShell";
import { AdministrationModal } from "./shell/AdministrationModal";
import { SettingsModal } from "./shell/SettingsModal";

export function Layout() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const { user } = useAuth();
  const canUsePalette = userIsAdministrator(user);

  useEffect(() => {
    return installDomInputSanitizer();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (!canUsePalette) return;
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAssistantOpen((open) => !open);
      }
    };
    const onOpenAssistant = () => setAssistantOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("taskmesh:open-assistant", onOpenAssistant);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("taskmesh:open-assistant", onOpenAssistant);
    };
  }, [canUsePalette]);

  return (
    <ThemeProvider>
      <SettingsProvider>
        <AdministrationProvider>
          <AssistantAttachProvider>
            <AppShell
              onOpenPalette={() => {
                if (canUsePalette) setPaletteOpen(true);
              }}
              onOpenAssistant={() => setAssistantOpen(true)}
            />
            <SettingsModal />
            <AdministrationModal />
            {canUsePalette ? (
              <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
            ) : null}
            <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
          </AssistantAttachProvider>
        </AdministrationProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
