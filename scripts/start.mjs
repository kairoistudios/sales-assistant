import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function productionProblems(env = process.env) {
  const problems = [];
  const secret = env.SESSION_SECRET || "";
  if (secret.length < 24 || secret === "dev-only-change-me") {
    problems.push("Set SESSION_SECRET to a long random string (openssl rand -base64 32).");
  }
  const key = (env.TOKEN_ENCRYPTION_KEY || "").trim();
  if (!key) {
    problems.push("Set TOKEN_ENCRYPTION_KEY to 32 bytes from: openssl rand -base64 32");
  } else if (!tokenKeyLooksValid(key)) {
    problems.push(
      "TOKEN_ENCRYPTION_KEY must be 32 bytes, encoded as base64 (openssl rand -base64 32) or as 64 hex characters.",
    );
  }
  const appUrl = env.APP_URL || "";
  if (!appUrl.startsWith("https://") || appUrl.endsWith("/")) {
    problems.push("Set APP_URL to the https address of this deployment, with no trailing slash.");
  }
  return problems;
}

function tokenKeyLooksValid(value) {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const decoded = Buffer.from(`${normalized}${padding}`, "base64");
  if (decoded.length !== 32) return false;
  return normalized.replace(/=+$/, "") === decoded.toString("base64").replace(/=+$/, "");
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedDirectly()) {
  const problems = productionProblems(process.env);
  if (problems.length > 0) {
    console.error(`Refusing to start in production:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }

  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const port = process.env.PORT || "43123";
  const flag = "--disable-warning=ExperimentalWarning";
  const env = { ...process.env };
  env.NODE_OPTIONS = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${flag}` : flag;

  const child = spawn(process.execPath, [nextBin, "start", "-H", "0.0.0.0", "-p", port], {
    stdio: "inherit",
    env,
  });

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => child.kill(signal));
  }

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}
