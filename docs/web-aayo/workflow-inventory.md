# n8n workflow inventory

No n8n instance or version was found locally, so this inventory distinguishes the one portable starter export from workflows that remain specifications only. No workflow has been imported, credentialed, tested in n8n, or activated.

| ID | Trigger and purpose | Dependencies | State |
| --- | --- | --- | --- |
| WF-01 | Authenticated webhook imports a bounded JSON `rows` batch into Relay, validates source-use acknowledgement, and returns counts | n8n Webhook Header Auth; n8n HTTP Header Auth credential; Relay HTTPS URL, MongoDB migration and `WEB_AAYO_AUTOMATION_TOKEN` | Export exists at `n8n/WF-01-lead-import.json`; inactive; node versions unverified |
| WF-02 | Scheduled bounded research/qualification, evidence capture and score updates | Actual AI provider/model, permitted source APIs, source terms, data budget, MongoDB write API | Not built; blocked on provider/source discovery |
| WF-03 | Qualified lead → personalized message draft and approval task | AI provider, verified evidence, business-approved service claims | Not built; no message send |
| WF-04 | Revision-specific approval → consent/suppression/frequency recheck → dry-run sender | WhatsApp/email provider, templates, inbound opt-out state, explicit operator activation | Not built; live sending prohibited |
| WF-05 | Signed, deduplicated inbound WhatsApp event → deterministic opt-out and intent routing | Existing provider webhook/signature/delivery capabilities | Not built; inbound provider capability unverified |
| WF-06 | Due follow-up review/draft with hard stop conditions | Persistent task records, consent and customer-service-window rules | Not built; no automated follow-up |
| WF-07 | Daily niche intelligence using licensed APIs and verified source dates | Permitted source list, retrieval policies, AI provider | Not built; no scraping or external searches |
| WF-08 | Authenticated client-specific content drafts and quality checks | Client brand profiles, approved pricing/claims, AI provider | Not built; no publishing |
| WF-09 | Revision approval and manual publishing package | Content UI and audit history; user publishes manually | Not built |
| WF-10 | Daily confirmed KPI report and redacted n8n failure event capture | Financial ledger, n8n Error Trigger/API, notification integration | Not built; revenue metrics remain blank |

WF-01 is only an import bridge. It does not perform the end-to-end sales or content system described in the master prompt.
