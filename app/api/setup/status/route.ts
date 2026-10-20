import { NextRequest, NextResponse } from "next/server";
import { isAdmin, isAuthConfigured } from "@/lib/auth";
import { getDatabase, hasDatabase } from "@/lib/db";
import { usesLocalPersistence } from "@/lib/local-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SetupItem = {
  id: string;
  title: string;
  status: "ready" | "missing" | "warning";
  description: string;
  variables: string[];
};

function has(names: string[]) {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

function item(
  id: string,
  title: string,
  variables: string[],
  description: string,
  configured: boolean,
): SetupItem {
  return { id, title, status: configured ? "ready" : "missing", variables, description };
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items: SetupItem[] = [
    item(
      "admin-auth",
      "Admin password and session",
      ["RELAY_ADMIN_PASSWORD_HASH", "RELAY_SESSION_SECRET"],
      "Required to protect the dashboard and its management APIs.",
      isAuthConfigured(),
    ),
  ];

  if (hasDatabase) {
    let reachable = false;
    try {
      const database = await getDatabase();
      await database.command({ ping: 1 });
      reachable = true;
    } catch {
      // Deliberately avoid returning database hostnames, credentials, or driver errors.
    }
    items.push(item(
      "mongodb",
      "MongoDB persistence",
      ["MONGODB_URI", "MONGODB_DB"],
      reachable
        ? "MongoDB answered a read-only ping; Relay creates its indexes on first use."
        : "MongoDB is configured but did not answer. Check the URI, network access list, and database user permissions.",
      reachable,
    ));
  } else {
    items.push({
      id: "mongodb",
      title: "MongoDB persistence",
      status: usesLocalPersistence() ? "warning" : "missing",
      variables: ["MONGODB_URI", "MONGODB_DB"],
      description: usesLocalPersistence()
        ? "MongoDB is not configured; this local development instance is using its local JSON file. Configure MongoDB before production or workflow activation."
        : "MongoDB is required outside local development.",
    });
  }

  items.push(
    {
      id: "webhook-auth",
      title: "Incoming webhook protection",
      status: has(["RELAY_WEBHOOK_SECRET"]) || has(["META_APP_SECRET", "META_VERIFY_TOKEN"]) ? "ready" : "missing",
      variables: [
        "RELAY_WEBHOOK_SECRET for custom webhooks",
        "or META_APP_SECRET + META_VERIFY_TOKEN for Meta Lead Ads",
      ],
      description: "Webhook requests are rejected unless they include the shared secret or a valid Meta signature.",
    },
    item(
      "meta",
      "Meta Lead Ads",
      ["META_APP_SECRET", "META_VERIFY_TOKEN", "META_PAGE_ACCESS_TOKEN", "META_GRAPH_API_VERSION"],
      "Needed for Meta webhook verification, signature checks, and fetching Instant Form details.",
      has(["META_APP_SECRET", "META_VERIFY_TOKEN", "META_PAGE_ACCESS_TOKEN", "META_GRAPH_API_VERSION"]),
    ),
    item(
      "sheets",
      "Google Sheets",
      ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "GOOGLE_SHEET_ID"],
      "Share the destination sheet with the service account email. Secret values stay on the server.",
      has(["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "GOOGLE_SHEET_ID"]),
    ),
    item(
      "telegram",
      "Telegram alerts and daily call list",
      ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
      "Add the bot to the admissions chat and provide the chat ID.",
      has(["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]),
    ),
  );

  const whatsappReady = has(["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "META_GRAPH_API_VERSION"]);
  const smsReady = has(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]);
  items.push({
    id: "followup",
    title: "Lead follow-up channel",
    status: whatsappReady || smsReady ? "ready" : "missing",
    variables: [
      "WhatsApp: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, META_GRAPH_API_VERSION",
      "or SMS: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER",
    ],
    description: whatsappReady
      ? "WhatsApp credentials are present. Confirm approved templates and messaging permission before activating live sends."
      : smsReady
        ? "Twilio credentials are present. Confirm recipient permission and test the sender before activating live sends."
        : "Configure one complete channel. Only contact leads with the required permission; WhatsApp templates must be approved.",
  });

  items.push(
    item(
      "cron",
      "Scheduled jobs and reminders",
      ["CRON_SECRET"],
      "Protects the daily Vercel Cron route used for reminders, uncalled-lead digests, and scheduled workflows.",
      has(["CRON_SECRET"]),
    ),
  );

  return NextResponse.json(
    {
      checkedAt: new Date().toISOString(),
      items,
      summary: {
        ready: items.filter((entry) => entry.status === "ready").length,
        total: items.length,
        operational: items.every((entry) => entry.status === "ready"),
      },
      secretValuesExposed: false,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
