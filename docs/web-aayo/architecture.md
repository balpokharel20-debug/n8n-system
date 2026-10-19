# Web Aayo growth system architecture

## Current phase-one path

```text
Admin session
  ├─ Web Aayo dashboard (/web-aayo)
  │    ├─ CSV import (1 MB / 1,000 rows maximum)
  │    ├─ searchable, paginated prospect list
  │    └─ status + suppression controls
  └─ authenticated API (/api/web-aayo/*)
       └─ MongoDB `web_aayo_*` collections

Optional n8n WF-01 (inactive, credentials assigned by operator)
  Webhook → bounded row validation → authenticated Relay import API → summary
```

The browser/API is the current source of truth. There is no direct n8n-to-MongoDB credential or public database connection. Admin routes reuse Relay's existing signed, HttpOnly session. The service import route accepts either that admin session or a timing-safe `WEB_AAYO_AUTOMATION_TOKEN`; n8n stores the matching value in an n8n credential, never in workflow JSON.

## Namespaced collections and initial indexes

The database may be shared with the existing Relay admissions app. To prevent mixing business records, every Web Aayo collection is prefixed with `web_aayo_`.

`web_aayo_import_limits` is an operational TTL collection for a fixed-window import throttle (10 authenticated imports per minute for the single admin or n8n token); it stores only a hashed bucket key and expiry. `web_aayo_workflow_events` receives a PII-minimized summary for each import attempt.

| Collection | Initial responsibility | Indexes in migration |
| --- | --- | --- |
| `web_aayo_businesses` | business identity, permitted source and verified facts | source ID unique when present; normalized name/category/location lookup |
| `web_aayo_leads` | score, research state, owner, sales status and follow-up date | import fingerprint unique; status/score/date; due action |
| `web_aayo_contacts` | channel and permission/suppression evidence | business/channel/identifier unique when present; suppression lookup |
| `web_aayo_conversations` | provider message/event audit | provider event and message IDs unique when present |
| `web_aayo_outreach_jobs` | drafts, approval revisions and send idempotency | idempotency unique; status/schedule |
| `web_aayo_clients` | signed/active engagements and renewal data | contract status/renewal date |
| `web_aayo_brand_profiles` | client-specific approved claims and brand settings | client/update time |
| `web_aayo_research_items` | permitted source research and verification state | source URL/retrieval time; intentionally not unique |
| `web_aayo_content_items` | drafts, revision approval and manual-publishing state | client/status/schedule |
| `web_aayo_tasks` | follow-ups and delivery tasks | status/due date/priority |
| `web_aayo_metrics_daily` | daily aggregate metrics | date lookup (non-unique until a tenant/key model is defined) |
| `web_aayo_workflow_events` | redacted workflow event and correlation log | correlation ID/time |
| `web_aayo_settings` | configurable non-secret business settings | MongoDB's built-in `_id` uniqueness |

Business, contact, and lead record types are defined in `lib/web-aayo/types.ts`. Import dates are stored as BSON `Date` values. The migration writes a manifest and Extended JSON Lines backup before creating indexes. No backfill or destructive data rewrite is included.

## Lead score and permission gate

Lead scores use only explicitly supplied points: niche fit (25), verified service opportunity (25), delivery fit (20), need evidence (15), channel fit (15). Routes are 75–100 priority review, 50–74 research/manual review, and below 50 defer. Imported scores have confidence 0 and are not treated as proof of purchase intent.

`unknown` permission is the default. The current dashboard has no send button. Eligibility helper returns true only for explicit `consented` permission with no do-not-contact flag or suppression reason; channel-specific platform/template requirements still need separate checks before any sender is built.

## Not implemented or connected yet

No AI API adapter, research fetcher, WhatsApp inbound/delivery webhook, client/brand-profile UI, content studio/calendar, outreach sender, KPI finance ledger, error-notification workflow, automatic publishing, or client multi-user isolation is active. Revenue remains unavailable until confirmed financial records exist. The NPR 50k–60k monthly figure is an objective only, not a forecast or guarantee.
