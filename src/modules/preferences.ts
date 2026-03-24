import { config } from "../../package.json";
import { getString } from "../utils/locale";
import type { AIProvider } from "./ai/modelCatalog";
import { getPref, setPref } from "../utils/prefs";

type LlmProviderPreference = AIProvider | "local";

const LLM_OPTIONS = [
  { label: "Ollama", value: "ollama" },
  { label: "Goethe Uni", value: "goethe" },
] as const satisfies ReadonlyArray<{ label: string; value: LlmProviderPreference }>;

const PREFERENCES_PANE_ID = `zotero-prefpane-${config.addonRef}`;

type PreferencePaneEntry = {
  id?: string;
  pluginID?: string;
};

type PreferencePaneRegistry = typeof Zotero.PreferencePanes & {
  pluginPanes?: PreferencePaneEntry[];
  unregister?: (id: string) => void;
};

export function registerPrefs() {
  const preferencePanes = Zotero.PreferencePanes as PreferencePaneRegistry;
  const pluginID = addon.data.config.addonID;
  const existingPluginPanes = (preferencePanes.pluginPanes ?? []).filter(
    (pane) => pane.pluginID === pluginID,
  );

  for (const pane of existingPluginPanes) {
    if (pane.id && pane.id !== PREFERENCES_PANE_ID) {
      preferencePanes.unregister?.(pane.id);
    }
  }

  if (
    existingPluginPanes.some((pane) => pane.id === PREFERENCES_PANE_ID)
  ) {
    return;
  }

  void Zotero.PreferencePanes.register({
    id: PREFERENCES_PANE_ID,
    pluginID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/ai-icon.svg`,
  });
}

export async function registerPrefsScripts(_window: Window) {
  // This function is called when the prefs window is opened
  // See addon/content/preferences.xhtml onpaneload
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
    };
  } else {
    addon.data.prefs.window = _window;
  }
  await bindPrefEvents();
}

function getPrefsWindow(): Window {
  return addon.data.prefs!.window;
}

function getPrefsDocument(): Document {
  return getPrefsWindow().document;
}

function getStringPref(
  key:
    | "llmProvider"
    | "localPort"
    | "goetheApiKey",
): string {
  return String(getPref(key) ?? "").trim();
}

function normalizeProviderPreference(value: string): AIProvider {
  return value === "local" ? "ollama" : (value as AIProvider);
}

async function bindPrefEvents() {
  const doc = getPrefsDocument();
  const savedProvider = normalizeProviderPreference(getStringPref("llmProvider") || "ollama");

  if (savedProvider !== getStringPref("llmProvider")) {
    setPref("llmProvider", savedProvider);
  }

  const providerBoxId = `${config.addonRef}-llm-provider-placeholder`;
  const providerBox = doc.getElementById(providerBoxId);

  if (providerBox) {
    ztoolkit.UI.replaceElement(
      {
        tag: "menulist",
        id: `zotero-prefpane-${config.addonRef}-llm-provider`,
        attributes: {
          value: savedProvider,
          native: "true",
          preference: "llmProvider",
        },
        listeners: [
          {
            type: "command",
            listener: (_e: Event) => {
              syncLlmSettingsVisibility();
            },
          },
        ],
        children: [
          {
            tag: "menupopup",
            children: LLM_OPTIONS.map((option) => ({
              tag: "menuitem",
              attributes: {
                label: option.label,
                value: option.value,
              },
            })),
          },
        ],
      },
      providerBox,
    );
  }

  syncLlmSettingsVisibility();
}

function syncLlmSettingsVisibility() {
  const doc = getPrefsDocument();
  const menulist = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-llm-provider`,
  ) as XUL.MenuList | null;
  const provider = normalizeProviderPreference(
    (menulist?.value as LlmProviderPreference | undefined) ||
      getStringPref("llmProvider") ||
      "ollama",
  );
  const localBox = doc.getElementById(
    `${config.addonRef}-local-settings`,
  ) as HTMLElement | null;
  const goetheBox = doc.getElementById(
    `${config.addonRef}-goethe-settings`,
  ) as HTMLElement | null;

  if (localBox) {
    localBox.hidden = provider !== "ollama";
  }
  if (goetheBox) {
    goetheBox.hidden = provider !== "goethe";
  }
}
