"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, Ban, BriefcaseBusiness, Check, CircleAlert, FileUp, LoaderCircle, RefreshCw, Search, ShieldCheck } from "lucide-react";

type LeadStatus =
  | "new" | "research_pending" | "qualified" | "review_required" | "outreach_pending"
  | "contacted" | "replied" | "meeting_booked" | "proposal_sent" | "won" | "lost" | "nurture" | "do_not_contact";

type Contact = {
  channel: string;
  contact_identifier: string;
  permission_status: "unknown" | "consented" | "client_service";
  do_not_contact: boolean;
};

type Lead = {
  id: string;
  status: LeadStatus;
  score: number;
  score_route: "priority_review" | "research_or_review" | "defer";
  score_reasons: string[];
  niche: string;
  created_at: string;
  business: { name: string; category: string; location: string; website?: string; source: string } | null;
  contacts: Contact[];
};

type Summary = {
  total_leads: number;
  by_status: Record<string, number>;
  pending_approvals: number;
  open_tasks: number;
  active_clients: number;
  revenue: null;
  revenue_note: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body as T;
}

const statusLabels: Record<LeadStatus, string> = {
  new: "New",
  research_pending: "Research pending",
  qualified: "Qualified",
  review_required: "Priority review",
  outreach_pending: "Outreach draft",
  contacted: "Contacted",
  replied: "Replied",
  meeting_booked: "Meeting booked",
  proposal_sent: "Proposal sent",
  won: "Won",
  lost: "Lost",
  nurture: "Nurture",
  do_not_contact: "Do not contact",
};

const allStatuses = Object.keys(statusLabels) as LeadStatus[];

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function WebAayoDashboard() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const session = await api<{ authenticated: boolean }>("/api/auth/session");
      setAuthenticated(session.authenticated);
      if (!session.authenticated) return;
      const params = new URLSearchParams({ limit: "25", page: String(page) });
      if (status) params.set("status", status);
      if (query.trim()) params.set("q", query.trim());
      const [overview, pageResult] = await Promise.all([
        api<Summary>("/api/web-aayo/overview"),
        api<{ items: Lead[]; pages: number; total: number }>(`/api/web-aayo/leads?${params.toString()}`),
      ]);
      setSummary(overview);
      setLeads(pageResult.items);
      setPageCount(pageResult.pages);
      setTotalCount(pageResult.total);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Web Aayo records.");
    } finally {
      setLoading(false);
    }
  }, [page, query, status]);

  useEffect(() => { void load(); }, [load]);

  async function importFile(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("For phase one, export your spreadsheet as CSV and import that file.");
      return;
    }
    setImporting(true);
    setError("");
    setNotice("");
    try {
      const csv = await file.text();
      const result = await api<{ summary: { received: number; imported: number; duplicates: number }; rejected: Array<{ row: number; errors: string[] }> }>(
        "/api/web-aayo/leads/import",
        { method: "POST", headers: { "content-type": "text/csv" }, body: csv },
      );
      setNotice(`${result.summary.imported} imported · ${result.summary.duplicates} duplicate${result.summary.duplicates === 1 ? "" : "s"} · ${result.rejected.length} rejected. Nothing was contacted.`);
      await load();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function updateStatus(lead: Lead, nextStatus: LeadStatus) {
    if (nextStatus === "do_not_contact" && !window.confirm("Suppress this business’s contacts from all outreach? This will mark all linked contacts as do-not-contact.")) return;
    setError("");
    try {
      await api(`/api/web-aayo/leads/${encodeURIComponent(lead.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update lead.");
    }
  }

  if (authenticated === false) {
    return <main className="web-aayo-shell"><section className="web-aayo-empty"><ShieldCheck size={26} /><h1>Sign in to Relay first</h1><p>Web Aayo records use the existing administrator session.</p><Link href="/" className="secondary-button"><ArrowLeft size={15} /> Back to Relay</Link></section></main>;
  }

  return (
    <main className="web-aayo-shell">
      <header className="web-aayo-topbar">
        <Link href="/" className="web-aayo-brand"><span className="web-aayo-brand-mark"><BriefcaseBusiness size={17} /></span><span><strong>Web Aayo</strong><small>GROWTH DESK</small></span></Link>
        <div className="web-aayo-top-actions">
          <span className="web-aayo-safe"><ShieldCheck size={14} /> Review-first · no automatic sending</span>
          <Link href="/" className="web-aayo-back"><ArrowLeft size={14} /> Relay workflows</Link>
        </div>
      </header>

      <div className="web-aayo-content">
        <section className="web-aayo-heading">
          <div><span className="eyebrow">ORGANIC SALES PIPELINE</span><h1>Prospect desk</h1><p>Import, qualify and review local business prospects. Outreach remains gated until permission and approval are recorded.</p></div>
          <label className={`primary-button web-aayo-import ${importing ? "is-loading" : ""}`}>
            {importing ? <LoaderCircle className="spin" size={15} /> : <FileUp size={15} />}
            {importing ? "Importing" : "Import CSV"}
            <input type="file" accept=".csv,text/csv" onChange={(event) => { void importFile(event.target.files?.[0]); event.currentTarget.value = ""; }} disabled={importing || authenticated !== true} />
          </label>
        </section>

        {error && <div className="web-aayo-alert web-aayo-alert--error" role="alert"><CircleAlert size={16} /><span>{error}</span></div>}
        {notice && <div className="web-aayo-alert web-aayo-alert--success" role="status"><Check size={16} /><span>{notice}</span></div>}

        <section className="web-aayo-metrics" aria-label="Pipeline overview">
          <article><span>Total prospects</span><strong>{loading ? "—" : summary?.total_leads ?? "—"}</strong><small>Stored in the Web Aayo namespace</small></article>
          <article><span>Priority review</span><strong>{loading || !summary ? "—" : summary.by_status?.review_required ?? 0}</strong><small>High score routes to human review</small></article>
          <article><span>Pending approvals</span><strong>{loading || !summary ? "—" : summary.pending_approvals}</strong><small>Drafts only; no send action here</small></article>
          <article><span>Active clients</span><strong>{loading || !summary ? "—" : summary.active_clients}</strong><small>Confirmed active contracts only</small></article>
        </section>

        <section className="web-aayo-panel">
          <div className="web-aayo-panel-head">
            <div><h2>Lead pipeline</h2><p>Unknown consent blocks promotional outreach; imported contacts are never messaged.</p></div>
            <button className="icon-button" onClick={() => void load()} disabled={loading} title="Refresh"><RefreshCw size={15} className={loading ? "spin" : ""} /></button>
          </div>
          <div className="web-aayo-filters">
            <label className="web-aayo-search"><Search size={15} /><input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search business, niche or location" /></label>
            <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} aria-label="Filter lead status">
              <option value="">All statuses</option>
              {allStatuses.map((item) => <option key={item} value={item}>{statusLabels[item]}</option>)}
            </select>
            <a className="web-aayo-template-link" href="/web-aayo-import-template.csv" download><ArrowDownToLine size={14} /> CSV columns</a>
          </div>
          <div className="web-aayo-table-wrap">
            <table className="web-aayo-table">
              <thead><tr><th>Business</th><th>Location</th><th>Score</th><th>Contact permission</th><th>Status</th><th>Added</th></tr></thead>
              <tbody>
                {leads.map((lead) => {
                  const business = lead.business;
                  const contacts = lead.contacts ?? [];
                  const canContact = contacts.some((contact) => contact.permission_status === "consented" && !contact.do_not_contact);
                  return <tr key={lead.id}>
                    <td><div className="web-aayo-business"><strong>{business?.name ?? "Business record missing"}</strong><small>{business?.category || lead.niche || "Uncategorized"} · {business?.source || "Manual"}</small>{business?.website && <a href={business.website} target="_blank" rel="noreferrer">Website <ArrowUpRight size={11} /></a>}</div></td>
                    <td>{business?.location || "—"}</td>
                    <td><span className={`web-aayo-score web-aayo-score--${lead.score_route}`}>{lead.score}<small>/100</small></span></td>
                    <td>{contacts.length === 0 ? <span className="web-aayo-permission web-aayo-permission--blocked"><Ban size={12} /> No contact</span> : canContact ? <span className="web-aayo-permission web-aayo-permission--allowed"><ShieldCheck size={12} /> Consent recorded</span> : <span className="web-aayo-permission web-aayo-permission--blocked"><Ban size={12} /> Not eligible</span>}</td>
                    <td><select value={lead.status} onChange={(event) => void updateStatus(lead, event.target.value as LeadStatus)} aria-label={`Status for ${business?.name ?? "lead"}`}>
                      {allStatuses.map((item) => <option key={item} value={item}>{statusLabels[item]}</option>)}
                    </select></td>
                    <td>{formatDate(lead.created_at)}</td>
                  </tr>;
                })}
                {!loading && !error && leads.length === 0 && <tr><td colSpan={6} className="web-aayo-empty-row">No matching prospects yet. Import a CSV or add prospects through the authenticated API.</td></tr>}
                {loading && <tr><td colSpan={6} className="web-aayo-empty-row"><LoaderCircle size={16} className="spin" /> Loading records…</td></tr>}
              </tbody>
            </table>
          </div>
          <footer className="web-aayo-panel-foot">
            <span>{summary?.revenue_note ?? "Revenue metrics are withheld until confirmed financial records exist."}</span>
            <div className="web-aayo-pagination">
              <button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={loading || page <= 1} aria-label="Previous page">‹</button>
              <span>{totalCount ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, totalCount)} of ${totalCount}` : summary ? "0 records" : ""}</span>
              <button onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={loading || pageCount === 0 || page >= pageCount} aria-label="Next page">›</button>
            </div>
            <span><ShieldCheck size={13} /> Admin-only view</span>
          </footer>
        </section>

        <section className="web-aayo-next-step"><div><strong>Phase-one safety defaults</strong><p>Research and approval remain human-led. There is no automatic outreach or content publishing in this workspace.</p></div><span>DRY RUN · MANUAL REVIEW</span></section>
      </div>
    </main>
  );
}
