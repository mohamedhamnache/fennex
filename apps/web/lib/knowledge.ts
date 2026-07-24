/** What the agency knows about a project.
 *
 *  Documents are embedded once when added; employees retrieve passages only
 *  when they need them, so a large library costs nothing on turns that never
 *  consult it.
 */
import { API_BASE, apiClient, getToken } from "./api";

export interface KnowledgeDoc {
  id: string;
  title: string;
  kind: string;
  source: string | null;
  wordCount: number;
  chunkCount: number;
  status: "ready" | "processing" | "no_vectors" | "failed";
  error: string | null;
  createdAt: string | null;
}

export interface KnowledgeIndex {
  documents: KnowledgeDoc[];
  stats: { documents: number; chunks: number; words: number };
  /** The standing summary every employee sees. */
  digest: string | null;
}

export function listKnowledge(projectId: string): Promise<KnowledgeIndex> {
  return apiClient.get(`/knowledge?project_id=${projectId}`);
}

export function addNote(body: {
  project_id: string;
  title: string;
  body: string;
  kind?: string;
}): Promise<KnowledgeDoc> {
  return apiClient.post("/knowledge/note", body);
}

export function deleteKnowledge(id: string): Promise<{ ok: boolean }> {
  return apiClient.delete(`/knowledge/${id}`);
}

/** Preview what an employee would retrieve for a question. */
export function searchKnowledge(
  projectId: string,
  question: string,
): Promise<{ passages: { document: string; text: string; relevance: number | null }[] }> {
  return apiClient.post("/knowledge/search", {
    project_id: projectId, title: "search", body: question,
  });
}

export async function uploadKnowledge(
  projectId: string,
  file: File,
): Promise<KnowledgeDoc> {
  const token = getToken();
  const form = new FormData();
  form.append("project_id", projectId);
  form.append("file", file);
  // No Content-Type header: the browser must set the multipart boundary.
  const res = await fetch(`${API_BASE}/api/v1/knowledge/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
    } catch {
      // non-JSON error body
    }
    throw new Error(detail);
  }
  return res.json();
}
