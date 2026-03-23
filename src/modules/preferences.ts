import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getModelCatalog, type ModelOption } from "./ai/modelCatalog";
import { getPref, setPref } from "../utils/prefs";

const LLM_OPTIONS = [
  { label: "Local", value: "local" },
  { label: "OpenAI", value: "openai" },
  { label: "Goethe Uni", value: "goethe" },
];

const GOETHE_MODELS_URL =
  "https://litellm.s.studiumdigitale.uni-frankfurt.de/v1/models";

let goetheModelsCache:
  | {
      apiKey: string;
      models: ModelOption[];
    }
  | undefined;
let goetheFetchToken = 0;

export function registerPrefs() {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
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

async function bindPrefEvents() {
  const doc = addon.data.prefs!.window.document;

  const providerBoxId = `${config.addonRef}-llm-provider-placeholder`;
  const providerBox = doc.getElementById(providerBoxId);

  if (providerBox) {
    ztoolkit.UI.replaceElement(
      {
        tag: "menulist",
        id: `zotero-prefpane-${config.addonRef}-llm-provider`,
        attributes: {
          value: (getPref("llmProvider") as string) || LLM_OPTIONS[0].value,
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

  renderOpenAIModelSelect();
  attachGoetheApiKeyListeners();
  await renderGoetheModelSelect();

  syncLlmSettingsVisibility();
}

function createModelMenuConfig(
  id: string,
  preference: "openaiModel" | "goetheModel",
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
          setPref(preference, (target?.value ?? "") as any);
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
  const doc = addon.data.prefs!.window.document;
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
  const value = String(getPref("openaiModel") ?? "").trim();
  const selectedValue =
    value || options[0]?.value || "gpt-4o-mini";

  ztoolkit.UI.replaceElement(
    createModelMenuConfig(
      `zotero-prefpane-${config.addonRef}-openai-model`,
      "openaiModel",
      selectedValue,
      options.length
        ? options
        : [{ label: selectedValue || "gpt-4o-mini", value: selectedValue || "gpt-4o-mini" }],
    ),
    placeholder,
  );

  if (!value && selectedValue) {
    setPref("openaiModel", selectedValue as any);
  }
}

function attachGoetheApiKeyListeners() {
  const doc = addon.data.prefs!.window.document;
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
  return addon.data.prefs!.window.document.getElementById(
    `${config.addonRef}-goethe-model-status`,
  ) as HTMLElement | null;
}

function getGoetheModelMount() {
  const doc = addon.data.prefs!.window.document;
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

async function fetchGoetheModels(apiKey: string): Promise<ModelOption[]> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    return [];
  }

  if (goetheModelsCache?.apiKey === trimmedApiKey) {
    return goetheModelsCache.models;
  }

  const response = await fetch(GOETHE_MODELS_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${trimmedApiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Model fetch failed ${response.status} ${response.statusText}${
        errorText ? `: ${errorText}` : ""
      }`,
    );
  }

  const data = (await response.json()) as {
    data?: Array<{ id?: string; owned_by?: string }>;
  };

  const models = (data.data ?? [])
    .map((entry) => String(entry.id ?? "").trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .map((id) => ({ label: id, value: id }));

  goetheModelsCache = {
    apiKey: trimmedApiKey,
    models,
  };
  return models;
}

async function renderGoetheModelSelect(forceRefresh = false) {
  const doc = addon.data.prefs!.window.document;
  const mount = getGoetheModelMount();
  if (!mount) {
    return;
  }

  const savedValue = String(getPref("goetheModel") ?? "").trim();
  const apiKeyInput = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-goethe-api-key`,
  ) as HTMLInputElement | null;
  const apiKey = String(apiKeyInput?.value ?? getPref("goetheApiKey") ?? "").trim();
  const modelSelectId = `zotero-prefpane-${config.addonRef}-goethe-model`;

  if (!apiKey) {
    const options = getGoetheModelFallbackOptions(
      savedValue,
      getString("pref-model-enter-api-key" as any),
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
    setGoetheModelStatus(getString("pref-model-enter-api-key" as any));
    return;
  }

  if (forceRefresh) {
    goetheModelsCache = undefined;
  }

  const token = ++goetheFetchToken;
  ztoolkit.UI.replaceElement(
    createModelMenuConfig(
      modelSelectId,
      "goetheModel",
      savedValue,
      getGoetheModelFallbackOptions(
        savedValue,
        getString("pref-model-loading" as any),
      ),
      true,
    ),
    mount,
  );
  setGoetheModelStatus(getString("pref-model-loading" as any));

  try {
    const options = await fetchGoetheModels(apiKey);
    if (token !== goetheFetchToken) {
      return;
    }

    const finalOptions = options.length
      ? options
      : getGoetheModelFallbackOptions(
          savedValue,
          getString("pref-model-none-found" as any),
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
      options.length ? "" : getString("pref-model-none-found" as any),
    );

    if (selectedValue !== savedValue) {
      setPref("goetheModel", selectedValue as any);
    }
  } catch (error) {
    if (token !== goetheFetchToken) {
      return;
    }

    const options = getGoetheModelFallbackOptions(
      savedValue,
      getString("pref-model-load-failed" as any),
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
      `${getString("pref-model-load-failed" as any)}${message ? `: ${message}` : ""}`,
    );
  }
}

function syncLlmSettingsVisibility() {
  const doc = addon.data.prefs!.window.document;
  const menulist = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-llm-provider`,
  ) as XUL.MenuList | null;
  const provider =
    menulist?.value || (getPref("llmProvider") as string) || "local";
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
    localBox.hidden = provider !== "local";
  }
  if (openaiBox) {
    openaiBox.hidden = provider !== "openai";
  }
  if (goetheBox) {
    goetheBox.hidden = provider !== "goethe";
  }
}
