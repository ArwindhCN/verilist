// Runs the whole verification pipeline in order and stops at the first failure:
//   compile -> test -> coverage -> e2e -> frontend build
// Plain Node, so it works the same on Windows, macOS and Linux:   npm run verify-all
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const steps = [
  { name: "compile", command: "npm run compile" },
  { name: "test", command: "npm run test" },
  { name: "coverage", command: "npm run coverage" },
  { name: "e2e", command: "npm run e2e" },
  { name: "frontend build", command: "npm run frontend:build" },
];

// The frontend build needs its own node_modules. Install them first if they are missing,
// so `verify-all` also works on a fresh checkout.
if (!fs.existsSync(path.join(root, "frontend", "node_modules"))) {
  steps.splice(4, 0, { name: "frontend install", command: "npm run frontend:install" });
}

const summary = [];

for (const step of steps) {
  console.log(`\n===== ${step.name}: ${step.command} =====\n`);
  const started = Date.now();
  // One command string with `shell: true` is the cross-platform way to run npm
  // (on Windows npm is a .cmd file, which cannot be spawned directly).
  const result = spawnSync(step.command, { cwd: root, stdio: "inherit", shell: true });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;
  summary.push({ step: step.name, result: ok ? "PASS" : "FAIL", seconds });

  if (!ok) {
    console.log(`\n"${step.name}" failed (exit code ${result.status}). Stopping.\n`);
    console.table(summary);
    process.exit(1);
  }
}

console.log("\nAll verification steps passed:\n");
console.table(summary);
