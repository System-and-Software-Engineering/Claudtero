import { spawn } from "node:child_process";

const [, , appEnv, command, ...args] = process.argv;

if (appEnv !== "dev" && appEnv !== "prod") {
  console.error('Usage: node scripts/run-with-app-env.mjs <dev|prod> <command> [args...]');
  process.exit(1);
}

if (!command) {
  console.error("A command is required.");
  process.exit(1);
}

const runtimeEnv = appEnv === "dev" ? "development" : "production";
const child =
  process.platform === "win32"
    ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `${command}.cmd`, ...args], {
        stdio: "inherit",
        env: {
          ...process.env,
          APP_ENV: appEnv,
          NODE_ENV: runtimeEnv,
        },
      })
    : spawn(command, args, {
        stdio: "inherit",
        env: {
          ...process.env,
          APP_ENV: appEnv,
          NODE_ENV: runtimeEnv,
        },
      });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});