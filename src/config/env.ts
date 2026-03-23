export type AppEnv = "dev" | "prod";
export type RuntimeEnv = "development" | "production";

export const appEnv: AppEnv = __appEnv__;
export const runtimeEnv: RuntimeEnv = __env__;

export const env = {
  appEnv,
  runtimeEnv,
  isDev: appEnv === "dev",
  isProd: appEnv === "prod",
  showDebugUi: appEnv === "dev",
  enableVerboseLogs: appEnv === "dev",
} as const;
