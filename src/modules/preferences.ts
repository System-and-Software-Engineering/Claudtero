import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getModelCatalog, type AIProvider, type ModelOption } from "./ai/modelCatalog";
import { fetchOllamaRunningModels } from "./ai/ollama";
import { clearGoetheModelsCache, fetchGoetheModels } from "./ai/goethe";
import { getPref, setPref } from "../utils/prefs";

type LlmProviderPreference = AIProvider | "local";
type ModelPreferenceKey = "openaiModel" | "goetheModel" | "ollamaModel";

const LLM_OPTIONS = [
  { label: "Ollama", value: "ollama" },
  { label: "OpenAI", value: "openai" },
  { label: "Goethe Uni", value: "goethe" },
] as const satisfies ReadonlyArray<{ label: string; value: LlmProviderPreference }>;

const OLLAMA_ENTER_PORT_MESSAGE = "Enter your Ollama port to load running models";
const OLLAMA_NONE_RUNNING_MESSAGE = "No running Ollama models found";
const PREFERENCES_PANE_ID = `zotero-prefpane-${config.addonRef}`;

type PreferencePaneEntry = {
  id?: string;
  pluginID?: string;
};

type PreferencePaneRegistry = typeof Zotero.PreferencePanes & {
  pluginPanes?: PreferencePaneEntry[];
  unregister?: (id: string) => void;
};

let goetheFetchToken = 0;
let ollamaModelsCache:
  | {
      port: string;
      models: ModelOption[];
    }
  | undefined;
let ollamaFetchToken = 0;

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
    | "ollamaModel"
    | "openaiModel"
    | "goetheModel"
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

  attachOllamaPortListeners();
  await renderOllamaModelSelect();
  renderOpenAIModelSelect();
  attachGoetheApiKeyListeners();
  await renderGoetheModelSelect();

  syncLlmSettingsVisibility();
}

function createModelMenuConfig(
  id: string,
  preference: ModelPreferenceKey,
  value: string,
  options: ModelOption[],
  disabled = false,
) {
  return {
    tag: "menulist",
    id,
    attributes: {
      value,
      native: "true",
      preference,
      disabled: disabled ? "true" : "false",
    },
    listeners: [
      {
        type: "command",
        listener: (event: Event) => {
          const target = event.currentTarget as XUL.MenuList | null;
          setPref(preference, target?.value ?? "");
        },
      },
    ],
    children: [
      {
        tag: "menupopup",
        children: options.map((option) => ({
          tag: "menuitem",
          attributes: {
            label: option.label,
            value: option.value,
          },
        })),
      },
    ],
  };
}

function renderOpenAIModelSelect() {
  const doc = getPrefsDocument();
  const placeholder = doc.getElementById(
    `${config.addonRef}-openai-model-placeholder`,
  );
  if (!placeholder) {
    return;
  }

  const openAIEntry = getModelCatalog().providers.find(
    (provider) => provider.provider === "openai",
  );
  const options = (openAIEntry?.models ?? []).filter((model) => model.value);
  const value = getStringPref("openaiModel");
  const fallbackValue = "gpt-4o-mini";
  const selectedValue = value || options[0]?.value || fallbackValue;

  ztoolkit.UI.replaceElement(
    createModelMenuConfig(
      `zotero-prefpane-${config.addonRef}-openai-model`,
      "openaiModel",
      selectedValue,
      options.length ? options : [{ label: selectedValue, value: selectedValue }],
    ),
    placeholder,
  );

  if (!value && selectedValue) {
    setPref("openaiModel", selectedValue);
  }
}

function attachOllamaPortListeners() {
  const doc = getPrefsDocument();
  const portInput = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-local-port`,
  ) as HTMLInputElement | null;

  if (!portInput || portInput.dataset.modelsBound === "true") {
    return;
  }

  const refreshModels = async () => {
    await renderOllamaModelSelect(true);
  };

  portInput.addEventListener("change", refreshModels);
  portInput.addEventListener("blur", refreshModels);
  portInput.dataset.modelsBound = "true";
}

function getOllamaModelStatusElement() {
  return getPrefsDocument().getElementById(
    `${config.addonRef}-ollama-model-status`,
  ) as HTMLElement | null;
}

function getOllamaModelMount() {
  const doc = getPrefsDocument();
  return (
    doc.getElementById(`zotero-prefpane-${config.addonRef}-ollama-model`) ??
    doc.getElementById(`${config.addonRef}-ollama-model-placeholder`)
  );
}

function setOllamaModelStatus(message: string) {
  const status = getOllamaModelStatusElement();
  if (status) {
    status.textContent = message;
  }
}

function getOllamaModelFallbackOptions(savedValue: string, label: string): ModelOption[] {
  if (savedValue) {
    return [{ label: savedValue, value: savedValue }];
  }
  return [{ label, value: "" }];
}

async function fetchCachedOllamaModels(port: string): Promise<ModelOption[]> {
  const trimmedPort = port.trim();
  if (!trimmedPort) {
    return [];
  }

  if (ollamaModelsCache?.port === trimmedPort) {
    return ollamaModelsCache.models;
  }

  const models = await fetchOllamaRunningModels(trimmedPort);
  ollamaModelsCache = {
    port: trimmedPort,
    models,
  };
  return models;
}

async function renderOllamaModelSelect(forceRefresh = false) {
  const doc = getPrefsDocument();
  const mount = getOllamaModelMount();
  if (!mount) {
    return;
  }

  const savedValue = getStringPref("ollamaModel");
  const portInput = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-local-port`,
  ) as HTMLInputElement | null;
  const port = String(portInput?.value ?? getStringPref("localPort")).trim();
  const modelSelectId = `zotero-prefpane-${config.addonRef}-ollama-model`;

  if (!port) {
    const options = getOllamaModelFallbackOptions(
      savedValue,
      OLLAMA_ENTER_PORT_MESSAGE,
    );
    ztoolkit.UI.replaceElement(
      createModelMenuConfig(
        modelSelectId,
        "ollamaModel",
        savedValue,
        options,
        true,
      ),
      mount,
    );
    setOllamaModelStatus(OLLAMA_ENTER_PORT_MESSAGE);
    return;
  }

  if (forceRefresh) {
    ollamaModelsCache = undefined;
  }

  const token = ++ollamaFetchToken;
  ztoolkit.UI.replaceElement(
    createModelMenuConfig(
      modelSelectId,
      "ollamaModel",
      savedValue,
      getOllamaModelFallbackOptions(savedValue, getString("pref-model-loading")),
      true,
    ),
    mount,
  );
  setOllamaModelStatus(getString("pref-model-loading"));

  try {
    const options = await fetchCachedOllamaModels(port);
    if (token !== ollamaFetchToken) {
      return;
    }

    const finalOptions = options.length
      ? options
      : getOllamaModelFallbackOptions(
          savedValue,
          OLLAMA_NONE_RUNNING_MESSAGE,
        );
    const selectedValue =
      savedValue && finalOptions.some((option) => option.value === savedValue)
        ? savedValue
        : finalOptions[0]?.value ?? "";

    ztoolkit.UI.replaceElement(
      createModelMenuConfig(
        modelSelectId,
        "ollamaModel",
        selectedValue,
        finalOptions,
        !options.length,
      ),
      getOllamaModelMount() ?? mount,
    );
    setOllamaModelStatus(
      options.length ? "" : OLLAMA_NONE_RUNNING_MESSAGE,
    );

    if (selectedValue !== savedValue) {
      setPref("ollamaModel", selectedValue);
    }
  } catch (error) {
    if (token !== ollamaFetchToken) {
      return;
    }

    const options = getOllamaModelFallbackOptions(
      savedValue,
      getString("pref-model-load-failed"),
    );
    ztoolkit.UI.replaceElement(
      createModelMenuConfig(
        modelSelectId,
        "ollamaModel",
        savedValue,
        options,
        true,
      ),
      getOllamaModelMount() ?? mount,
    );
    const message = error instanceof Error ? error.message : String(error);
    setOllamaModelStatus(
      `${getString("pref-model-load-failed")}${message ? `: ${message}` : ""}`,
    );
  }
}

function attachGoetheApiKeyListeners() {
  const doc = getPrefsDocument();
  const apiKeyInput = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-goethe-api-key`,
  ) as HTMLInputElement | null;

  if (!apiKeyInput || apiKeyInput.dataset.modelsBound === "true") {
    return;
  }

  const refreshModels = async () => {
    await renderGoetheModelSelect(true);
  };

  apiKeyInput.addEventListener("change", refreshModels);
  apiKeyInput.addEventListener("blur", refreshModels);
  apiKeyInput.dataset.modelsBound = "true";
}

function getGoetheModelStatusElement() {
  return getPrefsDocument().getElementById(
    `${config.addonRef}-goethe-model-status`,
  ) as HTMLElement | null;
}

function getGoetheModelMount() {
  const doc = getPrefsDocument();
  return (
    doc.getElementById(`zotero-prefpane-${config.addonRef}-goethe-model`) ??
    doc.getElementById(`${config.addonRef}-goethe-model-placeholder`)
  );
}

function setGoetheModelStatus(message: string) {
  const status = getGoetheModelStatusElement();
  if (status) {
    status.textContent = message;
  }
}

function getGoetheModelFallbackOptions(savedValue: string, label: string): ModelOption[] {
  if (savedValue) {
    return [{ label: savedValue, value: savedValue }];
  }
  return [{ label, value: "" }];
}

async function renderGoetheModelSelect(forceRefresh = false) {
  const doc = getPrefsDocument();
  const mount = getGoetheModelMount();
  if (!mount) {
    return;
  }

  const savedValue = getStringPref("goetheModel");
  const apiKeyInput = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-goethe-api-key`,
  ) as HTMLInputElement | null;
  const apiKey = String(apiKeyInput?.value ?? getStringPref("goetheApiKey")).trim();
  const modelSelectId = `zotero-prefpane-${config.addonRef}-goethe-model`;

  if (!apiKey) {
    const options = getGoetheModelFallbackOptions(
      savedValue,
      getString("pref-model-enter-api-key"),
    );
    ztoolkit.UI.replaceElement(
      createModelMenuConfig(
        modelSelectId,
        "goetheModel",
        savedValue,
        options,
        true,
      ),
      mount,
    );
    setGoetheModelStatus(getString("pref-model-enter-api-key"));
    return;
  }

  if (forceRefresh) {
    clearGoetheModelsCache();
  }

  const token = ++goetheFetchToken;
  ztoolkit.UI.replaceElement(
    createModelMenuConfig(
      modelSelectId,
      "goetheModel",
      savedValue,
      getGoetheModelFallbackOptions(
        savedValue,
        getString("pref-model-loading"),
      ),
      true,
    ),
    mount,
  );
  setGoetheModelStatus(getString("pref-model-loading"));

  try {
    const options = await fetchGoetheModels(apiKey);
    if (token !== goetheFetchToken) {
      return;
    }

    const finalOptions = options.length
      ? options
      : getGoetheModelFallbackOptions(
          savedValue,
          getString("pref-model-none-found"),
        );
    const selectedValue =
      savedValue && finalOptions.some((option) => option.value === savedValue)
        ? savedValue
        : finalOptions[0]?.value ?? "";

    ztoolkit.UI.replaceElement(
      createModelMenuConfig(
        modelSelectId,
        "goetheModel",
        selectedValue,
        finalOptions,
        !options.length,
      ),
      getGoetheModelMount() ?? mount,
    );
    setGoetheModelStatus(
      options.length ? "" : getString("pref-model-none-found"),
    );

    if (selectedValue !== savedValue) {
      setPref("goetheModel", selectedValue);
    }
  } catch (error) {
    if (token !== goetheFetchToken) {
      return;
    }

    const options = getGoetheModelFallbackOptions(
      savedValue,
      getString("pref-model-load-failed"),
    );
    ztoolkit.UI.replaceElement(
      createModelMenuConfig(
        modelSelectId,
        "goetheModel",
        savedValue,
        options,
        true,
      ),
      getGoetheModelMount() ?? mount,
    );
    const message = error instanceof Error ? error.message : String(error);
    setGoetheModelStatus(
      `${getString("pref-model-load-failed")}${message ? `: ${message}` : ""}`,
    );
  }
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
  const openaiBox = doc.getElementById(
    `${config.addonRef}-openai-settings`,
  ) as HTMLElement | null;
  const goetheBox = doc.getElementById(
    `${config.addonRef}-goethe-settings`,
  ) as HTMLElement | null;

  if (localBox) {
    localBox.hidden = provider !== "ollama";
  }
  if (openaiBox) {
    openaiBox.hidden = provider !== "openai";
  }
  if (goetheBox) {
    goetheBox.hidden = provider !== "goethe";
  }
}
