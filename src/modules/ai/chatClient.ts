import type { AIProvider } from "../ai/modelCatalog";

/**
 * Chat completion client for OpenAI and OpenRouter.
 *
 * This module intentionally abstracts both providers behind
 * a single function so the rest of the plugin does not care
 * which provider is used.
 *
 * Supported endpoints:
 * - OpenAI:     POST https://api.openai.com/v1/chat/completions
 * - OpenRouter: POST https://openrouter.ai/api/v1/chat/completions
 *
 * NOTE:
 * - This is a NON-streaming implementation.
 * - API keys must be supplied by the caller.
 * - Errors are thrown and should be handled by the UI layer.
 */

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */



/**
 * Allowed chat roles for Chat Completions.
 * Matches OpenAI / OpenRouter specification.
 */
export type ChatRole = "system" | "user" | "assistant";


/**
 * A single message in a chat conversation
 */
export interface ChatMessage {
    role: ChatRole
    content: string;
};

/**
 * Input parameters for a chat completion request
 */
export interface ChatCompletionParams {
    provider: AIProvider;
    apiKey: string;
    model: string;
    messages: ChatMessage[];
    temperature?: number;
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Resolve the API base URL for the given provider
 */
function getBaseUrl(provider: AIProvider): string {
    switch (provider) {
        case "openai":
            return "https://api.openai.com/v1";
        case "openrouter":
            return "https://openrouter.ai/api/v1";
        default:
            // Exhaustiveness check (helps TypeScript catch errors)
            throw new Error(`Unsupported AI provider: ${provider}`);
    }
}

/**
 * Build HTTP headers for a chat completion request.
 */
function buildHeaders(
    provider: AIProvider,
    apiKey: string
): Record<string, string> {
    const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
    };

    /**
   * OpenRouter recommends setting these headers so they can
   * attribute traffic and display of the app name in dashboards.
   * They are optional and safe to include.
   */
    if (provider === "openrouter") {
        headers["HTTP-Referer"] = "https://github.com/System-and-Software-Engineering/Claudtero";
        headers["X-Title"] = "Claudtero - Zotero AI Assistant";
    }

    return headers;
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Send a chat completion request to OpenAI or OpenRouter.
 *
 * This function:
 * 1. Builds the provider-specific endpoint
 * 2. Sends the full message history
 * 3. Returns ONLY the assistant's text content
 *
 * @throws Error if the request fails or the response is malformed
 */

export async function sendChatCompletions(
    params: ChatCompletionParams
): Promise <string> {
    const {
        provider,
        apiKey,
        model,
        messages,
        temperature = 0.2,
    } = params;

    if (!apiKey) {
        throw new Error(`Missing API Key for provider: ${provider}`);
    }

    const baseUrl = getBaseUrl(provider);
    const url = `${baseUrl}/chat/completions`;

    const response = await fetch(url, {
        method: "POST",
        headers: buildHeaders(provider, apiKey),
        body: JSON.stringify({
            model,
            messages,
            temperature,
        }),
    });

    /**
     * Non-2xx responses are treated as hard erros.
     * We attempt to extract response text for debugging
     */
    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
            `Chat completion failed (${provider}) ` +
            `${response.status} ${response.statusText} \n` +
            errorText
        );
    }

  /**
   * Expected response shape (simplified):
   * {
   *   choices: [
   *     {
   *       message: { role: "assistant", content: "..." }
   *     }
   *   ]
   * }
   */
  const data = (await response.json()) as {
    choices?: Array<{
        message?: {content?: string};
    }>;
  };

  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error(
        `Invalid chat completion response from ${provider}`
    );
  }

  return content;
}