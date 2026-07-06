import { test, expect } from "bun:test";

const ROOT = `${import.meta.dir}/..`;

test("--help prints usage and exits 0", () => {
  const result = Bun.spawnSync(["bun", "src/main.ts", "--help"], { cwd: ROOT });
  expect(result.stdout.toString()).toContain("usage: unifi");
  expect(result.exitCode).toBe(0);
});

test("no args prints usage and exits 0", () => {
  const result = Bun.spawnSync(["bun", "src/main.ts"], { cwd: ROOT });
  expect(result.stdout.toString()).toContain("usage: unifi");
  expect(result.exitCode).toBe(0);
});
