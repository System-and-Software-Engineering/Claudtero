import { getPref } from "../../utils/prefs";

/**
 * Hardcoded model catalog for MVP.
 *
 * TODO: Later we can replace this with live fetching:
 * - OpenAI: GET /v1/models
 * - OpenRouter: GET /api/v1/models
 *
 * The UI should NOT hardcode model IDs; it should read them from backend.
 */

/**
 * Supported AI providers.
 * Extend this union when adding new providers.
 */
export type AIProvider = "openai" | "openrouter" | "goethe";

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
  const configuredOpenAIModel = String(getPref("openaiModel") ?? "");
  const configuredGoetheModel = String(getPref("goetheModel") ?? "");

  return {
    providers: [
      {
        provider: "openai",
        label: "OpenAI",
        models: [
          buildConfiguredModelOption(
            configuredOpenAIModel,
            "Configured in Preferences",
          ),
          { label: "GPT-4o mini", value: "gpt-4o-mini" },
          { label: "GPT-4o", value: "gpt-4o" },
        ].filter(
          (model, index, list) =>
            Boolean(model.value) || index === 0
              ? list.findIndex((entry) => entry.value === model.value) === index
              : false,
        ),
      },
      {
        provider: "openrouter",
        label: "OpenRouter",
        models: [
          { label: "Claude 3.5 Sonnet", value: "anthropic/claude-3.5-sonnet" },
          { label: "Claude 3 Haiku", value: "anthropic/claude-3-haiku" },
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