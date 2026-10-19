# Web Aayo phase-one setup

## Local prerequisites

- Node.js 22.13 or newer.
- A reachable MongoDB deployment with a least-privilege application user. Do not use a local-only MongoDB URI for a Vercel deployment.
- The existing Relay admin environment values. Keep them in `.env.local`, not Git.
- `WEB_AAYO_AUTOMATION_TOKEN` is needed only if the optional n8n import workflow will call Relay.

Copy `.env.example` to `.env.local` if it does not already exist, then fill `MONGODB_URI` and `MONGODB_DB` using your private MongoDB connection details. Do not paste credentials into chat or commit them.

## Inspect and migrate MongoDB

From the project directory:

```powershell
npm install
npm run web-aayo:migrate
```

The first command only inventories `web_aayo_*` collection names and counts, checks for duplicate groups that would prevent unique indexes, and makes no database changes. If it reports conflicts, resolve them manually after reviewing a protected backup.

When the dry run is clean, apply:

```powershell
npm run web-aayo:migrate -- --apply
```

Before index changes, this exports existing `web_aayo_*` documents to `.web-aayo-backups/<timestamp>/` as Extended JSON Lines and writes a manifest. The backup may contain contact information; keep the directory private and never commit or send it. No existing non-prefixed Relay collections are read or changed by this script.

Only after the migration exits successfully, set `WEB_AAYO_SCHEMA_READY=true` in local `.env.local` or the intended Vercel environment. Do not enable that flag on an environment where the migration was not run.

## Run and use the dashboard

```powershell
npm run dev
```

Sign in to Relay, then open `/web-aayo` or use the Web Aayo link in the workflow sidebar. Download `public/web-aayo-import-template.csv` and export spreadsheet data as CSV (phase one does not parse `.xlsx` directly). Keep the file under 1 MB and 1,000 data rows.

Required import fields are `name`, `source`, and `source_usage_permitted=yes`. That flag is an operator attestation that the source's terms permit the collection and intended use; the app does not independently certify source terms. Use only permitted business sources. The contact permission defaults to `unknown`, which blocks promotional outreach. Do not import prohibited or uncertain scraped data.

Importing creates/reuses a business record and creates a research-pending lead. It never sends a message, creates an outreach job, or publishes content. Status changes are manual; setting `do_not_contact` suppresses all contacts linked to that business.

## Optional n8n import bridge

`n8n/WF-01-lead-import.json` accepts a JSON body with a `rows` array; it does not upload Excel files. It is inactive and was not validated against an installed n8n version because none was available in the audited environment. See [workflow inventory](workflow-inventory.md) for the state and dependencies of all ten requested workflows.

After importing into your actual n8n instance:

1. Read the installed version in n8n's About/Settings screen and validate every node in that version.
2. Assign a Header Auth credential to the Webhook node before activation.
3. Assign a separate HTTP Header Auth credential to the HTTP Request node with header name `x-web-aayo-token` and value matching `WEB_AAYO_AUTOMATION_TOKEN` in Relay. Never save the value in workflow JSON.
4. Edit the HTTP Request node URL to the correct HTTPS Relay origin. For local-only testing, use the host-reachable local URL (for Docker n8n, `host.docker.internal` may be needed instead of `localhost`).
5. Send a small permitted test batch in a non-production database, verify inserts/deduplication/rejections, inspect execution-data retention, and leave the workflow inactive until explicitly approved.

The JSON workflow is a transport/import helper only. It is not the research, AI, outreach, follow-up, content, or reporting system.
