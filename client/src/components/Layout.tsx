import { useEffect, useState } from "react";
import { installDomInputSanitizer } from "../lib/sanitizeDomInputs";
import { ThemeProvider } from "../lib/ThemeProvider";
import { AdministrationProvider } from "../lib/administration";
import { useAuth } from "../lib/auth";
import { userIsAdministrator } from "../lib/roles";
import { SettingsProvider } from "../lib/settings";
import { AssistantAttachProvider } from "../lib/assistantAttach";
import { useAssistantBlockedTitle } from "../lib/useAssistantAvailability";
import { AssistantPanel } from "./AssistantPanel";
import { BlockedStateNotice } from "./BlockedStateNotice";
import { CommandPalette } from "./CommandPalette";
import { AppShell } from "./shell/AppShell";
import { AdministrationModal } from "./shell/AdministrationModal";
import { SettingsModal } from "./shell/SettingsModal";

export function Layout() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const assistantBlockedTitle = useAssistantBlockedTitle();
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
        if (assistantBlockedTitle) return;
        setAssistantOpen((open) => !open);
      }
    };
    const onOpenAssistant = () => {
      if (assistantBlockedTitle) return;
      setAssistantOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("taskmesh:open-assistant", onOpenAssistant);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("taskmesh:open-assistant", onOpenAssistant);
    };
  }, [canUsePalette, assistantBlockedTitle]);

  return (
    <ThemeProvider>
      <SettingsProvider>
        <AdministrationProvider>
          <AssistantAttachProvider>
            <AppShell
              onOpenPalette={() => {
                if (canUsePalette) setPaletteOpen(true);
              }}
              onOpenAssistant={() => {
                if (assistantBlockedTitle) return;
                setAssistantOpen(true);
              }}
              assistantBlockedTitle={assistantBlockedTitle}
            />
            <SettingsModal />
            <AdministrationModal />
            {canUsePalette ? (
              <CommandPalette
                open={paletteOpen}
                onClose={() => setPaletteOpen(false)}
                assistantBlockedTitle={assistantBlockedTitle}
              />
            ) : null}
            <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
            <BlockedStateNotice />
          </AssistantAttachProvider>
        </AdministrationProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
