ALTER TABLE "comments" ADD COLUMN "by_agent" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Until now a comment with no author was always PlanAway's.
UPDATE "comments" SET "by_agent" = true WHERE "author_id" IS NULL;
