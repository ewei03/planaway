CREATE TABLE "place_cache" (
	"query" text PRIMARY KEY NOT NULL,
	"place" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
