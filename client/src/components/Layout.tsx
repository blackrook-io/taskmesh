import { useEffect, useState } from "react";
import { ThemeProvider } from "../lib/ThemeProvider";
import { SettingsProvider } from "../lib/settings";
import { AssistantAttachProvider } from "../lib/assistantAttach";
import { AssistantPanel } from "./AssistantPanel";
import { CommandPalette } from "./CommandPalette";
import { AppShell } from "./shell/AppShell";
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
        <AssistantAttachProvider>
          <AppShell
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenAssistant={() => setAssistantOpen(true)}
          />
          <SettingsModal />
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
          <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
        </AssistantAttachProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
