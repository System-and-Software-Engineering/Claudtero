import { getPref } from "../../utils/prefs";

/**
 * Hardcoded model catalog for MVP.
 *
 * TODO: Later we can replace this with live fetching:
 *
 * The UI should NOT hardcode model IDs; it should read them from backend.
 */

/**
 * Supported AI providers.
 * Extend this union when adding new providers.
 */
export type AIProvider = "ollama" | "goethe";

export interface ModelOption {
  /** Human-friendly label shown in UI */
  label: string;
  /** Provider-specific model ID passed to the API */
  value: string;
}

export interface ModelCatalog {
  providers: Array<{
    provider: AIProvider;
    label: string;
    models: ModelOption[];
  }>;
}

function buildConfiguredModelOption(
  configuredValue: string,
  fallbackLabel: string,
): ModelOption {
  const value = configuredValue.trim();
  return {
    label: value || fallbackLabel,
    value,
  };
}

export function getModelCatalog(): ModelCatalog {
  const configuredGoetheModel = String(getPref("goetheModel") ?? "");
  const configuredOllamaModel = String(getPref("ollamaModel") ?? "");

  return {
    providers: [
      {
        provider: "ollama",
        label: "Ollama",
        models: [
          buildConfiguredModelOption(
            configuredOllamaModel,
            "Configured in Preferences",
          ),
        ],
      },
      {
        provider: "goethe",
        label: "Goethe Uni",
        models: [
          buildConfiguredModelOption(
            configuredGoetheModel,
            "Configured in Preferences",
          ),
        ],
      },
    ],
  };
}