export const NOTIFICATION_TYPES = ["digest", "reminder", "mention", "assignment"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  digest: "Digest",
  reminder: "Reminder",
  mention: "Mention",
  assignment: "Assignment",
};

export type NotificationPreference = {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
  frequency: "immediate" | "daily" | "weekly";
  quietStart: number | null;
  quietEnd: number | null;
  timeZone: string;
};
