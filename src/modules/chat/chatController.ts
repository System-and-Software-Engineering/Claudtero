import { getDevKeys } from "../ai/keys";
import { sendChatCompletions, type ChatMessage } from "../ai/chatClient";
import { getModelCatalog, type AIProvider, type ModelCatalog } from "../ai/modelCatalog";
import { appendMessage, getSession } from "./sessionStore";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompt";
import { getSelectedPdfText } from "../pdf/getSelectedText";
import { getPref } from "../../utils/prefs";

/**
 * Request payload coming from the UI layer
 */
export interface ChatRequest {
    sessionId: string;
    provider: AIProvider;
    model: string;
    userText: string;
}

/**
 * Response payload returned back to the UI layer
 */
export interface ChatResult {
    assistantText: string;
}

interface ResolvedProviderSettings {
    apiKey: string;
    model: string;
    temperature: number;
    systemPrompt: string;
}

function parseTemperature(value: unknown, fallback = 0.2): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveProviderSettings(
    provider: AIProvider,
    requestedModel: string,
): ResolvedProviderSettings {
    const keys = getDevKeys();

    switch (provider) {
        case "openai": {
            const configuredPrompt = String(getPref("openaiPrompt") ?? "").trim();
            return {
                apiKey: String(getPref("openaiApiKey") ?? "").trim() || keys.openai,
                model:
                    requestedModel.trim() ||
                    String(getPref("openaiModel") ?? "").trim() ||
                    "gpt-4o",
                temperature: parseTemperature(getPref("openaiTemp"), 0.2),
                systemPrompt: configuredPrompt || DEFAULT_SYSTEM_PROMPT,
            };
        }
        case "openrouter":
            return {
                apiKey: keys.openrouter,
                model: requestedModel.trim() || "anthropic/claude-3.5-sonnet",
                temperature: 0.2,
                systemPrompt: DEFAULT_SYSTEM_PROMPT,
            };
        case "goethe": {
            const configuredPrompt = String(getPref("goethePrompt") ?? "").trim();
            return {
                apiKey: String(getPref("goetheApiKey") ?? "").trim(),
                model: requestedModel.trim() || String(getPref("goetheModel") ?? "").trim(),
                temperature: parseTemperature(getPref("goetheTemp"), 0.2),
                systemPrompt: configuredPrompt || DEFAULT_SYSTEM_PROMPT,
            };
        }
        default:
            throw new Error(`Unsupported AI provider: ${provider}`);
    }
}

/**
 * Provide the provider+model mapping to the UI.
 * For MVP, this is hardcoded;
 * TODO: later fetch real model lists.
 */
export function getAvailableModels(): ModelCatalog {
    return getModelCatalog();
}

/**
 * Main chat handler used by the UI.
 *
 * Flow:
 * - Ensure session has a system prompt
 * - Optionally add selected PDF text as extra context
 * - Append user message to session history
 * - Call provider API (OpenAI/OpenRouter)
 * - Append assistant reply
 */
export async function handleChatSend(req: ChatRequest): Promise<ChatResult> {
    const { sessionId, provider, model, userText } = req;
    const settings = resolveProviderSettings(provider, model);

    // Initialize with sys system prompt exactly once per session
    const session = getSession(sessionId);
    if (session.length === 0) {
        appendMessage(sessionId, {
            role: "system",
            content: settings.systemPrompt,
        });
    }

    // Optional context from PDF selection
    const selected = await getSelectedPdfText();
    const finalUserContent = selected
        ? `Selected PDF text:\n${selected}\n\nUser questions:\n${userText}`
        : userText;

    appendMessage(sessionId, { role: "user", content: finalUserContent });

    const assistantText = await sendChatCompletions({
        provider,
        apiKey: settings.apiKey,
        model: settings.model,
        messages: getSession(sessionId) as ChatMessage[],
        temperature: settings.temperature,
    });

    appendMessage(sessionId, { role: "assistant", content: assistantText });

    return { assistantText };
}