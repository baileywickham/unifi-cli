import { test, expect } from "bun:test";
import { table, json, formatUptime, formatUnixTime } from "../src/format";

test("table pads columns and trims trailing whitespace", () => {
  const out = table(["NAME", "MODEL"], [["gw", "UCG-Ultra"], ["living-room", "U6+"]]);
  expect(out).toBe(["NAME         MODEL", "gw           UCG-Ultra", "living-room  U6+"].join("\n"));
});

test("table tolerates missing cells", () => {
  expect(table(["A", "B"], [["x"]])).toBe("A  B\nx");
});

test("json pretty-prints", () => {
  expect(json({ a: 1 })).toBe('{\n  "a": 1\n}');
});

test("formatUptime", () => {
  expect(formatUptime(3 * 86400 + 4 * 3600)).toBe("3d 4h");
  expect(formatUptime(4 * 3600 + 20 * 60)).toBe("4h 20m");
  expect(formatUptime(12 * 60 + 5)).toBe("12m");
});

test("formatUnixTime gives an ISO timestamp without millis", () => {
  expect(formatUnixTime(1790986688)).toBe("2026-10-03T00:18:08Z");
  expect(formatUnixTime(undefined)).toBe("");
});
