import { useEffect, useState } from "react";
import { ThemeProvider } from "../lib/ThemeProvider";
import { AdministrationProvider } from "../lib/administration";
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
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
  }, []);

  return (
    <ThemeProvider>
      <SettingsProvider>
        <AdministrationProvider>
          <AssistantAttachProvider>
            <AppShell
              onOpenPalette={() => setPaletteOpen(true)}
              onOpenAssistant={() => setAssistantOpen(true)}
            />
            <SettingsModal />
            <AdministrationModal />
            <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
            <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
          </AssistantAttachProvider>
        </AdministrationProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
