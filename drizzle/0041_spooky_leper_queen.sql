CREATE TABLE "oauth_login_states" (
	"state" text PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"code_verifier" text NOT NULL,
	"nonce" text,
	"return_to" text,
	"mode" text DEFAULT 'login' NOT NULL,
	"user_id" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"protocol" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"client_id" text,
	"client_secret_enc" text,
	"apple_team_id" text,
	"apple_key_id" text,
	"apple_private_key_enc" text,
	"scopes" text,
	"jit_enabled" boolean DEFAULT false NOT NULL,
	"default_role_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_providers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider_id" integer NOT NULL,
	"subject" text NOT NULL,
	"email_at_link" text,
	"raw_profile" jsonb,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_login_states" ADD CONSTRAINT "oauth_login_states_provider_id_oauth_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."oauth_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_login_states" ADD CONSTRAINT "oauth_login_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_providers" ADD CONSTRAINT "oauth_providers_default_role_id_roles_id_fk" FOREIGN KEY ("default_role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_provider_id_oauth_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."oauth_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_login_states_expires_idx" ON "oauth_login_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_provider_subject_uidx" ON "user_identities" USING btree ("provider_id","subject");--> statement-breakpoint
CREATE INDEX "user_identities_user_id_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
INSERT INTO "oauth_providers" ("slug", "name", "protocol", "enabled", "scopes", "sort_order") VALUES
  ('google', 'Google', 'oidc', false, 'openid email profile', 0),
  ('apple', 'Apple', 'oidc', false, 'name email', 1),
  ('github', 'GitHub', 'oauth2', false, 'read:user user:email', 2);
