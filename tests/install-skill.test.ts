import { test, expect } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("install-skill copies SKILL.md to dest", () => {
  const dest = join(mkdtempSync(join(tmpdir(), "unifi-skill-")), "unifi-cli");
  const result = Bun.spawnSync(["bun", "scripts/install-skill.ts", dest], { cwd: `${import.meta.dir}/..` });
  expect(result.exitCode).toBe(0);
  expect(existsSync(join(dest, "SKILL.md"))).toBe(true);
  expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toContain("name: unifi-cli");
});
