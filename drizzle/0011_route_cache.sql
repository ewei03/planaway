CREATE TABLE "route_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"leg" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
