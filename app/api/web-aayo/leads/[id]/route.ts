import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { leadStatuses } from "@/lib/web-aayo/domain";
import { updateGrowthLeadStatus } from "@/lib/web-aayo/store";

export const dynamic = "force-dynamic";

const statusSchema = z.object({ status: z.enum(leadStatuses) });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid lead status." }, { status: 400 });
  const { id } = await context.params;
  try {
    const lead = await updateGrowthLeadStatus(id, parsed.data.status);
    return lead
      ? NextResponse.json({ lead })
      : NextResponse.json({ error: "Lead not found." }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Could not update the lead." }, { status: 503 });
  }
}
