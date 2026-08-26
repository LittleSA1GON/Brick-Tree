import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("Vercel deployment configuration", () => {
  it("pins the verified Node major and compact production dependency surface", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      version: string;
      engines: { node: string };
      dependencies: Record<string, string>;
    };
    expect(pkg.version).toBe("0.8.0");
    expect(pkg.engines.node).toBe("22.x");
    expect(pkg.dependencies.next).toBe("16.3.3");
    expect(Object.keys(pkg.dependencies)).toHaveLength(6);
  });

  it("uses a standard Next.js Vercel build without duplicating checks", () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")) as {
      framework: string;
      installCommand: string;
      buildCommand: string;
    };
    expect(config.framework).toBe("nextjs");
    expect(config.installCommand).toBe("npm install --no-audit --no-fund");
    expect(config.buildCommand).toBe("npm run build");
  });

  it("keeps the PDF parser external and gives bounded AI fallback enough runtime", () => {
    const nextConfig = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
    const agentRoute = fs.readFileSync(path.join(root, "app/api/agent/route.ts"), "utf8");
    const documentRoute = fs.readFileSync(path.join(root, "app/api/documents/route.ts"), "utf8");
    expect(nextConfig).toContain('serverExternalPackages: ["pdf-parse"]');
    expect(agentRoute).toContain("export const maxDuration = 60");
    expect(documentRoute).toContain("export const maxDuration = 30");
    expect(documentRoute).toContain("MAX_REQUEST_SIZE = 4_400_000");
  });
});
