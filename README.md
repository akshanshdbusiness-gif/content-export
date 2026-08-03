# Sitecore Content Export Tool

A standalone Next.js 15 app for exporting page content and component data from
**Sitecore XM Cloud** to structured **XML**. Browse the content tree, select
pages, and download a clean file containing all page fields and component field
values.

---

## ⚠ Read this before running a large export

The export runs on the **Edge layout service**. Every selected page is one Edge
request, and they are issued one after another.

1. **Run large exports during off-peak hours.** A few hundred pages is a
   sustained burst against the same service your sites read from.
2. **Point each environment at the CM (preview) host, not Experience Edge
   delivery.** The app calls `{host}/sitecore/api/graph/edge`, so `host` should
   be your CM URL
   (`https://xmc-<org>-<project>-<env>.sitecorecloud.io`).
   Experience Edge **delivery** is rate limited to **80 requests per second
   across the entire organisation** — an export aimed there competes with live
   traffic and can get you throttled. The app detects hosts that look like Edge
   delivery and warns in the UI, and reports HTTP 429 as a rate-limit error
   rather than a generic failure.
3. **Edge serves published content only.** The content tree reads `master`, so a
   page can be visible and tickable in the tree yet export as nothing if it has
   never been published. The export says so explicitly in its warnings.

---

## What it does

- **Content tree browser** — navigate `/sitecore/content` and tick the pages to export.
  This is the one place the Authoring GraphQL API is used; it reads `master`, so
  unpublished items are visible in the tree
- **Edge layout API crawl** — for each selected page, calls `{host}/sitecore/api/graph/edge`
  with your API key; the response contains all page fields and every component's
  datasource fields already resolved. This is the whole export pipeline — one request
  per page, issued sequentially
- **Auto site detection** — extracts the XM Cloud site name from the Sitecore content path
  (segment before `/Home`) — no manual input needed
- **Structured XML output** — `<Page>` → `<Fields>` + `<Presentation>` → `<Placeholder>` →
  `<Component>` → nested field elements
- **Component field nesting** — JSON object fields (images, links, card lists) are rendered
  as proper nested XML elements, not escaped strings
- **Header/footer skip** — checkbox to exclude shared `headless-header`, `headless-footer`,
  `sxa-header`, `sxa-footer` placeholders
- **Credentials modal** — paste a `SITECORE_ENVIRONMENTS` JSON value or add environments one
  at a time at runtime (kept in server memory only, never written to disk)
- **Optional Auth0 SSO** — integrate with Sitecore Cloud login; disable entirely with
  `DISABLE_AUTH=true` for local/internal use

---

## XML output structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<SitecoreExport version="1.0" exportedAt="2026-08-02T19:26:25.649Z" environment="Dev"
                language="en" totalPages="1" totalComponents="2">
  <Pages count="1">
    <Page itemPath="/sitecore/content/org/site/Home/about" itemId="{1111...}"
          name="about" displayName="About" templateName="Page"
          language="en" site="site" route="/about">
      <Fields count="4">
        <Field name="pageTitle">About Acme</Field>
        <Field name="metaDescription">We are a global materials company.</Field>
        <Field name="ogImage">
          <src>https://cdn.example.com/image.jpg</src>
          <alt>About image</alt>
          <width>1200</width>
          <height>630</height>
        </Field>
      </Fields>
      <Presentation componentCount="2">
        <Placeholder key="headless-main" componentCount="1">
          <Component index="0" type="CardGrid" uid="e32417ec-..."
                     datasourcePath="/sitecore/content/org/site/Data/Cards">
            <Params>
              <GridParameters>col-12</GridParameters>
              <FieldNames>TextOnHover</FieldNames>
            </Params>
            <Fields count="2">
              <Field name="sectionTitle">Brands</Field>
              <Field name="cardList">
                <item>
                  <id>29C99ECD-...</id>
                  <title>Aurora™</title>
                  <image>
                    <src>https://cdn.example.com/aurora.jpg</src>
                    <alt>Aurora</alt>
                  </image>
                  <cta>
                    <href>https://www.example.com/aurora</href>
                    <text>Learn More</text>
                  </cta>
                </item>
              </Field>
            </Fields>
          </Component>
        </Placeholder>
      </Presentation>
    </Page>
  </Pages>
</SitecoreExport>
```

XML is the only output format. It is chosen precisely because nesting survives: image and
link objects become child elements and content lists become `<item>` elements, so nothing
is flattened into an escaped JSON blob.

Field elements carry the field name only. The layout service returns names and values, not
template metadata, so there is no field type or template section to record.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 20 |
| npm | ≥ 10 |
| XM Cloud environment | with Authoring API access and/or a GraphQL API key |

---

## Local development

```bash
cd content-export
```

```bash
npm install
```

```bash
cp .env.example .env.local
```

Edit `.env.local` — minimum required: `SITECORE_ENVIRONMENTS` + `DISABLE_AUTH=true`.

```bash
npm run dev
```

Open <http://localhost:3000>.

---

## Environment variables

### Minimum setup (no auth, local dev)

```env
DISABLE_AUTH=true
NEXT_PUBLIC_DISABLE_AUTH=true
SITECORE_ENVIRONMENTS=[{"name":"Dev","host":"https://xmc-org-project-dev.sitecorecloud.io","clientId":"...","clientSecret":"...","contextId":"...","apiKey":"..."}]
```

> `SITECORE_ENVIRONMENTS` must be a **single line** — dotenv only preserves multi-line
> values when the whole value is wrapped in double quotes.

### Full reference

| Variable | Required | Description |
|---|---|---|
| `SITECORE_ENVIRONMENTS` | Yes¹ | JSON array of environment objects — see schema below |
| `DISABLE_AUTH` | Local dev | `true` to skip all JWT checks |
| `NEXT_PUBLIC_DISABLE_AUTH` | Local dev | `true` to hide the Auth0 login screen |
| `ALLOW_RUNTIME_CREDENTIALS` | — | `false` to disable the in-app Credentials modal |
| `NEXT_PUBLIC_ALLOW_RUNTIME_CREDENTIALS` | — | Same switch, client side |
| `SITECORE_ORG_ID` | Auth only | Your `org_...` ID from Sitecore Cloud |
| `SITECORE_ADMIN_ROLE_PATTERNS` | Auth only | Comma-separated role substrings accepted as admin |
| `SITECORE_AUTH_DOMAIN` | Auth only | Default: `https://auth.sitecorecloud.io` |
| `SITECORE_USER_TOKEN_AUDIENCE` | Auth only | Default: `https://api-webapp.sitecorecloud.io` |
| `SITECORE_MACHINE_TOKEN_AUDIENCE` | Auth only | Default: `https://api.sitecorecloud.io` |
| `NEXT_PUBLIC_AUTH0_CLIENT_ID` | Auth only | Auth0 application client ID |
| `NEXT_PUBLIC_AUTH0_DOMAIN` | Auth only | Default: `auth.sitecorecloud.io` |
| `NEXT_PUBLIC_AUTH0_AUDIENCE` | Auth only | Default: `https://api-webapp.sitecorecloud.io` |
| `NEXT_PUBLIC_AUTH0_SCOPE` | Auth only | Default: `openid profile email offline_access` |
| `NEXT_PUBLIC_SITECORE_ORG_ID` | Auth only | Same as `SITECORE_ORG_ID` (client-side) |

¹ Optional if you add every environment through the Credentials modal instead.

### `SITECORE_ENVIRONMENTS` schema

```json
[
  {
    "name":         "Dev",
    "host":         "https://xmc-org-project-dev.sitecorecloud.io",
    "clientId":     "automation_client_id",
    "clientSecret": "automation_client_secret",
    "contextId":    "edge_context_id",
    "apiKey":       "graphql_api_key"
  }
]
```

| Field | Required | Where to find it |
|---|---|---|
| `name` | Yes | Anything — shown in the dropdown |
| `host` | Yes | XM Cloud Deploy → Environment → Details → **CM URL** (not an Edge delivery host) |
| `apiKey` | **Yes** | CM host → `/sitecore/api/graph/edge` Playground → Settings → API Key |
| `clientId` / `clientSecret` | Optional | Deploy → Environment → Credentials → Create (Automation scope) |
| `contextId` | Optional | Deploy → Environment → Details → Context ID (informational) |

`apiKey` is what runs the export and is effectively required. The automation client is
optional and powers **only** the content tree browser and the *Include descendants*
option — without it you can still export by typing page paths in manually. The UI shows
which capabilities the selected environment has.

---

## How the export works

Everything is read through the Edge layout API — one request per page, returning the page
fields and every component's resolved datasource fields in a single response. Requests are
issued **sequentially**, on purpose: parallelising them is the fastest way to trip
Sitecore's rate limiter.

The Authoring GraphQL API is used in exactly one place — browsing the content tree and
expanding an *Include descendants* selection into concrete page paths. No page content is
ever read through it.

```
Selected Sitecore path
       │
       ▼
siteNameFromPath()    →  "acme-us"   (segment before /Home)
sitecorePathToRoute() →  "/about"     (everything below /Home)
       │
       ▼
POST {host}/sitecore/api/graph/edge      (sc_apikey header)
  query GetPageLayout(siteName, routePath, language)
       │
       ▼
rendered.sitecore.route
  ├── fields        → <Page><Fields>…</Fields>
  └── placeholders  → <Presentation><Placeholder><Component>…
       │
       ▼
xml-exporter.ts
       │
       ▼
Content-Disposition: attachment; filename="sitecore-export-2026-08-02-about.xml"
```

---

## Useful scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Create optimised production build |
| `npm run start` | Run the production build |
| `npm run type-check` | TypeScript check without emit |
| `npm run lint` | ESLint across `src/` |
| `npm test` | Run the Vitest suite |

---

## Architecture

```
content-export/
├── .env.example
├── next.config.ts              ← security headers + frame-ancestors for the Sitecore portal
├── vitest.config.mts
└── src/
    ├── app/
    │   ├── page.tsx                  ← app shell with optional Auth0 gate
    │   ├── layout.tsx / providers.tsx
    │   ├── globals.css
    │   └── api/
    │       ├── environments/         ← GET    list configured environments
    │       ├── tree/                 ← GET    browse one level of the content tree
    │       ├── sites/                ← GET    list XM Cloud site definitions
    │       ├── export/               ← POST   crawl pages → download XML
    │       └── settings/credentials/ ← GET/POST/DELETE runtime credential store
    ├── components/
    │   ├── ContentTreeBrowser.tsx    ← lazy collapsible tree, layout-aware checkboxes
    │   ├── EnvironmentSelector.tsx   ← environment + language, capability badges
    │   ├── ExportPanel.tsx           ← main UI
    │   ├── UsageDisclaimer.tsx       ← off-peak / preview-vs-live notice
    │   └── CredentialsModal.tsx      ← paste JSON / add a single environment
    └── lib/
        ├── auth/
        │   ├── guard.ts              ← withOrgAdmin() route guard
        │   └── verify-user.ts        ← JWT verification via JWKS (+ DISABLE_AUTH bypass)
        ├── config.ts                 ← environment config + runtime credential store
        ├── types.ts                  ← shared TypeScript types
        ├── sitecore/
        │   ├── edge-client.ts        ← Edge transport, 429 handling, live-host detection
        │   ├── edge-layout.ts        ← Edge layout API + field flattening  (the export)
        │   ├── authoring.ts          ← Authoring GraphQL client, schema-variant fallback
        │   ├── env-token.ts          ← M2M token cache (Authoring only)
        │   └── tree.ts               ← content tree queries + descendant walk
        └── exporters/
            ├── run-export.ts         ← resolves paths, crawls pages sequentially
            └── xml-exporter.ts       ← PageExport[] → nested XML + filename
```

The split is deliberate: everything under `edge-*` is the export path, and
`authoring.ts` / `env-token.ts` / `tree.ts` exist solely to render the content tree.

### Authoring schema variants

The Authoring GraphQL schema has shifted between XM Cloud releases (notably around
`Item.children`). `authoring.ts` sends a list of candidate query documents and keeps
whichever one the environment accepts, so the tree works across releases without a
version flag.

---

## Production deployment

### 1. Build

```bash
npm run build
```

### 2. Run

```bash
npm run start
```

Listens on `PORT` (default 3000).

### 3. Required environment variables

```
NODE_ENV=production
SITECORE_ENVIRONMENTS=[{"name":"Prod","host":"...","clientId":"...","clientSecret":"...","contextId":"...","apiKey":"..."}]
SITECORE_ORG_ID=org_...
DISABLE_AUTH=false
NEXT_PUBLIC_DISABLE_AUTH=false
NEXT_PUBLIC_AUTH0_CLIENT_ID=...
NEXT_PUBLIC_AUTH0_DOMAIN=auth.sitecorecloud.io
NEXT_PUBLIC_AUTH0_AUDIENCE=https://api-webapp.sitecorecloud.io
NEXT_PUBLIC_AUTH0_SCOPE=openid profile email offline_access
NEXT_PUBLIC_SITECORE_ORG_ID=org_...
```

> **Never** set `DISABLE_AUTH=true` in production — it removes every authorization check
> from the API routes. Consider also setting `ALLOW_RUNTIME_CREDENTIALS=false` so
> credentials can only come from the platform's secret store.

### 4. Docker

Add `output: "standalone"` to `next.config.ts` (it is present but commented out), then:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
```

### 5. Vercel

```bash
npx vercel --prod
```

Set the variables from step 3 via the dashboard or `vercel env add`.

---

## Troubleshooting

### `X is not a function`, or `Cannot find module './331.js'`

Almost always a stale `.next` directory rather than a code problem — typically caused by
`next dev` and `next build` writing to the same `.next` folder (for example, running
`npm run build` while the dev server is still up). The symptom is a minified runtime error
in `.next/server/app/page.js` that points at no source you recognise.

Stop every running dev/prod server, wipe the build output, and rebuild:

```bash
rm -rf .next tsconfig.tsbuildinfo && npm run build
```

On Windows PowerShell:

```bash
Remove-Item -Recurse -Force .next, tsconfig.tsbuildinfo -ErrorAction SilentlyContinue; npm run build
```

Never run `npm run dev` and `npm run build`/`npm run start` against the same checkout at
the same time.

---

## Notes and limits

- A single export is capped at **250 pages** (`MAX_PAGES_PER_EXPORT` in
  `src/lib/exporters/run-export.ts`); the cap is reported as a warning inside the file.
- Pages are crawled **sequentially** to stay inside XM Cloud rate limits. Large subtrees
  take time; `/api/export` sets `maxDuration = 300`. Do not parallelise the loop in
  `run-export.ts` without adding a concurrency limiter and retry/backoff.
- A rate-limited response (HTTP 429) is reported as such, with a reminder to re-run
  off-peak and to check the host is the CM preview endpoint.
- **Include descendants** requires an automation client — expanding a subtree walks the
  content tree through the Authoring API. Without one, the selected page is exported on
  its own and a warning says so.
- The tree reads `master` but the export reads Edge, so a page can be tickable and still
  export as nothing if it is unpublished. The export reports that per page.
- Items without presentation (folders, data items) cannot be ticked in the tree; only
  pages with a non-empty `__Renderings`/`__Final Renderings` field are exportable.
- Rich text is flattened to plain text by default. Tick **Preserve HTML in rich text** to
  keep the markup (XML-escaped in the output).
- Runtime credentials added through the modal live in server memory only and are lost on
  restart. Use `SITECORE_ENVIRONMENTS` for anything permanent.

---

## Relationship to other migration tools

| Tool | Purpose |
|---|---|
| `content-transfer-app` | Transfer / backup / restore items between environments |
| **`content-export`** | Export page field values + component data to XML for audits, migration mapping, or AEM/other CMS ingestion |
