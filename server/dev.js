import { spawn } from "node:child_process";

const storage = spawn(process.execPath, ["server/local-storage-server.js"], { stdio: "inherit" });
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], { stdio: "inherit" });
const children = [storage, vite];
let shuttingDown = false;

function shutDown(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill(signal);
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      shutDown();
      process.exitCode = code ?? (signal ? 1 : 0);
    }
  });
}

process.on("SIGINT", () => shutDown("SIGINT"));
process.on("SIGTERM", () => shutDown("SIGTERM"));
