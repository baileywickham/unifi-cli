import { cpSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../skill", import.meta.url));
const dest = process.argv[2] ?? join(homedir(), ".claude", "skills", "unifi-cli");
mkdirSync(dest, { recursive: true });
cpSync(source, dest, { recursive: true });
console.log(`installed skill to ${dest}`);
