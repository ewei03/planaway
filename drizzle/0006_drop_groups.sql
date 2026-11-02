-- Groups are gone: each trip is owned by its creator and shared one trip at a time.
-- Trips whose creator's account is gone go to an owner of their group.
UPDATE "trips" SET "created_by" = (
	SELECT "user_id" FROM "group_members"
	WHERE "group_members"."group_id" = "trips"."group_id"
	ORDER BY ("role" = 'owner') DESC, "joined_at"
	LIMIT 1
) WHERE "created_by" IS NULL;--> statement-breakpoint
DELETE FROM "trips" WHERE "created_by" IS NULL;--> statement-breakpoint
-- Everyone else in a trip's group keeps access to it, as if it had been shared
-- with them. Group owners become editors; the trip's creator is its only owner.
INSERT INTO "trip_members" ("trip_id", "user_id", "role", "joined_at")
SELECT "trips"."id", "group_members"."user_id",
	CASE WHEN "group_members"."role" = 'viewer' THEN 'viewer'::"group_role" ELSE 'editor'::"group_role" END,
	"group_members"."joined_at"
FROM "trips"
INNER JOIN "group_members" ON "group_members"."group_id" = "trips"."group_id"
WHERE "group_members"."user_id" <> "trips"."created_by"
ON CONFLICT ("trip_id", "user_id") DO UPDATE SET "role" = CASE
	WHEN "trip_members"."role" = 'editor' OR excluded."role" = 'editor' THEN 'editor'::"group_role"
	ELSE 'viewer'::"group_role"
END;--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_group_id_groups_id_fk";
--> statement-breakpoint
ALTER TABLE "group_members" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "groups" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "group_members" CASCADE;--> statement-breakpoint
DROP TABLE "groups" CASCADE;--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_created_by_users_id_fk";
--> statement-breakpoint
DROP INDEX "trips_group_idx";--> statement-breakpoint
ALTER TABLE "trips" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trips_created_by_idx" ON "trips" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "group_id";
