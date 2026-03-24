import { sendChatCompletions, type ChatMessage } from "../ai/chatClient";
import {
    getModelCatalog,
    type AIProvider,
    type ModelCatalog,
} from "../ai/modelCatalog";
import { getSelectedPdfText } from "../pdf/getSelectedText";
import { getPref } from "../../utils/prefs";
import { appendMessage, getSession } from "./sessionStore";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompt";
import {
    buildDocumentContext,
    buildSinglePageContext,
    buildUserMessageWithContext,
    decideContextMode,
    type ContextModeDecision,
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

function getTrimmedPref(
    key:
        | "localPort"
        | "ollamaModel"
        | "goetheApiKey"
        | "goetheModel",
): string {
    return String(getPref(key) ?? "").trim();
}

function resolveSelectedPageNumber(pageNumber: number | null | undefined): number | null {
    return typeof pageNumber === "number" && pageNumber > 0 ? pageNumber : null;
}

function buildSelectionDecision(): ContextModeDecision {
    return {
        mode: "page_window",
        reason:
            "The user provided highlighted text, so only the source page was sent as context.",
        keywords: [],
    };
}

function applyBuiltContextDecision(
    decision: ContextModeDecision,
    appliedMode: ContextModeDecision["mode"] | null,
    fallbackReason?: string,
): ContextModeDecision {
    if (!appliedMode || appliedMode === decision.mode) {
        return decision;
    }

    return {
        ...decision,
        mode: appliedMode,
        reason: fallbackReason ?? decision.reason,
    };
}

function ensureSessionSystemPrompt(sessionId: string, systemPrompt: string) {
    if (getSession(sessionId).length === 0) {
        appendMessage(sessionId, {
            role: "system",
            content: systemPrompt,
        });
    }
}

function buildRequestMessages(sessionId: string, userContent: string): ChatMessage[] {
    return [...getSession(sessionId), { role: "user", content: userContent }];
}

function resolveProviderSettings(
    provider: AIProvider,
    requestedModel: string,
): ResolvedProviderSettings {
    const requestedModelId = requestedModel.trim();

    switch (provider) {
        case "ollama":
            return {
                apiKey: "",
                model: requestedModelId || getTrimmedPref("ollamaModel"),
                temperature: 0.2,
                systemPrompt: DEFAULT_SYSTEM_PROMPT,
            };
        case "goethe":
            return {
                apiKey: getTrimmedPref("goetheApiKey"),
                model: requestedModelId || getTrimmedPref("goetheModel"),
                temperature: 0.2,
                systemPrompt: DEFAULT_SYSTEM_PROMPT,
            };
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
    const selectedText = (req.selectedText ?? (await getSelectedPdfText())).trim();

    if (selectedText) {
        const selectedPageNumber = resolveSelectedPageNumber(req.selectedPageNumber);
        const decision = buildSelectionDecision();
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
                selectedText,
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

    return {
        settings,
        finalUserContent: buildUserMessageWithContext({
            userText,
            selectedText,
            decision: applyBuiltContextDecision(
                decision,
                builtContext.appliedMode,
                builtContext.fallbackReason,
            ),
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

  ensureSessionSystemPrompt(sessionId, settings.systemPrompt);

  const assistantText = await sendChatCompletions({
    provider,
    apiKey: settings.apiKey,
    model: settings.model,
    messages: buildRequestMessages(sessionId, finalUserContent),
    temperature: settings.temperature,
  });

  appendMessage(sessionId, { role: "user", content: userText });
  appendMessage(sessionId, { role: "assistant", content: assistantText });

  return { assistantText };
}