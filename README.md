# PlanAway

PlanAway is the future for vacation planning: a Claude-powered AI agent that does all your research. Describe your dream trip in your own words, and it builds out a comprehensive, day-by-day itinerary within minutes! Fine-tune it as you go: the agent works your suggestions into the next revision. Plan it together with friends: everyone has a say in how the trip will look. 

## Tech stack

- **App:** Next.js 16 (App Router), React 19, TypeScript
- **AI:** Claude (`claude-opus-5-5`) via the Anthropic SDK, with server-side web search and fetch
- **Data:** Drizzle ORM on Postgres, or PGlite (embedded Postgres) when no database is configured; Zod for validation
- **Auth:** Auth.js (email and password, bcrypt)
- **Maps:** MapLibre GL, OpenFreeMap tiles, Nominatim, and Wikimedia Commons photos
- **Testing:** Vitest, Testing Library, and Playwright

## Setup

Requires Node 20.12+ and an [Anthropic API key](https://console.anthropic.com/).

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

### Maps and photos

The itinerary shows a route map and photos of destinations, activities, and stays. Both are free and need no API keys:

- **Map:** [MapLibre GL](https://maplibre.org) with [OpenFreeMap](https://openfreemap.org) tiles (OpenStreetMap data).
- **Places:** [Nominatim](https://nominatim.org), the OpenStreetMap search, finds each destination, activity, stay, and airport.
- **Photos:** when a place's OpenStreetMap entry links to Wikidata, its image comes from [Wikimedia Commons](https://commons.wikimedia.org), shown with its author and license.
- **Routes:** [OSRM](https://project-osrm.org) on the [FOSSGIS servers](https://routing.openstreetmap.de) finds the way between each day's stops: on foot for hops up to 2 km, by road beyond that. The map draws the streets, and the timeline shows how long each leg takes.

The map and the itinerary work together. Click on any stop in the timeline and it will show its location in the map, and click another stop of the same day to see the way between them, with the total time and distance. The travel time between two activities does the same for that leg. Clicking anywhere on an activity's card, a stay, or a flight (or pressing Enter on it) does the same. The map stays at the top of the itinerary while you scroll, unless you hide it; a pin's popup has "Show in itinerary" to jump back. "Find a place…" above the map searches every stop, stay, and flight by name. Clicking an activity the map couldn't place searches for it by name near the rest of its day (with [Photon](https://photon.komoot.io), within 30 km) and adds the closest match to the map, marked as such, for as long as the page is open.

The public Nominatim server allows one request per second for the whole app, so lookups are paced, a few new places per request. Pins and photos fill in over a few seconds for a new trip. Results are cached in the database for 30 days, and revising a plan only looks up new places. Famous sights and neighborhoods are found reliably; small restaurants and hotels sometimes aren't, and then simply have no pin or photo.

Routes are paced the same way (about one request a second, a few days per request) and cached for 90 days, leg by leg, so revising one stop reroutes only its legs. Until a leg is routed, or if routing fails, the map draws it as a straight dashed line.

Set `NOMINATIM_EMAIL` so the Nominatim operators can contact you about heavy use. For a busy deployment, self-host Nominatim, OSRM, and the tiles and point `NOMINATIM_URL`, `ROUTING_URL`, and `MAP_STYLE_URL` at them.

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

Create an account. Your trips are listed in the sidebar under **Your trips**, each with when it was last updated. Rename a trip from its ⋯ menu, or by clicking its title.

**Settings** (click your name at the bottom of the sidebar):
- **Profile:** name, email (changing it asks for your password, since it's how you sign in), and a profile photo, shown in the sidebar and to people viewing a trip with you.
- **Appearance:** light, dark, or match your device, and a color for each kind of activity on the timeline.
- **Trip defaults:** starting point, how you usually travel, number of travelers, currency, and pace. PlanAway uses them for anything a new trip request doesn't mention (what you say in the request wins), and they pre-fill **Plan it for me**.

**Starting a trip:**
- **I have an idea**: describe the trip in your own words.
- **Plan it for me**: fill in origin, budget, dates, interests, and pace. PlanAway picks the destination if you leave it blank.
- **Need inspiration?** Pick one of the idea cards under the box to start from it.
- **Surprise me**: a random destination that fits whatever origin, budget, and dates you entered.

**Planning together:**
- **Sharing a trip.** Choose **Share…** in a trip's ⋯ menu to create an invite link that lets someone edit or view it. A link gives access to that one trip, never the rest of your trips. Links expire after 1, 7 (the default), or 30 days, or never, and you can revoke them. The same dialog lists who joined, where you can change their role or remove them. Only a trip's owner (whoever created it) can share or delete it.
- **Invite links** open a preview of the trip (title, destinations, dates, summary) that anyone with the link can see. Joining needs an account and an explicit **Join trip** click. Trips shared with you appear under **Shared with you**, where you can leave them. Tokens are 192 random bits.

  | Role | Can |
  | --- | --- |
  | Editor | Change the itinerary with the agent, rename the trip, save versions, comment, export |
  | Viewer | View the itinerary, comment, export |

- **Shared chat.** Everyone the trip is shared with sees the conversation with the agent, and messages show who sent them. One person's request runs at a time. Others see "Maya is asking PlanAway…" and get the result when it finishes.
- **Comments.** Click the comment icon next to any activity, flight, stay, or budget line to start a thread, e.g. "too pricey" or "vegetarian options?". Threads can be replied to, resolved, and reopened. On the next turn the agent sees new comments, changes the plan, replies in the threads, and resolves the ones it addressed.
- Open tabs check for collaborators' changes every 4 seconds. The same check shows who has the trip open (you first) as initials next to the version picker above the itinerary.

**Weather:** the trip card says what weather to expect over the trip and how to dress and prepare for it, in general terms from PlanAway's research (no exact temperatures).

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

- `app/api/…`: route handlers: registration and Auth.js, trips, trip sharing and invite links, messages (streamed), comments, versions, exports, and the revision endpoint collaborators poll
- `app/login`, `app/invite/[token]`: sign-in, and the invite page that previews a shared trip
- `components/`: the React UI. `PlanAway.tsx` holds app state.
- `lib/db/`: the Drizzle schema and connection (PGlite or Postgres)
- `lib/store.ts`: all data access and permission checks
- `lib/agent.ts`, `lib/itinerary.ts`, `lib/export.ts`: the agent loop, itinerary schema, and exporters
- `lib/route.ts`, `lib/places.ts`: turning an itinerary into a map route, and place and photo lookups with caching
- `auth.ts`: Auth.js configuration (email and password, bcrypt, JWT session cookie)

Settings in `.env`:

| Variable | Default | |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (required) | |
| `AUTH_SECRET` | (required) | Signs session cookies |
| `DATABASE_URL` | (unset: PGlite) | Postgres connection string |
| `PGLITE_DIR` | `data/pglite` | Where PGlite stores data |
| `PLANAWAY_MODEL` | `claude-opus-5-5` | |
| `MAP_STYLE_URL` | OpenFreeMap "liberty" | MapLibre style for the route map |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Place search |
| `NOMINATIM_EMAIL` | (unset) | Contact address sent to Nominatim |
| `PHOTON_URL` | `https://photon.komoot.io` | Starting point suggestions in Settings, and finding activities the map missed |
| `ROUTING_URL` | `https://routing.openstreetmap.de` | Routes between stops (OSRM, with `/routed-foot` and `/routed-car`) |
| `APP_URL` | (unset; required in production) | The site's public address, used in links in emails |
| `OPERATOR_NAME` | "the PlanAway team" | Who runs PlanAway: named on the Privacy and Terms pages and in emails |
| `CONTACT_EMAIL` | (unset) | Where Contact page messages go; shown on the Contact, Privacy, and Terms pages |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | (unset: emails go to the server log) | Your email provider's SMTP server. Port 465 uses TLS from the start; set `SMTP_SECURE=true` or `false` to override |
| `EMAIL_FROM` | `PlanAway <no-reply@localhost>` | The sender of PlanAway's emails, on a domain your provider lets you send from |
| `PLANAWAY_EFFORT` | `medium` | `low` to `max`. Higher means more thorough research and higher cost. |

## Notes

- Prices come from search results and pages the agent reads, so they are **estimates**. Do not assume that prices are accurate; they are there for you to get a rough idea of how much you're spending. Confirm before booking.
- Every turn calls the API with web search enabled. Web searches are billed per search on top of tokens.
- Rate limits (wrong passwords at sign-in, sign-ups, confirmation and reset emails, the contact form) are kept in the server's memory. That's enough for one server; with several behind a load balancer, each keeps its own count.

## Accounts and email

Each account can make 20 agent requests in any 24 hours (`PLANAWAY_DAILY_TURNS`; 0 for no limit), so no one account can run up the AI bill. Requests are counted when they start, and deleting trips doesn't reset the count.

Confirming email addresses is off unless `EMAIL_VERIFICATION=on`, since it needs a working email provider. While it's off, new accounts go straight in, and every account counts as confirmed. With it on, new accounts confirm their email address with a 6-digit code before they can sign in: after "Create account", the same page asks for the code that was just emailed, then signs in. Signing in to an account that was never confirmed emails a fresh code and asks for it first. Codes work for 30 minutes and allow 5 wrong tries; a new code replaces the old one. Accounts made before confirmation existed count as confirmed. Changing the address in Settings asks for a code sent to the new one (entered in Settings, or on the home screen) and tells the old one. "Forgot password?" on the sign-in page emails a link that works for an hour. Codes and links are single-use, and only a hash of each is stored. After 10 wrong passwords for an address in 15 minutes, sign-in pauses for it until the 15 minutes are up.

Emails go out over SMTP, so any provider works: [Resend](https://resend.com), [Postmark](https://postmarkapp.com), Amazon SES, Mailgun, or a Google Workspace account. They're all transactional (no marketing), and each says who runs PlanAway and how to reach you. Without `SMTP_HOST`, emails are printed to the server log, which is handy in development.

Settings has "Download my data", a JSON file of the account and every trip the person is on.

## Going live

Before opening PlanAway to the public:

1. **Set `APP_URL`** to the site's address (`https://…`). Links in emails use it, and PlanAway refuses to send them without it in production.
2. **Set up email**: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_FROM` on a domain you've verified with your provider (with its SPF and DKIM records), or confirmation emails will land in spam.
3. **Set `OPERATOR_NAME` and `CONTACT_EMAIL`**: the Privacy and Terms pages name who runs PlanAway and how to reach them, as Canadian privacy law (PIPEDA) expects.
4. **Set `AUTH_SECRET`** to a long random value (`npx auth secret`), and serve the site over HTTPS only.
5. **Read the Privacy and Terms pages** as the operator: they describe your obligations, such as answering access requests within 30 days and reporting breaches. They're a plain-language starting point, not legal advice; have a lawyer review them if you can.
6. Set `NOMINATIM_EMAIL`, and consider self-hosting the map services for heavy traffic (see Maps and photos).