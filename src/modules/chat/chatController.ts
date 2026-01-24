import { getDevKeys } from "../ai/keys";
import { sendChatCompletions, type ChatMessage } from "../ai/chatClient";
import { getModelCatalog, type AIProvider, type ModelCatalog } from "../ai/modelCatalog";
import { appendMessage, getSession, isNewSession } from "./sessionStore";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompt";
import { getSelectedPdfText, getFullPdfText } from "../pdf/getSelectedText";

/**
 * Request payload coming from the UI layer
 */
export interface ChatRequest {
    sessionId: string;
    provider: AIProvider;
    model: string;
    userText: string;
    itemID: number; // Added to extract PDF text
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
 * - Check if this is a new session
 * - If new: Extract full PDF text and send with custom system prompt
 * - Ensure session has a system prompt
 * - Optionally add selected PDF text as extra context
 * - Append user message to session history
 * - Call provider API (OpenAI/OpenRouter)
 * - Append assistant reply
 */
export async function handleChatSend(req: ChatRequest): Promise<ChatResult> {
    const { sessionId, provider, model, userText, itemID } = req;

    const keys = getDevKeys();
    const apiKey = provider === "openai" ? keys.openai : keys.openrouter;

    // Check if this is the first message in the session
    const isFirstMessage = await isNewSession(sessionId, ztoolkit);

    // Initialize with system prompt exactly once per session
    const session = await getSession(sessionId, ztoolkit);
    if (session.length === 0) {
        await appendMessage(sessionId, { role: "system", content: DEFAULT_SYSTEM_PROMPT}, ztoolkit);
    }

    await appendMessage(sessionId, { role: "user", content: userText }, ztoolkit);

    /*ztoolkit.log(isFirstMessage)
    ztoolkit.log(itemID)*/

    // If this is the first message, extract and prepend the full PDF text as context
    if (isFirstMessage && itemID) {
        const fullPdfText = await getFullPdfText(itemID, ztoolkit);

        ztoolkit.log("Full PDF text extracted:", fullPdfText);

        if (fullPdfText) {
            // Add PDF context as a separate "context" message
            // This happens AFTER user message, but will be sent to API in correct order
            await appendMessage(sessionId, {
                role: "context",
                content: `You are a Zotero LLM Instance, please read the following as your context for this session and afterwards help the user find answers to what they ask you. You cannot see images if they ask for it.\n\nPDF-contents:\n${fullPdfText}`
            }, ztoolkit);
        } else {
            // If we couldn't extract PDF text, check for selected text
            const selected = await getSelectedPdfText();
            if (selected) {
                // Add selected text as context
                await appendMessage(sessionId, {
                    role: "context",
                    content: `Selected PDF text:\n${selected}`
                }, ztoolkit);
            }
        }
    } else {
        // Not the first message - check for selected text
        const selected = await getSelectedPdfText();
        if (selected) {
            // Add selected text as context for this specific question
            await appendMessage(sessionId, {
                role: "context",
                content: `Selected PDF text:\n${selected}`
            }, ztoolkit);
        }
    }

    // Get the full session for API call (including context messages)
    const fullSession = await getSession(sessionId, ztoolkit);

    const assistantText = await sendChatCompletions({
        provider,
        apiKey,
        model,
        messages: fullSession as ChatMessage[],
    });

    // Sanitize assistant response before saving
    // Remove control characters that could cause XML/HTML parsing errors
    const sanitizedResponse = assistantText
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')  // Remove control chars
        .replace(/[\uD800-\uDFFF]/g, '')  // Remove invalid surrogate pairs
        .replace(/[\uFFFE\uFFFF]/g, '');  // Remove invalid Unicode

    await appendMessage(sessionId, { role: "assistant", content: sanitizedResponse }, ztoolkit);

    return { assistantText: sanitizedResponse };
}