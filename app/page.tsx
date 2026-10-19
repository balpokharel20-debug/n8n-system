import { WorkflowStudio } from "@/components/workflow-studio";
import { connection } from "next/server";

export default async function Home() {
  // CSP nonces are generated per request by proxy.ts. Opt out of static
  // prerendering so Next can read the request CSP and nonce its scripts.
  await connection();
  return <WorkflowStudio />;
}
