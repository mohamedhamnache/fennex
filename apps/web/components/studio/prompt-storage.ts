// apps/web/components/studio/prompt-storage.ts

const HISTORY_KEY = (projectId: string) => `prompt-history-${projectId}`;
const SAVED_KEY = (projectId: string) => `prompt-saved-${projectId}`;
const MAX_HISTORY = 10;

function readList(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]): void {
  localStorage.setItem(key, JSON.stringify(list));
}

export function addToHistory(projectId: string, prompt: string): void {
  const key = HISTORY_KEY(projectId);
  const list = readList(key).filter((p) => p !== prompt);
  writeList(key, [prompt, ...list].slice(0, MAX_HISTORY));
}

export function getHistory(projectId: string): string[] {
  return readList(HISTORY_KEY(projectId));
}

export function savePrompt(projectId: string, prompt: string): void {
  const key = SAVED_KEY(projectId);
  const list = readList(key);
  if (!list.includes(prompt)) {
    writeList(key, [prompt, ...list]);
  }
}

export function getSaved(projectId: string): string[] {
  return readList(SAVED_KEY(projectId));
}

export function removeSaved(projectId: string, prompt: string): void {
  const key = SAVED_KEY(projectId);
  writeList(key, readList(key).filter((p) => p !== prompt));
}
