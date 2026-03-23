function getActiveReader(ztoolkit: any): any | null {
  const ZoteroTabs = ztoolkit.getGlobal("Zotero_Tabs");
  const ZoteroGlobal = (globalThis as any).Zotero;
  const tabId = ZoteroTabs?.selectedID;
  return ZoteroGlobal?.Reader?.getByTabID?.(tabId) ?? null;
}

function getReaderWindow(reader: any): any | null {
  return (
    reader?._iframeWindow ??
    reader?._internalReader?._iframeWindow ??
    reader?._internalReader?._window ??
    reader?.iframeWindow ??
    null
  );
}

async function getOpenPdfDocument(ztoolkit: any): Promise<any | null> {
  const reader = getActiveReader(ztoolkit);

  if (!reader) {
    ztoolkit.log("[getOpenPdfDocument] No active reader found");
    return null;
  }

  const readerWindow = getReaderWindow(reader);
  const wrappedWindow = readerWindow?.wrappedJSObject ?? readerWindow;
  const pdfApplication = wrappedWindow?.PDFViewerApplication;

  if (pdfApplication?.initializedPromise) {
    await pdfApplication.initializedPromise;
  }

  return pdfApplication?.pdfDocument ?? pdfApplication?.pdfViewer?.pdfDocument ?? null;
}

async function extractPdfPageText(pdfPage: any): Promise<string> {
  const textContent = await pdfPage.getTextContent();
  const pageText = textContent.items
    .map((item: any) => {
      if (!item?.str) {
        return item?.hasEOL ? "\n" : "";
      }
      return item.hasEOL ? `${item.str}\n` : item.str;
    })
    .join("")
    .trim();

  if (typeof pdfPage.cleanup === "function") {
    pdfPage.cleanup();
  }

  return pageText;
}

async function getOpenPdfAttachment(reader: any): Promise<any | null> {
  const ZoteroGlobal = (globalThis as any).Zotero;
  const itemID = reader?.itemID ?? reader?._item?.id ?? null;
  if (!itemID) {
    return null;
  }
  return (await ZoteroGlobal?.Items?.getAsync?.(itemID)) ?? null;
}

function getRecognizerPageText(page: any): string {
  if (typeof page === "string") {
    return page.trim();
  }

  if (Array.isArray(page)) {
    const directText = page.find(
      (value, index) => index >= 2 && typeof value === "string" && value.trim(),
    );
    if (typeof directText === "string") {
      return directText.trim();
    }

    const joinedWordText = page
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => {
        if (typeof value === "string") {
          return value;
        }
        if (value && typeof value.str === "string") {
          return value.str;
        }
        if (value && typeof value.text === "string") {
          return value.text;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();

    if (joinedWordText) {
      return joinedWordText;
    }
  }

  if (page && typeof page === "object") {
    const directText = [page.text, page.content, page.extractedText]
      .find((value) => typeof value === "string" && value.trim());
    if (typeof directText === "string") {
      return directText.trim();
    }

    if (Array.isArray(page.words)) {
      const wordText = page.words
        .map((word: any) => {
          if (typeof word === "string") {
            return word;
          }
          if (word && typeof word.str === "string") {
            return word.str;
          }
          if (word && typeof word.text === "string") {
            return word.text;
          }
          return "";
        })
        .filter(Boolean)
        .join(" ")
        .trim();
      if (wordText) {
        return wordText;
      }
    }
  }

  return "";
}

async function getOpenPdfRecognizerPageTexts(
  ztoolkit: any,
): Promise<Array<{ pageNumber: number; text: string }>> {
  try {
    const reader = getActiveReader(ztoolkit);
    if (!reader) {
      return [];
    }

    const attachment = await getOpenPdfAttachment(reader);
    if (!attachment) {
      return [];
    }

    const recognizerData = await (globalThis as any).Zotero?.PDFWorker?.getRecognizerData?.(
      attachment.id,
      true,
    );
    const pages = Array.isArray(recognizerData?.pages) ? recognizerData.pages : [];

    return pages.map((page: any, index: number) => ({
      pageNumber: index + 1,
      text: getRecognizerPageText(page),
    }));
  } catch (error) {
    ztoolkit.log(`[getOpenPdfRecognizerPageTexts] Failed: ${String(error)}`);
    return [];
  }
}

export async function extractOpenPdfText(ztoolkit: any): Promise<string> {
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

    const cachedText = String((await attachment.attachmentText) ?? "").trim();
    if (cachedText) {
      ztoolkit.log(
        `[extractOpenPdfText] Extracted ${cachedText.length} characters from attachmentText`,
      );
      return cachedText;
    }

    const result = await (globalThis as any).Zotero?.PDFWorker?.getFullText?.(
      attachment.id,
      null,
      true,
    );
    const workerText = String(result?.text ?? "").trim();

    ztoolkit.log(
      `[extractOpenPdfText] Extracted ${workerText.length} characters from PDFWorker`,
    );
    return workerText;
  } catch (error) {
    ztoolkit.log(`[extractOpenPdfText] Failed: ${String(error)}`);
    return "";
  }
}

export function getCurrentOpenPdfPage(ztoolkit: any): number | null {
  const reader = getActiveReader(ztoolkit);

  if (!reader) return null;

  const readerWindow = getReaderWindow(reader);

  const wrappedWindow = readerWindow?.wrappedJSObject ?? readerWindow;
  const pdfApplication = wrappedWindow?.PDFViewerApplication;

  return pdfApplication?.pdfViewer?.currentPageNumber ?? null;
}

export async function getOpenPdfPageCount(ztoolkit: any): Promise<number> {
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
  ztoolkit: any,
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
      const pdfPage = await pdfDocument.getPage(pageNumber);
      const pageText = await extractPdfPageText(pdfPage);

      if (pageText) {
        return pageText;
      }
    }

    const recognizerPages = await getOpenPdfRecognizerPageTexts(ztoolkit);
    const recognizerPageText =
      recognizerPages.find((page) => page.pageNumber === pageNumber)?.text ?? "";

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
  ztoolkit: any,
): Promise<Array<{ pageNumber: number; text: string }>> {
  try {
    const pdfDocument = await getOpenPdfDocument(ztoolkit);
    if (pdfDocument) {
      const pageCount = Number(pdfDocument.numPages ?? 0);
      const pages: Array<{ pageNumber: number; text: string }> = [];

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const pdfPage = await pdfDocument.getPage(pageNumber);
        pages.push({
          pageNumber,
          text: await extractPdfPageText(pdfPage),
        });
      }

      if (pages.some((page) => page.text.trim())) {
        ztoolkit.log(
          `[extractOpenPdfAllPageTexts] Extracted text for ${pages.length} page(s) from PDF.js`,
        );
        return pages;
      }
    }

    const recognizerPages = await getOpenPdfRecognizerPageTexts(ztoolkit);
    if (recognizerPages.some((page) => page.text.trim())) {
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