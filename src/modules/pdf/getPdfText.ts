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

async function getOpenPdfAttachment(reader: any): Promise<any | null> {
  const ZoteroGlobal = (globalThis as any).Zotero;
  const itemID = reader?.itemID ?? reader?._item?.id ?? null;
  if (!itemID) {
    return null;
  }
  return (await ZoteroGlobal?.Items?.getAsync?.(itemID)) ?? null;
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

    const reader = getActiveReader(ztoolkit);

    if (!reader) {
      ztoolkit.log("[extractOpenPdfPageText] No active reader found");
      return "";
    }

    const readerWindow = getReaderWindow(reader);

    const wrappedWindow = readerWindow?.wrappedJSObject ?? readerWindow;
    const pdfApplication = wrappedWindow?.PDFViewerApplication;

    if (pdfApplication?.initializedPromise) {
      await pdfApplication.initializedPromise;
    }

    const pdfDocument =
      pdfApplication?.pdfDocument ?? pdfApplication?.pdfViewer?.pdfDocument;
    if (!pdfDocument) {
      ztoolkit.log(
        "[extractOpenPdfPageText] PDF document is not available yet",
      );
      return "";
    }

    const pdfPage = await pdfDocument.getPage(pageNumber);
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

    if (!pageText) {
      ztoolkit.log(
        `[extractOpenPdfPageText] No text found for page ${pageNumber}`,
      );
    }

    if (typeof pdfPage.cleanup === "function") {
      pdfPage.cleanup();
    }

    return pageText;
  } catch (error) {
    ztoolkit.log(`[extractOpenPdfPageText] Failed: ${String(error)}`);
    return "";
  }
}