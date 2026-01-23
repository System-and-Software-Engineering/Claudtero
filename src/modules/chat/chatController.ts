import { getDevKeys } from "../ai/keys";
import { sendChatCompletions, type ChatMessage } from "../ai/chatClient";
import { getModelCatalog, type AIProvider, type ModelCatalog } from "../ai/modelCatalog";
import { appendMessage, getSession } from "./sessionStore";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompt";
import { getSelectedPdfText } from "../pdf/getSelectedText";

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

    const keys = getDevKeys();
    const apiKey = provider === "openai" ? keys.openai : keys.openrouter;

    // Initialize with sys system prompt exactly once per session
    const session = getSession(sessionId);
    if (session.length === 0) {
        appendMessage(sessionId, { role: "system", content: DEFAULT_SYSTEM_PROMPT});
    }

    // Optional context from PDF selection
    const selected = await getSelectedPdfText();
    const finalUserContent = selected
        ? `Selected PDF text:\n${selected}\n\nUser questions:\n${userText}`
        : userText;

    appendMessage(sessionId, { role: "user", content: finalUserContent });

    const assistantText = await sendChatCompletions({
        provider,
        apiKey,
        model,
        messages: getSession(sessionId) as ChatMessage[],
    });

    appendMessage(sessionId, { role: "assistant", content: assistantText });

    return { assistantText };
}