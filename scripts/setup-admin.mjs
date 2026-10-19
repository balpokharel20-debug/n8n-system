import { randomBytes, scryptSync } from "node:crypto";
import process from "node:process";

function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal so the password can be entered without echoing.");
  }

  return new Promise((resolve, reject) => {
    let value = "";
    const input = process.stdin;

    function finish(error) {
      input.removeListener("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    }

    function onData(chunk) {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          finish(new Error("Cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u0008" || character === "\u007f") {
          if (value.length) {
            value = [...value].slice(0, -1).join("");
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " ") {
          value += character;
          process.stdout.write("*");
        }
      }
    }

    process.stdout.write(prompt);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

try {
  const password = await readHidden("Choose an admin passphrase (16+ characters): ");
  const confirmation = await readHidden("Enter it again: ");
  if (password.length < 16) throw new Error("Use a passphrase with at least 16 characters.");
  if (password !== confirmation) throw new Error("The passphrases do not match.");

  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  console.log("\nAdd these values to your ignored .env.local file:");
  console.log(`RELAY_ADMIN_PASSWORD_HASH=scrypt$${salt.toString("base64url")}$${digest.toString("base64url")}`);
  console.log(`RELAY_SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
  console.log(`RELAY_WEBHOOK_SECRET=${randomBytes(32).toString("base64url")}`);
  console.log(`CRON_SECRET=${randomBytes(32).toString("base64url")}`);
  console.log(`META_VERIFY_TOKEN=${randomBytes(32).toString("base64url")}`);
  console.log("Restart the dev server after saving the values. Keep .env.local private.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not set up admin credentials.");
  process.exitCode = 1;
}
