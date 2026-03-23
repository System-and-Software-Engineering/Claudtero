import { getDevKeys } from "../ai/keys";
import { sendChatCompletions, type ChatMessage } from "../ai/chatClient";
import { getModelCatalog, type AIProvider, type ModelCatalog } from "../ai/modelCatalog";
import { appendMessage, getSession } from "./sessionStore";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompt";
import { getSelectedPdfText } from "../pdf/getSelectedText";
import { getPref } from "../../utils/prefs";
import {
    buildSinglePageContext,
    buildDocumentContext,
    buildUserMessageWithContext,
    type ContextModeDecision,
    decideContextMode,
} from "./documentContext";

/**
 * Request payload coming from the UI layer
 */
export interface ChatRequest {
    sessionId: string;
    provider: AIProvider;
    model: string;
    userText: string;
    selectedText?: string;
    selectedPageNumber?: number | null;
}

/**
 * Response payload returned back to the UI layer
 */
export interface ChatResult {
    assistantText: string;
}

export interface PreparedChatRequest {
    settings: ResolvedProviderSettings;
    finalUserContent: string;
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

export async function prepareChatRequest(
    req: ChatRequest,
): Promise<PreparedChatRequest> {
    const { provider, model, userText } = req;
    const settings = resolveProviderSettings(provider, model);
    const selected = (req.selectedText ?? (await getSelectedPdfText())).trim();

    if (selected) {
        const selectedPageNumber =
            typeof req.selectedPageNumber === "number" && req.selectedPageNumber > 0
                ? req.selectedPageNumber
                : null;
        const decision: ContextModeDecision = {
            mode: "page_window",
            reason:
                "The user provided highlighted text, so only the source page was sent as context.",
            keywords: [],
        };
        const documentContext = selectedPageNumber
            ? await buildSinglePageContext({
                  ztoolkit,
                  pageNumber: selectedPageNumber,
              })
            : "";

        return {
            settings,
            finalUserContent: buildUserMessageWithContext({
                userText,
                selectedText: selected,
                decision,
                documentContext,
            }),
        };
    }

    const decision = await decideContextMode({
        provider,
        apiKey: settings.apiKey,
        model: settings.model,
        userText,
    });
    const builtContext = await buildDocumentContext({
        ztoolkit,
        decision,
        userText,
    });
    const effectiveDecision: ContextModeDecision =
        builtContext.appliedMode && builtContext.appliedMode !== decision.mode
            ? {
                  ...decision,
                  mode: builtContext.appliedMode,
                  reason: builtContext.fallbackReason ?? decision.reason,
              }
            : decision;

    return {
        settings,
        finalUserContent: buildUserMessageWithContext({
            userText,
            selectedText: selected,
            decision: effectiveDecision,
            documentContext: builtContext.context,
        }),
    };
}

/**
 * Main chat handler used by the UI.
 *
 * Flow:
 * - Ensure session has a system prompt
 * - Ask a cheap routing request which document context mode to use
 * - Build the matching document context from the open PDF
 * - Call provider API with ephemeral per-request context
 * - Append only the plain user message to session history
 * - Append assistant reply
 */
export async function handleChatSend(req: ChatRequest): Promise<ChatResult> {
    return handlePreparedChatSend(req);
}

export async function handlePreparedChatSend(
    req: ChatRequest,
    preparedRequest?: PreparedChatRequest,
): Promise<ChatResult> {
    const { sessionId, provider, userText } = req;
    const resolvedRequest = preparedRequest ?? (await prepareChatRequest(req));
    const { settings, finalUserContent } = resolvedRequest;

    // Initialize with sys system prompt exactly once per session
    const session = getSession(sessionId);
    if (session.length === 0) {
        appendMessage(sessionId, {
            role: "system",
            content: settings.systemPrompt,
        });
    }

    const requestMessages = [
        ...getSession(sessionId),
        { role: "user", content: finalUserContent },
    ] as ChatMessage[];

    const assistantText = await sendChatCompletions({
        provider,
        apiKey: settings.apiKey,
        model: settings.model,
        messages: requestMessages,
        temperature: settings.temperature,
    });

    appendMessage(sessionId, { role: "user", content: userText });
    appendMessage(sessionId, { role: "assistant", content: assistantText });

    return { assistantText };
}