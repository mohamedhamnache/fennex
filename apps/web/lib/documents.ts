/** Deliverables saved out of a conversation.
 *
 *  A report lives in the thread that produced it, which is fine until the
 *  thread scrolls away or is deleted. Saving copies it somewhere permanent.
 */
import { apiClient } from "./api";

export interface SavedDocument {
  id: string;
  title: string;
  kind: string;
  fmt: string;
  employeeId: string | null;
  wordCount: number;
  projectId: string;
  conversationId: string | null;
  createdAt: string | null;
  body?: string;
}

export function listDocuments(projectId: string): Promise<{ documents: SavedDocument[] }> {
  return apiClient.get(`/documents?project_id=${projectId}`);
}

export function saveDocument(body: {
  project_id: string;
  title: string;
  body: string;
  conversation_id?: string | null;
  employee_id?: string | null;
  kind?: string;
}): Promise<SavedDocument> {
  return apiClient.post("/documents", body);
}

export function getDocument(id: string): Promise<SavedDocument> {
  return apiClient.get(`/documents/${id}`);
}

export function deleteDocument(id: string): Promise<{ ok: boolean }> {
  return apiClient.delete(`/documents/${id}`);
}
