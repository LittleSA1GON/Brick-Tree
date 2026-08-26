import { describe, expect, it } from "vitest";
import { assertSameOrigin, requestBodyTooLarge } from "@/lib/utils/request";

describe("request boundary helpers", () => {
  it("rejects declared bodies above the route budget", () => {
    expect(requestBodyTooLarge(new Request("http://localhost", { headers: { "content-length": "2001" } }), 2000)).toBe(true);
    expect(requestBodyTooLarge(new Request("http://localhost", { headers: { "content-length": "1999" } }), 2000)).toBe(false);
  });

  it("rejects cross-origin mutation requests", () => {
    expect(() => assertSameOrigin(new Request("https://brick-tree.example/api/agent", {
      headers: { origin: "https://evil.example" },
    }))).toThrow("invalid_origin");
    expect(() => assertSameOrigin(new Request("https://brick-tree.example/api/agent", {
      headers: { origin: "https://brick-tree.example" },
    }))).not.toThrow();
  });
});
