# Web Aayo security checklist

## Implemented in phase one

- [x] Reuse the existing admin session; no public dashboard data API.
- [x] Require same-origin state-changing requests for browser-admin operations.
- [x] Require timing-safe automation-token comparison for the n8n import API path.
- [x] Bound import size (1 MB) and row count (1,000); validate structured fields before database writes.
- [x] Apply a MongoDB-backed throttle of 10 authenticated imports per minute; retain only hashed bucket keys until TTL expiry.
- [x] Use separate `web_aayo_*` records to avoid touching Relay admissions leads.
- [x] Use stable import fingerprints and unique indexes for duplicate prevention.
- [x] Default permission to `unknown`; no marketing eligibility from a phone number or public listing alone.
- [x] Record opt-out/suppression; status `do_not_contact` marks linked contacts suppressed.
- [x] Do not put integration secrets in workflow JSON or source code.
- [x] Keep the sample n8n workflow inactive and return only the import summary.
- [x] Use a dry-run-first, duplicate-preflight, backup-before-index migration.
- [x] Leave revenue blank until financial records are implemented; do not generate fabricated dashboard metrics.

## Required before live outreach or production automation

- [ ] Verify n8n version, admin access, TLS/reverse proxy, API exposure, credential encryption key, backup/restore, and security audit.
- [ ] Set MongoDB least-privilege roles, IP/network policy, TLS, backup retention, and a tested restore plan.
- [ ] Identify and test the AI provider adapter, model, budget, data-retention policy, timeout and schema validation.
- [ ] Identify WhatsApp provider, business-account approval, webhook signature, customer-service window, approved templates, opt-out handling, and delivery callbacks.
- [ ] Build persistent rate limits, webhook event deduplication, provider idempotency and ambiguous-send handling before adding a sender.
- [ ] Add client-scoped access checks before storing more than one client's data. Current UI is single-admin, not a multi-tenant client portal.
- [ ] Set retention/deletion policies for contacts, conversations, leads, research and execution records; document data-subject requests.
- [ ] Do not contact imported contacts until lawful/required permission, channel eligibility, frequency caps, current suppression, and revision-specific approval pass.
- [ ] Keep publishing manual. No social publishing API call exists in this phase.

Never store a WhatsApp token, AI key, MongoDB URI, n8n API key, admin passphrase, or generated secret in a workflow export, CSV, issue, log, or chat.
