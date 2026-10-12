CREATE TABLE "user_ai_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"plugin_id" text NOT NULL,
	"secret_enc" text NOT NULL,
	"hint" text NOT NULL,
	"default_model" text,
	"verified_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_ai_credentials_user_plugin_uidx" UNIQUE("user_id","plugin_id"),
	CONSTRAINT "user_ai_credentials_plugin_chk" CHECK ("user_ai_credentials"."plugin_id" ~ '^[a-z0-9-]+$'),
	CONSTRAINT "user_ai_credentials_hint_chk" CHECK (char_length("user_ai_credentials"."hint") between 1 and 4),
	CONSTRAINT "user_ai_credentials_model_chk" CHECK ("user_ai_credentials"."default_model" is null or char_length("user_ai_credentials"."default_model") between 1 and 120),
	CONSTRAINT "user_ai_credentials_error_chk" CHECK ("user_ai_credentials"."last_error" is null or char_length("user_ai_credentials"."last_error") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "user_ai_credentials" ADD CONSTRAINT "user_ai_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;