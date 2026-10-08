# inQueue

I built inQueue to run the product workflow for a small print on demand business. It takes a shirt design from an AI prompt all the way to a finished Etsy draft listing. Three people on the team use it every day across six Etsy stores.

This is a cleaned up copy of a private repo. I swapped out the real store names and logos, and I took out the licensed mockup photos and all credentials. Everything else, including the tests, is the same.

Built with Node.js, Next.js, TypeScript, PostgreSQL, Prisma, the Google Drive API, the Etsy API, the OpenAI API, sharp, Playwright, and Render.

## How it works

There are four apps, and they all share one login.

| App | What it does | Stack |
|---|---|---|
| **Hub** | Login, the dashboard, and the settings for every store | Node, PostgreSQL |
| **Inkly** | Makes the artwork with OpenAI, then has a vision model check every design before it can be exported | Express, OpenAI, sharp |
| **Preply** | Puts the designs on mockups, gives each product a SKU, and uploads the batch to Google Drive | Node, Google Drive API |
| **Batchly** | Picks the batch up from Drive, checks it, and creates the Etsy drafts for each store | Next.js, TypeScript, Prisma |

A batch goes from Inkly to Preply to Batchly to Etsy. Nobody has to download or upload a single file by hand.

## Parts I'm proud of

**The hand off between apps is automatic.** When Preply finishes uploading to Drive, it pings Batchly. Batchly downloads the batch and checks it on its own. Files land in a temp folder first, so a half downloaded batch never shows up in the app. If an export gets cut off, the retry picks up where it stopped instead of starting over.

**One login works across four sites.** Each app runs on its own domain, so a normal cookie can't be shared between them. The hub gives the app a signed ticket that's only good for 60 seconds, and the app trades it for its own session cookie. Passwords are hashed with PBKDF2. You can see how it works in [the SSO code](lib/sso.js).

**It's safe for a team to use at the same time.** SKU reservations are locked, so two people can never get the same SKU. If you open a batch someone else is editing, you get a warning. State files are written atomically. That fixed a real bug where two writes at once were corrupting the file.

**It stays inside Etsy's limits.** Every Etsy call goes through a pacer that holds it to 4 requests a second. Listings are always created as drafts, so nothing goes live by mistake.

**The AI work is kept on a leash.** The [scheduler](inkly/lib/designScheduler.js) caps how many OpenAI calls run at once and does the heavy image work one at a time. A design that fails the vision review can't be exported.

**It won't start with a bad config.** The apps refuse to boot with a weak secret, a plain text password, or a localhost URL in production. One backup script dumps the whole database, and the hub keeps track of when the free database is going to expire. The checks live in [the guardrails file](lib/productionGuardrails.js).

## Tests

There are 38 test files. They cover unit tests, HTTP tests, and browser tests with Playwright. On a fresh clone, Inkly passes all 43 and Preply passes all 47. Some of the lib and Batchly tests need a PostgreSQL database to run.

## Running it

The [setup guide](docs/setup.md) walks through getting it running. The [deployment notes](docs/deployment.md) cover how it runs on Render.

## Where things are

| Folder | What's in it |
|---|---|
| `server.js` and `public` | The hub server and its pages |
| `lib` | Shared login, store settings, and startup checks, with their tests |
| `inkly` | The design app |
| `preply` | The mockup, SKU, and Drive upload app |
| `batchly` | The Next.js app that builds listings and creates Etsy drafts |
| `migrations` | The hub's database schema |
| `scripts` | Backups, config checks, and seeding |
| `docs` | Setup and deployment notes |
| `tests` | Playwright tests for the hub and the full flow |

Copyright Ismet Akyurek. Shared so people can look at my work. All rights reserved.
