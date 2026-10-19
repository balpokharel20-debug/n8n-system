import { connection } from "next/server";
import { WebAayoDashboard } from "@/components/web-aayo-dashboard";

export default async function WebAayoPage() {
  await connection();
  return <WebAayoDashboard />;
}
