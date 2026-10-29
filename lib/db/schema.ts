import type Anthropic from "@anthropic-ai/sdk";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Itinerary } from "../itinerary";
import type { Place } from "../route";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

/** owner: manage members and delete; editor: plan with the agent; viewer: read and comment. */
export const roleEnum = pgEnum("group_role", ["owner", "editor", "viewer"]);
export type Role = (typeof roleEnum.enumValues)[number];

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Each user gets one personal group at sign-up for trips they don't share. */
  personal: boolean("personal").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index("group_members_user_idx").on(t.userId)],
);

export const groupInvites = pgTable(
  "group_invites",
  {
    token: text("token").primaryKey(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("group_invites_group_idx").on(t.groupId)],
);

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull().default("New trip"),
    itinerary: jsonb("itinerary").$type<Itinerary>(),
    destinations: text("destinations").array().notNull().default([]),
    /** Bumped on every change so collaborators can poll cheaply. */
    revision: integer("revision").notNull().default(0),
    /** Set while an agent turn runs; doubles as a cross-process lock. */
    turnStartedAt: timestamp("turn_started_at", { withTimezone: true }),
    turnUserId: uuid("turn_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Comments created after this were not yet shown to the agent. */
    commentsSeenAt: timestamp("comments_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("trips_group_idx").on(t.groupId)],
);

/** The raw API transcript. Append-only: one row per message, in order. */
export const tripMessages = pgTable(
  "trip_messages",
  {
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    content: jsonb("content").$type<Anthropic.Beta.BetaMessageParam>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.seq] })],
);

/** What the chat UI shows. user_id is null for the agent's replies. */
export const tripChat = pgTable(
  "trip_chat",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("trip_chat_trip_idx").on(t.tripId, t.createdAt)],
);

export const tripVersions = pgTable(
  "trip_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    itinerary: jsonb("itinerary").$type<Itinerary>().notNull(),
    savedBy: uuid("saved_by").references(() => users.id, { onDelete: "set null" }),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("trip_versions_trip_idx").on(t.tripId)],
);

export const COMMENT_TARGETS = ["trip", "day", "activity", "flight", "lodging", "budget"] as const;
export type CommentTarget = (typeof COMMENT_TARGETS)[number];

/**
 * Comments are grouped into threads. A thread's first comment has
 * parent_id null and carries the anchor (target) and resolution state;
 * replies point at it. author_id is null for replies from the agent.
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    targetType: text("target_type", { enum: COMMENT_TARGETS }).notNull(),
    /** The itinerary item's id; null for comments on the whole trip. */
    targetId: text("target_id"),
    /** Snapshot of what was commented on, e.g. "Day 2 · Tsukiji Outer Market". */
    targetLabel: text("target_label").notNull(),
    body: text("body").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("comments_trip_idx").on(t.tripId, t.createdAt), index("comments_parent_idx").on(t.parentId)],
);

/**
 * Place lookups (OpenStreetMap and Wikimedia), keyed by the normalized text
 * query. place is null when nothing was found, so misses aren't retried on
 * every render. Rows older than the TTL in lib/places.ts are refetched, so
 * places stay current.
 */
export const placeCache = pgTable("place_cache", {
  query: text("query").primaryKey(),
  place: jsonb("place").$type<Place | null>(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});
