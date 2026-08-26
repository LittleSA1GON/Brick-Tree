export type AgentApiResponse<T> = {
  ok: boolean;
  data?: T;
  trace: Array<{
    id: string;
    timestamp: string;
    agent?: string;
    type: string;
    summary: string;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  }>;
  warnings: string[];
  error?: { code: string; message: string };
};

export async function callAgent<T>(body: unknown, signal?: AbortSignal): Promise<AgentApiResponse<T>> {
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const payload = (await response.json()) as AgentApiResponse<T>;
  if (!payload.ok) {
    throw new Error(payload.error?.message || `Agent request failed with ${response.status}.`);
  }
  return payload;
}
