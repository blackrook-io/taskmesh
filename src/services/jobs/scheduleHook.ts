export type BackupScheduleSnapshot = {
  enabled: boolean;
  hour: number;
  minute: number;
};

type Listener = (schedule: BackupScheduleSnapshot) => void;

let listener: Listener | null = null;

export function setBackupScheduleListener(next: Listener | null): void {
  listener = next;
}

export function notifyBackupScheduleWritten(schedule: BackupScheduleSnapshot): void {
  listener?.(schedule);
}
