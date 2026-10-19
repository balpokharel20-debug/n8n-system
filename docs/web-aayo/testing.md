# Web Aayo tests and verification

## Local automated checks

Run:

```powershell
npm run typecheck
npx vitest run tests/web-aayo-domain.test.ts
npm run test
npm run build -- --webpack
```

The focused domain suite covers name normalization, score thresholds, unknown-consent blocking, quoted CSV fields, explicit permitted-source acknowledgement, consent evidence, malformed quoting and row limits. The migration script is intentionally not run without an available MongoDB URI.

## External integration checks

No n8n server, MongoDB connection string, AI credentials, WhatsApp credentials, or Vercel project link was available in the local audit. Therefore MongoDB insert/index/restore tests, n8n import/node validation, AI API tests, WhatsApp inbound/outbound tests, provider webhooks, and production-database isolation tests are blocked and must not be represented as passed.

All future outbound-message tests must use mocks or dry-run mode. No marketing messages or public content have been sent or published by this implementation.
