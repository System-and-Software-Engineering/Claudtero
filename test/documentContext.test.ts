import { assert } from "chai";
import {
  buildDocumentContext,
  buildSinglePageContext,
  type ContextModeDecision,
} from "../src/modules/chat/documentContext";
import {
  getCurrentOpenPdfPage,
  type ZToolkitLike,
} from "../src/modules/pdf/getPdfText";

type ZoteroGlobalSnapshot = {
  Reader: unknown;
  Items: unknown;
  PDFWorker: unknown;
};

type TestContextOptions = {
  currentPage?: number;
  pageTexts?: string[];
  attachmentText?: string;
  malformedPageNumbers?: number[];
  wrappedPageNumbers?: number[];
};

type RetrievalMetrics = {
  requestedPages: number[];
  fullTextCalls: number;
  recognizerCalls: number;
};

function createZtoolkitMock(): ZToolkitLike {
  return {
    getGlobal(name: string): unknown {
      if (name === "Zotero_Tabs") {
        return { selectedID: "reader-tab" };
      }
      return undefined;
    },
    log(): void {
      // Ignore logs in unit tests.
    },
  };
}

function buildTextContentItems(text: string) {
  if (!text) {
    return [];
  }

  return [{ str: text, hasEOL: false }];
}

function createPdfDocument(pageTexts: string[], metrics: RetrievalMetrics) {
  return createPdfDocumentWithOptions(pageTexts, metrics, []);
}

function createPdfDocumentWithOptions(
  pageTexts: string[],
  metrics: RetrievalMetrics,
  malformedPageNumbers: number[],
  wrappedPageNumbers: number[] = [],
) {
  return {
    numPages: pageTexts.length,
    async getPage(pageNumber: number) {
      metrics.requestedPages.push(pageNumber);
      if (malformedPageNumbers.includes(pageNumber)) {
        return {};
      }

      const text = pageTexts[pageNumber - 1] ?? "";
      const page = {
        async getTextContent() {
          return {
            items: buildTextContentItems(text),
          };
        },
        cleanup() {
          // No-op in tests.
        },
      };

      if (wrappedPageNumbers.includes(pageNumber)) {
        return { wrappedJSObject: page };
      }

      return page;
    },
  };
}

function installPdfContext(options: TestContextOptions): RetrievalMetrics {
  const metrics: RetrievalMetrics = {
    requestedPages: [],
    fullTextCalls: 0,
    recognizerCalls: 0,
  };

  const zoteroGlobal = globalThis.Zotero as {
    Reader?: { getByTabID?: (tabId: unknown) => unknown };
    Items?: { getAsync?: (itemID: number) => Promise<unknown> };
    PDFWorker?: {
      getRecognizerData?: (itemID: number, includeText: boolean) => Promise<unknown>;
      getFullText?: (
        itemID: number,
        unused: unknown,
        includeText: boolean,
      ) => Promise<unknown>;
    };
  };

  const pdfDocument = options.pageTexts
    ? createPdfDocumentWithOptions(
        options.pageTexts,
        metrics,
        options.malformedPageNumbers ?? [],
        options.wrappedPageNumbers ?? [],
      )
    : null;

  zoteroGlobal.Reader = {
    getByTabID: (_tabId: unknown) => ({
      itemID: 1,
      _iframeWindow: {
        wrappedJSObject: {
          PDFViewerApplication: {
            initializedPromise: Promise.resolve(),
            pdfDocument,
            pdfViewer: {
              pdfDocument,
              currentPageNumber: options.currentPage ?? 1,
            },
          },
        },
      },
    }),
  };

  zoteroGlobal.Items = {
    getAsync: async (_itemID: number) => ({
      id: 1,
      attachmentText: options.attachmentText ?? "",
    }),
  };

  zoteroGlobal.PDFWorker = {
    getRecognizerData: async () => {
      metrics.recognizerCalls += 1;
      return { pages: [] };
    },
    getFullText: async () => {
      metrics.fullTextCalls += 1;
      return { text: options.attachmentText ?? "" };
    },
  };

  return metrics;
}

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
  let snapshot: ZoteroGlobalSnapshot;

  beforeEach(function () {
    const zoteroGlobal = globalThis.Zotero as {
      Reader?: unknown;
      Items?: unknown;
      PDFWorker?: unknown;
    };

    snapshot = {
      Reader: zoteroGlobal.Reader,
      Items: zoteroGlobal.Items,
      PDFWorker: zoteroGlobal.PDFWorker,
    };
  });

  afterEach(function () {
    const zoteroGlobal = globalThis.Zotero as {
      Reader?: unknown;
      Items?: unknown;
      PDFWorker?: unknown;
    };

    zoteroGlobal.Reader = snapshot.Reader;
    zoteroGlobal.Items = snapshot.Items;
    zoteroGlobal.PDFWorker = snapshot.PDFWorker;
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

  it("does not approximate selected-page context from whole-document text", async function () {
    const metrics = installPdfContext({
      currentPage: 2,
      pageTexts: ["", "", ""],
      attachmentText: "Whole-document text that must not be reused as page 2.",
    });

    const context = await buildSinglePageContext({
      ztoolkit: createZtoolkitMock(),
      pageNumber: 2,
    });

    assert.strictEqual(context, "");
    assert.deepEqual(metrics.requestedPages, [2, 1, 2, 3]);
    assert.strictEqual(metrics.fullTextCalls, 0);
  });

  it("falls back cleanly when a page object lacks getTextContent", async function () {
    const metrics = installPdfContext({
      currentPage: 1,
      pageTexts: ["", "Recognized page 2 text", ""],
      malformedPageNumbers: [2],
    });

    const zoteroGlobal = globalThis.Zotero as {
      PDFWorker?: {
        getRecognizerData?: (itemID: number, includeText: boolean) => Promise<unknown>;
      };
    };

    zoteroGlobal.PDFWorker = {
      getRecognizerData: async () => {
        metrics.recognizerCalls += 1;
        return {
          pages: [
            { text: "" },
            { text: "Recognizer fallback text for page 2." },
            { text: "" },
          ],
        };
      },
    };

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
    const zoteroGlobal = globalThis.Zotero as {
      Reader?: { getByTabID?: (tabId: unknown) => unknown };
    };

    zoteroGlobal.Reader = {
      getByTabID: (_tabId: unknown) => ({
        _iframeWindow: {
          wrappedJSObject: {
            PDFViewerApplication: {
              pdfViewer: {
                currentPageNumber: 1,
                currentPageLabel: "8",
                pageLabelToPageNumber(label: string) {
                  return label === "8" ? 5 : 1;
                },
              },
            },
          },
        },
      }),
    };

    const currentPage = getCurrentOpenPdfPage(createZtoolkitMock());
    assert.strictEqual(currentPage, 5);
  });

  it("falls back to the internal current page number when needed", function () {
    const zoteroGlobal = globalThis.Zotero as {
      Reader?: { getByTabID?: (tabId: unknown) => unknown };
    };

    zoteroGlobal.Reader = {
      getByTabID: (_tabId: unknown) => ({
        _iframeWindow: {
          wrappedJSObject: {
            PDFViewerApplication: {
              pdfViewer: {
                currentPageNumber: null,
                _currentPageNumber: 4,
              },
            },
          },
        },
      }),
    };

    const currentPage = getCurrentOpenPdfPage(createZtoolkitMock());
    assert.strictEqual(currentPage, 4);
  });
});