INSERT INTO "system_properties" ("key", "value") VALUES
	('default_theme', '"green"'::jsonb)
ON CONFLICT ("key") DO NOTHING;
