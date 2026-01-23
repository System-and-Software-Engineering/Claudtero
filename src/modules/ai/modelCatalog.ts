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
export type AIProvider = "openai" | "openrouter";

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

export function getModelCatalog(): ModelCatalog {
  return {
    providers: [
      {
        provider: "openai",
        label: "OpenAI",
        models: [
          { label: "GPT-4o mini", value: "gpt-4o-mini" },
          { label: "GPT-4o", value: "gpt-4o" },
        ],
      },
      {
        provider: "openrouter",
        label: "OpenRouter",
        models: [
          { label: "Claude 3.5 Sonnet", value: "anthropic/claude-3.5-sonnet" },
          { label: "Claude 3 Haiku", value: "anthropic/claude-3-haiku" },
        ],
      },
    ],
  };
}