# Web Aayo environment audit

Audit date: 2026-10-19. Scope: the checked-out `D:\testings\relay-flow` project and local process/tool availability. Secret values were not read or printed.

## What is present

- The existing app is Relay, built with Next.js 16.4.2, React 19, TypeScript, and the MongoDB Node driver 7.7. It already has a single-admin password session and an admissions-focused workflow editor/inbox.
- Existing application code supports Meta Lead Ads intake, Google Sheets append, Telegram notifications, WhatsApp Cloud template sends, and Twilio SMS fallback for the admissions pipeline. Those integrations belong to the existing admissions system and were not repurposed for Web Aayo.
- The checked-in Vercel cron is daily (`15 3 * * *`, 09:00 Asia/Kathmandu). It is Relay's scheduler, not an n8n worker.
- The project has a GitHub remote, but no local `.vercel` project link was present during the audit.

## What could not be verified locally

- No `n8n` executable or running n8n process was found. Docker, `mongosh`, and `mongod` were not available. The usual local n8n data directory was absent.
- No `.env.local`, MongoDB URI, n8n URL/API key, AI API configuration, or WhatsApp credentials were available in the project environment. The Vercel production secrets were not read.
- Therefore the installed n8n version, its deployment method/API, workflow inventory, MongoDB collections/indexes/roles, AI provider/model/limits, WhatsApp inbound/delivery callbacks, TLS/reverse proxy, timezone, and backup/restore status remain unverified. No database connectivity test or live provider test was performed.
- Repository search found no AI API client and no inbound WhatsApp or delivery-status handler. Existing WhatsApp support is outbound templates for admissions only.

## Safe implementation decision

Web Aayo records use `web_aayo_*` collections in the configured MongoDB database. The existing `leads` collection remains untouched because it stores admissions leads. Indexes are not created on page load; the migration script performs a dry run by default, checks unique-key conflicts, exports existing namespaced records before applying indexes, and requires an explicit `--apply`.

The first usable slice is an authenticated prospect desk and safe CSV/JSON import. Imports require an explicit `source_usage_permitted` confirmation, default contact permission is `unknown`, and no outreach or publishing action is implemented or activated. `n8n/WF-01-lead-import.json` is an inactive import bridge, not an installed or version-validated workflow.

## Still required from the operator

1. Provide access to the actual n8n instance (or its version, URL, and supported authenticated API) before workflow import/validation.
2. Configure the MongoDB connection in a private `.env.local` or deployment environment, inspect the target database, and run the documented backup-first migration.
3. Identify the AI provider/base URL/model and existing credential mechanism before implementing AI calls.
4. Identify the WhatsApp provider and inbound webhook/signature/delivery-status capabilities before implementing any message workflow.
5. Confirm business-approved claims, pricing, service fulfillment capacity, preferred languages, and outreach/legal policy before generating or sending promotional content.
