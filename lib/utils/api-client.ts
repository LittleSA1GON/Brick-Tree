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
  error?: {
    code: string;
    message: string;
  };
};

export async function readJsonResponse<T>(
  response: Response,
  fallbackMessage = "The server returned an invalid response.",
): Promise<T> {
  const raw = await response.text();

  if (!raw.trim()) {
    throw new Error(
      response.ok
        ? fallbackMessage
        : `Request failed with HTTP ${response.status}.`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    if (!response.ok) {
      throw new Error(
        `Request failed with HTTP ${response.status}. Please try again.`,
      );
    }

    throw new Error(fallbackMessage);
  }
}

export async function callAgent<T>(
  body: unknown,
  signal?: AbortSignal,
): Promise<AgentApiResponse<T>> {
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  const payload = await readJsonResponse<AgentApiResponse<T>>(
    response,
    "Brick Tree received an unreadable response from the server. Please try again.",
  );

  if (!response.ok || !payload.ok) {
    throw new Error(
      payload.error?.message ||
        `Agent request failed with HTTP ${response.status}.`,
    );
  }

  return {
    ...payload,
    trace: payload.trace ?? [],
    warnings: payload.warnings ?? [],
  };
}