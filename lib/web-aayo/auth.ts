import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export function hasWebAayoAutomationToken(request: NextRequest) {
  const expected = process.env.WEB_AAYO_AUTOMATION_TOKEN;
  if (!expected) return false;
  const authorization = request.headers.get("authorization");
  const supplied = request.headers.get("x-web-aayo-token") ??
    (authorization?.startsWith("Bearer ") ? authorization.slice(7) : null);
  if (!supplied) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
