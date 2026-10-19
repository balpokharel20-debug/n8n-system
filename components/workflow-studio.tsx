"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
} from "@xyflow/react";
import {
  Activity,
  Blocks,
  Braces,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Cloud,
  Copy,
  Database,
  Ellipsis,
  FileSpreadsheet,
  GitBranch,
  KeyRound,
  ListChecks,
  LoaderCircle,
  LogOut,
  LockKeyhole,
  MousePointerClick,
  MessageCircle,
  MessagesSquare,
  PanelLeftClose,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  Webhook,
  UserRoundSearch,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { leadCaptureWorkflow } from "@/lib/lead-capture-workflow";
import type {
  Execution,
  Lead,
  LeadStatus,
  NodeConfig,
  NodeKind,
  Workflow,
  WorkflowEdge,
  WorkflowInput,
  WorkflowNode,
  WorkflowStatus,
} from "@/lib/types";
import { WorkflowNodeCard } from "@/components/workflow-node";

const nodeTypes = { workflow: WorkflowNodeCard };

const nodeCatalog: Array<{
  kind: NodeKind;
  name: string;
  description: string;
  icon: typeof Zap;
  config: NodeConfig;
}> = [
  { kind: "trigger.manual", name: "Manual", description: "Start from the editor", icon: MousePointerClick, config: {} },
  { kind: "trigger.webhook", name: "Webhook", description: "Receive an HTTP request", icon: Webhook, config: {} },
  { kind: "trigger.schedule", name: "Schedule", description: "Run on a recurring clock", icon: Clock3, config: { schedule: "every-5-minutes" } },
  { kind: "data.set", name: "Transform", description: "Shape and map fields", icon: Braces, config: { fields: { value: "{{previous}}" } } },
  { kind: "logic.condition", name: "Condition", description: "Split into yes or no", icon: GitBranch, config: { field: "previous.value", operator: "eq", value: "true" } },
  { kind: "action.http", name: "HTTP request", description: "Call any public API", icon: Send, config: { method: "POST", url: "https://api.example.com/events", headers: { Authorization: "Bearer {{env.EXAMPLE_API_KEY}}" }, body: "{{previous}}" } },
  { kind: "integration.meta-lead", name: "Meta lead", description: "Fetch and normalize Lead Ads data", icon: UserRoundSearch, config: { courseField: "course" } },
  { kind: "crm.lead", name: "Save lead", description: "Create or update a lead record", icon: Database, config: {} },
  { kind: "integration.sheets", name: "Google Sheets", description: "Append a lead row", icon: FileSpreadsheet, config: { tab: "Leads" } },
  { kind: "integration.telegram", name: "Telegram alert", description: "Notify admissions instantly", icon: MessagesSquare, config: {} },
  { kind: "integration.followup", name: "WhatsApp / SMS", description: "Send a template with SMS fallback", icon: MessageCircle, config: { template: "lead_welcome", language: "en_US", sms: "Hi {{previous.name}}, thanks for your interest in {{previous.course}}. Our admissions team will call you shortly." } },
  { kind: "output.response", name: "Response", description: "Return the final payload", icon: Radio, config: { body: "{{previous}}" } },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error ?? `Request failed (${response.status})`);
    Object.assign(error, { status: response.status, data });
    throw error;
  }
  return data as T;
}

function blankWorkflow(): WorkflowInput {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    name: "Untitled workflow",
    slug: `workflow-${suffix}`,
    description: "",
    status: "draft",
    schedule: null,
    nodes: [
      {
        id: crypto.randomUUID(),
        type: "workflow",
        position: { x: 100, y: 180 },
        data: { label: "Run manually", kind: "trigger.manual", config: {} },
      },
    ],
    edges: [],
  };
}

function timeAgo(date: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function JsonEditor({
  value,
  onChange,
  rows = 6,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  rows?: number;
}) {
  const [draft, setDraft] = useState(pretty(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => setDraft(pretty(value)), [value]);

  function commit() {
    try {
      onChange(JSON.parse(draft));
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  }

  return (
    <div className={invalid ? "json-field is-invalid" : "json-field"}>
      <textarea value={draft} rows={rows} onChange={(event) => setDraft(event.target.value)} onBlur={commit} spellCheck={false} />
      {invalid && <span>Enter valid JSON before leaving this field.</span>}
    </div>
  );
}

export function WorkflowStudio() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [current, setCurrent] = useState<Workflow | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowEdge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [view, setView] = useState<"canvas" | "runs" | "leads">("canvas");
  const [addOpen, setAddOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [runInput, setRunInput] = useState('{\n  "name": "Maya",\n  "email": "maya@example.com",\n  "score": 82\n}');
  const [busy, setBusy] = useState<"save" | "run" | "create" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [lastExecution, setLastExecution] = useState<Execution | null>(null);
  const [origin, setOrigin] = useState("");
  const seeded = useRef(false);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  useEffect(() => {
    try {
      localStorage.removeItem("relay-admin-token");
    } catch {
      // Authentication no longer uses browser storage.
    }
    setOrigin(window.location.origin);
    void api<{ authenticated: boolean; configured: boolean }>("/api/auth/session")
      .then((session) => {
        setAuthenticated(session.authenticated);
        setAuthConfigured(session.configured);
      })
      .catch(() => {
        setAuthenticated(false);
        setAuthConfigured(false);
      })
      .finally(() => setLoading(false));
  }, []);

  const applyWorkflow = useCallback(
    (workflow: Workflow) => {
      setCurrent(workflow);
      setNodes(workflow.nodes);
      setEdges(workflow.edges);
      setSelectedNodeId(null);
      setView("canvas");
    },
    [setEdges, setNodes],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [workflowData, executionData, leadData] = await Promise.all([
        api<{ workflows: Workflow[] }>("/api/workflows"),
        api<{ executions: Execution[] }>("/api/executions"),
        api<{ leads: Lead[] }>("/api/leads"),
      ]);
      setWorkflows(workflowData.workflows);
      setExecutions(executionData.executions);
      setLeads(leadData.leads);

      if (workflowData.workflows.length) {
        const next = workflowData.workflows.find((item) => item.id === current?.id) ?? workflowData.workflows[0];
        applyWorkflow(next);
      } else if (!seeded.current) {
        seeded.current = true;
        const created = await api<{ workflow: Workflow }>("/api/workflows", {
          method: "POST",
          body: JSON.stringify(leadCaptureWorkflow()),
        });
        setWorkflows([created.workflow]);
        applyWorkflow(created.workflow);
      }
    } catch (error) {
      if ((error as Error & { status?: number }).status === 401) setAuthenticated(false);
      else setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not load Relay." });
    } finally {
      setLoading(false);
    }
  }, [applyWorkflow, current?.id]);

  useEffect(() => {
    if (authenticated) void refresh();
    // Refresh is intentionally keyed only to authentication state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timeout);
  }, [notice]);

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((items) =>
        addEdge(
          {
            ...connection,
            id: crypto.randomUUID(),
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          },
          items,
        ),
      ),
    [setEdges],
  );

  function patchCurrent(patch: Partial<Workflow>) {
    setCurrent((item) => (item ? { ...item, ...patch } : item));
  }

  async function persist(patch: Partial<Workflow> = {}) {
    if (!current || !authenticated) return null;
    setBusy("save");
    try {
      const payload: WorkflowInput = {
        name: patch.name ?? current.name,
        slug: patch.slug ?? current.slug,
        description: patch.description ?? current.description,
        status: (patch.status ?? current.status) as WorkflowStatus,
        nodes,
        edges,
        schedule: patch.schedule === undefined ? current.schedule : patch.schedule,
      };
      const result = await api<{ workflow: Workflow }>(`/api/workflows/${current.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setCurrent(result.workflow);
      setWorkflows((items) => items.map((item) => (item.id === result.workflow.id ? result.workflow : item)));
      setNotice({ tone: "success", text: "Workflow saved" });
      return result.workflow;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Save failed" });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function createWorkflow() {
    if (!authenticated) return;
    setBusy("create");
    try {
      const result = await api<{ workflow: Workflow }>("/api/workflows", {
        method: "POST",
        body: JSON.stringify(blankWorkflow()),
      });
      setWorkflows((items) => [result.workflow, ...items]);
      applyWorkflow(result.workflow);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not create workflow" });
    } finally {
      setBusy(null);
    }
  }

  async function deleteWorkflow() {
    if (!current || !authenticated || !confirm(`Delete “${current.name}” and its execution history?`)) return;
    try {
      await api(`/api/workflows/${current.id}`, { method: "DELETE" });
      const remaining = workflows.filter((item) => item.id !== current.id);
      setWorkflows(remaining);
      if (remaining[0]) applyWorkflow(remaining[0]);
      else setCurrent(null);
      setNotice({ tone: "success", text: "Workflow deleted" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Delete failed" });
    }
  }

  function addNode(kind: NodeKind) {
    const definition = nodeCatalog.find((item) => item.kind === kind)!;
    const node: WorkflowNode = {
      id: crypto.randomUUID(),
      type: "workflow",
      position: { x: 180 + (nodes.length % 3) * 290, y: 100 + Math.floor(nodes.length / 3) * 180 },
      data: { label: definition.name, kind, config: structuredClone(definition.config) },
    };
    setNodes((items) => [...items, node]);
    setSelectedNodeId(node.id);
    if (kind === "trigger.schedule" && !current?.schedule) patchCurrent({ schedule: "every-5-minutes" });
    setAddOpen(false);
  }

  function patchSelected(dataPatch: Partial<WorkflowNode["data"]>) {
    if (!selectedNodeId) return;
    setNodes((items) =>
      items.map((node) =>
        node.id === selectedNodeId ? { ...node, data: { ...node.data, ...dataPatch } } : node,
      ),
    );
  }

  function patchConfig(key: string, value: unknown) {
    if (!selectedNode) return;
    patchSelected({ config: { ...selectedNode.data.config, [key]: value } });
  }

  function removeSelectedNode() {
    if (!selectedNodeId) return;
    setNodes((items) => items.filter((node) => node.id !== selectedNodeId));
    setEdges((items) => items.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId));
    setSelectedNodeId(null);
  }

  async function runWorkflow() {
    if (!current || !authenticated) return;
    let input: unknown;
    try {
      input = JSON.parse(runInput);
    } catch {
      setNotice({ tone: "error", text: "Run input must be valid JSON" });
      return;
    }

    setBusy("run");
    try {
      const saved = await persist();
      if (!saved) return;
      let result: { execution?: Execution; error?: string };
      try {
        result = await api<{ execution: Execution }>(`/api/workflows/${saved.id}/execute`, {
          method: "POST",
          body: JSON.stringify({ input }),
        });
      } catch (error) {
        const typed = error as Error & { data?: { execution?: Execution } };
        if (!typed.data?.execution) throw error;
        result = { execution: typed.data.execution };
      }
      if (!result.execution) throw new Error(result.error ?? "Run failed");
      setLastExecution(result.execution);
      setExecutions((items) => [result.execution!, ...items]);
      setRunOpen(false);
      setNotice({ tone: result.execution.status === "success" ? "success" : "error", text: result.execution.status === "success" ? `Run completed · ${result.execution.steps.length} steps` : result.execution.error ?? "Run failed" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Run failed" });
    } finally {
      setBusy(null);
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: loginPassword }),
      });
      setLoginPassword("");
      setAuthenticated(true);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function signOut() {
    try {
      await api("/api/auth/logout", { method: "POST" });
      setAuthenticated(false);
      setWorkflows([]);
      setExecutions([]);
      setLeads([]);
      setCurrent(null);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not sign out." });
    }
  }

  async function copyWebhook() {
    if (!current) return;
    await navigator.clipboard.writeText(`${origin}/api/webhooks/${current.slug}`);
    setNotice({ tone: "success", text: "Webhook URL copied" });
  }

  async function setLeadStatus(id: string, status: LeadStatus) {
    if (!authenticated) return;
    try {
      const result = await api<{ lead: Lead }>(`/api/leads/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setLeads((items) => items.map((lead) => (lead.id === id ? result.lead : lead)));
      setNotice({ tone: "success", text: `Lead marked ${status}` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not update lead" });
    }
  }

  if (authenticated === null || loading) {
    return (
      <main className="splash-screen">
        <div className="splash-mark"><Zap size={24} fill="currentColor" /></div>
        <div className="splash-loader"><span /><span /><span /></div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="access-screen">
        <section className="access-card">
          <div className="brand-lockup brand-lockup--center"><span><Zap size={18} fill="currentColor" /></span><strong>relay</strong></div>
          <div className="access-icon"><LockKeyhole size={26} /></div>
          <h1>Your automation workspace is protected</h1>
          <p>Sign in with the admin passphrase configured for this Relay instance.</p>
          <form onSubmit={signIn}>
            <label className="field-label" htmlFor="admin-password">Admin passphrase</label>
            <input id="admin-password" className="text-input" type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" autoFocus required disabled={loginBusy || !authConfigured} />
            <button className="primary-button primary-button--wide" type="submit" disabled={loginBusy || !authConfigured}>
              {loginBusy ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}
              {loginBusy ? "Signing in" : "Sign in"}
            </button>
          </form>
          {loginError && <p className="auth-error" role="alert">{loginError}</p>}
          {!authConfigured && <p className="auth-setup-hint">Set up a password in your terminal with <code>npm run auth:setup</code>, then restart Relay.</p>}
          <small>Your passphrase is checked server-side and never stored in browser storage.</small>
        </section>
      </main>
    );
  }

  return (
    <main className={`studio-shell ${view !== "canvas" ? "studio-shell--wide" : ""}`}>
      <aside className="sidebar">
        <div className="brand-lockup"><span><Zap size={17} fill="currentColor" /></span><strong>relay</strong><em>beta</em></div>
        <nav className="main-nav">
          <button className={view === "canvas" ? "is-active" : ""} onClick={() => setView("canvas")}><Blocks size={16} /> Workflows <kbd>{workflows.length}</kbd></button>
          <button className={view === "runs" ? "is-active" : ""} onClick={() => setView("runs")}><ListChecks size={16} /> Executions <kbd>{executions.length}</kbd></button>
          <button className={view === "leads" ? "is-active" : ""} onClick={() => setView("leads")}><UsersRound size={16} /> Leads <kbd>{leads.filter((lead) => lead.status === "New").length}</kbd></button>
        </nav>

        <div className="sidebar-heading"><span>MY WORKFLOWS</span><button onClick={createWorkflow} aria-label="New workflow"><Plus size={15} /></button></div>
        <div className="workflow-list">
          {workflows.map((workflow) => (
            <button key={workflow.id} className={current?.id === workflow.id && view === "canvas" ? "workflow-list__item is-active" : "workflow-list__item"} onClick={() => applyWorkflow(workflow)}>
              <span className={`workflow-dot workflow-dot--${workflow.status}`} />
              <span><strong>{workflow.name}</strong><small>{workflow.nodes.length} nodes · {timeAgo(workflow.updatedAt)}</small></span>
              <Ellipsis size={15} />
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="system-status"><span><i /></span><div><strong>System online</strong><small>Vercel serverless</small></div></div>
          <button className="icon-button" onClick={() => void signOut()} title="Sign out"><LogOut size={16} /></button>
        </div>
      </aside>

      <section className="workspace">
        {view === "leads" ? (
          <LeadView leads={leads} onRefresh={() => void refresh()} onStatusChange={setLeadStatus} />
        ) : view === "runs" ? (
          <ExecutionView executions={executions} onRefresh={() => void refresh()} />
        ) : current ? (
          <>
            <header className="workspace-header">
              <div className="workflow-title">
                <button className="mobile-menu"><PanelLeftClose size={17} /></button>
                <span className="workflow-status-icon"><Activity size={16} /></span>
                <div><input value={current.name} onChange={(event) => patchCurrent({ name: event.target.value })} /><small>Edited {timeAgo(current.updatedAt)}</small></div>
              </div>
              <div className="header-actions">
                <span className={`status-pill status-pill--${current.status}`}><i />{current.status}</span>
                <button className="secondary-button" onClick={() => void persist()} disabled={busy !== null}>{busy === "save" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} Save</button>
                <button className="primary-button" onClick={() => setRunOpen(true)} disabled={busy !== null}><Play size={14} fill="currentColor" /> Run workflow</button>
                <button className="icon-button"><Ellipsis size={18} /></button>
              </div>
            </header>

            <div className="canvas-wrap">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                fitView
                minZoom={0.35}
                maxZoom={1.6}
                defaultEdgeOptions={{ animated: true, markerEnd: { type: MarkerType.ArrowClosed } }}
              >
                <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="#283247" />
                <Controls showInteractive={false} position="bottom-left" />
                <MiniMap pannable zoomable position="bottom-right" nodeColor="#5b6c87" maskColor="rgba(7, 11, 18, .78)" />
              </ReactFlow>

              <div className="canvas-toolbar">
                <div className="add-node-wrap">
                  <button className="add-node-button" onClick={() => setAddOpen((open) => !open)}><Plus size={15} /> Add step <ChevronDown size={14} /></button>
                  {addOpen && (
                    <div className="node-menu">
                      <div><strong>Add a step</strong><small>Choose what happens next</small></div>
                      {nodeCatalog.map((item) => (
                        <button key={item.kind} onClick={() => addNode(item.kind)}><span><item.icon size={16} /></span><div><strong>{item.name}</strong><small>{item.description}</small></div><Plus size={14} /></button>
                      ))}
                    </div>
                  )}
                </div>
                <span className="canvas-hint"><Sparkles size={14} /> Drag from a node handle to connect steps</span>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state"><Blocks size={30} /><h2>No workflow selected</h2><button className="primary-button" onClick={createWorkflow}><Plus size={15} /> Create workflow</button></div>
        )}
      </section>

      {view === "canvas" && current && (
        <aside className="inspector">
          <div className="inspector-header"><div><strong>{selectedNode ? "Step settings" : "Workflow settings"}</strong><small>{selectedNode ? selectedNode.data.kind : current.slug}</small></div>{selectedNode && <button className="icon-button" onClick={() => setSelectedNodeId(null)}><X size={17} /></button>}</div>
          <div className="inspector-body">
            {selectedNode ? (
              <NodeInspector node={selectedNode} workflow={current} origin={origin} patchLabel={(label) => patchSelected({ label })} patchConfig={patchConfig} setSchedule={(schedule) => patchCurrent({ schedule })} onCopyWebhook={copyWebhook} onRemove={removeSelectedNode} />
            ) : (
              <>
                <label className="field-label">Workflow name</label>
                <input className="text-input" value={current.name} onChange={(event) => patchCurrent({ name: event.target.value })} />
                <label className="field-label">Webhook slug</label>
                <input className="text-input mono" value={current.slug} onChange={(event) => patchCurrent({ slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
                <label className="field-label">Description</label>
                <textarea className="text-area" rows={4} value={current.description} onChange={(event) => patchCurrent({ description: event.target.value })} placeholder="What does this automation do?" />
                <label className="field-label">Status</label>
                <div className="segmented-control">
                  {(["draft", "active", "paused"] as WorkflowStatus[]).map((status) => <button key={status} className={current.status === status ? "is-active" : ""} onClick={() => patchCurrent({ status })}>{status}</button>)}
                </div>
                <div className="info-card"><Cloud size={17} /><div><strong>Vercel ready</strong><p>Runs execute inside serverless functions. Configure MongoDB Atlas before production.</p></div></div>
                <button className="danger-button" onClick={deleteWorkflow}><Trash2 size={15} /> Delete workflow</button>
              </>
            )}
          </div>
        </aside>
      )}

      {runOpen && current && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setRunOpen(false)}>
          <section className="run-modal">
            <header><div className="run-icon"><Play size={17} fill="currentColor" /></div><div><h2>Run “{current.name}”</h2><p>Test the workflow with a JSON payload.</p></div><button className="icon-button" onClick={() => setRunOpen(false)}><X size={18} /></button></header>
            <label className="field-label">Trigger input</label>
            <textarea className="code-editor" value={runInput} onChange={(event) => setRunInput(event.target.value)} rows={12} spellCheck={false} />
            <footer><span><CircleAlert size={14} /> External HTTP actions will run for real.</span><div><button className="secondary-button" onClick={() => setRunOpen(false)}>Cancel</button><button className="primary-button" onClick={runWorkflow} disabled={busy !== null}>{busy === "run" ? <LoaderCircle className="spin" size={15} /> : <Play size={14} fill="currentColor" />} Run now</button></div></footer>
          </section>
        </div>
      )}

      {lastExecution && (
        <aside className="result-drawer">
          <header><div><span className={`run-state run-state--${lastExecution.status}`}>{lastExecution.status === "success" ? <Check size={14} /> : <X size={14} />}</span><div><strong>{lastExecution.status === "success" ? "Workflow completed" : "Workflow failed"}</strong><small>{lastExecution.steps.length} steps · {lastExecution.id.slice(0, 8)}</small></div></div><button className="icon-button" onClick={() => setLastExecution(null)}><X size={17} /></button></header>
          <pre>{pretty(lastExecution.error ? { error: lastExecution.error, steps: lastExecution.steps } : lastExecution.output)}</pre>
        </aside>
      )}

      {notice && <div className={`toast toast--${notice.tone}`}>{notice.tone === "success" ? <Check size={15} /> : <CircleAlert size={15} />}{notice.text}</div>}
    </main>
  );
}

function NodeInspector({
  node,
  workflow,
  origin,
  patchLabel,
  patchConfig,
  setSchedule,
  onCopyWebhook,
  onRemove,
}: {
  node: WorkflowNode;
  workflow: Workflow;
  origin: string;
  patchLabel: (label: string) => void;
  patchConfig: (key: string, value: unknown) => void;
  setSchedule: (schedule: Workflow["schedule"]) => void;
  onCopyWebhook: () => void;
  onRemove: () => void;
}) {
  const config = node.data.config;
  return (
    <>
      <label className="field-label">Step name</label>
      <input className="text-input" value={node.data.label} onChange={(event) => patchLabel(event.target.value)} />

      {node.data.kind === "trigger.webhook" && (
        <>
          <label className="field-label">Production URL</label>
          <div className="copy-field"><input value={`${origin}/api/webhooks/${workflow.slug}`} readOnly /><button onClick={onCopyWebhook}><Copy size={14} /></button></div>
          <div className="info-card"><Webhook size={17} /><div><strong>POST, GET, PUT or PATCH</strong><p>Send <code>x-relay-secret</code> when a webhook secret is configured.</p></div></div>
        </>
      )}

      {node.data.kind === "trigger.schedule" && (
        <>
          <label className="field-label">Frequency</label>
          <select className="select-input" value={workflow.schedule ?? "every-5-minutes"} onChange={(event) => setSchedule(event.target.value as Workflow["schedule"])}>
            <option value="every-5-minutes">Every 5 minutes</option>
            <option value="hourly">Every hour</option>
            <option value="daily">Every day at 00:00 UTC</option>
          </select>
          <p className="field-help">The Vercel cron endpoint checks active workflows every five minutes.</p>
        </>
      )}

      {node.data.kind === "data.set" && (
        <>
          <label className="field-label">Fields</label>
          <JsonEditor value={config.fields ?? { value: "{{previous}}" }} onChange={(value) => patchConfig("fields", value)} rows={9} />
          <p className="field-help">Use expressions such as <code>{"{{input.email}}"}</code> or <code>{"{{previous.id}}"}</code>.</p>
        </>
      )}

      {node.data.kind === "logic.condition" && (
        <>
          <label className="field-label">Value path</label>
          <input className="text-input mono" value={String(config.field ?? "previous.value")} onChange={(event) => patchConfig("field", event.target.value)} />
          <label className="field-label">Operator</label>
          <select className="select-input" value={String(config.operator ?? "eq")} onChange={(event) => patchConfig("operator", event.target.value)}>
            <option value="eq">Equals</option><option value="neq">Does not equal</option><option value="contains">Contains</option><option value="exists">Exists</option><option value="gt">Greater than</option><option value="gte">Greater than or equal</option><option value="lt">Less than</option><option value="lte">Less than or equal</option>
          </select>
          <label className="field-label">Compare with</label>
          <input className="text-input" value={String(config.value ?? "")} onChange={(event) => patchConfig("value", event.target.value)} />
        </>
      )}

      {node.data.kind === "action.http" && (
        <>
          <div className="field-row"><div><label className="field-label">Method</label><select className="select-input" value={String(config.method ?? "GET")} onChange={(event) => patchConfig("method", event.target.value)}><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></div><div className="grow"><label className="field-label">URL</label><input className="text-input mono" value={String(config.url ?? "")} onChange={(event) => patchConfig("url", event.target.value)} placeholder="https://api.example.com" /></div></div>
          <label className="field-label">Headers</label>
          <JsonEditor value={config.headers ?? {}} onChange={(value) => patchConfig("headers", value)} rows={5} />
          <label className="field-label">JSON body</label>
          <JsonEditor value={config.body ?? "{{previous}}"} onChange={(value) => patchConfig("body", value)} rows={7} />
          <p className="field-help">Reference Vercel secrets with <code>{"{{env.SECRET_NAME}}"}</code>.</p>
        </>
      )}

      {node.data.kind === "integration.meta-lead" && (
        <>
          <label className="field-label">Course field name</label>
          <input className="text-input mono" value={String(config.courseField ?? "course")} onChange={(event) => patchConfig("courseField", event.target.value)} />
          <div className="info-card"><UserRoundSearch size={17} /><div><strong>Meta Lead Ads</strong><p>Uses <code>META_PAGE_ACCESS_TOKEN</code>, <code>META_APP_SECRET</code>, and <code>META_GRAPH_API_VERSION</code> on the server.</p></div></div>
        </>
      )}

      {node.data.kind === "crm.lead" && (
        <div className="info-card"><Database size={17} /><div><strong>Durable lead record</strong><p>Saves the lead as New. Changing its status in Leads prevents future automated reminders.</p></div></div>
      )}

      {node.data.kind === "integration.sheets" && (
        <>
          <label className="field-label">Sheet tab</label>
          <input className="text-input" value={String(config.tab ?? "Leads")} onChange={(event) => patchConfig("tab", event.target.value)} />
          <div className="info-card"><FileSpreadsheet size={17} /><div><strong>Google Sheets append</strong><p>Uses the service account and sheet ID from Vercel environment variables.</p></div></div>
        </>
      )}

      {node.data.kind === "integration.telegram" && (
        <>
          <label className="field-label">Custom alert (optional)</label>
          <textarea className="text-area mono" rows={6} value={String(config.message ?? "")} onChange={(event) => patchConfig("message", event.target.value)} placeholder="Leave blank for the admissions lead alert." />
          <p className="field-help">Uses <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code>.</p>
        </>
      )}

      {node.data.kind === "integration.followup" && (
        <>
          <label className="field-label">WhatsApp template</label>
          <input className="text-input mono" value={String(config.template ?? "lead_welcome")} onChange={(event) => patchConfig("template", event.target.value)} />
          <label className="field-label">Template language</label>
          <input className="text-input mono" value={String(config.language ?? "en_US")} onChange={(event) => patchConfig("language", event.target.value)} />
          <label className="field-label">SMS fallback</label>
          <textarea className="text-area" rows={5} value={String(config.sms ?? "")} onChange={(event) => patchConfig("sms", event.target.value)} />
          <p className="field-help">Relay uses WhatsApp Cloud first, then Twilio SMS when WhatsApp is not configured.</p>
        </>
      )}

      {node.data.kind === "output.response" && (
        <>
          <label className="field-label">Response body</label>
          <JsonEditor value={config.body ?? "{{previous}}"} onChange={(value) => patchConfig("body", value)} rows={9} />
        </>
      )}

      {node.data.kind === "trigger.manual" && <div className="info-card"><MousePointerClick size={17} /><div><strong>Editor-only trigger</strong><p>Use Run workflow to start this path with test input.</p></div></div>}
      <button className="danger-button" onClick={onRemove}><Trash2 size={15} /> Remove step</button>
    </>
  );
}

function ExecutionView({ executions, onRefresh }: { executions: Execution[]; onRefresh: () => void }) {
  const [selected, setSelected] = useState<Execution | null>(executions[0] ?? null);
  useEffect(() => { if (!selected && executions[0]) setSelected(executions[0]); }, [executions, selected]);

  return (
    <div className="executions-page">
      <header className="page-header"><div><span className="eyebrow">OPERATIONS</span><h1>Execution history</h1><p>Inspect every trigger, step, output, and failure.</p></div><button className="secondary-button" onClick={onRefresh}><RefreshCw size={15} /> Refresh</button></header>
      <div className="execution-grid">
        <section className="execution-table-card">
          <div className="table-title"><strong>Recent runs</strong><span>{executions.length} shown</span></div>
          <div className="execution-table">
            {executions.length === 0 ? <div className="empty-runs"><ListChecks size={25} /><strong>No executions yet</strong><span>Run a workflow to see it here.</span></div> : executions.map((execution) => (
              <button key={execution.id} className={selected?.id === execution.id ? "execution-row is-active" : "execution-row"} onClick={() => setSelected(execution)}>
                <span className={`run-state run-state--${execution.status}`}>{execution.status === "success" ? <Check size={13} /> : execution.status === "failed" ? <X size={13} /> : <LoaderCircle className="spin" size={13} />}</span>
                <span><strong>{execution.workflowName ?? "Workflow"}</strong><small>{execution.triggerType} · {timeAgo(execution.startedAt)}</small></span>
                <span className="steps-count">{execution.steps.length} steps</span>
              </button>
            ))}
          </div>
        </section>
        <section className="execution-detail">
          {selected ? (
            <><header><div><span className={`run-state run-state--${selected.status}`}>{selected.status === "success" ? <Check size={14} /> : <X size={14} />}</span><div><strong>{selected.status}</strong><small>{selected.id}</small></div></div><span>{new Date(selected.startedAt).toLocaleString()}</span></header><div className="detail-section"><label>Steps</label>{selected.steps.map((step, index) => <div className="step-row" key={`${step.nodeId}-${index}`}><span>{index + 1}</span><div><strong>{step.label}</strong><small>{step.kind}</small></div><em className={step.status}>{step.status}</em></div>)}</div><div className="detail-section"><label>{selected.error ? "Error" : "Output"}</label><pre>{pretty(selected.error ? { error: selected.error } : selected.output)}</pre></div></>
          ) : <div className="empty-runs"><Activity size={26} /><strong>Select an execution</strong></div>}
        </section>
      </div>
    </div>
  );
}

function LeadView({
  leads,
  onRefresh,
  onStatusChange,
}: {
  leads: Lead[];
  onRefresh: () => void;
  onStatusChange: (id: string, status: LeadStatus) => void;
}) {
  const newCount = leads.filter((lead) => lead.status === "New").length;
  const qualifiedCount = leads.filter((lead) => lead.status === "Qualified").length;
  const enrolledCount = leads.filter((lead) => lead.status === "Enrolled").length;

  return (
    <div className="executions-page leads-page">
      <header className="page-header">
        <div><span className="eyebrow">ADMISSIONS</span><h1>Lead inbox</h1><p>Call new inquiries quickly and update their status to stop reminders.</p></div>
        <button className="secondary-button" onClick={onRefresh}><RefreshCw size={15} /> Refresh</button>
      </header>
      <div className="lead-stats">
        <div><span className="stat-icon stat-icon--new"><Zap size={16} /></span><section><small>NEW / UNCALLED</small><strong>{newCount}</strong></section></div>
        <div><span className="stat-icon stat-icon--qualified"><UserRoundSearch size={16} /></span><section><small>QUALIFIED</small><strong>{qualifiedCount}</strong></section></div>
        <div><span className="stat-icon stat-icon--enrolled"><Check size={16} /></span><section><small>ENROLLED</small><strong>{enrolledCount}</strong></section></div>
        <div><span className="stat-icon"><UsersRound size={16} /></span><section><small>TOTAL LEADS</small><strong>{leads.length}</strong></section></div>
      </div>
      <section className="lead-table-card">
        <div className="lead-table-head"><strong>Recent inquiries</strong><span>Day 1 and Day 3 reminders run only while status is New</span></div>
        {leads.length === 0 ? (
          <div className="empty-runs"><UsersRound size={28} /><strong>No leads captured yet</strong><span>Activate the admissions workflow and send a test webhook.</span></div>
        ) : (
          <div className="lead-table-scroll">
            <table className="lead-table">
              <thead><tr><th>Student</th><th>Phone</th><th>Course</th><th>Source</th><th>Received</th><th>Reminder</th><th>Status</th></tr></thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td><span className="lead-avatar">{lead.name.slice(0, 1).toUpperCase()}</span><div><strong>{lead.name}</strong><small>{lead.externalId}</small></div></td>
                    <td><a href={`tel:${lead.phone}`}>{lead.phone}</a></td>
                    <td>{lead.course}</td>
                    <td><span className="source-chip">{lead.source}</span></td>
                    <td>{timeAgo(lead.createdAt)}</td>
                    <td><span className="reminder-chip">{lead.reminderStage === 0 ? "Pending +1d" : lead.reminderStage === 1 ? "+1d sent" : "Complete"}</span></td>
                    <td>
                      <select className={`lead-status lead-status--${lead.status.toLowerCase()}`} value={lead.status} onChange={(event) => onStatusChange(lead.id, event.target.value as LeadStatus)}>
                        <option>New</option><option>Called</option><option>Qualified</option><option>Enrolled</option><option>Closed</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
