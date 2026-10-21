import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const ideas = pgTable("ideas", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → I####. */
  number: integer("number").notNull().unique(),
  title: text("title").notNull(),
  body: text("body"),
  /** Record owner (T0112). Access scoped in T0113–T0115. */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  /**
   * Optional assignee (T0117). Distinct from ownership.
   * Ideas have no project pool — product UI keeps this null.
   */
  assigneeId: integer("assignee_id").references(() => users.id, {
    onDelete: "set null",
  }),
  /** Manual Ideas list order. Lower comes first. Column sort does not write this. */
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → P####. */
  number: integer("number").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("idea"),
  /**
   * Default schedule anchor for a new plan (YYYY-MM-DD).
   * Null means a new plan stays unanchored.
   */
  startDate: date("start_date", { mode: "string" }),
  /** Manual list order (left nav / project list). */
  sortOrder: integer("sort_order").notNull().default(0),
  /** Set when an idea was converted into this project. */
  sourceIdeaId: integer("source_idea_id").references(() => ideas.id, {
    onDelete: "set null",
  }),
  /** Record owner (T0112). Nested project content inherits this for access. */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  /**
   * Project choice for AI: `full` | `read_only` | `excluded` (T0184).
   * Effective access is the narrower of this value and the instance ceiling.
   */
  aiAccess: text("ai_access").notNull().default("full"),
  /**
   * When true, AI for this project may use local models only (T0320).
   * The effective mark is this value OR the instance ceiling `ai_project_local_only`.
   */
  aiLocalOnly: boolean("ai_local_only").notNull().default(false),
  /**
   * Project AI instructions (T0209). Plain text, like an AGENTS.md for the project.
   * Sent with context for this project. Not indexed in knowledge_chunks.
   */
  aiInstructions: text("ai_instructions"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  aiAccessCheck: check(
    "projects_ai_access_chk",
    sql`${t.aiAccess} in ('full', 'read_only', 'excluded')`,
  ),
}));

/** List-view Task Groups (saved filter + color). Distinct from Project Phases. */
export const taskGroups = pgTable("task_groups", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Accent on the group bar (CSS hex). */
  color: text("color"),
  /** T0053-shaped filter JSON; null/empty = manual membership via task_group_members. */
  filter: jsonb("filter").$type<{
    clauses: { field: string; operator: string; value: string }[];
    joins: string[];
  } | null>(),
  /** When true and filter is active, list under Tasks in the Project menu. */
  showInNav: boolean("show_in_nav").notNull().default(false),
  /** Optional tag applied to tasks that match this group’s filter (T0077). */
  autoTagId: integer("auto_tag_id").references(() => tags.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Project development phases. Tasks optionally associate via phase_id. */
export const projectPhases = pgTable("project_phases", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Project Managers list (T0127 schema; role enforcement in T0128).
 * Owner (`projects.owner_id`) is an implicit Manager and is not stored here.
 * A user may appear in at most one of managers/members/viewers per project (app rule).
 */
export const projectManagers = pgTable(
  "project_managers",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("project_managers_project_user_uidx").on(t.projectId, t.userId),
    index("project_managers_user_id_idx").on(t.userId),
  ],
);

/**
 * Project Members list (T0127 schema; R/W enforcement in T0128).
 * A user may appear in at most one of managers/members/viewers per project (app rule).
 */
export const projectMembers = pgTable(
  "project_members",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("project_members_project_user_uidx").on(t.projectId, t.userId),
    index("project_members_user_id_idx").on(t.userId),
  ],
);

/**
 * Project Viewers list (T0127 schema; read-only enforcement in T0128).
 * A user may appear in at most one of managers/members/viewers per project (app rule).
 */
export const projectViewers = pgTable(
  "project_viewers",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("project_viewers_project_user_uidx").on(t.projectId, t.userId),
    index("project_viewers_user_id_idx").on(t.userId),
  ],
);

/** App users. Display → U####. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → U####. */
  number: integer("number").notNull().unique(),
  /** Unique case-insensitively via `users_display_name_ci_uidx`. */
  displayName: text("display_name").notNull(),
  /** FK to uploads; ON DELETE SET NULL. Declared after uploads via lazy ref. */
  avatarUploadId: integer("avatar_upload_id").references(
    (): AnyPgColumn => uploads.id,
    { onDelete: "set null" },
  ),
  /** Unique among non-null (Postgres UNIQUE allows multiple NULLs). */
  email: text("email").unique(),
  /**
   * Set when the address may be used to sign in (T0129).
   * Null on a self-signup account until the confirmation link is used.
   * Administrator-created accounts and pre-existing rows are set immediately.
   */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  /** SHA-256 hex of the single-use signup confirmation token. Plaintext is not stored. */
  emailConfirmTokenHash: text("email_confirm_token_hash"),
  /** When the confirmation link stops working (24 hours from issue). */
  emailConfirmExpiresAt: timestamp("email_confirm_expires_at", { withTimezone: true }),
  /** scrypt hash; set via admin reset / future Profile (T0062). */
  passwordHash: text("password_hash"),
  /** Null = active; set when admin deactivates the user. */
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  /** Failed login attempts; written when auth exists. */
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  /** Set when login-failure threshold is hit, or when an admin locks the account. */
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  /**
   * Why the account is locked (T0139): `login_failures` | `mfa_deadline` | `admin`.
   * Cleared on unlock.
   */
  lockReason: text("lock_reason"),
  /**
   * AES-GCM ciphertext of TOTP shared secret (env `MFA_TOTP_KEY`); null when not enrolled.
   */
  mfaTotpSecretEnc: text("mfa_totp_secret_enc"),
  /** Set when TOTP MFA is successfully enrolled. */
  mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
  /**
   * Last accepted TOTP time-step counter (replay protection within the ±30s window).
   * Cleared when MFA is cleared.
   */
  mfaTotpLastStep: integer("mfa_totp_last_step"),
  /**
   * First successful primary auth under MFA enforcement while not yet enrolled (grace clock).
   */
  mfaGraceStartedAt: timestamp("mfa_grace_started_at", { withTimezone: true }),
  /** Last UI auth/access — written when auth exists. */
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  /** Last API-key usage — written when API keys exist. */
  lastApiAt: timestamp("last_api_at", { withTimezone: true }),
  /**
   * User opt-in for Tier 1 auto-apply (T0186). Default off.
   * Ignored when the Administrator ceiling has `tier1Enabled` false.
   */
  aiTier1OptIn: boolean("ai_tier1_opt_in").notNull().default(false),
  /**
   * User narrowing of the AI ceiling (T0190).
   * `{ raised, off, featuresOff, allowInventTags }`. Empty or invalid JSON inherits the ceiling.
   * `allowInventTags` (T0199) defaults false: auto-tagging may only use this user's existing tags.
   */
  aiPolicy: jsonb("ai_policy").$type<{
    raised?: Record<string, 0 | 1 | 2 | 3>;
    off?: string[];
    featuresOff?: string[];
    allowInventTags?: boolean;
  }>().notNull().default(sql`'{}'::jsonb`),
  /** Per-user AI instructions (T0209). Not indexed in knowledge_chunks. */
  aiInstructions: text("ai_instructions"),
  /**
   * Attention digest settings (T0216). Empty JSON uses daily, all sections,
   * summary on, timezone UTC, and delivery at or after 07:00 local.
   * `{ frequency, sections, summary, timeZone, hour }`.
   */
  digestPrefs: jsonb("digest_prefs").$type<{
    frequency?: "daily" | "weekly";
    sections?: Partial<Record<string, boolean>>;
    summary?: boolean;
    timeZone?: string;
    hour?: number;
  }>().notNull().default(sql`'{}'::jsonb`),
  /** Set when Home or the digest page has shown the latest digest (T0217). */
  digestSeenAt: timestamp("digest_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  uniqueIndex("users_display_name_ci_uidx").on(sql`lower(btrim(${t.displayName}))`),
  uniqueIndex("users_email_confirm_token_hash_uidx")
    .on(t.emailConfirmTokenHash)
    .where(sql`${t.emailConfirmTokenHash} is not null`),
]);

/**
 * Short-lived MFA challenge after password/OAuth primary auth (T0139).
 * Client posts TOTP against `id` before a session cookie is minted.
 */
export const mfaLoginChallenges = pgTable(
  "mfa_login_challenges",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("mfa_login_challenges_user_id_idx").on(t.userId)],
);

/**
 * Trusted browser devices that may skip MFA (T0141).
 * Cookie holds the opaque token; only `token_hash` is stored.
 */
export const mfaTrustedDevices = pgTable(
  "mfa_trusted_devices",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 hex of the cookie token. */
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mfa_trusted_devices_user_id_idx").on(t.userId),
    index("mfa_trusted_devices_expires_at_idx").on(t.expiresAt),
  ],
);

/**
 * Single-use MFA recovery / backup codes (T0140).
 * Plaintext shown once; only SHA-256 of the normalized code is stored.
 */
export const mfaRecoveryCodes = pgTable(
  "mfa_recovery_codes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 hex of normalized code (uppercase alnum, no dashes). */
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mfa_recovery_codes_user_id_idx").on(t.userId),
    uniqueIndex("mfa_recovery_codes_user_hash_uidx").on(t.userId, t.codeHash),
  ],
);

/** Browser login sessions (opaque id in httpOnly cookie). */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Reserved for session timeout enforcement (T0096 stores; middleware enforces later). */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/**
 * Seeded OAuth/OIDC providers (T0111): google | apple | github.
 * Client secrets / Apple key material encrypted with OAUTH_CREDENTIALS_KEY.
 */
export const oauthProviders = pgTable("oauth_providers", {
  id: serial("id").primaryKey(),
  /** Stable slug: google | apple | github */
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** oidc | oauth2 */
  protocol: text("protocol").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  clientId: text("client_id"),
  /** AES-GCM ciphertext (base64url); null when unset */
  clientSecretEnc: text("client_secret_enc"),
  /** Apple Sign in with Apple only */
  appleTeamId: text("apple_team_id"),
  appleKeyId: text("apple_key_id"),
  applePrivateKeyEnc: text("apple_private_key_enc"),
  scopes: text("scopes"),
  jitEnabled: boolean("jit_enabled").notNull().default(false),
  /** Role assigned on JIT create; null → ensure Editor by slug */
  defaultRoleId: integer("default_role_id").references(
    (): AnyPgColumn => roles.id,
    { onDelete: "set null" },
  ),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Linked external identities (T0111). */
export const userIdentities = pgTable(
  "user_identities",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => oauthProviders.id, { onDelete: "cascade" }),
    /** IdP subject (`sub` or GitHub user id string) */
    subject: text("subject").notNull(),
    emailAtLink: text("email_at_link"),
    rawProfile: jsonb("raw_profile").$type<Record<string, unknown> | null>(),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("user_identities_provider_subject_uidx").on(t.providerId, t.subject),
    index("user_identities_user_id_idx").on(t.userId),
  ],
);

/** Short-lived OAuth login/link state + PKCE (T0111). */
export const oauthLoginStates = pgTable(
  "oauth_login_states",
  {
    state: text("state").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => oauthProviders.id, { onDelete: "cascade" }),
    codeVerifier: text("code_verifier").notNull(),
    nonce: text("nonce"),
    returnTo: text("return_to"),
    /** login | link */
    mode: text("mode").notNull().default("login"),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("oauth_login_states_expires_idx").on(t.expiresAt)],
);

/**
 * Prior password hashes for reuse rejection (T0109).
 * Current hash lives on `users.password_hash`; this table holds up to 4 older hashes
 * so Profile change rejects any of the last 5 passwords (current + 4 prior).
 */
export const passwordHistory = pgTable(
  "password_history",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** scrypt hash (same format as users.password_hash). */
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("password_history_user_created_idx").on(t.userId, t.createdAt)],
);

/** Named roles. System `administrator` is seeded and protected (T0108). */
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** User ↔ role membership. */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index("user_roles_role_id_idx").on(t.roleId),
  ],
);

/**
 * User Groups (T0130) — org/people groups, distinct from Task Groups (`task_groups`).
 * Display → G####. Admins manage via Administration → Groups.
 */
export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → G####. */
  number: integer("number").notNull().unique(),
  name: text("name").notNull().unique(),
  createdById: integer("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Group ↔ user membership. */
export const groupMembers = pgTable(
  "group_members",
  {
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("group_members_user_id_idx").on(t.userId),
  ],
);

/** Group ↔ platform role grants (live expansion to members). */
export const groupRoles = pgTable(
  "group_roles",
  {
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.roleId] }),
    index("group_roles_role_id_idx").on(t.roleId),
  ],
);

/**
 * Project Managers list — Groups (T0130). Live expansion via group_members.
 * A group may appear in at most one of managers/members/viewers per project (app rule).
 */
export const projectManagerGroups = pgTable(
  "project_manager_groups",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("project_manager_groups_project_group_uidx").on(t.projectId, t.groupId),
    index("project_manager_groups_group_id_idx").on(t.groupId),
  ],
);

/** Project Members list — Groups (T0130). */
export const projectMemberGroups = pgTable(
  "project_member_groups",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("project_member_groups_project_group_uidx").on(t.projectId, t.groupId),
    index("project_member_groups_group_id_idx").on(t.groupId),
  ],
);

/** Project Viewers list — Groups (T0130). */
export const projectViewerGroups = pgTable(
  "project_viewer_groups",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("project_viewer_groups_project_group_uidx").on(t.projectId, t.groupId),
    index("project_viewer_groups_group_id_idx").on(t.groupId),
  ],
);

/** API keys (admin bridge; Profile CRUD + enforcement in T0063). */
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Public display prefix, e.g. taskmesh_rw_ab12. */
  prefix: text("prefix").notNull(),
  /** Hash of the full secret key; never returned after create. */
  keyHash: text("key_hash").notNull(),
  /** readonly | readwrite */
  access: text("access").notNull().default("readwrite"),
  /** active | suspended | expired | revoked */
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** System-wide editable properties (enforcement later). */
export const systemProperties = pgTable("system_properties", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Schema metadata for List View columns (T0056).
 * Seeded/maintained with schema development; `displayable: false` hides a field
 * from Personalize and from list columns.
 */
export const entityFields = pgTable(
  "entity_fields",
  {
    id: serial("id").primaryKey(),
    /** Matches EntityType for listable entities (`task`, `idea`, …). */
    entityType: text("entity_type").notNull(),
    /** Stable field key used in prefs JSON and UI (e.g. title, dueDate). */
    fieldKey: text("field_key").notNull(),
    label: text("label").notNull(),
    displayable: boolean("displayable").notNull().default(true),
    defaultVisible: boolean("default_visible").notNull().default(false),
    defaultSortOrder: integer("default_sort_order").notNull().default(0),
    sortable: boolean("sortable").notNull().default(false),
    /**
     * Optional surface filter: `null` = all surfaces for this list-view type;
     * `global` = only global Tasks list (e.g. Project column).
     */
    scope: text("scope"),
  },
  (t) => [
    unique("entity_fields_entity_type_field_key_uidx").on(t.entityType, t.fieldKey),
    index("entity_fields_entity_type_idx").on(t.entityType),
  ],
);

export type ListViewColumnPref = {
  fieldKey: string;
  visible: boolean;
};

/** Per-user List View column order/visibility (T0056). One row per list-view type. */
export const userListViewPrefs = pgTable(
  "user_list_view_prefs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** `tasks` | `ideas` | `todo_lists` — not scoped by project. `todo_lists` uses entity_fields rows with entity_type `todo_list` (membership columns, not the todo_lists table). */
    listViewKey: text("list_view_key").notNull(),
    columns: jsonb("columns").$type<ListViewColumnPref[]>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("user_list_view_prefs_user_list_uidx").on(t.userId, t.listViewKey),
    index("user_list_view_prefs_user_id_idx").on(t.userId),
  ],
);

/**
 * Per-user Task List open/closed state (T0191) and Hide completed (T0338).
 * One row per user. Missing row means every group and parent is expanded
 * and Complete / Canceled tasks stay visible.
 * Arrays store collapsed ids only.
 */
export const userTaskListState = pgTable("user_task_list_state", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Task Group ids the user has collapsed. */
  collapsedGroupIds: jsonb("collapsed_group_ids")
    .$type<number[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** Project ids whose Unassigned section is collapsed. */
  collapsedUngroupedProjectIds: jsonb("collapsed_ungrouped_project_ids")
    .$type<number[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** Parent task ids the user has collapsed (project list and All Tasks). */
  collapsedParentIds: jsonb("collapsed_parent_ids")
    .$type<number[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** When true, task lists hide Complete and Canceled tasks (T0338). */
  hideCompleted: boolean("hide_completed").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type OverviewPanelPref = {
  limit: 5 | 10 | 20;
  /** Days window for date-based panels (recently completed, upcoming). */
  days?: number;
};

/** One Overview canvas panel instance (T0136). Ordered in layout arrays. */
export type OverviewPanelInstance = {
  id: string;
  type: string;
  limit: 5 | 10 | 20;
  days?: number;
};

/** Project-wide Overview default layout (Manager/Owner/Admin). One row per project. */
export const projectOverviewDefaults = pgTable(
  "project_overview_defaults",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Ordered panel instances. */
    layout: jsonb("layout").$type<OverviewPanelInstance[]>().notNull(),
    updatedById: integer("updated_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("project_overview_defaults_project_uidx").on(t.projectId),
    index("project_overview_defaults_project_id_idx").on(t.projectId),
  ],
);

/**
 * Per-user Project Overview canvas layout (T0135/T0136).
 * One row per (user, project). Missing row → follow project default.
 * `layout` is ordered instances; legacy T0135 key→prefs maps are accepted on read and rewritten.
 */
export const userProjectOverviewPrefs = pgTable(
  "user_project_overview_prefs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Ordered panel instances (or legacy map until rewritten). */
    panels: jsonb("panels").$type<OverviewPanelInstance[] | Record<string, OverviewPanelPref>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("user_project_overview_prefs_user_project_uidx").on(t.userId, t.projectId),
    index("user_project_overview_prefs_user_id_idx").on(t.userId),
    index("user_project_overview_prefs_project_id_idx").on(t.projectId),
  ],
);

/** One saved Mesh canvas per user and focused record (T0165). `view` is `focus`. */
export type MeshLayoutPin = { x: number; y: number };
export type MeshLayoutViewport = { x: number; y: number; zoom: number };

export const meshLayouts = pgTable(
  "mesh_layouts",
  {
    id: serial("id").primaryKey(),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Graph root type, including `tag`. */
    rootType: text("root_type").notNull(),
    rootId: integer("root_id").notNull(),
    /** `focus` */
    view: text("view").notNull(),
    /** Pinned node key → top-left. Missing keys stay on the computed layout. */
    positions: jsonb("positions")
      .$type<Record<string, MeshLayoutPin>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Saved pan and zoom. Null until the user moves the canvas. */
    viewport: jsonb("viewport").$type<MeshLayoutViewport | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("mesh_layouts_owner_root_view_uidx").on(t.ownerId, t.rootType, t.rootId, t.view),
    index("mesh_layouts_owner_id_idx").on(t.ownerId),
    check(
      "mesh_layouts_root_type_chk",
      sql`${t.rootType} in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board', 'plan', 'tag')`,
    ),
    check("mesh_layouts_view_chk", sql`${t.view} in ('focus')`),
  ],
);

/** Append-only API request / auth audit log for Admin APIs + Logging. */
export const apiRequestLogs = pgTable(
  "api_request_logs",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** success | api_failure | auth_failure | access_violation */
    outcome: text("outcome").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    statusCode: integer("status_code").notNull(),
    ip: text("ip"),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    apiKeyId: integer("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    message: text("message"),
    /** True when request used an admin-owned key (audit flag). */
    adminKey: boolean("admin_key").notNull().default(false),
    /** Request Content-Length (ingress estimate), bytes. */
    requestBytes: integer("request_bytes").notNull().default(0),
    /** Response body bytes sent to the client (egress estimate). */
    responseBytes: integer("response_bytes").notNull().default(0),
  },
  (t) => [index("api_request_logs_created_at_idx").on(t.createdAt)],
);

/**
 * Singleton outbound mail settings (T0384).
 * Password and API token are AES-256-GCM ciphertext under `EMAIL_CREDENTIALS_KEY`.
 * Hints are the last 4 characters when the secret is longer than 4. The plaintext is not stored.
 */
export const mailSettings = pgTable(
  "mail_settings",
  {
    id: integer("id").primaryKey().default(1),
    enabled: boolean("enabled").notNull().default(false),
    /** Login screen may offer email self-signup (T0129). Still requires outbound mail. */
    selfSignupEnabled: boolean("self_signup_enabled").notNull().default(false),
    host: text("host").notNull().default(""),
    port: integer("port").notNull().default(587),
    /** none | starttls | tls */
    encryption: text("encryption").notNull().default("starttls"),
    username: text("username").notNull().default(""),
    passwordEnc: text("password_enc"),
    passwordHint: text("password_hint"),
    apiTokenEnc: text("api_token_enc"),
    apiTokenHint: text("api_token_hint"),
    fromAddress: text("from_address").notNull().default(""),
    fromName: text("from_name").notNull().default(""),
    replyTo: text("reply_to").notNull().default(""),
    timeoutSeconds: integer("timeout_seconds").notNull().default(30),
    updatedById: integer("updated_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("mail_settings_singleton_chk", sql`${t.id} = 1`),
    check(
      "mail_settings_encryption_chk",
      sql`${t.encryption} in ('none', 'starttls', 'tls')`,
    ),
    check("mail_settings_port_chk", sql`${t.port} between 1 and 65535`),
    check("mail_settings_timeout_chk", sql`${t.timeoutSeconds} between 1 and 120`),
  ],
);

/**
 * Append-only outbound mail transaction log (T0384).
 * Records time, result, To, Subject, and server warnings or errors. The message body is not stored.
 */
export const mailLog = pgTable(
  "mail_log",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** queued | sent | failed | retry | verified */
    result: text("result").notNull(),
    toAddress: text("to_address").notNull().default(""),
    subject: text("subject").notNull().default(""),
    warning: text("warning"),
    error: text("error"),
    jobId: text("job_id"),
    /** outbound | test | connection */
    kind: text("kind").notNull().default("outbound"),
  },
  (t) => [
    index("mail_log_created_at_idx").on(t.createdAt),
    check(
      "mail_log_result_chk",
      sql`${t.result} in ('queued', 'sent', 'failed', 'retry', 'verified')`,
    ),
    check("mail_log_kind_chk", sql`${t.kind} in ('outbound', 'test', 'connection')`),
  ],
);

/**
 * Per-user notification preferences (T0221).
 * One row per user and type. A missing row uses both channels, immediate email,
 * no quiet hours, and UTC.
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** digest | reminder | mention | assignment */
    type: text("type").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(true),
    /** immediate | daily | weekly — applies to email. In-app is immediate. */
    frequency: text("frequency").notNull().default("immediate"),
    /** Local hour 0–23 when quiet hours start. Null with quiet_end means none. */
    quietStart: integer("quiet_start"),
    /** Local hour 0–23 when quiet hours end. The end hour itself is not quiet. */
    quietEnd: integer("quiet_end"),
    timeZone: text("time_zone").notNull().default("UTC"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("notification_preferences_user_type_uidx").on(t.userId, t.type),
    check(
      "notification_preferences_type_chk",
      sql`${t.type} in ('digest', 'reminder', 'mention', 'assignment')`,
    ),
    check(
      "notification_preferences_frequency_chk",
      sql`${t.frequency} in ('immediate', 'daily', 'weekly')`,
    ),
    check(
      "notification_preferences_quiet_chk",
      sql`(${t.quietStart} is null and ${t.quietEnd} is null) or (${t.quietStart} between 0 and 23 and ${t.quietEnd} between 0 and 23 and ${t.quietStart} <> ${t.quietEnd})`,
    ),
  ],
);

/** In-app notification inbox (T0221). */
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** digest | reminder | mention | assignment */
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** App path, such as `/tasks?open=1`. */
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    check(
      "notifications_type_chk",
      sql`${t.type} in ('digest', 'reminder', 'mention', 'assignment')`,
    ),
  ],
);

/**
 * Reusable one-click unsubscribe secret per user and type (T0221).
 * The plaintext token is the capability in the email link.
 */
export const notificationUnsubscribeTokens = pgTable(
  "notification_unsubscribe_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("notification_unsubscribe_user_type_uidx").on(t.userId, t.type),
    unique("notification_unsubscribe_token_uidx").on(t.token),
    check(
      "notification_unsubscribe_type_chk",
      sql`${t.type} in ('digest', 'reminder', 'mention', 'assignment')`,
    ),
  ],
);

/**
 * Email that is waiting for quiet hours or a daily/weekly slot (T0221).
 * `sent_at` is set after the message is accepted by the mail queue.
 */
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    subject: text("subject").notNull(),
    textBody: text("text_body").notNull(),
    htmlBody: text("html_body").notNull(),
    href: text("href"),
    deliverAfter: timestamp("deliver_after", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_outbox_pending_idx")
      .on(t.deliverAfter)
      .where(sql`${t.sentAt} is null`),
    check(
      "notification_outbox_type_chk",
      sql`${t.type} in ('digest', 'reminder', 'mention', 'assignment')`,
    ),
  ],
);

/**
 * One reminder already sent for a record and date (T0221).
 * `marker` is the due date (`YYYY-MM-DD`) or the action-by instant.
 */
export const notificationReminderMarks = pgTable(
  "notification_reminder_marks",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    /** due | action_by */
    kind: text("kind").notNull(),
    marker: text("marker").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("notification_reminder_marks_uidx").on(
      t.userId,
      t.entityType,
      t.entityId,
      t.kind,
      t.marker,
    ),
    check(
      "notification_reminder_marks_entity_chk",
      sql`${t.entityType} in ('task', 'todo')`,
    ),
    check(
      "notification_reminder_marks_kind_chk",
      sql`${t.kind} in ('due', 'action_by')`,
    ),
  ],
);

/**
 * One encrypted provider key for the whole instance (T0182).
 * Ciphertext is AES-256-GCM under `AI_CREDENTIALS_KEY`. `hint` is the last 4 characters only.
 */
export const aiInstanceCredentials = pgTable(
  "ai_instance_credentials",
  {
    id: serial("id").primaryKey(),
    pluginId: text("plugin_id").notNull().unique(),
    secretEnc: text("secret_enc").notNull(),
    hint: text("hint").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Redacted provider rejection (max 500). Set when Verify or a live call rejects the key. */
    lastError: text("last_error"),
    updatedById: integer("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pluginCheck: check(
      "ai_instance_credentials_plugin_chk",
      sql`${t.pluginId} ~ '^[a-z0-9-]+$'`,
    ),
    hintCheck: check(
      "ai_instance_credentials_hint_chk",
      sql`char_length(${t.hint}) between 1 and 4`,
    ),
    errorCheck: check(
      "ai_instance_credentials_error_chk",
      sql`${t.lastError} is null or char_length(${t.lastError}) between 1 and 500`,
    ),
  }),
);

/**
 * One encrypted provider API key per user and plugin (T0183).
 * Ciphertext is AES-256-GCM under `AI_CREDENTIALS_KEY`. `hint` is the last 4 characters only.
 * Rows are removed when the user is deleted.
 */
export const userAiCredentials = pgTable(
  "user_ai_credentials",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pluginId: text("plugin_id").notNull(),
    secretEnc: text("secret_enc").notNull(),
    hint: text("hint").notNull(),
    defaultModel: text("default_model"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userPlugin: unique("user_ai_credentials_user_plugin_uidx").on(t.userId, t.pluginId),
    pluginCheck: check(
      "user_ai_credentials_plugin_chk",
      sql`${t.pluginId} ~ '^[a-z0-9-]+$'`,
    ),
    hintCheck: check(
      "user_ai_credentials_hint_chk",
      sql`char_length(${t.hint}) between 1 and 4`,
    ),
    modelCheck: check(
      "user_ai_credentials_model_chk",
      sql`${t.defaultModel} is null or char_length(${t.defaultModel}) between 1 and 120`,
    ),
    errorCheck: check(
      "user_ai_credentials_error_chk",
      sql`${t.lastError} is null or char_length(${t.lastError}) between 1 and 500`,
    ),
  }),
);

/**
 * One model choice per user and AI feature (T0205).
 * Distinct from `user_ai_credentials.default_model`, which is the per-plugin default.
 * Rows are removed when the user is deleted.
 */
export const userAiRoutePrefs = pgTable(
  "user_ai_route_prefs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    pluginId: text("plugin_id").notNull(),
    model: text("model").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userFeature: unique("user_ai_route_prefs_user_feature_uidx").on(t.userId, t.feature),
    featureCheck: check(
      "user_ai_route_prefs_feature_chk",
      sql`${t.feature} ~ '^[a-z0-9_]+$'`,
    ),
    pluginCheck: check(
      "user_ai_route_prefs_plugin_chk",
      sql`${t.pluginId} ~ '^[a-z0-9-]+$'`,
    ),
    modelCheck: check(
      "user_ai_route_prefs_model_chk",
      sql`char_length(${t.model}) between 1 and 120`,
    ),
  }),
);

/**
 * Append-only log of assistant tool calls, replies, and proposal applies (T0178).
 * Stores the decision and token counts, not prompts, arguments, or record text.
 * A respond row may store prompt id, version, and a composed ref (T0212). It does not store prompt text.
 * A web_fetch allow row stores `Fetched` plus the capped URL in `reason`.
 * A write or web_fetch that follows private record text in the same turn appends `untrusted-followup` (T0201).
 */
export const aiAuditLog = pgTable(
  "ai_audit_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    feature: text("feature").notNull(),
    provider: text("provider"),
    model: text("model"),
    tool: text("tool"),
    /** read | propose_create | propose_update | link | tag | comment | apply | propose_delete | web_fetch | bulk | respond | key_mode | route | undo | usage | settings */
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** allow | deny */
    decision: text("decision").notNull(),
    reason: text("reason"),
    tier: integer("tier").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    latencyMs: integer("latency_ms"),
    /** Primary prompt id for a model reply (T0212). Null on route, tool, apply, and key-mode rows. */
    promptId: text("prompt_id"),
    /** Version of `prompt_id`. */
    promptVersion: integer("prompt_version"),
    /** Full composition, e.g. assistant@1 or assistant@1+assistant_web_fetch@1. No prompt text. */
    promptRef: text("prompt_ref"),
    /** user | instance | local. Set on usage rows (T0188). */
    keySource: text("key_source"),
    /** Estimated instance-key cost in micro-USD. Zero for user and local keys. */
    costMicrousd: integer("cost_microusd"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("ai_audit_log_created_at_idx").on(t.createdAt),
    usageUserIdx: index("ai_audit_log_usage_user_idx").on(t.userId, t.createdAt),
    decisionCheck: check(
      "ai_audit_log_decision_chk",
      sql`${t.decision} in ('allow', 'deny')`,
    ),
    actionCheck: check(
      "ai_audit_log_action_chk",
      sql`${t.action} in ('read', 'propose_create', 'propose_update', 'link', 'tag', 'comment', 'apply', 'propose_delete', 'web_fetch', 'bulk', 'respond', 'key_mode', 'route', 'undo', 'usage', 'settings')`,
    ),
    keySourceCheck: check(
      "ai_audit_log_key_source_chk",
      sql`${t.keySource} is null or ${t.keySource} in ('user', 'instance', 'local')`,
    ),
    costCheck: check(
      "ai_audit_log_cost_microusd_chk",
      sql`${t.costMicrousd} is null or ${t.costMicrousd} >= 0`,
    ),
    promptIdCheck: check(
      "ai_audit_log_prompt_id_chk",
      sql`${t.promptId} is null or ${t.promptId} ~ '^[a-z0-9_]+$'`,
    ),
    promptVersionCheck: check(
      "ai_audit_log_prompt_version_chk",
      sql`${t.promptVersion} is null or ${t.promptVersion} >= 1`,
    ),
    promptRefCheck: check(
      "ai_audit_log_prompt_ref_chk",
      sql`${t.promptRef} is null or char_length(${t.promptRef}) between 1 and 200`,
    ),
    promptSetCheck: check(
      "ai_audit_log_prompt_set_chk",
      sql`(${t.promptId} is null and ${t.promptVersion} is null and ${t.promptRef} is null) or (${t.promptId} is not null and ${t.promptVersion} is not null and ${t.promptRef} is not null and (${t.promptRef} = ${t.promptId} || '@' || ${t.promptVersion}::text or ${t.promptRef} like ${t.promptId} || '@' || ${t.promptVersion}::text || '/%' or ${t.promptRef} like ${t.promptId} || '@' || ${t.promptVersion}::text || '+%'))`,
    ),
  }),
);

/**
 * Inverse of a Tier 1 auto-apply (T0186).
 * `inverse` holds ids and a comment body hash, not prompt or record text.
 */
export const aiUndoJournal = pgTable(
  "ai_undo_journal",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    auditId: integer("audit_id").references(() => aiAuditLog.id, { onDelete: "set null" }),
    /** tag | link | comment. A task dependency is stored as link. */
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    summary: text("summary").notNull(),
    inverse: jsonb("inverse").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    /** applied | undone | skipped */
    status: text("status").notNull().default("applied"),
  },
  (t) => ({
    userAppliedIdx: index("ai_undo_journal_user_applied_idx").on(t.userId, t.appliedAt),
    actionCheck: check(
      "ai_undo_journal_action_chk",
      sql`${t.action} in ('tag', 'link', 'comment')`,
    ),
    statusCheck: check(
      "ai_undo_journal_status_chk",
      sql`${t.status} in ('applied', 'undone', 'skipped')`,
    ),
    summaryCheck: check(
      "ai_undo_journal_summary_chk",
      sql`char_length(${t.summary}) between 1 and 500`,
    ),
  }),
);

/**
 * Quality signals for one AI audit row (T0211).
 * The audit log stays append-only; thumbs and outcomes live here.
 * A note is optional and only used with thumbs (max 500 characters).
 */
export const aiOutputFeedback = pgTable(
  "ai_output_feedback",
  {
    id: serial("id").primaryKey(),
    auditId: integer("audit_id")
      .notNull()
      .references(() => aiAuditLog.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    /** thumb_up | thumb_down | accept | dismiss | undo */
    kind: text("kind").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    auditIdx: index("ai_output_feedback_audit_id_idx").on(t.auditId),
    createdIdx: index("ai_output_feedback_created_at_idx").on(t.createdAt),
    kindCheck: check(
      "ai_output_feedback_kind_chk",
      sql`${t.kind} in ('thumb_up', 'thumb_down', 'accept', 'dismiss', 'undo')`,
    ),
    noteCheck: check(
      "ai_output_feedback_note_chk",
      sql`${t.note} is null or char_length(${t.note}) <= 500`,
    ),
    thumbUidx: uniqueIndex("ai_output_feedback_thumb_uidx")
      .on(t.auditId, t.userId)
      .where(sql`${t.kind} in ('thumb_up', 'thumb_down')`),
    outcomeUidx: uniqueIndex("ai_output_feedback_outcome_uidx")
      .on(t.auditId, t.kind)
      .where(sql`${t.kind} in ('accept', 'dismiss', 'undo')`),
  }),
);

/**
 * Pending and applied AI tag suggestions (T0199).
 * One row per surfaced tag. Does not store record text.
 * `pending` waits for Accept or Dismiss. `applied` was auto-applied.
 * `accepted` and `dismissed` are the one-click outcomes.
 */
export const aiTagSuggestions = pgTable(
  "ai_tag_suggestions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    tagId: integer("tag_id").references(() => tags.id, { onDelete: "cascade" }),
    proposedName: text("proposed_name"),
    confidence: real("confidence").notNull(),
    /** pending | applied | accepted | dismissed */
    status: text("status").notNull().default("pending"),
    auditId: integer("audit_id").references(() => aiAuditLog.id, { onDelete: "set null" }),
    journalId: integer("journal_id").references(() => aiUndoJournal.id, { onDelete: "set null" }),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("ai_tag_suggestions_entity_idx").on(t.userId, t.entityType, t.entityId),
    journalIdx: index("ai_tag_suggestions_journal_idx").on(t.journalId),
    pendingTagUidx: uniqueIndex("ai_tag_suggestions_pending_tag_uidx")
      .on(t.userId, t.entityType, t.entityId, t.tagId)
      .where(sql`${t.status} = 'pending' and ${t.tagId} is not null`),
    pendingNameUidx: uniqueIndex("ai_tag_suggestions_pending_name_uidx")
      .on(t.userId, t.entityType, t.entityId, t.proposedName)
      .where(sql`${t.status} = 'pending' and ${t.proposedName} is not null`),
    statusCheck: check(
      "ai_tag_suggestions_status_chk",
      sql`${t.status} in ('pending', 'applied', 'accepted', 'dismissed')`,
    ),
    confidenceCheck: check(
      "ai_tag_suggestions_confidence_chk",
      sql`${t.confidence} >= 0 and ${t.confidence} <= 1`,
    ),
    targetCheck: check(
      "ai_tag_suggestions_target_chk",
      sql`${t.tagId} is not null or ${t.proposedName} is not null`,
    ),
    entityTypeCheck: check(
      "ai_tag_suggestions_entity_type_chk",
      sql`${t.entityType} in ('idea', 'project', 'task', 'todo', 'document')`,
    ),
    nameCheck: check(
      "ai_tag_suggestions_name_chk",
      sql`${t.proposedName} is null or char_length(${t.proposedName}) between 1 and 100`,
    ),
  }),
);

/**
 * Likely duplicate task/todo pairs for one user (T0200).
 * Ends are stored in canonical order so a task↔todo pair is one row.
 * `pending` is a warning. `linked` and `ignored` are user choices.
 * `rejected` is a model “no” and is not raised again for this pair.
 */
export const aiDuplicatePairs = pgTable(
  "ai_duplicate_pairs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    aType: text("a_type").notNull(),
    aId: integer("a_id").notNull(),
    bType: text("b_type").notNull(),
    bId: integer("b_id").notNull(),
    score: real("score").notNull(),
    /** exact_title | near_title | index | model */
    reason: text("reason").notNull(),
    /** pending | linked | ignored | rejected */
    status: text("status").notNull().default("pending"),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairUidx: uniqueIndex("ai_duplicate_pairs_pair_uidx").on(t.userId, t.aType, t.aId, t.bType, t.bId),
    aIdx: index("ai_duplicate_pairs_a_idx").on(t.userId, t.aType, t.aId),
    bIdx: index("ai_duplicate_pairs_b_idx").on(t.userId, t.bType, t.bId),
    statusCheck: check(
      "ai_duplicate_pairs_status_chk",
      sql`${t.status} in ('pending', 'linked', 'ignored', 'rejected')`,
    ),
    scoreCheck: check(
      "ai_duplicate_pairs_score_chk",
      sql`${t.score} >= 0 and ${t.score} <= 1`,
    ),
    reasonCheck: check(
      "ai_duplicate_pairs_reason_chk",
      sql`${t.reason} in ('exact_title', 'near_title', 'index', 'model')`,
    ),
    typeCheck: check(
      "ai_duplicate_pairs_type_chk",
      sql`${t.aType} in ('task', 'todo') and ${t.bType} in ('task', 'todo')`,
    ),
    orderCheck: check(
      "ai_duplicate_pairs_order_chk",
      sql`${t.aType} < ${t.bType} or (${t.aType} = ${t.bType} and ${t.aId} < ${t.bId})`,
    ),
  }),
);

/**
 * Proposed record links for one user (T0168).
 * `src` would reference `dst`. Nothing is written to `entity_links` until Accept.
 * `dismissed` and `rejected` are not suggested again for that pair.
 * `accepted` means the user created the manual references link.
 */
export const aiLinkSuggestions = pgTable(
  "ai_link_suggestions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    srcType: text("src_type").notNull(),
    srcId: integer("src_id").notNull(),
    dstType: text("dst_type").notNull(),
    dstId: integer("dst_id").notNull(),
    score: real("score").notNull(),
    reason: text("reason").notNull(),
    /** shared_tags | mention | same_list | same_board | similar_text */
    signal: text("signal").notNull(),
    /** pending | accepted | dismissed | rejected */
    status: text("status").notNull().default("pending"),
    auditId: integer("audit_id").references(() => aiAuditLog.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairUidx: uniqueIndex("ai_link_suggestions_pair_uidx").on(
      t.userId,
      t.srcType,
      t.srcId,
      t.dstType,
      t.dstId,
    ),
    srcIdx: index("ai_link_suggestions_src_idx").on(t.userId, t.srcType, t.srcId),
    dstIdx: index("ai_link_suggestions_dst_idx").on(t.userId, t.dstType, t.dstId),
    statusCheck: check(
      "ai_link_suggestions_status_chk",
      sql`${t.status} in ('pending', 'accepted', 'dismissed', 'rejected')`,
    ),
    scoreCheck: check(
      "ai_link_suggestions_score_chk",
      sql`${t.score} >= 0 and ${t.score} <= 1`,
    ),
    reasonCheck: check(
      "ai_link_suggestions_reason_chk",
      sql`char_length(${t.reason}) between 1 and 160`,
    ),
    signalCheck: check(
      "ai_link_suggestions_signal_chk",
      sql`${t.signal} in ('shared_tags', 'mention', 'same_list', 'same_board', 'similar_text')`,
    ),
    typeCheck: check(
      "ai_link_suggestions_type_chk",
      sql`${t.srcType} in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board', 'plan') and ${t.dstType} in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board', 'plan')`,
    ),
    notSelf: check(
      "ai_link_suggestions_not_self",
      sql`not (${t.srcType} = ${t.dstType} and ${t.srcId} = ${t.dstId})`,
    ),
  }),
);

/**
 * One stored attention digest per user and period (T0216).
 * Facts are deterministic. `summary` is an optional model paragraph.
 */
export const attentionDigests = pgTable(
  "attention_digests",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Local date `YYYY-MM-DD` or ISO week `YYYY-Www`. */
    periodKey: text("period_key").notNull(),
    /** daily | weekly */
    frequency: text("frequency").notNull(),
    timeZone: text("time_zone").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    sections: jsonb("sections").notNull(),
    counts: jsonb("counts").notNull(),
    enabled: jsonb("enabled").notNull(),
    summary: text("summary"),
    /** model | null */
    summarySource: text("summary_source"),
    excludedProjects: jsonb("excluded_projects").notNull().default(sql`'[]'::jsonb`),
  },
  (t) => ({
    userPeriodUidx: uniqueIndex("attention_digests_user_period_uidx").on(t.userId, t.periodKey),
    userGeneratedIdx: index("attention_digests_user_generated_idx").on(t.userId, t.generatedAt),
    frequencyCheck: check(
      "attention_digests_frequency_chk",
      sql`${t.frequency} in ('daily', 'weekly')`,
    ),
    summarySourceCheck: check(
      "attention_digests_summary_source_chk",
      sql`${t.summarySource} is null or ${t.summarySource} = 'model'`,
    ),
  }),
);

/**
 * Per-item snooze or dismiss for the attention digest (T0217).
 * Dismiss applies to one period. Snooze applies until `until`.
 * The stored digest row is not rewritten.
 */
export const digestItemHides = pgTable(
  "digest_item_hides",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    section: text("section").notNull(),
    /** snooze | dismiss */
    kind: text("kind").notNull(),
    /** Dismiss hides this period key only. */
    periodKey: text("period_key"),
    /** Snooze hides until this instant. */
    until: timestamp("until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userItemUidx: uniqueIndex("digest_item_hides_user_item_uidx").on(
      t.userId,
      t.entityType,
      t.entityId,
      t.section,
    ),
    kindCheck: check("digest_item_hides_kind_chk", sql`${t.kind} in ('snooze', 'dismiss')`),
    sectionCheck: check(
      "digest_item_hides_section_chk",
      sql`${t.section} in ('overdue', 'at_risk', 'stale', 'blocked', 'changed', 'suggestions', 'duplicates', 'assigned_out')`,
    ),
    shapeCheck: check(
      "digest_item_hides_shape_chk",
      sql`(${t.kind} = 'snooze' and ${t.until} is not null) or (${t.kind} = 'dismiss' and ${t.periodKey} is not null)`,
    ),
  }),
);

/** Periodic Postgres gauges for Administration → Database charts. */
export const dbStatsSnapshots = pgTable(
  "db_stats_snapshots",
  {
    id: serial("id").primaryKey(),
    sampledAt: timestamp("sampled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** pg_database_size of the connected app database. */
    databaseSizeBytes: bigint("database_size_bytes", { mode: "number" }).notNull(),
    /** User tables in the app database (pg_stat_user_tables). */
    tableCount: integer("table_count").notNull(),
    /** Always 1 — only the connected app database is counted. */
    databaseCount: integer("database_count").notNull(),
    datname: text("datname").notNull(),
  },
  (t) => ({
    sampledAtIdx: index("db_stats_snapshots_sampled_at_idx").on(t.sampledAt),
  }),
);

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  /** Null when task lives only in Lists / Unsorted (not project-scoped). */
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  /** Optional Project Phase (not Task Group membership). */
  phaseId: integer("phase_id").references(() => projectPhases.id, {
    onDelete: "set null",
  }),
  parentId: integer("parent_id").references((): AnyPgColumn => tasks.id, {
    onDelete: "set null",
  }),
  /** App-wide unique display number → T####. */
  number: integer("number").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  /** new (Draft) | ready | in_progress | pending | complete | canceled | on_hold | deleted */
  state: text("state").notNull().default("new"),
  /** none | low | medium | high | urgent */
  priority: text("priority").notNull().default("none"),
  /** Date-only due date (YYYY-MM-DD). */
  dueDate: date("due_date", { mode: "string" }),
  /**
   * Schedule hint (YYYY-MM-DD): do not place work before this date.
   * Does not block In Progress. Null means no constraint.
   */
  startDate: date("start_date", { mode: "string" }),
  /**
   * Effort estimate in hours. Null = not estimated. 0 = trivial.
   * Quarter-hour steps only (0, 0.25, …, 999.75 at the API).
   */
  estimateHours: numeric("estimate_hours", { precision: 6, scale: 2, mode: "number" }),
  /** @deprecated Prefer dueDate; kept for migration compatibility. */
  dueAt: timestamp("due_at", { withTimezone: true }),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdById: integer("created_by_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  updatedById: integer("updated_by_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  /** Record owner (T0112). Unsorted tasks use this; project tasks also stamped. */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  /**
   * Optional assignee (T0117). Distinct from ownership.
   * When project-scoped: must be Project Owner, Manager, or Member (not Viewer).
   */
  assigneeId: integer("assignee_id").references(() => users.id, {
    onDelete: "set null",
  }),
  /**
   * When true, `state` is hand-set. When false and `rollup_total` is set,
   * status is derived from descendant leaf tasks (T0335).
   */
  stateManual: boolean("state_manual").notNull().default(false),
  /** Complete counted leaves. Null when this task has no counted leaves. */
  rollupDone: integer("rollup_done"),
  /** Counted leaves (non-deleted, non-canceled). Null when not derived. */
  rollupTotal: integer("rollup_total"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  rollupPair: check(
    "tasks_rollup_pair",
    sql`(${t.rollupDone} is null and ${t.rollupTotal} is null) or (${t.rollupDone} >= 0 and ${t.rollupTotal} > 0 and ${t.rollupDone} <= ${t.rollupTotal})`,
  ),
  estimateHoursQuarter: check(
    "tasks_estimate_hours_quarter",
    sql`${t.estimateHours} >= 0 AND ${t.estimateHours} * 4 = trunc(${t.estimateHours} * 4)`,
  ),
  startNotAfterDue: check(
    "tasks_start_not_after_due",
    sql`${t.startDate} is null or ${t.dueDate} is null or ${t.startDate} <= ${t.dueDate}`,
  ),
}));

/** Manual members for Task Groups with no active filter (List View drag-into). */
export const taskGroupMembers = pgTable(
  "task_group_members",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => taskGroups.id, { onDelete: "cascade" }),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    groupTaskUniq: unique("task_group_members_group_task_uidx").on(t.groupId, t.taskId),
  }),
);

/** Reusable Markdown bodies for Task Description (project-scoped or Global). */
export const taskDescriptionTemplates = pgTable("task_description_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  /** Null when saved from an unsorted / non-project task. */
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  /** When true, available on all tasks regardless of project. */
  isGlobal: boolean("is_global").notNull().default(false),
  createdById: integer("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedById: integer("updated_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  /** Creator-owned (T0112). Global templates still scoped to owner (+ admin). */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * History timeline for any record: user comments and auto-recorded field changes.
 * Keyed by `(entity_type, entity_id)`. `task_id` is set only for tasks so task
 * deletes still cascade. ToDo, Project, Document, and ToDo List deletes purge
 * their rows via database triggers. List comments live on the list. A list's
 * last update is still derived from its member ToDos and Tasks.
 */
export const taskActivity = pgTable(
  "task_activity",
  {
    id: serial("id").primaryKey(),
    /** Set when `entity_type` is `task`; null for every other type. */
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    /** comment | change */
    kind: text("kind").notNull(),
    /** Comment rows: Markdown body and last-edit timestamp. */
    body: text("body"),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    /**
     * Change rows: which field and its before/after display values.
     * Session summaries use field=`summary` with the concise text in `body`.
     * Document body edits use field=`body` and leave old/new null.
     */
    field: text("field"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    /** Actor who authored the comment / change (nullable for legacy rows). */
    createdById: integer("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** `ui` = SPA; `api` = other clients; `ai` = an applied assistant proposal. */
    source: text("source").notNull().default("api"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    entityIdx: index("task_activity_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    entityTypeCheck: check(
      "task_activity_entity_type_chk",
      sql`${t.entityType} in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board', 'plan')`,
    ),
    taskLinkCheck: check(
      "task_activity_task_link_chk",
      sql`(${t.entityType} = 'task' and ${t.taskId} = ${t.entityId}) or (${t.entityType} <> 'task' and ${t.taskId} is null)`,
    ),
    sourceCheck: check(
      "task_activity_source_chk",
      sql`${t.source} in ('ui', 'api', 'ai')`,
    ),
  }),
);

/**
 * Directed blocking edges: `taskId` Depends on `dependsOnTaskId`.
 * Inverse view = Required by. Separate from parentId hierarchy.
 */
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: integer("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pairUniq: unique("task_dependencies_pair_uidx").on(t.taskId, t.dependsOnTaskId),
  }),
);

export const projectDocuments = pgTable("project_documents", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → N####. */
  number: integer("number").notNull().unique(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body"),
  /** `markdown` (default), `epub`, or `pdf` (binary via uploadId). */
  kind: text("kind").notNull().default("markdown"),
  /** FK to uploads for binary document kinds (epub, pdf). */
  uploadId: integer("upload_id").references((): AnyPgColumn => uploads.id, {
    onDelete: "set null",
  }),
  position: integer("position").notNull().default(0),
  updatedById: integer("updated_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** One extraction run per document. Text lives in `document_text_spans`, not `body`. */
export const documentExtractions = pgTable(
  "document_extractions",
  {
    documentId: integer("document_id")
      .primaryKey()
      .references(() => projectDocuments.id, { onDelete: "cascade" }),
    /** Upload this row describes. Stale when it differs from `project_documents.upload_id`. */
    uploadId: integer("upload_id").references((): AnyPgColumn => uploads.id, {
      onDelete: "set null",
    }),
    /** `pending` | `ready` | `empty` | `failed` */
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    /** Page count (PDF) or chapter count (EPUB). */
    unitCount: integer("unit_count").notNull().default(0),
    charCount: integer("char_count").notNull().default(0),
    truncated: boolean("truncated").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusCheck: check(
      "document_extractions_status_chk",
      sql`${t.status} in ('pending', 'ready', 'empty', 'failed')`,
    ),
  }),
);

/** One row per PDF page or EPUB spine item, in reading order. */
export const documentTextSpans = pgTable(
  "document_text_spans",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => projectDocuments.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    /** 1-based page number or spine index. */
    locator: integer("locator").notNull(),
    label: text("label").notNull(),
    text: text("text").notNull(),
  },
  (t) => ({
    documentOrdinalUniq: unique("document_text_spans_document_ordinal_uidx").on(
      t.documentId,
      t.ordinal,
    ),
    documentLocatorIdx: index("document_text_spans_document_locator_idx").on(
      t.documentId,
      t.locator,
    ),
  }),
);

/** pgvector column. Embeddings are 768-d (`nomic-embed-text`). */
export const vector768 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(768)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    const trimmed = value.trim().replace(/^\[/, "").replace(/\]$/, "");
    if (!trimmed) return [];
    return trimmed.split(",").map((part) => Number(part));
  },
});

/** Stored `tsvector`. Written as `to_tsvector('simple', content)` on insert. */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * Full-text and embedding chunks for search (T0208).
 * No FK to the source record: deletes remove rows in the app, and the nightly sweep drops orphans.
 * `source_id` is 0 for the record's own title or body, an activity id for a comment, or a text-span id.
 */
export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    /** `title` | `body` | `comment` | `extraction` */
    source: text("source").notNull(),
    sourceId: integer("source_id").notNull().default(0),
    chunkIndex: integer("chunk_index").notNull(),
    heading: text("heading"),
    /** 1-based PDF page or EPUB spine index. Null for Markdown and titles. */
    locator: integer("locator"),
    startOffset: integer("start_offset").notNull().default(0),
    endOffset: integer("end_offset").notNull().default(0),
    content: text("content").notNull(),
    contentTsv: tsvector("content_tsv").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector768("embedding"),
    embeddingModel: text("embedding_model"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    entitySourceUniq: unique("knowledge_chunks_entity_source_uidx").on(
      t.entityType,
      t.entityId,
      t.source,
      t.sourceId,
      t.chunkIndex,
    ),
    entityIdx: index("knowledge_chunks_entity_idx").on(t.entityType, t.entityId),
    projectIdx: index("knowledge_chunks_project_idx").on(t.projectId),
    entityTypeCheck: check(
      "knowledge_chunks_entity_type_chk",
      sql`${t.entityType} in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board', 'plan')`,
    ),
    sourceCheck: check(
      "knowledge_chunks_source_chk",
      sql`${t.source} in ('title', 'body', 'comment', 'extraction')`,
    ),
  }),
);

export const uploads = pgTable("uploads", {
  id: serial("id").primaryKey(),
  /** Stored filename on disk (UUID + extension). */
  storedName: text("stored_name").notNull().unique(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  /** Record owner (T0112). GET/delete scoped in T0114. */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tags = pgTable(
  "tags",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    color: text("color"),
    /** Per-user tags (T0112). Uniqueness is (owner_id, name). */
    ownerId: integer("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerNameUniq: unique("tags_owner_id_name_uidx").on(t.ownerId, t.name),
  }),
);

/** Polymorphic join: tag ↔ (entity_type, entity_id). */
export const taggings = pgTable(
  "taggings",
  {
    id: serial("id").primaryKey(),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
  },
  (t) => ({
    tagEntityUniq: unique("taggings_tag_entity_uidx").on(
      t.tagId,
      t.entityType,
      t.entityId,
    ),
  }),
);

/**
 * Directed record-to-record links (T0160). Polymorphic ends, so no FK cascade;
 * AFTER DELETE triggers purge rows when either end is hard-deleted.
 * `origin` separates manual links from later mention sync (T0161).
 */
const ENTITY_LINK_TYPES_SQL = `'idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board', 'plan'`;

export const entityLinks = pgTable(
  "entity_links",
  {
    id: serial("id").primaryKey(),
    srcType: text("src_type").notNull(),
    srcId: integer("src_id").notNull(),
    dstType: text("dst_type").notNull(),
    dstId: integer("dst_id").notNull(),
    /** relates_to | references | supports | part_of | duplicate_of */
    relation: text("relation").notNull().default("relates_to"),
    /** manual | mention */
    origin: text("origin").notNull().default("manual"),
    createdById: integer("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pairUniq: unique("entity_links_pair_uidx").on(
      t.srcType,
      t.srcId,
      t.dstType,
      t.dstId,
      t.relation,
      t.origin,
    ),
    srcIdx: index("entity_links_src_idx").on(t.srcType, t.srcId),
    dstIdx: index("entity_links_dst_idx").on(t.dstType, t.dstId),
    srcTypeCheck: check(
      "entity_links_src_type_chk",
      sql`${t.srcType} in (${sql.raw(ENTITY_LINK_TYPES_SQL)})`,
    ),
    dstTypeCheck: check(
      "entity_links_dst_type_chk",
      sql`${t.dstType} in (${sql.raw(ENTITY_LINK_TYPES_SQL)})`,
    ),
    relationCheck: check(
      "entity_links_relation_chk",
      sql`${t.relation} in ('relates_to', 'references', 'supports', 'part_of', 'duplicate_of')`,
    ),
    originCheck: check(
      "entity_links_origin_chk",
      sql`${t.origin} in ('manual', 'mention')`,
    ),
    notSelf: check(
      "entity_links_not_self",
      sql`not (${t.srcType} = ${t.dstType} and ${t.srcId} = ${t.dstId})`,
    ),
  }),
);

/**
 * First-class ToDo records (UI: "ToDo"; display D####).
 * Lighter than Task: scheduled work without full task hierarchy/phases.
 */
export const todos = pgTable("todos", {
  id: serial("id").primaryKey(),
  /** Null when not project-scoped (same idea as tasks). */
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  /** App-wide unique display number → D####. */
  number: integer("number").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  /** Same values as tasks.state (including soft-delete `deleted`). */
  state: text("state").notNull().default("new"),
  /** none | low | medium | high | urgent */
  priority: text("priority").notNull().default("none"),
  /** Date-only due date (YYYY-MM-DD). */
  dueDate: date("due_date", { mode: "string" }),
  /**
   * Schedule hint (YYYY-MM-DD): do not place work before this date.
   * Does not block In Progress. Null means no constraint.
   */
  startDate: date("start_date", { mode: "string" }),
  /**
   * Effort estimate in hours. Null = not estimated. 0 = trivial.
   * Quarter-hour steps only (0, 0.25, …, 999.75 at the API).
   */
  estimateHours: numeric("estimate_hours", { precision: 6, scale: 2, mode: "number" }),
  /** When this ToDo should be acted on. */
  actionBy: timestamp("action_by", { withTimezone: true }),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Set when created by converting an Idea. */
  sourceIdeaId: integer("source_idea_id").references(() => ideas.id, {
    onDelete: "set null",
  }),
  createdById: integer("created_by_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  updatedById: integer("updated_by_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  /** Record owner (T0112). Unsorted todos use this; project todos also stamped. */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  /**
   * Optional assignee (T0117). Distinct from ownership.
   * When project-scoped: must be Project Owner, Manager, or Member (not Viewer).
   */
  assigneeId: integer("assignee_id").references(() => users.id, {
    onDelete: "set null",
  }),
  /** User-set percent complete, 0–100 (T0155). Parents with sub-items store the derived rollup (T0097). */
  progress: integer("progress").notNull().default(0),
  /** Sub-item parent (T0097). Null = top-level. */
  parentId: integer("parent_id").references((): AnyPgColumn => todos.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  progressRange: check("todos_progress_range", sql`${t.progress} >= 0 AND ${t.progress} <= 100`),
  estimateHoursQuarter: check(
    "todos_estimate_hours_quarter",
    sql`${t.estimateHours} >= 0 AND ${t.estimateHours} * 4 = trunc(${t.estimateHours} * 4)`,
  ),
  startNotAfterDue: check(
    "todos_start_not_after_due",
    sql`${t.startDate} is null or ${t.dueDate} is null or ${t.startDate} <= ${t.dueDate}`,
  ),
  parentIdx: index("todos_parent_id_idx").on(t.parentId),
}));

/** Standalone or project-scoped checklist containers. */
export const todoLists = pgTable("todo_lists", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → L####. */
  number: integer("number").notNull().unique(),
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("list"),
  /** Record owner (T0112). Standalone lists use this; project lists also stamped. */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Polymorphic list rows. New memberships: `todo` | `task`.
 * Legacy `idea` rows may remain (no data migration); read/remove only.
 */
export const todoListItems = pgTable(
  "todo_list_items",
  {
    id: serial("id").primaryKey(),
    listId: integer("list_id")
      .notNull()
      .references(() => todoLists.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    checked: boolean("checked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    listEntityUniq: unique("todo_list_items_list_entity_uidx").on(
      t.listId,
      t.entityType,
      t.entityId,
    ),
  }),
);

/** Per-project enablement of hub modules (tasks, wiki, boards, …). */
export const projectModules = pgTable(
  "project_modules",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    projectModuleUniq: unique("project_modules_project_key_uidx").on(t.projectId, t.moduleKey),
  }),
);

/**
 * Ordered, phased sequences of Tasks and ToDos (T0309).
 * Display number → PL####. `project_id` null means a standalone plan.
 */
export const plans = pgTable(
  "plans",
  {
    id: serial("id").primaryKey(),
    /** App-wide unique display number → PL####. */
    number: integer("number").notNull().unique(),
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    /** draft | active | complete | archived */
    status: text("status").notNull().default("draft"),
    targetDate: date("target_date", { mode: "string" }),
    /**
     * Schedule anchor (YYYY-MM-DD). Null means a later schedule treats the anchor as today.
     */
    startDate: date("start_date", { mode: "string" }),
    /**
     * Hours in a working day. Later duration is estimate hours ÷ this value.
     * Quarter-hours from 0.25 through 24.
     */
    workdayHours: numeric("workday_hours", { precision: 4, scale: 2, mode: "number" })
      .notNull()
      .default(8),
    /** Hours per week used when completion history is too short to project a finish. */
    capacityHoursPerWeek: numeric("capacity_hours_per_week", {
      precision: 5,
      scale: 2,
      mode: "number",
    }),
    /** Optimistic lock incremented on every successful reorder. */
    revision: integer("revision").notNull().default(0),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdById: integer("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedById: integer("updated_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusCheck: check(
      "plans_status_chk",
      sql`${t.status} in ('draft', 'active', 'complete', 'archived')`,
    ),
    startNotAfterTarget: check(
      "plans_start_not_after_target",
      sql`${t.startDate} is null or ${t.targetDate} is null or ${t.startDate} <= ${t.targetDate}`,
    ),
    workdayHoursQuarter: check(
      "plans_workday_hours_quarter",
      sql`${t.workdayHours} >= 0.25 AND ${t.workdayHours} <= 24 AND ${t.workdayHours} * 4 = trunc(${t.workdayHours} * 4)`,
    ),
  }),
);

/** Phases belong to one plan. Deleting a phase is refused while it still has items. */
export const planPhases = pgTable("plan_phases", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One row is one Task or ToDo in one phase of one plan.
 * An item may appear in many plans, once per plan.
 */
export const planItems = pgTable(
  "plan_items",
  {
    id: serial("id").primaryKey(),
    planId: integer("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    phaseId: integer("phase_id")
      .notNull()
      .references(() => planPhases.id, { onDelete: "restrict" }),
    /** task | todo */
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    planEntityUniq: unique("plan_items_plan_entity_uidx").on(t.planId, t.entityType, t.entityId),
    orderIdx: index("plan_items_order_idx").on(t.planId, t.phaseId, t.sortOrder),
    entityIdx: index("plan_items_entity_idx").on(t.entityType, t.entityId),
    entityTypeCheck: check(
      "plan_items_entity_type_chk",
      sql`${t.entityType} in ('task', 'todo')`,
    ),
  }),
);

/** One cached AI finish range per plan. The hash is the minimized input packet. */
export const planAiProjections = pgTable("plan_ai_projections", {
  planId: integer("plan_id")
    .primaryKey()
    .references(() => plans.id, { onDelete: "cascade" }),
  inputHash: text("input_hash").notNull(),
  result: jsonb("result")
    .$type<{
      p50: string;
      p80: string;
      confidence: "low" | "medium" | "high";
      drivers: string[];
    }>()
    .notNull(),
  auditId: integer("audit_id").references(() => aiAuditLog.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Kanban planning boards (multiple per project). */
export const boards = pgTable("boards", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → B####. */
  number: integer("number").notNull().unique(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const boardColumns = pgTable("board_columns", {
  id: serial("id").primaryKey(),
  boardId: integer("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  wipLimit: integer("wip_limit"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const boardLanes = pgTable("board_lanes", {
  id: serial("id").primaryKey(),
  boardId: integer("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Cards point at tasks (and later other entities). */
export const boardCards = pgTable(
  "board_cards",
  {
    id: serial("id").primaryKey(),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    columnId: integer("column_id")
      .notNull()
      .references(() => boardColumns.id, { onDelete: "cascade" }),
    laneId: integer("lane_id").references(() => boardLanes.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    boardEntityUniq: unique("board_cards_board_entity_uidx").on(
      t.boardId,
      t.entityType,
      t.entityId,
    ),
  }),
);

/** Nested wiki TOC nodes pointing at documents or canvases. */
export const wikiNodes = pgTable(
  "wiki_nodes",
  {
    id: serial("id").primaryKey(),
    /** App-wide unique display number → W####. */
    number: integer("number").notNull().unique(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: integer("parent_id").references((): AnyPgColumn => wikiNodes.id, {
      onDelete: "cascade",
    }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    title: text("title").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    projectEntityUniq: unique("wiki_nodes_project_entity_uidx").on(
      t.projectId,
      t.entityType,
      t.entityId,
    ),
  }),
);

/** Freeform Excalidraw documents scoped to a project. */
export const canvases = pgTable("canvases", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → C####. */
  number: integer("number").notNull().unique(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Excalidraw scene JSON (elements / appState / files). */
  document: jsonb("document")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** PureRef-style image boards; optional project association. */
export const imageBoards = pgTable("image_boards", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → M####. */
  number: integer("number").notNull().unique(),
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Scene JSON: camera, gridVisible, items (images / text / boxes). */
  document: jsonb("document")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  /** Record owner (T0112). Standalone boards use this; project boards also stamped. */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ideasRelations = relations(ideas, ({ one, many }) => ({
  owner: one(users, {
    fields: [ideas.ownerId],
    references: [users.id],
    relationName: "idea_owner",
  }),
  assignee: one(users, {
    fields: [ideas.assigneeId],
    references: [users.id],
    relationName: "idea_assignee",
  }),
  projects: many(projects),
  todos: many(todos),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  sourceIdea: one(ideas, {
    fields: [projects.sourceIdeaId],
    references: [ideas.id],
  }),
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id],
    relationName: "project_owner",
  }),
  taskGroups: many(taskGroups),
  phases: many(projectPhases),
  managers: many(projectManagers),
  members: many(projectMembers),
  viewers: many(projectViewers),
  tasks: many(tasks),
  todos: many(todos),
  documents: many(projectDocuments),
  todoLists: many(todoLists),
  modules: many(projectModules),
  plans: many(plans),
  boards: many(boards),
  wikiNodes: many(wikiNodes),
  canvases: many(canvases),
  imageBoards: many(imageBoards),
  overviewPrefs: many(userProjectOverviewPrefs),
  overviewDefault: many(projectOverviewDefaults),
}));

export const todosRelations = relations(todos, ({ one, many }) => ({
  project: one(projects, {
    fields: [todos.projectId],
    references: [projects.id],
  }),
  parent: one(todos, {
    fields: [todos.parentId],
    references: [todos.id],
    relationName: "todo_hierarchy",
  }),
  children: many(todos, { relationName: "todo_hierarchy" }),
  sourceIdea: one(ideas, {
    fields: [todos.sourceIdeaId],
    references: [ideas.id],
  }),
  createdBy: one(users, {
    fields: [todos.createdById],
    references: [users.id],
    relationName: "todo_created_by",
  }),
  updatedBy: one(users, {
    fields: [todos.updatedById],
    references: [users.id],
    relationName: "todo_updated_by",
  }),
  owner: one(users, {
    fields: [todos.ownerId],
    references: [users.id],
    relationName: "todo_owner",
  }),
  assignee: one(users, {
    fields: [todos.assigneeId],
    references: [users.id],
    relationName: "todo_assignee",
  }),
}));

export const taskGroupsRelations = relations(taskGroups, ({ one, many }) => ({
  project: one(projects, {
    fields: [taskGroups.projectId],
    references: [projects.id],
  }),
  autoTag: one(tags, {
    fields: [taskGroups.autoTagId],
    references: [tags.id],
  }),
  members: many(taskGroupMembers),
}));

export const taskGroupMembersRelations = relations(taskGroupMembers, ({ one }) => ({
  group: one(taskGroups, {
    fields: [taskGroupMembers.groupId],
    references: [taskGroups.id],
  }),
  task: one(tasks, {
    fields: [taskGroupMembers.taskId],
    references: [tasks.id],
  }),
}));

export const projectManagersRelations = relations(projectManagers, ({ one }) => ({
  project: one(projects, {
    fields: [projectManagers.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectManagers.userId],
    references: [users.id],
    relationName: "project_manager_user",
  }),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectMembers.userId],
    references: [users.id],
    relationName: "project_member_user",
  }),
}));

export const projectViewersRelations = relations(projectViewers, ({ one }) => ({
  project: one(projects, {
    fields: [projectViewers.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectViewers.userId],
    references: [users.id],
    relationName: "project_viewer_user",
  }),
}));

export const projectPhasesRelations = relations(projectPhases, ({ one, many }) => ({
  project: one(projects, {
    fields: [projectPhases.projectId],
    references: [projects.id],
  }),
  tasks: many(tasks),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  avatarUpload: one(uploads, {
    fields: [users.avatarUploadId],
    references: [uploads.id],
  }),
  createdTasks: many(tasks, { relationName: "task_created_by" }),
  updatedTasks: many(tasks, { relationName: "task_updated_by" }),
  ownedTasks: many(tasks, { relationName: "task_owner" }),
  assignedTasks: many(tasks, { relationName: "task_assignee" }),
  createdTodos: many(todos, { relationName: "todo_created_by" }),
  updatedTodos: many(todos, { relationName: "todo_updated_by" }),
  ownedTodos: many(todos, { relationName: "todo_owner" }),
  assignedTodos: many(todos, { relationName: "todo_assignee" }),
  ownedIdeas: many(ideas, { relationName: "idea_owner" }),
  assignedIdeas: many(ideas, { relationName: "idea_assignee" }),
  ownedProjects: many(projects, { relationName: "project_owner" }),
  ownedUploads: many(uploads, { relationName: "upload_owner" }),
  ownedTags: many(tags, { relationName: "tag_owner" }),
  createdEntityLinks: many(entityLinks, { relationName: "entity_link_created_by" }),
  ownedTodoLists: many(todoLists, { relationName: "todo_list_owner" }),
  ownedImageBoards: many(imageBoards, { relationName: "image_board_owner" }),
  ownedPlans: many(plans, { relationName: "plan_owner" }),
  createdPlans: many(plans, { relationName: "plan_created_by" }),
  updatedPlans: many(plans, { relationName: "plan_updated_by" }),
  createdTaskDescriptionTemplates: many(taskDescriptionTemplates, {
    relationName: "task_description_templates_created_by",
  }),
  updatedTaskDescriptionTemplates: many(taskDescriptionTemplates, {
    relationName: "task_description_templates_updated_by",
  }),
  ownedTaskDescriptionTemplates: many(taskDescriptionTemplates, {
    relationName: "task_description_templates_owner",
  }),
  apiKeys: many(apiKeys),
  mfaLoginChallenges: many(mfaLoginChallenges),
  mfaTrustedDevices: many(mfaTrustedDevices),
  mfaRecoveryCodes: many(mfaRecoveryCodes),
  userRoles: many(userRoles),
  passwordHistory: many(passwordHistory),
  identities: many(userIdentities),
  listViewPrefs: many(userListViewPrefs),
  taskListState: many(userTaskListState),
  overviewPrefs: many(userProjectOverviewPrefs),
  meshLayouts: many(meshLayouts),
  aiCredentials: many(userAiCredentials),
  aiRoutePrefs: many(userAiRoutePrefs),
}));

export const mfaLoginChallengesRelations = relations(mfaLoginChallenges, ({ one }) => ({
  user: one(users, {
    fields: [mfaLoginChallenges.userId],
    references: [users.id],
  }),
}));

export const mfaTrustedDevicesRelations = relations(mfaTrustedDevices, ({ one }) => ({
  user: one(users, {
    fields: [mfaTrustedDevices.userId],
    references: [users.id],
  }),
}));

export const mfaRecoveryCodesRelations = relations(mfaRecoveryCodes, ({ one }) => ({
  user: one(users, {
    fields: [mfaRecoveryCodes.userId],
    references: [users.id],
  }),
}));

export const oauthProvidersRelations = relations(oauthProviders, ({ one, many }) => ({
  defaultRole: one(roles, {
    fields: [oauthProviders.defaultRoleId],
    references: [roles.id],
  }),
  identities: many(userIdentities),
  loginStates: many(oauthLoginStates),
}));

export const userIdentitiesRelations = relations(userIdentities, ({ one }) => ({
  user: one(users, {
    fields: [userIdentities.userId],
    references: [users.id],
  }),
  provider: one(oauthProviders, {
    fields: [userIdentities.providerId],
    references: [oauthProviders.id],
  }),
}));

export const oauthLoginStatesRelations = relations(oauthLoginStates, ({ one }) => ({
  provider: one(oauthProviders, {
    fields: [oauthLoginStates.providerId],
    references: [oauthProviders.id],
  }),
  user: one(users, {
    fields: [oauthLoginStates.userId],
    references: [users.id],
  }),
}));

export const userListViewPrefsRelations = relations(userListViewPrefs, ({ one }) => ({
  user: one(users, {
    fields: [userListViewPrefs.userId],
    references: [users.id],
  }),
}));

export const userTaskListStateRelations = relations(userTaskListState, ({ one }) => ({
  user: one(users, {
    fields: [userTaskListState.userId],
    references: [users.id],
  }),
}));

export const userProjectOverviewPrefsRelations = relations(
  userProjectOverviewPrefs,
  ({ one }) => ({
    user: one(users, {
      fields: [userProjectOverviewPrefs.userId],
      references: [users.id],
    }),
    project: one(projects, {
      fields: [userProjectOverviewPrefs.projectId],
      references: [projects.id],
    }),
  }),
);

export const meshLayoutsRelations = relations(meshLayouts, ({ one }) => ({
  owner: one(users, {
    fields: [meshLayouts.ownerId],
    references: [users.id],
  }),
}));

export const projectOverviewDefaultsRelations = relations(
  projectOverviewDefaults,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectOverviewDefaults.projectId],
      references: [projects.id],
    }),
    updatedBy: one(users, {
      fields: [projectOverviewDefaults.updatedById],
      references: [users.id],
    }),
  }),
);

export const passwordHistoryRelations = relations(passwordHistory, ({ one }) => ({
  user: one(users, {
    fields: [passwordHistory.userId],
    references: [users.id],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

export const aiInstanceCredentialsRelations = relations(aiInstanceCredentials, ({ one }) => ({
  updatedBy: one(users, {
    fields: [aiInstanceCredentials.updatedById],
    references: [users.id],
  }),
}));

export const userAiCredentialsRelations = relations(userAiCredentials, ({ one }) => ({
  user: one(users, {
    fields: [userAiCredentials.userId],
    references: [users.id],
  }),
}));

export const userAiRoutePrefsRelations = relations(userAiRoutePrefs, ({ one }) => ({
  user: one(users, {
    fields: [userAiRoutePrefs.userId],
    references: [users.id],
  }),
}));

export const aiAuditLogRelations = relations(aiAuditLog, ({ one, many }) => ({
  user: one(users, {
    fields: [aiAuditLog.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [aiAuditLog.projectId],
    references: [projects.id],
  }),
  feedback: many(aiOutputFeedback),
}));

export const aiOutputFeedbackRelations = relations(aiOutputFeedback, ({ one }) => ({
  audit: one(aiAuditLog, {
    fields: [aiOutputFeedback.auditId],
    references: [aiAuditLog.id],
  }),
  user: one(users, {
    fields: [aiOutputFeedback.userId],
    references: [users.id],
  }),
}));

export const mailSettingsRelations = relations(mailSettings, ({ one }) => ({
  updatedBy: one(users, {
    fields: [mailSettings.updatedById],
    references: [users.id],
  }),
}));

export const apiRequestLogsRelations = relations(apiRequestLogs, ({ one }) => ({
  user: one(users, {
    fields: [apiRequestLogs.userId],
    references: [users.id],
  }),
  apiKey: one(apiKeys, {
    fields: [apiRequestLogs.apiKeyId],
    references: [apiKeys.id],
  }),
}));

export const taskDescriptionTemplatesRelations = relations(
  taskDescriptionTemplates,
  ({ one }) => ({
    project: one(projects, {
      fields: [taskDescriptionTemplates.projectId],
      references: [projects.id],
    }),
    createdBy: one(users, {
      fields: [taskDescriptionTemplates.createdById],
      references: [users.id],
      relationName: "task_description_templates_created_by",
    }),
    updatedBy: one(users, {
      fields: [taskDescriptionTemplates.updatedById],
      references: [users.id],
      relationName: "task_description_templates_updated_by",
    }),
    owner: one(users, {
      fields: [taskDescriptionTemplates.ownerId],
      references: [users.id],
      relationName: "task_description_templates_owner",
    }),
  }),
);

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  phase: one(projectPhases, {
    fields: [tasks.phaseId],
    references: [projectPhases.id],
  }),
  parent: one(tasks, {
    fields: [tasks.parentId],
    references: [tasks.id],
    relationName: "task_hierarchy",
  }),
  children: many(tasks, { relationName: "task_hierarchy" }),
  createdBy: one(users, {
    fields: [tasks.createdById],
    references: [users.id],
    relationName: "task_created_by",
  }),
  updatedBy: one(users, {
    fields: [tasks.updatedById],
    references: [users.id],
    relationName: "task_updated_by",
  }),
  owner: one(users, {
    fields: [tasks.ownerId],
    references: [users.id],
    relationName: "task_owner",
  }),
  assignee: one(users, {
    fields: [tasks.assigneeId],
    references: [users.id],
    relationName: "task_assignee",
  }),
  activity: many(taskActivity),
  dependencies: many(taskDependencies, { relationName: "task_depends_on" }),
  requiredBy: many(taskDependencies, { relationName: "task_required_by" }),
}));

export const taskActivityRelations = relations(taskActivity, ({ one }) => ({
  task: one(tasks, {
    fields: [taskActivity.taskId],
    references: [tasks.id],
  }),
  createdBy: one(users, {
    fields: [taskActivity.createdById],
    references: [users.id],
  }),
}));

export const taskDependenciesRelations = relations(taskDependencies, ({ one }) => ({
  task: one(tasks, {
    fields: [taskDependencies.taskId],
    references: [tasks.id],
    relationName: "task_depends_on",
  }),
  dependsOn: one(tasks, {
    fields: [taskDependencies.dependsOnTaskId],
    references: [tasks.id],
    relationName: "task_required_by",
  }),
}));

export const projectDocumentsRelations = relations(projectDocuments, ({ one }) => ({
  project: one(projects, {
    fields: [projectDocuments.projectId],
    references: [projects.id],
  }),
  upload: one(uploads, {
    fields: [projectDocuments.uploadId],
    references: [uploads.id],
  }),
  updatedBy: one(users, {
    fields: [projectDocuments.updatedById],
    references: [users.id],
  }),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  owner: one(users, {
    fields: [tags.ownerId],
    references: [users.id],
    relationName: "tag_owner",
  }),
  taggings: many(taggings),
  taskGroups: many(taskGroups),
}));

export const taggingsRelations = relations(taggings, ({ one }) => ({
  tag: one(tags, {
    fields: [taggings.tagId],
    references: [tags.id],
  }),
}));

export const entityLinksRelations = relations(entityLinks, ({ one }) => ({
  createdBy: one(users, {
    fields: [entityLinks.createdById],
    references: [users.id],
    relationName: "entity_link_created_by",
  }),
}));

export const todoListsRelations = relations(todoLists, ({ one, many }) => ({
  project: one(projects, {
    fields: [todoLists.projectId],
    references: [projects.id],
  }),
  owner: one(users, {
    fields: [todoLists.ownerId],
    references: [users.id],
    relationName: "todo_list_owner",
  }),
  items: many(todoListItems),
}));

export const todoListItemsRelations = relations(todoListItems, ({ one }) => ({
  list: one(todoLists, {
    fields: [todoListItems.listId],
    references: [todoLists.id],
  }),
}));

export const projectModulesRelations = relations(projectModules, ({ one }) => ({
  project: one(projects, {
    fields: [projectModules.projectId],
    references: [projects.id],
  }),
}));

export const plansRelations = relations(plans, ({ one, many }) => ({
  project: one(projects, {
    fields: [plans.projectId],
    references: [projects.id],
  }),
  owner: one(users, {
    fields: [plans.ownerId],
    references: [users.id],
    relationName: "plan_owner",
  }),
  createdBy: one(users, {
    fields: [plans.createdById],
    references: [users.id],
    relationName: "plan_created_by",
  }),
  updatedBy: one(users, {
    fields: [plans.updatedById],
    references: [users.id],
    relationName: "plan_updated_by",
  }),
  phases: many(planPhases),
  items: many(planItems),
  aiProjection: one(planAiProjections),
}));

export const planPhasesRelations = relations(planPhases, ({ one, many }) => ({
  plan: one(plans, {
    fields: [planPhases.planId],
    references: [plans.id],
  }),
  items: many(planItems),
}));

export const planAiProjectionsRelations = relations(planAiProjections, ({ one }) => ({
  plan: one(plans, {
    fields: [planAiProjections.planId],
    references: [plans.id],
  }),
  audit: one(aiAuditLog, {
    fields: [planAiProjections.auditId],
    references: [aiAuditLog.id],
  }),
}));

export const planItemsRelations = relations(planItems, ({ one }) => ({
  plan: one(plans, {
    fields: [planItems.planId],
    references: [plans.id],
  }),
  phase: one(planPhases, {
    fields: [planItems.phaseId],
    references: [planPhases.id],
  }),
}));

export const boardsRelations = relations(boards, ({ one, many }) => ({
  project: one(projects, {
    fields: [boards.projectId],
    references: [projects.id],
  }),
  columns: many(boardColumns),
  lanes: many(boardLanes),
  cards: many(boardCards),
}));

export const boardColumnsRelations = relations(boardColumns, ({ one, many }) => ({
  board: one(boards, {
    fields: [boardColumns.boardId],
    references: [boards.id],
  }),
  cards: many(boardCards),
}));

export const boardLanesRelations = relations(boardLanes, ({ one, many }) => ({
  board: one(boards, {
    fields: [boardLanes.boardId],
    references: [boards.id],
  }),
  cards: many(boardCards),
}));

export const boardCardsRelations = relations(boardCards, ({ one }) => ({
  board: one(boards, {
    fields: [boardCards.boardId],
    references: [boards.id],
  }),
  column: one(boardColumns, {
    fields: [boardCards.columnId],
    references: [boardColumns.id],
  }),
  lane: one(boardLanes, {
    fields: [boardCards.laneId],
    references: [boardLanes.id],
  }),
}));

export const wikiNodesRelations = relations(wikiNodes, ({ one, many }) => ({
  project: one(projects, {
    fields: [wikiNodes.projectId],
    references: [projects.id],
  }),
  parent: one(wikiNodes, {
    fields: [wikiNodes.parentId],
    references: [wikiNodes.id],
    relationName: "wiki_tree",
  }),
  children: many(wikiNodes, { relationName: "wiki_tree" }),
}));

export const canvasesRelations = relations(canvases, ({ one }) => ({
  project: one(projects, {
    fields: [canvases.projectId],
    references: [projects.id],
  }),
}));

export const imageBoardsRelations = relations(imageBoards, ({ one }) => ({
  project: one(projects, {
    fields: [imageBoards.projectId],
    references: [projects.id],
  }),
  owner: one(users, {
    fields: [imageBoards.ownerId],
    references: [users.id],
    relationName: "image_board_owner",
  }),
}));
