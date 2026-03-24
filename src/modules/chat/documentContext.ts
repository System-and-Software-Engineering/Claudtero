import {
  extractOpenPdfAllPageTexts,
  extractOpenPdfPageText,
  extractOpenPdfText,
  getCurrentOpenPdfPage,
  getOpenPdfPageCount,
  type PdfPageText,
  type ZToolkitLike,
} from "../pdf/getPdfText";
import { sendChatCompletions } from "../ai/chatClient";
import type { AIProvider } from "../ai/modelCatalog";

export type ContextMode = "page_window" | "bm25_window" | "whole_document";

const BM25_TOP_PAGE_LIMIT = 6;

export interface ContextModeDecision {
  mode: ContextMode;
  reason: string;
  keywords: string[];
}

export interface BuiltDocumentContext {
  context: string;
  appliedMode: ContextMode | null;
  fallbackReason?: string;
}

interface RouterDecisionPayload {
  mode?: unknown;
  reason?: unknown;
  keywords?: unknown;
}

type ContextBuilder = (options: {
  ztoolkit: ZToolkitLike;
  userText: string;
  keywords: string[];
}) => Promise<string>;

const ROUTER_SYSTEM_PROMPT = `
You decide how much PDF context an academic assistant should send to an LLM.

Return a JSON object only with this schema:
{
  "mode": "page_window" | "bm25_window" | "whole_document",
  "reason": "short explanation",
  "keywords": ["keyword1", "keyword2"]
}

Choose modes like this:
- page_window: the question is about what the user is currently reading locally, nearby explanation, the current page, previous page, next page, a figure/table/equation near the current reading position, or a small local passage.
- bm25_window: the question asks to find where something is discussed, compare occurrences, locate concepts, definitions, methods, terms, sections, authors, datasets, or any keyword/topic-based lookup.
- whole_document: the question asks for global understanding of the whole paper, such as summary, abstracted explanation, main contribution, strengths/weaknesses, structure, methodology overview, or conclusions across the document.

Keep keywords concise, useful for search, and omit stopwords.

Important priority rule:
If the user explicitly refers to the current page, this page, the page they are looking at, nearby text, or a local passage, choose page_window even if the user also asks for a summary.
`;

function isLocalPageRequest(text: string): boolean {
  return /\b(current page|this page|page i(?:'| a)?m on|page i am on|page i'm reading|page i am reading|the page i(?:'| a)?m looking at|the page i am looking at|nearby|local passage|this passage|this paragraph|paragraph on this page|section on this page)\b/.test(
    text.toLowerCase(),
  );
}

function isDocumentLevelRequest(text: string): boolean {
  return /\b(summary|summarize|overview|whole paper|entire paper|main contribution|conclusion|takeaway|overall|big picture)\b/.test(
    text.toLowerCase(),
  );
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function parseJsonObject(text: string): RouterDecisionPayload | null {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenceMatch ? fenceMatch[1] : trimmed;

  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as RouterDecisionPayload)
      : null;
  } catch {
    const objectMatch = candidate.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return null;
    }
    try {
      const parsed = JSON.parse(objectMatch[0]) as unknown;
      return parsed && typeof parsed === "object"
        ? (parsed as RouterDecisionPayload)
        : null;
    } catch {
      return null;
    }
  }
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (token) => token.length > 1,
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function extractKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return unique(
    value
      .map((keyword) => String(keyword ?? "").trim())
      .filter(Boolean),
  ).slice(0, 8);
}

function getFallbackDecision(userText: string): ContextModeDecision {
  const normalized = userText.toLowerCase();
  const keywords = unique(tokenize(userText)).slice(0, 8);

  if (isLocalPageRequest(normalized)) {
    return {
      mode: "page_window",
      reason: "The question explicitly targets the current page or nearby text.",
      keywords,
    };
  }

  if (isDocumentLevelRequest(normalized)) {
    return {
      mode: "whole_document",
      reason: "The question asks for a document-level overview.",
      keywords,
    };
  }

  if (
    /\b(here|paragraph|passage|equation|figure above|figure below|next page|previous page|nearby)\b/.test(
      normalized,
    )
  ) {
    return {
      mode: "page_window",
      reason: "The question appears to be about the local reading context.",
      keywords,
    };
  }

  return {
    mode: "bm25_window",
    reason: "The question looks like a topic lookup in the document.",
    keywords,
  };
}

export async function decideContextMode(options: {
  provider: AIProvider;
  apiKey: string;
  model: string;
  userText: string;
}): Promise<ContextModeDecision> {
  const { provider, apiKey, model, userText } = options;

  try {
    const response = await sendChatCompletions({
      provider,
      apiKey,
      model,
      temperature: 0,
      maxTokens: 120,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: ROUTER_SYSTEM_PROMPT },
        {
          role: "user",
          content: `User question:\n${userText}\n\nReturn JSON only.`,
        },
      ],
    });

    const parsed = parseJsonObject(response);
    const mode = parsed?.mode;
    if (
      mode !== "page_window" &&
      mode !== "bm25_window" &&
      mode !== "whole_document"
    ) {
      return getFallbackDecision(userText);
    }

    if (isLocalPageRequest(userText)) {
      const fallbackKeywords = getFallbackDecision(userText).keywords;
      return {
        mode: "page_window",
        reason:
          "The user explicitly asked about the current page, so local page context overrides broader routing.",
        keywords: extractKeywords(parsed?.keywords).length
          ? extractKeywords(parsed?.keywords)
          : fallbackKeywords,
      };
    }

    const fallbackDecision = getFallbackDecision(userText);
    const parsedKeywords = extractKeywords(parsed?.keywords);

    return {
      mode,
      reason:
        typeof parsed?.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : fallbackDecision.reason,
      keywords: parsedKeywords.length ? parsedKeywords : fallbackDecision.keywords,
    };
  } catch {
    return getFallbackDecision(userText);
  }
}

function buildNeighborPages(centerPages: number[], pageCount: number): number[] {
  const pages = new Set<number>();

  for (const pageNumber of centerPages) {
    for (let offset = -1; offset <= 1; offset += 1) {
      const candidate = pageNumber + offset;
      if (candidate >= 1 && candidate <= pageCount) {
        pages.add(candidate);
      }
    }
  }

  return [...pages].sort((left, right) => left - right);
}

function formatPageContexts(
  pages: PdfPageText[],
  header: string,
): string {
  const sections = pages
    .filter((page) => page.text.trim())
    .map(
      (page) =>
        `Page ${page.pageNumber}\n${normalizeWhitespace(page.text)}`,
    );

  if (!sections.length) {
    return "";
  }

  return `${header}\n\n${sections.join("\n\n---\n\n")}`;
}

function chooseNearestNonEmptyPages(options: {
  pages: PdfPageText[];
  anchorPage: number;
  maxPages?: number;
}): PdfPageText[] {
  const { pages, anchorPage, maxPages = 3 } = options;

  return pages
    .filter((page) => page.text.trim())
    .sort((left, right) => {
      const leftDistance = Math.abs(left.pageNumber - anchorPage);
      const rightDistance = Math.abs(right.pageNumber - anchorPage);
      return leftDistance - rightDistance || left.pageNumber - right.pageNumber;
    })
    .slice(0, maxPages)
    .sort((left, right) => left.pageNumber - right.pageNumber);
}

interface PageStats {
  pageNumber: number;
  text: string;
  tokens: string[];
  frequencies: Map<string, number>;
  length: number;
}

function buildPageStats(
  pages: PdfPageText[],
): PageStats[] {
  return pages.map((page) => {
    const tokens = tokenize(page.text);
    const frequencies = new Map<string, number>();

    for (const token of tokens) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }

    return {
      pageNumber: page.pageNumber,
      text: page.text,
      tokens,
      frequencies,
      length: tokens.length,
    };
  });
}

function computeBm25Matches(
  pages: PdfPageText[],
  query: string,
  keywords: string[],
): number[] {
  const queryTerms = unique(
    [...keywords, ...tokenize(query)].map((term) => term.toLowerCase()),
  );
  const stats = buildPageStats(pages).filter((page) => page.length > 0);

  if (!stats.length || !queryTerms.length) {
    return [];
  }

  const averageDocumentLength =
    stats.reduce((total, page) => total + page.length, 0) / stats.length;
  const documentFrequencies = new Map<string, number>();

  for (const term of queryTerms) {
    let documentCount = 0;
    for (const page of stats) {
      if (page.frequencies.has(term)) {
        documentCount += 1;
      }
    }
    documentFrequencies.set(term, documentCount);
  }

  const k1 = 1.5;
  const b = 0.75;
  const scoredPages = stats
    .map((page) => {
      let score = 0;

      for (const term of queryTerms) {
        const termFrequency = page.frequencies.get(term) ?? 0;
        if (!termFrequency) {
          continue;
        }

        const documentFrequency = documentFrequencies.get(term) ?? 0;
        const inverseDocumentFrequency = Math.log(
          1 +
            (stats.length - documentFrequency + 0.5) /
              (documentFrequency + 0.5),
        );
        const normalizedLength =
          1 - b + (b * page.length) / Math.max(averageDocumentLength, 1);

        score +=
          inverseDocumentFrequency *
          ((termFrequency * (k1 + 1)) /
            (termFrequency + k1 * normalizedLength));
      }

      return {
        pageNumber: page.pageNumber,
        score,
      };
    })
    .filter((page) => page.score > 0)
    .sort((left, right) => right.score - left.score || left.pageNumber - right.pageNumber);

  return scoredPages.map((page) => page.pageNumber);
}

function buildPageWindowHeader(pageNumber: number): string {
  return `Document context mode: page_window (current page ${pageNumber} with neighbors)`;
}

function buildBestEffortHeader(pageNumber: number): string {
  return `Document context mode: page_window (best-effort nearest non-empty pages around ${pageNumber})`;
}

function buildSinglePageHeader(pageNumber: number): string {
  return `Document context mode: page_window (selected text source page ${pageNumber})`;
}

async function buildPageWindowContext(ztoolkit: ZToolkitLike): Promise<string> {
  const currentPage = getCurrentOpenPdfPage(ztoolkit);
  const pageCount = await getOpenPdfPageCount(ztoolkit);

  if (currentPage && pageCount) {
    const pageNumbers = buildNeighborPages([currentPage], pageCount);
    const pages = await Promise.all(
      pageNumbers.map(async (pageNumber) => ({
        pageNumber,
        text: await extractOpenPdfPageText(ztoolkit, pageNumber),
      })),
    );

    const context = formatPageContexts(
      pages,
      buildPageWindowHeader(currentPage),
    );
    if (context) {
      return context;
    }
  }

  const pages = await extractOpenPdfAllPageTexts(ztoolkit);
  if (!pages.length) {
    return "";
  }

  const fallbackCurrentPage =
    currentPage && currentPage <= pages.length ? currentPage : 1;
  const pageNumbers = buildNeighborPages([fallbackCurrentPage], pages.length);
  const selectedPages = pages.filter((page) => pageNumbers.includes(page.pageNumber));

  const fallbackContext = formatPageContexts(
    selectedPages,
    buildPageWindowHeader(fallbackCurrentPage),
  );
  if (fallbackContext) {
    return fallbackContext;
  }

  const nearestPages = chooseNearestNonEmptyPages({
    pages,
    anchorPage: fallbackCurrentPage,
  });
  const nearestContext = formatPageContexts(
    nearestPages,
    buildBestEffortHeader(fallbackCurrentPage),
  );
  return nearestContext;
}

async function buildBm25WindowContext(
  ztoolkit: ZToolkitLike,
  query: string,
  keywords: string[],
): Promise<string> {
  const extractedPages = await extractOpenPdfAllPageTexts(ztoolkit);
  const pages = extractedPages;
  if (!pages.length) {
    return "";
  }

  const hitPages = computeBm25Matches(pages, query, keywords);
  if (!hitPages.length) {
    return "";
  }

  const topHitPages = hitPages.slice(0, BM25_TOP_PAGE_LIMIT);
  const neighborhoodPages = buildNeighborPages(topHitPages, pages.length);
  const selectedPages = pages.filter((page) => neighborhoodPages.includes(page.pageNumber));
  return formatPageContexts(
    selectedPages,
    `Document context mode: bm25_window (matched pages ${topHitPages.join(", ")})`,
  );
}

async function buildWholeDocumentContext(ztoolkit: ZToolkitLike): Promise<string> {
  const fullText = await extractOpenPdfText(ztoolkit);
  if (fullText) {
    return `Document context mode: whole_document\n\n${fullText}`;
  }

  const pages = await extractOpenPdfAllPageTexts(ztoolkit);
  const pageContext = formatPageContexts(
    pages,
    "Document context mode: whole_document (assembled from per-page extraction)",
  );
  return pageContext;
}

export async function buildSinglePageContext(options: {
  ztoolkit: ZToolkitLike;
  pageNumber: number;
}): Promise<string> {
  const { ztoolkit, pageNumber } = options;

  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return "";
  }

  const directPageText = await extractOpenPdfPageText(ztoolkit, pageNumber);
  const directContext = formatPageContexts(
    [{ pageNumber, text: directPageText }],
    buildSinglePageHeader(pageNumber),
  );
  if (directContext) {
    return directContext;
  }

  const extractedPages = await extractOpenPdfAllPageTexts(ztoolkit);
  const extractedPageText =
    extractedPages.find((page) => page.pageNumber === pageNumber)?.text ?? "";
  const extractedContext = formatPageContexts(
    [{ pageNumber, text: extractedPageText }],
    buildSinglePageHeader(pageNumber),
  );
  return extractedContext;
}

const CONTEXT_BUILDERS: Record<ContextMode, ContextBuilder> = {
  page_window: async ({ ztoolkit }) => buildPageWindowContext(ztoolkit),
  bm25_window: async ({ ztoolkit, userText, keywords }) =>
    buildBm25WindowContext(ztoolkit, userText, keywords),
  whole_document: async ({ ztoolkit }) => buildWholeDocumentContext(ztoolkit),
};

export async function buildDocumentContext(options: {
  ztoolkit: ZToolkitLike;
  decision: ContextModeDecision;
  userText: string;
}): Promise<BuiltDocumentContext> {
  const { ztoolkit, decision, userText } = options;

  const fallbackOrder: ContextMode[] =
    decision.mode === "page_window"
      ? ["page_window", "whole_document"]
      : [
          decision.mode,
          ...(["page_window", "bm25_window", "whole_document"] as ContextMode[]).filter(
            (mode) => mode !== decision.mode,
          ),
        ];

  for (const mode of fallbackOrder) {
    const context = await CONTEXT_BUILDERS[mode]({
      ztoolkit,
      userText,
      keywords: decision.keywords,
    });
    if (context.trim()) {
      return {
        context,
        appliedMode: mode,
        ...(mode !== decision.mode
          ? {
              fallbackReason: `Requested ${decision.mode} but used ${mode} because the requested context extraction returned no text.`,
            }
          : {}),
      };
    }
  }

  return {
    context: "",
    appliedMode: null,
    fallbackReason: `Requested ${decision.mode} but no document context could be extracted.`,
  };
}

export function buildUserMessageWithContext(options: {
  userText: string;
  selectedText: string;
  decision: ContextModeDecision;
  documentContext: string;
}): string {
  const parts: string[] = [];
  const { userText, selectedText, decision, documentContext } = options;

  if (selectedText.trim()) {
    parts.push(`Selected PDF text:\n${selectedText.trim()}`);
  }

  if (documentContext.trim()) {
    parts.push(
      `PDF context routing decision:\n${JSON.stringify(decision, null, 2)}`,
      documentContext.trim(),
    );
  }

  parts.push(`User question:\n${userText.trim()}`);
  return parts.join("\n\n");
}