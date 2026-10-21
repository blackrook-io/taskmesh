CREATE TABLE "notification_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"text_body" text NOT NULL,
	"html_body" text NOT NULL,
	"href" text,
	"deliver_after" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_type_chk" CHECK ("notification_outbox"."type" in ('digest', 'reminder', 'mention', 'assignment'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"frequency" text DEFAULT 'immediate' NOT NULL,
	"quiet_start" integer,
	"quiet_end" integer,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_type_uidx" UNIQUE("user_id","type"),
	CONSTRAINT "notification_preferences_type_chk" CHECK ("notification_preferences"."type" in ('digest', 'reminder', 'mention', 'assignment')),
	CONSTRAINT "notification_preferences_frequency_chk" CHECK ("notification_preferences"."frequency" in ('immediate', 'daily', 'weekly')),
	CONSTRAINT "notification_preferences_quiet_chk" CHECK (("notification_preferences"."quiet_start" is null and "notification_preferences"."quiet_end" is null) or ("notification_preferences"."quiet_start" between 0 and 23 and "notification_preferences"."quiet_end" between 0 and 23 and "notification_preferences"."quiet_start" <> "notification_preferences"."quiet_end"))
);
--> statement-breakpoint
CREATE TABLE "notification_reminder_marks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"kind" text NOT NULL,
	"marker" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reminder_marks_uidx" UNIQUE("user_id","entity_type","entity_id","kind","marker"),
	CONSTRAINT "notification_reminder_marks_entity_chk" CHECK ("notification_reminder_marks"."entity_type" in ('task', 'todo')),
	CONSTRAINT "notification_reminder_marks_kind_chk" CHECK ("notification_reminder_marks"."kind" in ('due', 'action_by'))
);
--> statement-breakpoint
CREATE TABLE "notification_unsubscribe_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_unsubscribe_user_type_uidx" UNIQUE("user_id","type"),
	CONSTRAINT "notification_unsubscribe_token_uidx" UNIQUE("token"),
	CONSTRAINT "notification_unsubscribe_type_chk" CHECK ("notification_unsubscribe_tokens"."type" in ('digest', 'reminder', 'mention', 'assignment'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_type_chk" CHECK ("notifications"."type" in ('digest', 'reminder', 'mention', 'assignment'))
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reminder_marks" ADD CONSTRAINT "notification_reminder_marks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_unsubscribe_tokens" ADD CONSTRAINT "notification_unsubscribe_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_outbox_pending_idx" ON "notification_outbox" USING btree ("deliver_after") WHERE "notification_outbox"."sent_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");