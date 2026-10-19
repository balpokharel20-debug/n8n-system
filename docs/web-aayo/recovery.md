# Web Aayo backup and recovery

## Before migration

`npm run web-aayo:migrate` performs a dry run and does not write. `npm run web-aayo:migrate -- --apply` first backs up every existing `web_aayo_*` collection as Extended JSON Lines under `.web-aayo-backups/<timestamp>/`, then creates the indexes. If there are duplicate groups for unique indexes, the script stops before backup/index writes and reports only collection, index fields and group counts (not record contents).

Protect the backup directory as sensitive business data. It is ignored by Git, but Git ignore is not encryption. Store a separate encrypted off-device copy according to your retention policy before production rollout.

## Restore safely

Restore into a separate staging database first, inspect counts and representative records using an authorized database client, and only then plan a production repair. The JSONL files preserve BSON dates through MongoDB Extended JSON. Do not use a destructive `--drop` restore against the live Relay database.

With MongoDB Database Tools installed and a URI held in a private shell environment, each file can be imported with `mongoimport` in upsert mode, for example:

```text
mongoimport --uri "$WEB_AAYO_RESTORE_URI" --db relay_restore --collection web_aayo_leads --file "<backup-path>\web_aayo_leads.jsonl" --mode=upsert --upsertFields=_id
```

The restore URI should point to the staging database; never put it directly in a checked-in script or command history. Verify that all expected collection indexes exist after restore. Since this phase adds no destructive schema rewrite, rollback is to disable the Web Aayo route with `WEB_AAYO_SCHEMA_READY=false`; the existing admissions app and data remain separate.

## Workflow rollback

The provided n8n import workflow is inactive by default. If later activated, disable it in n8n first, revoke or rotate its Header Auth credentials if exposed, then inspect the latest execution summaries without copying PII into logs. No active workflow is managed by this repository today.
