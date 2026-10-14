import { useEffect, useState } from "react";
import { installDomInputSanitizer } from "../lib/sanitizeDomInputs";
import { ThemeProvider } from "../lib/ThemeProvider";
import { AdministrationProvider } from "../lib/administration";
import { useAuth } from "../lib/auth";
import { userIsAdministrator } from "../lib/roles";
import { SettingsProvider } from "../lib/settings";
import { AssistantAttachProvider } from "../lib/assistantAttach";
import { useAssistantBlockedTitle, useCaptureBlockedTitle } from "../lib/useAssistantAvailability";
import { isTextEntry } from "../lib/quickCapture";
import { AiApplyToastHost } from "./AiApplyToast";
import { AssistantPanel } from "./AssistantPanel";
import { BlockedStateNotice } from "./BlockedStateNotice";
import { CommandPalette } from "./CommandPalette";
import { QuickCaptureDialog } from "./QuickCaptureDialog";
import { AppShell } from "./shell/AppShell";
import { AdministrationModal } from "./shell/AdministrationModal";
import { SettingsModal } from "./shell/SettingsModal";

export function Layout() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const assistantBlockedTitle = useAssistantBlockedTitle();
  const captureBlockedTitle = useCaptureBlockedTitle();
  const { user } = useAuth();
  const canUsePalette = userIsAdministrator(user);

  useEffect(() => {
    return installDomInputSanitizer();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "k") {
        if (isTextEntry(e.target)) return;
        e.preventDefault();
        if (captureBlockedTitle) return;
        setCaptureOpen((open) => !open);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
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
    const onOpenCapture = () => {
      if (captureBlockedTitle) return;
      setCaptureOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("taskmesh:open-assistant", onOpenAssistant);
    window.addEventListener("taskmesh:open-capture", onOpenCapture);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("taskmesh:open-assistant", onOpenAssistant);
      window.removeEventListener("taskmesh:open-capture", onOpenCapture);
    };
  }, [canUsePalette, assistantBlockedTitle, captureBlockedTitle]);

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
                captureBlockedTitle={captureBlockedTitle}
              />
            ) : null}
            <QuickCaptureDialog open={captureOpen} onClose={() => setCaptureOpen(false)} />
            <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
            <AiApplyToastHost />
            <BlockedStateNotice />
          </AssistantAttachProvider>
        </AdministrationProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
