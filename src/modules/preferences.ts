import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";

const LLM_OPTIONS = [
  { label: "Local", value: "local" },
  { label: "OpenAI", value: "openai" },
  { label: "Goethe Uni", value: "goethe" },
];

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
  bindPrefEvents();
}

function bindPrefEvents() {
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

  syncLlmSettingsVisibility();
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
