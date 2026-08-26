import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const productionRoots = ["app", "components", "lib"];

function files(dir: string): string[] {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    return entry.isDirectory() ? files(relative) : [relative];
  });
}

function productionSource(): string {
  return productionRoots.flatMap(files)
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\n");
}

describe("stateless compact runtime", () => {
  it("contains no persistence implementation", () => {
    const source = productionSource();
    for (const forbidden of [
      "@neondatabase/serverless",
      "@vercel/blob",
      "DATABASE_URL",
      "AUTH_SECRET",
      "BLOB_READ_WRITE_TOKEN",
      "localStorage",
      "sessionStorage",
      "getAuthenticatedUser",
      "WorkspaceRepository",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("keeps the production dependency surface intentionally small", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      "mammoth",
      "next",
      "pdf-parse",
      "react",
      "react-dom",
      "zod",
    ]);

    const source = productionSource();
    for (const removed of [
      'from "motion',
      'from "axios',
      'from "openai',
      'from "groq-sdk',
      "SEARCH_PROVIDER",
      "RETRIEVAL_PROVIDER",
      "GOOGLE_GENERATIVE_AI_API_KEY",
    ]) {
      expect(source).not.toContain(removed);
    }
  });
});
