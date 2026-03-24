export type ZToolkitLike = {
  getGlobal(name: string): unknown;
  log(...args: unknown[]): void;
};

export type PdfPageText = {
  pageNumber: number;
  text: string;
};

interface ZoteroItemLike {
  id: number;
  attachmentText?: Promise<unknown> | unknown;
}

interface ZoteroReaderLike {
  itemID?: number | null;
  _item?: { id?: number | null };
  _iframeWindow?: ReaderWindowLike;
  _internalReader?: {
    _iframeWindow?: ReaderWindowLike;
    _window?: ReaderWindowLike;
  };
  iframeWindow?: ReaderWindowLike;
}

interface ReaderWindowLike {
  wrappedJSObject?: ReaderWindowLike;
  PDFViewerApplication?: PdfViewerApplicationLike;
}

interface WrappedObjectLike<T = unknown> {
  wrappedJSObject?: T;
}

interface PdfViewerApplicationLike {
  initializedPromise?: Promise<unknown>;
  pdfDocument?: PdfDocumentLike | null;
  pageLabelToPageNumber?: (label: string) => number;
  pdfViewer?: {
    pdfDocument?: PdfDocumentLike | null;
    currentPageNumber?: number | null;
    _currentPageNumber?: number | null;
    currentPageLabel?: string | null;
    pageLabelToPageNumber?: (label: string) => number;
  };
}

interface PdfDocumentLike {
  numPages?: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

interface PdfPageLike {
  getTextContent(): Promise<{ items?: Array<{ str?: string; hasEOL?: boolean }> }>;
  cleanup?(): void;
}

interface PdfPageLikePartial {
  getTextContent?: unknown;
  cleanup?: unknown;
}

interface RecognizerPageObjectLike {
  str?: string;
  text?: string;
  content?: string;
  extractedText?: string;
  words?: unknown[];
}

interface ZoteroGlobalLike {
  Reader?: {
    getByTabID?(tabId: unknown): ZoteroReaderLike | null;
  };
  Items?: {
    getAsync?(itemID: number): Promise<ZoteroItemLike | null>;
  };
  PDFWorker?: {
    getRecognizerData?(
      itemID: number,
      includeText: boolean,
    ): Promise<{ pages?: unknown[] } | undefined>;
    getFullText?(
      itemID: number,
      unused: unknown,
      includeText: boolean,
    ): Promise<{ text?: unknown } | undefined>;
  };
}

function getZoteroGlobal(): ZoteroGlobalLike {
  return ((globalThis as { Zotero?: ZoteroGlobalLike }).Zotero ?? {}) as ZoteroGlobalLike;
}

function getActiveReader(ztoolkit: ZToolkitLike): ZoteroReaderLike | null {
  const zoteroTabs = ztoolkit.getGlobal("Zotero_Tabs") as
    | { selectedID?: unknown }
    | undefined;
  return getZoteroGlobal().Reader?.getByTabID?.(zoteroTabs?.selectedID) ?? null;
}

function getReaderWindow(reader: ZoteroReaderLike | null): ReaderWindowLike | null {
  if (!reader) {
    return null;
  }

  return (
    reader._iframeWindow ??
    reader._internalReader?._iframeWindow ??
    reader._internalReader?._window ??
    reader.iframeWindow ??
    null
  );
}

function getPdfViewerApplication(
  reader: ZoteroReaderLike | null,
): PdfViewerApplicationLike | null {
  const readerWindow = getReaderWindow(reader);
  const wrappedWindow = unwrapRuntimeObject(readerWindow);
  return wrappedWindow?.PDFViewerApplication ?? null;
}

function unwrapRuntimeObject<T>(value: T | null | undefined): T | null {
  if (!value || typeof value !== "object") {
    return value ?? null;
  }

  return ((value as WrappedObjectLike<T>).wrappedJSObject ?? value) as T;
}

async function getOpenPdfDocument(
  ztoolkit: ZToolkitLike,
): Promise<PdfDocumentLike | null> {
  const reader = getActiveReader(ztoolkit);
  if (!reader) {
    ztoolkit.log("[getOpenPdfDocument] No active reader found");
    return null;
  }

  const pdfApplication = getPdfViewerApplication(reader);
  if (pdfApplication?.initializedPromise) {
    await pdfApplication.initializedPromise;
  }

  return unwrapRuntimeObject(
    pdfApplication?.pdfDocument ?? pdfApplication?.pdfViewer?.pdfDocument ?? null,
  );
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function normalizePositiveIntegerString(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveCurrentPageFromLabel(
  pdfApplication: PdfViewerApplicationLike | null,
): number | null {
  const currentPageLabel = normalizeText(pdfApplication?.pdfViewer?.currentPageLabel);
  if (!currentPageLabel) {
    return null;
  }

  const pageLabelToPageNumber =
    pdfApplication?.pdfViewer?.pageLabelToPageNumber ??
    pdfApplication?.pageLabelToPageNumber;
  if (typeof pageLabelToPageNumber === "function") {
    const resolvedPageNumber = pageLabelToPageNumber(currentPageLabel);
    const normalizedPageNumber = normalizePositiveNumber(resolvedPageNumber);
    if (normalizedPageNumber) {
      return normalizedPageNumber;
    }
  }

  return normalizePositiveIntegerString(currentPageLabel);
}

function extractLooseText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const textLikeObject = value as RecognizerPageObjectLike;
  return (
    normalizeText(textLikeObject.str) ||
    normalizeText(textLikeObject.text) ||
    normalizeText(textLikeObject.content) ||
    normalizeText(textLikeObject.extractedText)
  );
}

function collectNestedText(values: unknown[]): string {
  const parts: string[] = [];

  for (const value of values) {
    if (Array.isArray(value)) {
      const nestedText = collectNestedText(value);
      if (nestedText) {
        parts.push(nestedText);
      }
      continue;
    }

    const text = extractLooseText(value);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join(" ").trim();
}

function isPdfPageLike(pdfPage: unknown): pdfPage is PdfPageLike {
  const resolvedPage = unwrapRuntimeObject(pdfPage);
  return (
    !!resolvedPage &&
    typeof resolvedPage === "object" &&
    typeof (resolvedPage as PdfPageLikePartial).getTextContent === "function"
  );
}

function describeObjectKeys(value: unknown): string {
  if (!value || typeof value !== "object") {
    return typeof value;
  }

  const keys = Object.keys(value);
  return keys.length ? keys.join(", ") : "<no enumerable keys>";
}

async function extractPdfPageText(
  pdfPage: unknown,
  ztoolkit?: ZToolkitLike,
): Promise<string> {
  const resolvedPage = unwrapRuntimeObject(pdfPage);

  if (!isPdfPageLike(resolvedPage)) {
    ztoolkit?.log(
      `[extractPdfPageText] Page object does not expose getTextContent; keys: ${describeObjectKeys(resolvedPage)}`,
    );
    return "";
  }

  try {
    const textContent = await resolvedPage.getTextContent();
    return (textContent.items ?? [])
      .map((item) => {
        if (!item?.str) {
          return item?.hasEOL ? "\n" : "";
        }
        return item.hasEOL ? `${item.str}\n` : item.str;
      })
      .join("")
      .trim();
  } finally {
    if (typeof resolvedPage.cleanup === "function") {
      resolvedPage.cleanup();
    }
  }
}

function getReaderItemId(reader: ZoteroReaderLike | null): number | null {
  const itemId = reader?.itemID ?? reader?._item?.id ?? null;
  return typeof itemId === "number" && itemId > 0 ? itemId : null;
}

async function getOpenPdfAttachment(
  reader: ZoteroReaderLike | null,
): Promise<ZoteroItemLike | null> {
  const itemID = getReaderItemId(reader);
  if (!itemID) {
    return null;
  }

  return (await getZoteroGlobal().Items?.getAsync?.(itemID)) ?? null;
}

function getRecognizerPageText(page: unknown): string {
  if (typeof page === "string") {
    return page.trim();
  }

  if (Array.isArray(page)) {
    const directText = page
      .slice(2)
      .map((value) => extractLooseText(value))
      .find(Boolean);
    if (directText) {
      return directText;
    }

    return collectNestedText(page);
  }

  if (!page || typeof page !== "object") {
    return "";
  }

  const recognizerPage = page as RecognizerPageObjectLike;
  const directText =
    normalizeText(recognizerPage.text) ||
    normalizeText(recognizerPage.content) ||
    normalizeText(recognizerPage.extractedText);
  if (directText) {
    return directText;
  }

  return Array.isArray(recognizerPage.words)
    ? collectNestedText(recognizerPage.words)
    : "";
}

function hasNonEmptyPageText(pages: PdfPageText[]): boolean {
  return pages.some((page) => page.text.trim().length > 0);
}

async function extractAllPdfPageTexts(
  pdfDocument: PdfDocumentLike,
): Promise<PdfPageText[]> {
  const pageCount = Number(pdfDocument.numPages ?? 0);
  const pages: PdfPageText[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const pdfPage = unwrapRuntimeObject(await pdfDocument.getPage(pageNumber));
    pages.push({
      pageNumber,
      text: await extractPdfPageText(pdfPage),
    });
  }

  return pages;
}

async function getOpenPdfRecognizerPageTexts(
  ztoolkit: ZToolkitLike,
): Promise<PdfPageText[]> {
  try {
    const reader = getActiveReader(ztoolkit);
    if (!reader) {
      return [];
    }

    const attachment = await getOpenPdfAttachment(reader);
    if (!attachment) {
      return [];
    }

    const recognizerData = await getZoteroGlobal().PDFWorker?.getRecognizerData?.(
      attachment.id,
      true,
    );
    const recognizerPages = Array.isArray(recognizerData?.pages)
      ? recognizerData.pages
      : [];

    return recognizerPages.map((page, index) => ({
      pageNumber: index + 1,
      text: getRecognizerPageText(page),
    }));
  } catch (error) {
    ztoolkit.log(`[getOpenPdfRecognizerPageTexts] Failed: ${String(error)}`);
    return [];
  }
}

export async function extractOpenPdfText(ztoolkit: ZToolkitLike): Promise<string> {
  try {
    const reader = getActiveReader(ztoolkit);
    if (!reader) {
      ztoolkit.log("[extractOpenPdfText] No active reader found");
      return "";
    }

    const attachment = await getOpenPdfAttachment(reader);
    if (!attachment) {
      ztoolkit.log("[extractOpenPdfText] No active PDF attachment found");
      return "";
    }

    const cachedText = normalizeText(await attachment.attachmentText);
    if (cachedText) {
      ztoolkit.log(
        `[extractOpenPdfText] Extracted ${cachedText.length} characters from attachmentText`,
      );
      return cachedText;
    }

    const result = await getZoteroGlobal().PDFWorker?.getFullText?.(
      attachment.id,
      null,
      true,
    );
    const workerText = normalizeText(result?.text);

    ztoolkit.log(
      `[extractOpenPdfText] Extracted ${workerText.length} characters from PDFWorker`,
    );
    return workerText;
  } catch (error) {
    ztoolkit.log(`[extractOpenPdfText] Failed: ${String(error)}`);
    return "";
  }
}

export function getCurrentOpenPdfPage(ztoolkit: ZToolkitLike): number | null {
  const pdfApplication = getPdfViewerApplication(getActiveReader(ztoolkit));
  const labelPageNumber = resolveCurrentPageFromLabel(pdfApplication);
  if (labelPageNumber) {
    return labelPageNumber;
  }

  const currentPageNumber = normalizePositiveNumber(
    pdfApplication?.pdfViewer?.currentPageNumber,
  );
  if (currentPageNumber) {
    return currentPageNumber;
  }

  return normalizePositiveNumber(pdfApplication?.pdfViewer?._currentPageNumber);
}

export async function getOpenPdfPageCount(ztoolkit: ZToolkitLike): Promise<number> {
  try {
    const pdfDocument = await getOpenPdfDocument(ztoolkit);
    const pageCount = Number(pdfDocument?.numPages ?? 0);
    if (pageCount > 0) {
      return pageCount;
    }

    const recognizerPages = await getOpenPdfRecognizerPageTexts(ztoolkit);
    return recognizerPages.length;
  } catch (error) {
    ztoolkit.log(`[getOpenPdfPageCount] Failed: ${String(error)}`);
    return 0;
  }
}

export async function extractOpenPdfPageText(
  ztoolkit: ZToolkitLike,
  pageNumber: number,
): Promise<string> {
  try {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      ztoolkit.log(
        `[extractOpenPdfPageText] Invalid page number: ${pageNumber}`,
      );
      return "";
    }

    const pdfDocument = await getOpenPdfDocument(ztoolkit);
    if (pdfDocument) {
      const pdfPage = unwrapRuntimeObject(await pdfDocument.getPage(pageNumber));
      const pageText = await extractPdfPageText(pdfPage, ztoolkit);
      ztoolkit.log(
        `[extractOpenPdfPageText] Page ${pageNumber} PDF.js text:\n${pageText}`,
      );
      if (pageText) {
        return pageText;
      }
    }

    const recognizerPageText = (
      await getOpenPdfRecognizerPageTexts(ztoolkit)
    ).find((page) => page.pageNumber === pageNumber)?.text;

    if (recognizerPageText) {
      ztoolkit.log(
        `[extractOpenPdfPageText] Used recognizer fallback for page ${pageNumber}`,
      );
      return recognizerPageText;
    }

    if (!pdfDocument) {
      ztoolkit.log(
        "[extractOpenPdfPageText] PDF document is not available yet",
      );
    } else {
      ztoolkit.log(
        `[extractOpenPdfPageText] No text found for page ${pageNumber}`,
      );
    }

    return "";
  } catch (error) {
    ztoolkit.log(`[extractOpenPdfPageText] Failed: ${String(error)}`);
    return "";
  }
}

export async function extractOpenPdfAllPageTexts(
  ztoolkit: ZToolkitLike,
): Promise<PdfPageText[]> {
  try {
    const pdfDocument = await getOpenPdfDocument(ztoolkit);
    if (pdfDocument) {
      const pdfPages = await extractAllPdfPageTexts(pdfDocument);
      if (hasNonEmptyPageText(pdfPages)) {
        ztoolkit.log(
          `[extractOpenPdfAllPageTexts] Extracted text for ${pdfPages.length} page(s) from PDF.js`,
        );
        return pdfPages;
      }
    }

    const recognizerPages = await getOpenPdfRecognizerPageTexts(ztoolkit);
    if (hasNonEmptyPageText(recognizerPages)) {
      ztoolkit.log(
        `[extractOpenPdfAllPageTexts] Extracted text for ${recognizerPages.length} page(s) from recognizer fallback`,
      );
      return recognizerPages;
    }

    ztoolkit.log("[extractOpenPdfAllPageTexts] No per-page text could be extracted");
    return [];
  } catch (error) {
    ztoolkit.log(`[extractOpenPdfAllPageTexts] Failed: ${String(error)}`);
    return [];
  }
}