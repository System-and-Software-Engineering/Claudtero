import { config } from "../package.json";
import { DialogHelper } from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { appEnv, runtimeEnv, type AppEnv, type RuntimeEnv } from "./config/env";
import { createZToolkit } from "./utils/ztoolkit";

interface LocaleState {
  current: {
    formatMessagesSync?(
      messages: Array<{ id: string; args?: Record<string, unknown> }>,
    ): Array<{ value?: string; attributes?: Array<{ name: string; value: string }> | Record<string, string> }>;
  };
}

interface PreferencesState {
  window: Window;
}

interface AddonData {
  alive: boolean;
  config: typeof config;
  env: RuntimeEnv;
  appEnv: AppEnv;
  initialized: boolean;
  ztoolkit: ZToolkit;
  locale?: LocaleState;
  prefs?: PreferencesState;
  dialog?: DialogHelper;
}

class Addon {
  public data: AddonData;
  public hooks: typeof hooks;
  public api: Record<string, unknown>;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: runtimeEnv,
      appEnv,
      initialized: false,
      ztoolkit: createZToolkit(),
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
