# Relay

Relay is a Vercel-native visual workflow automation system. It provides an n8n-style graph editor while keeping the runtime compatible with serverless deployments.

## Included

- Visual node canvas with draggable, connectable steps
- Manual, webhook, and scheduled triggers
- Data mapping with `{{input.*}}`, `{{previous.*}}`, and `{{steps.*}}` expressions
- Yes/no condition branches
- HTTP actions with server-side environment secret references
- JSON response nodes
- MongoDB persistence and execution history
- Password-based admin login with signed, HttpOnly sessions
- Required webhook and cron secrets
- Vercel Cron integration
- Local file persistence for workflows, leads, executions, and reminder state
- Admissions lead inbox with status controls
- Meta Lead Ads normalization and signature verification
- Google Sheets, Telegram, WhatsApp Cloud, and Twilio SMS integrations
- Day 1 / Day 3 follow-ups that stop when a lead is no longer `New`
- Daily uncalled-lead Telegram digest

## Local setup

```bash
npm install
copy .env.example .env.local
npm run auth:setup
npm run dev
```

`npm run auth:setup` asks for a 16+ character passphrase without echoing it, then prints a scrypt password hash and random session, webhook, cron, and Meta verification secrets. Copy those generated lines into `.env.local`; restart the dev server afterward. The plaintext passphrase is not saved by the script.

Set `MONGODB_URI` in `.env.local` to connect to an auth-enabled local MongoDB server, for example `mongodb://relay_app:<URL_ENCODED_PASSWORD>@127.0.0.1:27017/relay?authSource=relay`. Give that database user only `readWrite` access to the `relay` database. Set `MONGODB_DB=relay`. When `MONGODB_URI` is blank in development, Relay uses the ignored `.relay-data.json` fallback. Outside local development, missing MongoDB configuration makes storage unavailable instead of silently using volatile memory.

The example environment file leaves database and integration credentials blank, so a fresh local run does not send messages or write to third-party services. Add integration credentials only when you are ready to connect them.

## Deploy to Vercel

1. Create a MongoDB Atlas cluster, create a least-privileged application database user, and set `MONGODB_URI` and `MONGODB_DB` in Vercel.
2. Run `npm run auth:setup` locally and add the generated `RELAY_ADMIN_PASSWORD_HASH`, `RELAY_SESSION_SECRET`, `RELAY_WEBHOOK_SECRET`, `CRON_SECRET`, and `META_VERIFY_TOKEN` to Vercel environment variables. Keep the plaintext passphrase private.
3. Add any third-party credentials as Vercel environment variables. Reference them inside HTTP nodes as `{{env.SECRET_NAME}}`.
4. Import this directory as a Vercel project and deploy.
5. Open the deployment and sign in with the passphrase used to generate the hash.

MongoDB indexes are created automatically on first use. The provided `vercel.json` invokes `/api/cron` every five minutes. Vercel plan limits may restrict cron frequency; webhook and manual triggers are unaffected. Locally, run `npm run cron:local` in a second terminal alongside `npm run dev` to check reminders once per minute. For a one-off local check, send `Authorization: Bearer <CRON_SECRET>` to `GET http://localhost:3000/api/cron`.

## Admissions lead pipeline

The first empty workspace is seeded with **Admissions lead follow-up**:

`Meta webhook → fetch lead → save lead → Google Sheet + Telegram → WhatsApp/SMS → response`

1. Copy `.env.example` values into the eventual Vercel project.
2. Create a Google service account, enable the Sheets API, and share the destination sheet with `GOOGLE_SERVICE_ACCOUNT_EMAIL`. The `Leads` tab should have the columns Time, Name, Phone, Course, Source, Status, External ID, and Relay ID.
3. Create a Telegram bot, add it to the admissions chat, and set the bot token and chat ID.
4. Create and approve the WhatsApp templates named in the environment variables. Each template is expected to accept the student name and course as two body parameters. Twilio is used only when WhatsApp is not configured.
5. In Meta, set the callback URL to `https://YOUR-DOMAIN/api/webhooks/YOUR-WORKFLOW-SLUG` and use the exact `META_VERIFY_TOKEN` value. POST requests are verified with `META_APP_SECRET`.
6. Activate the workflow after all credentials pass a manual test.

Captured leads appear in the **Leads** screen. Staff should change a lead to Called, Qualified, Enrolled, or Closed after contact. Only leads still marked New receive the Day 1 and Day 3 messages. At `DAILY_DIGEST_HOUR` in `BUSINESS_TIMEZONE`, the cron sends the uncalled list to Telegram.

## Runtime model

Each execution is bounded to 50 nodes, HTTP steps time out after 20 seconds, and API routes declare a 60-second maximum duration. This is deliberate: Vercel Functions are request-based, not permanent workers. Add a durable queue such as QStash, Inngest, or Vercel Workflow before introducing long waits, large fan-outs, or multi-minute jobs.

## Security notes

- Management APIs require an authenticated admin session in every environment; there is no development bypass.
- The password is stored only as a scrypt hash. Sessions use an eight-hour signed `HttpOnly`, `SameSite=Strict` cookie, with `Secure` enabled in production.
- State-changing management requests require a same-origin `Origin` header. Login is rate-limited and persistent when MongoDB is configured.
- Incoming webhooks require `x-relay-secret` or a valid Meta HMAC signature. Cron requests require `CRON_SECRET`; both fail closed when secrets are missing.
- Production responses include CSP with per-request script nonces, HSTS, clickjacking, MIME-sniffing, referrer, and cross-origin isolation headers.
- HTTP nodes block localhost and private-network targets to reduce SSRF risk.
- Secret values stay in ignored local environment files or Vercel environment variables; workflow definitions store only references.
- Put the deployment behind Vercel Authentication or add user accounts before using Relay as a multi-user product.
- Local MongoDB is reachable only from this machine. A Vercel deployment must use a network-reachable database such as Atlas; do not put `127.0.0.1` in Vercel environment variables.

# n8n-system
