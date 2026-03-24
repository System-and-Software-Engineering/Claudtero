import { assert } from "chai";
import {
  buildDocumentContext,
  buildSinglePageContext,
  decideContextMode,
  type ContextModeDecision,
} from "../src/modules/chat/documentContext";
import { getCurrentOpenPdfPage } from "../src/modules/pdf/getPdfText";
import {
  createFetchResponse,
  createZtoolkitMock,
  installPdfContext,
  restoreTestGlobals,
  snapshotTestGlobals,
  type TestContextOptions,
  type TestGlobalsSnapshot,
} from "./helpers/testSupport";

async function buildContext(
  decision: ContextModeDecision,
  contextOptions: TestContextOptions,
  userText = "Test query",
) {
  const metrics = installPdfContext(contextOptions);
  const result = await buildDocumentContext({
    ztoolkit: createZtoolkitMock(),
    decision,
    userText,
  });

  return {
    result,
    metrics,
  };
}

describe("document context retrieval", function () {
  let snapshot: TestGlobalsSnapshot;

  beforeEach(function () {
    snapshot = snapshotTestGlobals();
  });

  afterEach(function () {
    restoreTestGlobals(snapshot);
  });

  it("retrieves the current page window with neighboring pages", async function () {
    const { result, metrics } = await buildContext(
      {
        mode: "page_window",
        reason: "Local reading context",
        keywords: [],
      },
      {
        currentPage: 2,
        pageTexts: [
          "Introduction and setup.",
          "Methods described on the current page.",
          "Results discussed on the next page.",
        ],
      },
    );

    assert.strictEqual(result.appliedMode, "page_window");
    assert.include(
      result.context,
      "Document context mode: page_window (current page 2 with neighbors)",
    );
    assert.isUndefined(result.fallbackReason);
    assert.deepEqual(metrics.requestedPages, [1, 2, 3]);
    assert.strictEqual(metrics.fullTextCalls, 0);
    assert.strictEqual(metrics.recognizerCalls, 0);
    assert.include(result.context, "Page 1\nIntroduction and setup.");
    assert.include(
      result.context,
      "Page 2\nMethods described on the current page.",
    );
    assert.include(result.context, "Page 3\nResults discussed on the next page.");
  });

  it("retrieves BM25-matched pages with their neighborhood", async function () {
    const { result } = await buildContext(
      {
        mode: "bm25_window",
        reason: "Keyword lookup",
        keywords: ["transformer", "attention"],
      },
      {
        currentPage: 1,
        pageTexts: [
          "Background material with no target term.",
          "Experimental setup and dataset details.",
          "Transformer attention transformer layers are analyzed here.",
          "Ablation results and discussion.",
        ],
      },
      "Where is transformer attention discussed?",
    );

    assert.strictEqual(result.appliedMode, "bm25_window");
    assert.include(
      result.context,
      "Document context mode: bm25_window (matched pages 3)",
    );
    assert.notInclude(result.context, "Page 1\nBackground material with no target term.");
    assert.include(result.context, "Page 2\nExperimental setup and dataset details.");
    assert.include(
      result.context,
      "Page 3\nTransformer attention transformer layers are analyzed here.",
    );
    assert.include(result.context, "Page 4\nAblation results and discussion.");
  });

  it("retrieves the whole document from full-text extraction", async function () {
    const { result, metrics } = await buildContext(
      {
        mode: "whole_document",
        reason: "Document-level overview",
        keywords: ["summary"],
      },
      {
        attachmentText:
          "Full paper text covering introduction, methods, results, and conclusion.",
      },
      "Summarize the paper.",
    );

    assert.strictEqual(result.appliedMode, "whole_document");
    assert.deepEqual(metrics.requestedPages, []);
    assert.strictEqual(metrics.fullTextCalls, 0);
    assert.strictEqual(metrics.recognizerCalls, 0);
    assert.strictEqual(
      result.context,
      "Document context mode: whole_document\n\nFull paper text covering introduction, methods, results, and conclusion.",
    );
  });

  it("falls back from empty page-window extraction to whole-document context", async function () {
    const { result } = await buildContext(
      {
        mode: "page_window",
        reason: "Current-page question",
        keywords: [],
      },
      {
        currentPage: 2,
        pageTexts: ["", "", ""],
        attachmentText:
          "Whole paper text covering introduction, methods, and results.",
      },
      "Explain this page.",
    );

    assert.strictEqual(result.appliedMode, "whole_document");
    assert.include(
      result.fallbackReason ?? "",
      "Requested page_window but used whole_document",
    );
    assert.include(
      result.context,
      "Whole paper text covering introduction, methods, and results.",
    );
  });

  it("falls back cleanly when a page object lacks getTextContent", async function () {
    const metrics = installPdfContext({
      currentPage: 1,
      pageTexts: ["", "Recognized page 2 text", ""],
      malformedPageNumbers: [2],
      recognizerPages: [
        { text: "" },
        { text: "Recognizer fallback text for page 2." },
        { text: "" },
      ],
    });

    const context = await buildSinglePageContext({
      ztoolkit: createZtoolkitMock(),
      pageNumber: 2,
    });

    assert.include(context, "Page 2\nRecognizer fallback text for page 2.");
    assert.strictEqual(metrics.recognizerCalls, 1);
    assert.deepEqual(metrics.requestedPages, [2]);
  });

  it("extracts text from wrapped PDF page objects", async function () {
    const metrics = installPdfContext({
      currentPage: 2,
      pageTexts: ["Page 1", "Wrapped page 2 text", "Page 3"],
      wrappedPageNumbers: [2],
    });

    const context = await buildSinglePageContext({
      ztoolkit: createZtoolkitMock(),
      pageNumber: 2,
    });

    assert.include(context, "Page 2\nWrapped page 2 text");
    assert.strictEqual(metrics.recognizerCalls, 0);
    assert.deepEqual(metrics.requestedPages, [2]);
  });

  it("resolves the current page from the current page label", function () {
    installPdfContext({
      currentPage: 1,
      currentPageLabel: "8",
      pageLabelMap: { "8": 5 },
      pageTexts: ["i", "ii", "1", "2", "3"],
    });

    const currentPage = getCurrentOpenPdfPage(createZtoolkitMock());
    assert.strictEqual(currentPage, 5);
  });

  it("falls back to the internal current page number when needed", function () {
    installPdfContext({
      currentPage: null,
      internalCurrentPage: 4,
      pageTexts: ["Page 1", "Page 2", "Page 3", "Page 4"],
    });

    const currentPage = getCurrentOpenPdfPage(createZtoolkitMock());
    assert.strictEqual(currentPage, 4);
  });

  it("uses heuristic fallback when the routing model returns invalid JSON", async function () {
    globalThis.fetch = async () =>
      createFetchResponse({
        jsonData: {
          choices: [{ message: { content: "not valid json" } }],
        },
      });

    const decision = await decideContextMode({
      provider: "goethe",
      apiKey: "secret",
      model: "router-model",
      userText: "Summarize the paper.",
    });

    assert.deepEqual(decision, {
      mode: "whole_document",
      reason: "The question asks for a document-level overview.",
      keywords: ["summarize", "the", "paper"],
    });
  });

  it("overrides router output when the user explicitly asks about the current page", async function () {
    globalThis.fetch = async () =>
      createFetchResponse({
        jsonData: {
          choices: [
            {
              message: {
                content:
                  '{"mode":"whole_document","reason":"summary","keywords":["summary"]}',
              },
            },
          ],
        },
      });

    const decision = await decideContextMode({
      provider: "goethe",
      apiKey: "secret",
      model: "router-model",
      userText: "Summarize this page for me.",
    });

    assert.strictEqual(decision.mode, "page_window");
    assert.include(decision.reason, "explicitly asked about the current page");
  });

  it("falls back to BM25 lookup when the router call fails for a search-style query", async function () {
    globalThis.fetch = async () => {
      throw new Error("router unavailable");
    };

    const decision = await decideContextMode({
      provider: "goethe",
      apiKey: "secret",
      model: "router-model",
      userText: "Where is transformer attention discussed?",
    });

    assert.strictEqual(decision.mode, "bm25_window");
    assert.include(decision.reason, "topic lookup");
    assert.include(decision.keywords, "transformer");
  });
});