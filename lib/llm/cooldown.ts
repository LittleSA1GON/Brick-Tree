import type { ProviderName } from "@/lib/config/env";

const cooldowns = new Map<ProviderName, number>();
const nextSlots = new Map<ProviderName, number>();
const rateLimitStrikes = new Map<ProviderName, number>();

const MAX_COOLDOWN_MS = 10 * 60 * 1000;
const GROQ_SOFT_TOKEN_FLOOR = 2_000;

function parseDurationMs(value: string | null): number | undefined {
  if (!value) return undefined;

  const numericSeconds = Number(value);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.ceil(numericSeconds * 1000);
  }

  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) {
    return Math.max(1_000, timestamp - Date.now());
  }

  const match = value.trim().match(/^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i);
  if (!match) return undefined;

  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2] ?? 0);
  const total = (minutes * 60 + seconds) * 1000;
  return Number.isFinite(total) && total >= 0 ? Math.ceil(total) : undefined;
}

export function markProviderCooldown(provider: ProviderName, durationMs: number): void {
  const until = Date.now() + Math.max(1_000, Math.min(durationMs, MAX_COOLDOWN_MS));
  const current = cooldowns.get(provider) ?? 0;
  if (until > current) cooldowns.set(provider, until);
}

export function markProviderRateLimited(
  provider: ProviderName,
  retryAfterMs?: number,
  fallbackCooldownMs = 90_000,
): void {
  const strikes = Math.min(4, (rateLimitStrikes.get(provider) ?? 0) + 1);
  rateLimitStrikes.set(provider, strikes);

  const exponentialFallback = Math.min(
    MAX_COOLDOWN_MS,
    fallbackCooldownMs * 2 ** (strikes - 1),
  );

  markProviderCooldown(provider, retryAfterMs ?? exponentialFallback);
}

export function markProviderHealthy(provider: ProviderName): void {
  rateLimitStrikes.delete(provider);
}

export function observeProviderRateLimitHeaders(
  provider: ProviderName,
  headers: Headers,
): void {
  if (provider !== "groq") return;

  const remainingTokens = Number(headers.get("x-ratelimit-remaining-tokens"));
  if (!Number.isFinite(remainingTokens) || remainingTokens > GROQ_SOFT_TOKEN_FLOOR) return;

  const resetMs = parseDurationMs(headers.get("x-ratelimit-reset-tokens"));
  if (resetMs && resetMs > 0) {
    markProviderCooldown(provider, resetMs + 500);
  }
}

export function providerCooldownRemainingMs(provider: ProviderName): number {
  const until = cooldowns.get(provider) ?? 0;
  const remaining = until - Date.now();
  if (remaining <= 0) {
    cooldowns.delete(provider);
    return 0;
  }
  return remaining;
}

export function providerIsCoolingDown(provider: ProviderName): boolean {
  return providerCooldownRemainingMs(provider) > 0;
}

export function providerSlotRemainingMs(provider: ProviderName): number {
  return Math.max(0, (nextSlots.get(provider) ?? 0) - Date.now());
}

export async function waitForProviderSlot(
  provider: ProviderName,
  minimumIntervalMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const interval = Math.max(0, minimumIntervalMs);
  if (!interval) return;

  const now = Date.now();
  const next = nextSlots.get(provider) ?? now;
  const delay = Math.max(0, next - now);
  nextSlots.set(provider, Math.max(now, next) + interval);

  if (!delay) return;

  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Request aborted", "AbortError"));
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function resetProviderCooldownsForTests(): void {
  cooldowns.clear();
  nextSlots.clear();
  rateLimitStrikes.clear();
}
