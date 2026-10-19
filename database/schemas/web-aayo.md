# Web Aayo collection contract

All Web Aayo collections use the `web_aayo_` prefix to keep them separate from the existing Relay admissions collections. IDs are stable strings in `_id` and `id`; timestamps are BSON `Date` values. No schema validator or backfill is applied to existing collections by the application.

## Implemented record shapes

- `web_aayo_businesses`: `id`, `name`, `normalized_name`, `category`, `location`, optional `website`, `source`, optional `source_business_id`/`source_url`, `source_retrieved_at`, `verified_facts[]`, `created_at`, `updated_at`.
- `web_aayo_contacts`: `id`, `business_id`, `channel`, `contact_identifier`, `permission_status`, `permission_source`, optional `permission_timestamp`, `permission_purpose`, `do_not_contact`, optional `suppression_reason`/`last_inbound_at`/`last_outbound_at`, `created_at`, `updated_at`.
- `web_aayo_leads`: `id`, `business_id`, `niche`, `service_fit` with the five scored dimensions and notes, `score`, `score_route`, `score_reasons`, `confidence`, optional `research`, `status`, `owner`, optional `last_contact_at`/`next_action_at`, `import_fingerprint`, `created_at`, `updated_at`.

The CSV importer accepts only business fields, explicit source-use acknowledgement, optional contact/permission data, and bounded manual score inputs. It never stores a credential, writes a message, or infers consent.

## Reserved collection contracts

Indexes are prepared for `conversations`, `outreach_jobs`, `clients`, `brand_profiles`, `research_items`, `content_items`, `tasks`, `metrics_daily`, `workflow_events`, and `settings`. Their complete write paths and validators are not implemented yet. Do not insert arbitrary documents into these collections or treat their indexes as proof that those workflows are ready.

## Index source of truth

The explicit migration script is `scripts/migrate-web-aayo.mjs`; its index definitions must be kept aligned with the `WEB_AAYO_SCHEMA_READY` guard in `lib/web-aayo/store.ts`. The application checks that flag and connects, but does not silently create or modify indexes at runtime. Unique indexes use partial filters where records may legitimately lack an ID; daily metric dates are non-unique until a tenant/key model is defined.
