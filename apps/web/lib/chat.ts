/** Main Chat client.
 *
 *  One conversational surface over the whole AI company. The user types; the
 *  Router decides who answers. This module streams the turn's events so the UI
 *  can show routing, joins, handoffs and streamed text as they happen.
 */
import { API_BASE, getToken } from "./api";
import { queryClient } from "./queryClient";

export interface ChatEmployee {
  id: string;
  name: string;
  role: string;
  department: string;
  icon: string;
  codename: string;
}

export interface RoutingCandidate {
  id: string;
  name: string;
  role: string;
  department: string;
  icon: string;
  confidence: number;
  actionId: string | null;
}

export interface RoutingInfo {
  /** Which model actually answered. Carried on the message so the cost of a
   *  reply is visible beside the reply -- the agentic runtime picks its own
   *  model, so this is reported from its telemetry rather than assumed. */
  model?: string;
  provider?: string;
  /** What this reply cost, priced with the meter's own rates. Absent when the
   *  rate is unknown -- the UI omits the figure rather than printing a
   *  confident zero. */
  credits?: number;
  costMicros?: number;
  tokens?: number;
  mode: "single" | "team" | "clarify";
  intent: {
    capabilities: string[];
    complexity: string;
    tools: string[];
    summary: string;
    topicChanged: boolean;
    source: "llm" | "keywords";
  };
  primary: RoutingCandidate | null;
  candidates: RoutingCandidate[];
  team: TeamStep[];
  handoffFrom: string | null;
  reason: string;
  confidence: number;
}

export interface TeamStep {
  capability: string;
  employeeId: string;
  employeeName: string;
  actionId: string;
  icon: string;
  department: string;
}

export interface ChatMessage {
  id: string;
  seq: number;
  role: "user" | "employee" | "system" | "approval" | "assistant";   // "assistant" = Fennex speaking for itself
  employeeId: string | null;
  event: string | null;
  content: string;
  routing: RoutingInfo | null;
  confidence: number | null;
  artifactType: string | null;
  artifactIds: string[] | null;
  structured: Record<string, unknown> | null;
  error: string | null;
  createdAt: string | null;
}

export interface ChatModel {
  id: string;
  label: string;
  provider: string;
  grade: "fast" | "deep";
  hint: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  status: string;
  ownerEmployeeId: string | null;
  participants: string[];
  projectId: string;
  createdAt: string | null;
  modelProvider?: string | null;
  modelId?: string | null;
}

/** Every event the turn can emit, in the order the UI reacts to them. */
export type ChatEvent =
  | { type: "conversation"; id: string }
  | { type: "routing" }
  | { type: "joined"; employee: ChatEmployee; from: string | null; message: ChatMessage; routing: RoutingInfo }
  | { type: "handoff"; employee: ChatEmployee; from: string | null; message: ChatMessage; routing?: RoutingInfo }
  | { type: "plan"; team: TeamStep[]; message: ChatMessage }
  | { type: "stage"; step: number; of: number; employeeId: string; capability: string }
  | { type: "delta"; employeeId: string; text: string }
  | { type: "message"; message: ChatMessage }
  | { type: "approval"; approvalId: string; kind?: "approval" | "proposal"; preview: Record<string, unknown>; message: ChatMessage }
  | { type: "actions"; employeeId: string; actions: OfferedAction[]; message: ChatMessage }
  | { type: "workflow"; steps: WorkflowStep[]; message: ChatMessage }
  | { type: "followOn"; actions: FollowOnAction[]; message: ChatMessage }
  | { type: "working"; employeeId: string; action: string }
  | { type: "tool"; employeeId: string; tool: string }
  | { type: "telemetry"; metrics: Record<string, unknown> }
  | { type: "result"; stepIndex?: number; message: ChatMessage; artifactType: string | null; artifactIds: string[] | null }
  | { type: "clarify"; message: ChatMessage; routing: RoutingInfo }
  | { type: "error"; message: string; employeeId?: string; stepIndex?: number }
  | { type: "done" };

/** Send a message and consume the turn. Returns an abort handle so the user can
 *  interrupt a long run. */
export function listModels(): Promise<{ models: ChatModel[] }> {
  return request("/chat/models");
}

export function sendMessage(
  body: {
    message: string;
    project_id: string;
    conversation_id?: string | null;
    model_provider?: string | null;
    model_id?: string | null;
  },
  onEvent: (event: ChatEvent) => void,
): { done: Promise<void>; cancel: () => void } {
  return streamTurn("/chat/stream", body, onEvent);
}

/** One thing an employee is offering to do, rendered as a button. */
export interface OfferedAction {
  actionId: string;
  label: string;
  description: string;
  outputs: string[];
  permissions: string[];
  weight: "light" | "heavy";
  destructive: boolean;
}

/** A next step the company suggests once the current work is delivered.
 *  Unlike OfferedAction these can span several employees, so each carries its
 *  own identity. */
export interface FollowOnAction {
  actionId: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  icon: string;
  department: string;
  label: string;
  description: string;
  outputs: string[];
  weight: "light" | "heavy";
  permissions: string[];
  destructive: boolean;
}

/** One specialist's turn inside an approved multi-employee workflow. */
export interface WorkflowStep {
  index: number;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  actionId: string;
  label: string;
  description: string;
  outputs: string[];
  weight: "light" | "heavy";
  permissions: string[];
  capability: string;
  /** Plain-language rationale for putting this specialist on this step. */
  why: string;
  dependsOnPrevious: boolean;
  icon: string;
  department: string;
}

/** Run the whole approved workflow: every specialist, in order, for real. */
export function runWorkflow(
  body: { conversation_id: string; steps: WorkflowStep[] },
  onEvent: (event: ChatEvent) => void,
): { done: Promise<void>; cancel: () => void } {
  return streamTurn("/chat/workflow/run", body, onEvent);
}

/** Run a single approved step, inheriting whatever earlier steps produced. */
export function runWorkflowStep(
  body: { conversation_id: string; steps: WorkflowStep[]; index: number },
  onEvent: (event: ChatEvent) => void,
): { done: Promise<void>; cancel: () => void } {
  return streamTurn("/chat/workflow/step", body, onEvent);
}

/** Run the action the user picked. Nothing runs until they press a button. */
export function runAction(
  body: { conversation_id: string; employee_id: string; action_id: string },
  onEvent: (event: ChatEvent) => void,
): { done: Promise<void>; cancel: () => void } {
  return streamTurn("/chat/actions/run", body, onEvent);
}

/** Validate a proposed action and run it for real. Same event stream, so the
 *  UI shows the employee working and the artifact it produced. */
export function approveAndRun(
  approvalId: string,
  onEvent: (event: ChatEvent) => void,
): { done: Promise<void>; cancel: () => void } {
  return streamTurn(`/chat/approvals/${approvalId}/run`, undefined, onEvent);
}

function streamTurn(
  path: string,
  body: unknown,
  onEvent: (event: ChatEvent) => void,
): { done: Promise<void>; cancel: () => void } {
  const controller = new AbortController();

  const done = (async () => {
    const token = getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/api/v1${path}`, {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      let detail = res.statusText;
      try {
        const data = await res.json();
        if (typeof data.detail === "string") detail = data.detail;
      } catch {
        // non-JSON error body
      }
      onEvent({ type: "error", message: detail });
      onEvent({ type: "done" });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith("data:")) continue;
        try {
          onEvent(JSON.parse(line.slice(5)) as ChatEvent);
        } catch {
          // a partial frame is not fatal -- keep reading
        }
      }
    }
    // Every streamTurn endpoint is credit-gated (/chat/stream,
    // /chat/workflow/run|step, /chat/actions/run, /chat/approvals/*/run) and
    // a multi-employee workflow can spend credits on earlier steps even if a
    // later one errors mid-stream, so refresh once the stream closes rather
    // than only on a clean finish.
    queryClient.invalidateQueries({ queryKey: ["usage-summary"] });
  })().catch((err) => {
    // An abort is a user action, not a failure.
    if ((err as Error)?.name !== "AbortError") {
      onEvent({ type: "error", message: (err as Error)?.message ?? "Chat failed" });
      queryClient.invalidateQueries({ queryKey: ["usage-summary"] });
    }
    onEvent({ type: "done" });
  });

  return { done, cancel: () => controller.abort() };
}

// --- plain REST ---------------------------------------------------------------

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api/v1${path}`, { ...init, headers });
  if (!res.ok) throw new Error(res.statusText);
  return res.json() as Promise<T>;
}

export function listConversations(projectId: string): Promise<{ conversations: Conversation[] }> {
  return request(`/chat/conversations?project_id=${projectId}`);
}

export function getConversation(
  id: string,
): Promise<{ conversation: Conversation; messages: ChatMessage[] }> {
  return request(`/chat/conversations/${id}`);
}

export function deleteConversation(id: string): Promise<{ ok: boolean }> {
  return request(`/chat/conversations/${id}`, { method: "DELETE" });
}

export function decideApproval(
  approvalId: string,
  decision: "approved" | "rejected",
): Promise<{ id: string; status: string }> {
  return request(`/chat/approvals/${approvalId}`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}
