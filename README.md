# PlanAway

A collaborative trip-planning agent powered by Claude. Describe a trip, or describe what you like and let it pick, and it researches flights, stays, and things to do on the web. It then builds a day-by-day itinerary. Plan it together with your group: everyone shares the conversation with the agent, comments on specific parts of the plan, and the agent works the comments into the next revision.

## Setup

Built with Next.js (App Router), React, Auth.js, Drizzle, and Postgres. Requires Node 20.12+ and an [Anthropic API key](https://console.anthropic.com/).

```sh
npm install
cp .env.example .env   # set ANTHROPIC_API_KEY and AUTH_SECRET
npm run dev            # http://localhost:3000
```

For a production build: `npm run build && npm start`.

### Database

With no `DATABASE_URL`, PlanAway runs on [PGlite](https://pglite.dev), which is Postgres compiled to WebAssembly. It runs inside the server process and stores its data in `data/pglite/`, so there's nothing to install. PGlite allows only one process per data directory, so stop `npm run dev` before running `npm start` against the same data.

To use a real Postgres server, run `docker compose up -d` (the config is in `docker-compose.yml`) or use a hosted one (Neon, Supabase, RDS). Then set:

```
DATABASE_URL=postgres://planaway:planaway@localhost:5432/planaway
```

Migrations in `drizzle/` run automatically on startup. After changing `lib/db/schema.ts`, generate a new migration with `npx drizzle-kit generate`.

## Testing

```sh
npm test               # unit, integration, and component tests (Vitest)
npm run test:watch     # same, re-running on change
npm run test:e2e       # browser tests (Playwright)
npm run test:all       # everything
```

Run `npx playwright install chromium` once before the first e2e run.

- `tests/server/`: Node tests for `lib/` and the route handlers. Each file gets a fresh in-memory PGlite database (`PGLITE_DIR=memory://`), so they never touch `data/pglite`. The Anthropic SDK and Auth.js are mocked.
- `tests/ui/`: React components in jsdom with Testing Library.
- `e2e/`: Playwright tests against a real `next dev` server on port 3100 (in-memory database, built into `.next-e2e/` so it can run alongside `npm run dev`). The agent talks to `e2e/mock-anthropic.mjs`, a scripted stand-in for the Messages API, so no API key is needed and nothing is billed.

## Using it

Create an account. You get a **Personal** group for trips you plan alone.

**Starting a trip:**
- **I have an idea**: describe the trip in your own words.
- **Plan it for me**: fill in origin, budget, dates, interests, and pace. PlanAway picks the destination if you leave it blank.
- **🎲 Surprise me**: a random destination that fits whatever origin, budget, and dates you entered.

**Planning together:**
- **Groups** own trips. Click **+ New group**, then use ⚙ to create an invite link as an editor or a viewer. Links expire after 7 days and can be revoked. Every trip in a group is shared with all its members.

  | Role | Can |
  | --- | --- |
  | Owner | Everything, plus manage members and invites, delete trips and the group |
  | Editor | Chat with the agent, create and rename trips, save versions |
  | Viewer | Read trips, comment, export |

- **Shared chat.** Everyone in the group sees the conversation with the agent, and messages show who sent them. One person's request runs at a time. Others see "Maya is asking PlanAway…" and get the result when it finishes.
- **Comments.** Click 💬 next to any activity, day, flight, stay, or budget line (or the trip title) to start a thread, e.g. "too pricey" or "vegetarian options?". Threads can be replied to, resolved, and reopened. On the next turn the agent sees new comments, changes the plan, replies in the threads, and resolves the ones it addressed. **✨ Ask PlanAway to address open comments** in the comments panel triggers that directly.
- Open tabs check for collaborators' changes every 4 seconds.

**Saving and exporting:**
- **Save** stores a named snapshot of the current draft. Pick it from the version menu to view or export it later.
- **Export** downloads the itinerary as `.csv` (spreadsheet), `.md` (document), `.ics` (calendar, once the trip has dates), or `.json`.

## How it works

`lib/agent.ts` runs a streaming tool-use loop on `claude-opus-5-5` with four tools:

- `web_search` and `web_fetch` are Anthropic server-side tools. Claude searches the web (booking sites, Reddit, official attraction pages) and reads pages itself. No scraper runs on your machine.
- `update_itinerary` takes the complete itinerary, validated against the Zod schema in `lib/itinerary.ts`. Every item has a stable id that the agent keeps when it edits the item, so comments stay attached as the plan changes.
- `reply_to_comments` posts the agent's replies in comment threads and resolves them.

Each trip keeps the full API transcript (`trip_messages`), so later refinements have all the earlier research. A turn is committed in one transaction when it finishes. A failed turn writes nothing. A database lock on the trip keeps two people's requests from interleaving, and it works across server instances. Refused requests fall back to another model on the server (`fallbacks: "default"`).

Code layout:

- `app/api/…`: route handlers: registration and Auth.js, groups, members, invites, trips, messages (streamed), comments, versions, exports, and the revision endpoint collaborators poll
- `app/login`, `app/invite/[token]`: sign-in and invite pages
- `components/`: the React UI. `PlanAway.tsx` holds app state.
- `lib/db/`: the Drizzle schema and connection (PGlite or Postgres)
- `lib/store.ts`: all data access and permission checks
- `lib/agent.ts`, `lib/itinerary.ts`, `lib/export.ts`: the agent loop, itinerary schema, and exporters
- `auth.ts`: Auth.js configuration (email and password, bcrypt, JWT session cookie)

Settings in `.env`:

| Variable | Default | |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (required) | |
| `AUTH_SECRET` | (required) | Signs session cookies |
| `DATABASE_URL` | (unset: PGlite) | Postgres connection string |
| `PGLITE_DIR` | `data/pglite` | Where PGlite stores data |
| `PLANAWAY_MODEL` | `claude-opus-5-5` | |
| `PLANAWAY_EFFORT` | `medium` | `low` to `max`. Higher means more thorough research and higher cost. |

## Notes

- Prices come from search results and pages the agent reads, so they are estimates. Confirm before booking.
- Every turn calls the API with web search enabled. Web searches are billed per search on top of tokens.
- Before running this on a public server, add rate limiting on sign-in and registration, email verification, and password reset. None of these exist yet.

TODO: Build a map feature; make it more visually appealing for UI/UX purposes
