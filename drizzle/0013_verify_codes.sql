ALTER TABLE "email_tokens" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Confirmation links are replaced by codes; the old links no longer work.
DELETE FROM "email_tokens" WHERE "purpose" = 'verify';
