import { config } from "../../package.json";
import type { ZToolkitLike } from "../../src/modules/pdf/getPdfText";

type PluginPrefKey =
  | "localPort"
  | "ollamaModel"
  | "goetheApiKey"
  | "goetheModel";

type ZoteroGlobalShape = {
  Reader?: unknown;
  Items?: unknown;
  PDFWorker?: unknown;
  Prefs?: unknown;
};

export type TestGlobalsSnapshot = {
  Zotero: ZoteroGlobalShape;
  Zotero_Tabs: unknown;
  ztoolkit: unknown;
  fetch: typeof globalThis.fetch | undefined;
};

export type TestContextOptions = {
  currentPage?: number | null;
  internalCurrentPage?: number | null;
  currentPageLabel?: string | null;
  pageLabelMap?: Record<string, number>;
  pageTexts?: string[];
  attachmentText?: string;
  workerText?: string;
  malformedPageNumbers?: number[];
  wrappedPageNumbers?: number[];
  recognizerPages?: unknown[];
  noReader?: boolean;
  noPdfDocument?: boolean;
};

export type RetrievalMetrics = {
  requestedPages: number[];
  fullTextCalls: number;
  recognizerCalls: number;
};

type FetchResponseOptions = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  jsonData?: unknown;
  textData?: string;
};

type PdfDocumentOptions = Pick<
  TestContextOptions,
  "pageTexts" | "malformedPageNumbers" | "wrappedPageNumbers"
>;

function getMutableGlobals(): typeof globalThis & {
  Zotero?: ZoteroGlobalShape;
  Zotero_Tabs?: { selectedID?: unknown };
  ztoolkit?: unknown;
} {
  return globalThis as typeof globalThis & {
    Zotero?: ZoteroGlobalShape;
    Zotero_Tabs?: { selectedID?: unknown };
    ztoolkit?: unknown;
  };
}

function buildTextContentItems(text: string) {
  if (!text) {
    return [];
  }

  return [{ str: text, hasEOL: false }];
}

function createPdfDocument(
  options: PdfDocumentOptions,
  metrics: RetrievalMetrics,
) {
  const pageTexts = options.pageTexts ?? [];
  const malformedPageNumbers = options.malformedPageNumbers ?? [];
  const wrappedPageNumbers = options.wrappedPageNumbers ?? [];

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
          return undefined;
        },
      };

      if (wrappedPageNumbers.includes(pageNumber)) {
        return { wrappedJSObject: page };
      }

      return page;
    },
  };
}

export function snapshotTestGlobals(): TestGlobalsSnapshot {
  const globals = getMutableGlobals();
  const zotero = globals.Zotero ?? {};

  return {
    Zotero: {
      Reader: zotero.Reader,
      Items: zotero.Items,
      PDFWorker: zotero.PDFWorker,
      Prefs: zotero.Prefs,
    },
    Zotero_Tabs: globals.Zotero_Tabs,
    ztoolkit: globals.ztoolkit,
    fetch: globalThis.fetch,
  };
}

export function restoreTestGlobals(snapshot: TestGlobalsSnapshot): void {
  const globals = getMutableGlobals();

  globals.Zotero = {
    ...(globals.Zotero ?? {}),
    Reader: snapshot.Zotero.Reader,
    Items: snapshot.Zotero.Items,
    PDFWorker: snapshot.Zotero.PDFWorker,
    Prefs: snapshot.Zotero.Prefs,
  };
  globals.Zotero_Tabs = snapshot.Zotero_Tabs as
    | { selectedID?: unknown }
    | undefined;
  globals.ztoolkit = snapshot.ztoolkit;

  if (snapshot.fetch) {
    globalThis.fetch = snapshot.fetch;
  }
}

export function createZtoolkitMock(logs: string[] = []): ZToolkitLike {
  return {
    getGlobal(name: string): unknown {
      if (name === "Zotero_Tabs") {
        return getMutableGlobals().Zotero_Tabs ?? { selectedID: "reader-tab" };
      }
      return undefined;
    },
    log(...args: unknown[]): void {
      logs.push(args.map((arg) => String(arg)).join(" "));
    },
  };
}

export function installGlobalZtoolkit(options?: {
  selectedText?: string;
  logs?: string[];
}): ZToolkitLike & {
  Reader: { getSelectedText(): Promise<string> };
} {
  const toolkit = {
    ...createZtoolkitMock(options?.logs),
    Reader: {
      async getSelectedText() {
        return options?.selectedText ?? "";
      },
    },
  };

  getMutableGlobals().ztoolkit = toolkit;
  return toolkit;
}

export function installPrefs(
  initial: Partial<Record<PluginPrefKey, string>> = {},
): Map<string, unknown> {
  const globals = getMutableGlobals();
  const zotero = (globals.Zotero ??= {});
  const store = new Map<string, unknown>();

  for (const [key, value] of Object.entries(initial)) {
    store.set(`${config.prefsPrefix}.${key}`, value);
  }

  zotero.Prefs = {
    get(key: string) {
      return store.get(String(key));
    },
    set(key: string, value: unknown) {
      store.set(String(key), value);
      return true;
    },
    clear(key: string) {
      store.delete(String(key));
      return true;
    },
  };

  return store;
}

export function installPdfContext(options: TestContextOptions): RetrievalMetrics {
  const globals = getMutableGlobals();
  const zotero = (globals.Zotero ??= {});
  globals.Zotero_Tabs = { selectedID: "reader-tab" };

  const metrics: RetrievalMetrics = {
    requestedPages: [],
    fullTextCalls: 0,
    recognizerCalls: 0,
  };

  const pdfDocument = options.noPdfDocument
    ? null
    : createPdfDocument(options, metrics);

  zotero.Reader = {
    getByTabID: (_tabId: unknown) => {
      if (options.noReader) {
        return null;
      }

      return {
        itemID: 1,
        _item: { id: 1 },
        _iframeWindow: {
          wrappedJSObject: {
            PDFViewerApplication: {
              initializedPromise: Promise.resolve(),
              pdfDocument,
              pageLabelToPageNumber(label: string) {
                return options.pageLabelMap?.[label] ?? 1;
              },
              pdfViewer: {
                pdfDocument,
                currentPageNumber:
                  options.currentPage === undefined ? 1 : options.currentPage,
                _currentPageNumber:
                  options.internalCurrentPage ??
                  (options.currentPage === undefined ? 1 : options.currentPage),
                currentPageLabel: options.currentPageLabel ?? null,
                pageLabelToPageNumber(label: string) {
                  return options.pageLabelMap?.[label] ?? 1;
                },
              },
            },
          },
        },
      };
    },
  };

  zotero.Items = {
    getAsync: async (_itemID: number) => ({
      id: 1,
      attachmentText: options.attachmentText ?? "",
    }),
  };

  zotero.PDFWorker = {
    getRecognizerData: async () => {
      metrics.recognizerCalls += 1;
      return { pages: options.recognizerPages ?? [] };
    },
    getFullText: async () => {
      metrics.fullTextCalls += 1;
      return { text: options.workerText ?? "" };
    },
  };

  return metrics;
}

export function createFetchResponse(
  options: FetchResponseOptions = {},
): Response {
  const {
    ok = true,
    status = 200,
    statusText = "OK",
    jsonData = {},
    textData = "",
  } = options;

  return {
    ok,
    status,
    statusText,
    async json() {
      return jsonData;
    },
    async text() {
      return textData;
    },
  } as Response;
}