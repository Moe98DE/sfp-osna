# Students for Palestine Osnabrück

A small static website with a write-once Instagram → Gemini publishing pipeline.
There is no database, CMS, runtime backend, visitor JavaScript, or client-side API call.
The repository is the content store. `npm run build` produces an ordinary `dist/`
directory, independent of the deployment provider.

The initial German copy uses the supplied account name and Osnabrück location.
No founding date, event history, university affiliation, address or email was
invented. The included posts and typographic images are conspicuously labeled
**demonstrations**, not real Instagram reports. Replace or withdraw them before
your public launch.

## How it works

1. A local command or hourly GitHub Action reads recent media using Meta's
   **Instagram API with Instagram Login**.
2. Existing Instagram IDs, including drafts and renamed Markdown files, are
   skipped before image downloads or Gemini calls.
3. Images are downloaded from Meta's CDN and optimized into local WebP files.
   Carousels keep multiple images. Videos use an available poster and source
   link and require review; the script does not download video files.
4. Gemini receives the caption, timestamp, downloaded images and organization
   context. Its structured JSON is checked by Zod and additional editorial
   markup/count checks.
5. A new Markdown article is written atomically without replacing any existing
   file. Unsafe model output is retained in `review/` and becomes a review draft.
6. Astro generates the pages, sitemap, RSS, metadata and JSON-LD. A build step
   removes unpublished media from `dist/` and verifies the output.
7. The optional Neocities uploader publishes changed files from `dist/`.

Start reading the implementation at `scripts/sync-instagram.ts`, then
`src/lib/instagram/index.ts`, `src/lib/gemini/index.ts` and `src/lib/content/sync.ts`.

## Repository

```text
src/
  config/site.ts                 Organization details, origin and branding
  content.config.ts             Astro Markdown collection
  content/organization-context.md  Human-edited factual/editorial context
  content/posts/*.md             Published articles and review drafts
  components/                   Image and article-card templates
  layouts/Base.astro            Navigation, footer and shared SEO
  pages/                        Home, about, contact, archive, articles, RSS, robots
  lib/instagram/                Official Meta adapter and normalization
  lib/gemini/                   Editorial prompt and official Gemini SDK
  lib/content/                  Validation, images, file writes and sync
  lib/seo/                      Shared structured data helpers
  styles/global.css             Plain responsive CSS
public/
  favicon.png                   Browser-tab icon made from the supplied logo
  brand/sfpo-logo.png           Full-size organization logo
  moodboard/                    Supplied collage imagery
  media/posts/<id>/*.webp        Version-controlled local images
fixtures/                       Raw API-shaped examples and deterministic editor
review/                         Source captions and rejected generated text
scripts/                        Sync, build verification and optional deployment
tests/                          Node test runner tests; no live API dependency
.github/workflows/              Push/PR validation and hourly publishing
.env.example                    Environment template; no real credentials
```

`dist/`, `node_modules/`, `.astro/`, `.env`, `work/` and the sync lock are ignored.
The `review/` directory is version-controlled but is never copied to `dist/`.
It is visible to anyone who can read your Git repository: use a private repository
if source captions and rejected drafts should not be public there.

## Local setup

### Local admin corner

Run `npm run admin` and open **http://127.0.0.1:4322/**. Keep `npm run dev`
running separately for the website preview at port 4321; its footer includes an
Admin link during development. The admin is a small local Node process, started
only when you need it. It is never built into `dist/` or uploaded to Neocities.
There is no public admin endpoint or browser-side API credential.

The admin provides:

- **Neuesten Beitrag holen:** find the newest Instagram post by timestamp and
  import that one if absent. It scans metadata across all pages because API
  ordering is not assumed. An already-imported newest post is a clean no-op.
- **Alle fehlenden importieren:** paginate through every available account post
  and import all missing IDs. This can take time and use Gemini quota. Existing
  drafts, published articles and trashed IDs are skipped, preserving human edits.
- **Edit:** search/filter articles, edit title, excerpt, SEO description, Markdown,
  tags and image alt texts; save drafts or publish after confirming factual review.
  Reloading or leaving a dirty editor asks before discarding unsaved changes.
- **Trash and restore:** delete an article into `archive/deleted/<id>.json`.
  This version-controlled record preserves its Markdown and prevents automatic
  reimport. Restore it from the Papierkorb filter; it returns at its original URL
  as a draft. Images remain local for restoration but are excluded from `dist/`.
- **Website bauen:** rebuild and verify `dist/`. This button does not deploy.
  Commit and push your article changes **and `archive/`**, or deploy the new build
  using `npm run deploy`, to update the actual public website.

Import behavior follows `AUTO_PUBLISH` in `.env`; restart the admin after changing
environment values. A demo-import button works without API credentials. Equivalent
terminal commands are `npm run sync -- --newest` and `npm run sync -- --all`.
The ordinary scheduled sync retains its modest recent-page window.

The server binds to `127.0.0.1` only and rejects foreign hosts/origins and mutation
requests without its per-session CSRF token. Do not expose it through a proxy or
tunnel. Mutations share the sync lock, and stale edits produce a conflict instead
of overwriting newer text. Before explicit edits, previous Markdown is backed up
under ignored `work/admin-backups/`; commit your work for durable history.

Deleting through the admin deliberately suppresses reimport. Use **restore**, not
another fetch, to retrieve a trashed article. A plain static host cannot edit your
local Git repository: the admin must run on your computer.

Use **Node.js 24** and npm. In PowerShell:

```powershell
Set-Location 'D:\Sfp Osna'
npm install
npm run sync:fixture
npm run dev
```

Open the local URL printed by Astro. The fixture command needs neither an `.env`
file nor network/API access. It creates two published examples (one carousel)
and one review draft. Repeated runs report skips and preserve all edits.

```powershell
npm run format
npm run format:check
npm run check
npm test
npm run build
npm run preview
```

| Command                | Purpose                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `npm install`          | Install the locked dependencies for development                           |
| `npm ci`               | Reproduce the lockfile installation in CI                                 |
| `npm run dev`          | Astro's local development server                                          |
| `npm run sync:fixture` | Exercise normalization, generation, images, validation and writes offline |
| `npm run sync`         | Import recent real Instagram posts using `.env`                           |
| `npm run check`        | Astro diagnostics and strict TypeScript checks                            |
| `npm test`             | Isolated Node tests; temporary files stay under `work/tests/`             |
| `npm run format`       | Explicitly format the repository with Prettier                            |
| `npm run format:check` | Read-only formatting validation                                           |
| `npm run build`        | Build, remove draft/orphan media, and verify static output                |
| `npm run preview`      | Serve the production build locally                                        |
| `npm run deploy`       | Upload the existing build to Neocities                                    |

The Astro development server may run detached in Astro 7. Use
`npx astro dev status`, `npx astro dev logs`, or `npx astro dev stop` when needed.
Only local development needs a server. Visitors receive static files.

## Site customization

- Edit **`src/config/site.ts`** for name, short name, logo text, town, region,
  country, language/locale, introduction, Instagram URL, navigation, email and
  accent color. An empty contact email hides that field.
- Set **`SITE_URL`** to your actual origin, such as
  `https://your-account.neocities.org`. The default `https://example.org` is for
  local development only; the deploy script refuses it.
- Edit **`src/content/organization-context.md`** to provide verified background,
  preferred terminology, recurring projects, tone and intentionally supplied
  names. Keep it consistent with the visible site configuration. Context is
  editorial source material; it is not rendered as an unfiltered public page.
- Edit `src/styles/global.css` for spacing, typography and colors. Replace
  `public/brand/sfpo-logo.png` with an updated logo and regenerate
  `public/favicon.png` for the browser tab.
- Page copy lives in ordinary Astro templates. About uses the shared
  organization introduction. Add verified history there only when supplied.

The public design draws on the supplied moodboard: cream paper, red/green
print lettering, embroidery and botanical imagery. It uses Google-hosted
Barlow Condensed, DM Sans and DM Mono with system fallbacks. No visitor
JavaScript is required. The statement and activity descriptions live in
`src/config/site.ts`. Colors and responsive layouts live in `global.css`.
The public email and recurring activity descriptions were checked against the
Instagram profile and posts on September 6, 2026; source links are recorded in
`organization-context.md`. Existing fixture articles are still clearly marked
as demos. General activity descriptions are not upcoming event announcements.

Keep filenames stable after publication: they determine permanent article URLs.
Generated filenames end with the Instagram ID, avoiding collisions between
identical AI slugs. The default routes require hosting at a domain root. For
GitHub Pages use a user/organization site or a custom domain; project subpath
hosting requires adapting the root-relative links and asset URLs.

To remove the examples, set `draft: true` in each `demo: true` article. Keeping
their IDs prevents fixture sync from recreating them. Rebuild before deployment.
Never use the fixture command in the production sync workflow.

## Environment

```powershell
Copy-Item .env.example .env
```

Fill `.env` locally; it is ignored by Git. There is no `PUBLIC_` credential.
The sync and deploy commands load this file, and Astro loads it at build time.
CI supplies equivalent environment values directly.

| Variable                 | Required for      | Default / meaning                                          |
| ------------------------ | ----------------- | ---------------------------------------------------------- |
| `INSTAGRAM_ACCESS_TOKEN` | Live sync         | Instagram Login user token                                 |
| `INSTAGRAM_USER_ID`      | Live sync         | Numeric Instagram professional account ID, not username    |
| `INSTAGRAM_API_VERSION`  | Live sync         | `v26.0` in the example; explicitly versioned requests      |
| `INSTAGRAM_MAX_PAGES`    | Optional          | `2`, at most 50 recent posts per page; range 1–100         |
| `GEMINI_API_KEY`         | Live sync         | Google AI Studio API key                                   |
| `GEMINI_MODEL`           | Optional          | `gemini-3.8-flash`                                         |
| `AUTO_PUBLISH`           | Optional          | `false`; only literal `true` enables automatic publication |
| `SITE_URL`               | Real build/deploy | Public origin with no path, query, credentials or fragment |
| `NEOCITIES_API_KEY`      | Optional deploy   | Neocities bearer API key                                   |

The recent window is deliberately bounded to avoid repeatedly scanning a large
account. Increase `INSTAGRAM_MAX_PAGES` for an initial backfill or a long outage.
The script follows cursor pagination without trusting API-supplied next-page
URLs, and does not assume results are sorted. It never updates edited captions
or deletes articles when a post disappears from Instagram. Those are editorial
decisions for the repository maintainer.

## Connect Instagram

This project implements **Instagram Login**, not Facebook Login or the retired
Basic Display API. Meta's official [Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
documents the two different login paths. Instagram Login supports Business and
Creator accounts without requiring a linked Facebook Page.

1. Make sure you administer `studentsforpalestine.osna` and that it is a
   professional (Business or Creator) account. A public profile URL alone does
   not authorize API access to its media.
2. Create a Meta developer app and select the Instagram API with Instagram Login
   setup. Follow Meta's [getting started guide](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started).
3. Add/authorize the managed Instagram account in the app's Instagram setup.
   For a development app, assign the required app/tester roles and accept the
   invitation using that account. Request `instagram_business_basic` for this
   read-only importer. It does not need publishing, messaging or comment access.
4. Complete the dashboard's token-generation/Instagram authorization flow.
   Obtain the account's numeric ID and an Instagram Login user access token;
   put them into the two corresponding environment variables. Do not substitute
   a Facebook Page token or your account password.
5. For accounts outside your app roles, complete the access level/App Review
   steps required by Meta before production use. Dashboard labels and review
   requirements can change; follow the linked official documentation.
6. Leave `AUTO_PUBLISH=false`, run `npm run sync`, and review the imported drafts.

The adapter reads `/{user-id}/media` and `/{media-id}/children` at
`https://graph.instagram.com/v26.0/`. The API version remains configurable.
Meta documentation endpoints returned HTTP 429 during implementation; the
official collection and [Meta release index](https://developers.meta.com/resources/blog/)
were accessible and confirmed the login path and v26.0 release. Account-specific
access still needs verification with your real token.

**Token maintenance:** record the expiry shown by Meta. Follow its current
[access-token guide](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login)
and [refresh reference](https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token/)
to renew a valid long-lived token before expiry, or reauthorize if expired.
Replace the token in `.env` and GitHub Secrets. This repository deliberately does
not grant a workflow permission to rewrite GitHub secrets or store refreshed
tokens in Git. Set an external calendar reminder based on your actual expiry.

## Connect Gemini

1. Create an API key in [Google AI Studio](https://aistudio.google.com/apikey),
   following Google's [API-key guide](https://ai.google.dev/gemini-api/docs/api-key).
   Use the current authorization key type; Google's September 2026 transition
   retires standard keys. Newly created AI Studio keys use the new type.
2. Set `GEMINI_API_KEY`. Confirm model access and quota in that Google project.
3. Leave `GEMINI_MODEL=gemini-3.8-flash`, or choose a stable model supporting
   images and structured output from the [model catalog](https://ai.google.dev/gemini-api/docs/models).
4. Run a live sync in draft mode and inspect the results before enabling
   automatic publishing. Captions, organization context and downloaded images
   are sent to Google for editing; no API tokens are included in the prompt.

The official `@google/genai` SDK uses the current [Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview)
with `store: false`, image inputs and a JSON schema. Google's
[structured-output documentation](https://ai.google.dev/gemini-api/docs/structured-output)
describes the response format. Local Zod checks add length limits, strict keys,
slug restrictions and an exact alt-text/image count.

Schema validation cannot establish factual truth. Editorial instructions and
review flags reduce risk, but a fluent unsupported claim may still pass. Keep
automatic publication off if every article requires a human factual check.
No article word count is imposed beyond a small nonempty-body check.

## First sync and draft review

1. Commit or back up current content, fill verified organization context, and
   run fixtures first.
2. Configure the live credentials with `AUTO_PUBLISH=false`.
3. Run `npm run sync`. Inspect the new Markdown under `src/content/posts/` and
   the caption in `review/<instagram-id>.json`; compare with the Instagram link.
4. Check title, dates, locations, body, gallery, alt text and metadata. Resolve
   every warning. Do not infer an event date from the publication timestamp.
5. Edit the Markdown directly. Set `generation.needsReview: false` and
   `draft: false` only when ready. Clear resolved warnings or retain them as
   review history. Update `updatedAt` when making an editorial change.
6. Run `npm run format`, `npm run check`, `npm test`, and `npm run build`.
   Use `npm run preview` to inspect the production result before committing.

Both `draft: false` and `generation.needsReview: false` are required for a page,
card, feed or sitemap entry. Draft media is pruned from the production directory.
The local development server can still serve files from `public/`; use a private
local machine for review and upload **only `dist/`**.

With `AUTO_PUBLISH=true`, clean validated new articles publish automatically.
Model warnings, incomplete media, missing captions and review flags force a
draft. Invalid JSON or disallowed generated markup creates a fallback draft,
preserves the rejected text in `review/`, and exits nonzero. Network/model API
failure leaves that post retryable next time. Other posts continue processing.
Never paste rejected HTML into a template's `set:html`.

There is deliberately **no force/regenerate command**. Normal sync never changes
an existing article or its images, even after you rename or move its Markdown
file. Fix a draft manually. If a regeneration is genuinely needed, first preserve
the article and media in Git, then deliberately remove its Markdown and rerun;
this is a maintainer action, not scheduled behavior. Review the diff before
committing and restore the old filename to retain the URL if appropriate.

## GitHub Actions

Create a GitHub repository, push this project with default branch **main**, and
enable Actions. No remote is configured by the local initializer.

Repository **Secrets** (Settings → Secrets and variables → Actions):

- `INSTAGRAM_ACCESS_TOKEN`
- `INSTAGRAM_USER_ID`
- `GEMINI_API_KEY`
- `NEOCITIES_API_KEY`, only when enabling Neocities deployment

Repository **Variables**:

- `SITE_URL`: real origin, required for deployment
- `INSTAGRAM_SYNC_ENABLED=true`: opt into the live scheduled job
- `INSTAGRAM_API_VERSION=v26.0`: configurable version (workflow default shown)
- `GEMINI_MODEL=gemini-3.8-flash`: configurable model
- `AUTO_PUBLISH=false`: safe default; change to `true` when ready
- `INSTAGRAM_MAX_PAGES=2`: increase for backfill if needed
- `DEPLOY_NEOCITIES=true`: optional; otherwise only build/upload CI artifacts

`deploy.yml` validates formatting, types and tests on pull requests and pushes,
builds the site and uploads a `static-site` artifact. Main-branch runs optionally
deploy. Secrets are not provided to pull-request test/build steps.

`sync.yml` runs at minute 23 each hour and supports manual **Run workflow**. It
validates and builds before committing new articles/media/review records, then
pushes and optionally deploys. No changes means no commit. The deployment step
can retry a previously failed upload even when the next sync imports nothing;
remote hashes prevent unchanged uploads. Bot pushes using `GITHUB_TOKEN` do not
normally trigger another push workflow, so this workflow deploys explicitly.
See GitHub's [workflow triggering documentation](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow).

Both workflows share a main-branch concurrency group. A local exclusive lock
protects simultaneous sync commands. A human push during import makes the bot's
push fail safely instead of force-pushing or overwriting history; rerun the job
on the updated branch. Configure branch rules to allow the content bot's direct
push, or run sync locally and submit generated files through your normal review.

Partial sync failures preserve valid generated work when subsequent checks and
push succeed, but leave the workflow red and skip deployment. Inspect the log
and rerun after fixing. If a job is killed before commit, its workspace is
ephemeral; the next run imports again from the committed content state.

GitHub schedules can be delayed or skipped and are not a real-time publishing
guarantee. Keep Actions enabled and check failure notifications. See GitHub's
[schedule reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Neocities and other static hosts

The host-independent contract is simply:

```powershell
npm run build
```

Upload the **contents** of `dist/` at your site's root, preserving directories.
Do not upload the repository, `.env`, `review/`, or `public/` directly. For
manual deployment, the Neocities dashboard/CLI or another host's file uploader
can upload these ordinary HTML, CSS, SVG, XML, text and WebP files.

For scripted Neocities deployment:

1. Create your Neocities site and obtain its API key through the documented
   authenticated `GET /api/key` mechanism. Store it as `NEOCITIES_API_KEY`.
2. Set `SITE_URL` to the actual Neocities/custom-domain origin.
3. Run `npm run build`, then `npm run deploy`.
4. For CI, add the secret and set `DEPLOY_NEOCITIES=true` and `SITE_URL`.

The script uses Neocities' [documented API](https://neocities.org/api): bearer
authentication, a remote file listing, SHA-1 change comparison, and a multipart
upload. It avoids unchanged uploads. It also deletes obsolete **generated**
article paths and image files matching this project's filename conventions,
so withdrawing a published article does not leave its previous page online.
Use a dedicated Neocities site: matching generated paths are owned by this
project. Other remote files are left alone. Renamed human article paths outside
the generated naming convention must be removed manually when withdrawn.

Uploads are not atomic and this small script caps a changed batch at 100 MB.
Check your plan's storage and accepted file types. Do not schedule rapid repeated
deployments; the supplied hourly schedule is modest. Rerun after a partial
failure; the next listing detects successful files. For manual uploads, remove
withdrawn pages/images from the remote host yourself.

Cloudflare Pages, Netlify static hosting, GitHub Pages at a root domain, or an
ordinary file server can serve the same directory. Replace the deploy step with
that host's upload mechanism. No application rewrite, adapter or server process
is needed.

## Security and failure boundaries

- Secrets are used only by CLI/CI. Templates only import public configuration.
- API IDs and slugs are constrained before use as filenames. Writes are
  atomic and exclusive; every sync scans IDs from Markdown, including drafts.
- Downloads only allow HTTPS Meta image CDN hosts without credentials or
  redirects. Input is capped at 20 MB and 40 million pixels. Sharp strips image
  metadata, preserves aspect ratio, limits dimensions to 1600, and produces a
  640-wide variant without upscaling. A new Meta CDN hostname requires a reviewed
  allowlist change in `media.ts`.
- Generated prose cannot contain HTML, Markdown links/images, code or embeds.
  Rehype sanitization also protects Markdown rendering after human edits.
- Failures do not log remote response bodies, tokens, signed CDN URLs or SDK
  error objects. Review JSON contains the caption and rejected model text only.
- A failed media import keeps a draft; orphan images from an interrupted import
  are harmless and excluded from builds. The next attempt may replace orphan
  media only when no article with that ID exists.
- Keep normal development dependencies installed for sync/build (`npm ci`, not
  `npm ci --omit=dev`). TypeScript execution and formatting are build-time tools.

## Troubleshooting

| Symptom                              | What to check                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Missing environment fields           | Copy `.env.example`, fill required values, use `npm run sync` from the repo root                         |
| Instagram HTTP 400 / code 190        | Token expired/invalid; reauthorize and replace local and GitHub values                                   |
| Instagram 401 / 403                  | Correct login path, professional account, numeric ID, roles and basic permission                         |
| Empty media window                   | Account ID, account access, and `INSTAGRAM_MAX_PAGES`; no scraping fallback exists                       |
| Malformed Meta response              | Version and requested fields in `src/lib/instagram/index.ts`                                             |
| HTTP 429 / 5xx                       | Conservative retries run automatically; long rate limits defer to the next run                           |
| Gemini request failure               | Key, billing/quota, model access, supported image/structured output and status                           |
| Gemini invalid result                | Read `review/<id>.json`; correct the saved draft manually                                                |
| Media warning                        | Expired CDN URL, blocked host, download limits, corrupt image or unsupported video; inspect the original |
| Sync lock persists                   | Confirm no sync process is active, then remove `.sync.lock` left by a killed process                     |
| Duplicate/invalid metadata error     | Repair the named Markdown file before syncing; do not remove provenance casually                         |
| Expected draft is invisible          | Intentional: both review and draft flags must be cleared for production                                  |
| Wrong canonical URLs                 | Set `SITE_URL` before building and replace the old build                                                 |
| Git push rejected                    | Pull the latest branch, resolve edits, rerun; check branch protection and Actions write permission       |
| Neocities rejected upload            | Correct key, real origin, available storage, supported extensions and upload size                        |
| Withdrawing a page did not remove it | Check deploy completion or manually remove files outside managed naming patterns                         |

## Versions and future updates

Verified/installed on **2026-09-05**, with exact versions in `package-lock.json`:

| Component      | Version / API                                                                     |
| -------------- | --------------------------------------------------------------------------------- |
| Node           | Tested with 24.18.0; CI uses 24                                                   |
| Astro          | 7.3.1, static output and `glob()` content loader                                  |
| Astro Markdown | `@astrojs/markdown-remark` 7.3.0, explicit `unified()` processor for sanitization |
| Google SDK     | `@google/genai` 2.21.0, Interactions API, `store: false`                          |
| Gemini default | `gemini-3.8-flash`, stable in Google's current catalog                            |
| Meta           | Instagram Login API, version v26.0, configurable                                  |
| Zod            | 4.5.4                                                                             |
| Sharp          | 0.35.4                                                                            |
| TypeScript     | 6.0.3, latest compatible stable major accepted by `@astrojs/check` 0.9.10         |

Astro's current [Markdown documentation](https://docs.astro.build/en/guides/markdown-content/)
and [content collection guide](https://docs.astro.build/en/guides/content-collections/)
describe the configured native collection and processor interfaces.

Keep version changes localized: Meta fields and login behavior in
`src/lib/instagram/index.ts`, Gemini calls/prompt in `src/lib/gemini/index.ts`,
schemas in `src/lib/content/schema.ts`, deployment in
`scripts/deploy-neocities.ts`. Read official changelogs, update `.env.example` and
workflow defaults together, run fixture/tests/check/build, and perform one live
draft import before enabling the new configuration. Existing articles remain
unchanged by SDK or model upgrades.

## Verification

The offline test suite covers normalization, collision-safe paths, strict model
validation, repeated imports, preservation of renamed human edits, carousel
optimization, review flags, malformed model responses, partial failures, locks,
URL restrictions, mocked Meta pagination/authentication, HTTP error redaction and
workflow YAML parsing. Build verification checks published routes, metadata,
internal links, images, absence of drafts/private content and visitor scripts.

Live Instagram authorization, Gemini generation quality/quota, actual GitHub
runner execution and Neocities uploads require your accounts and credentials.
They are not exercised by the offline tests.
