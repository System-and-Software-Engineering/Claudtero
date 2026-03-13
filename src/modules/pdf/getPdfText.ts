export async function extractOpenPdfText(ztoolkit: any): Promise<string> {
  try {
    const ZoteroTabs = ztoolkit.getGlobal("Zotero_Tabs");
    const ZoteroGlobal = (globalThis as any).Zotero;
    const tabId = ZoteroTabs?.selectedID;
    const reader = ZoteroGlobal?.Reader?.getByTabID?.(tabId);

    if (!reader) {
      ztoolkit.log("[extractOpenPdfText] No active reader found");
      return "";
    }

    const readerWindow =
      (reader as any)._iframeWindow ??
      (reader as any)._internalReader?._iframeWindow ??
      (reader as any)._internalReader?._window ??
      (reader as any).iframeWindow;

    const wrappedWindow = readerWindow?.wrappedJSObject ?? readerWindow;
    const pdfApplication = wrappedWindow?.PDFViewerApplication;
    const internalReader =
      (reader as any)._internalReader ?? wrappedWindow?._reader ?? null;
    const primaryView =
      internalReader?._primaryView ?? internalReader?._lastView ?? null;
    const findController = primaryView?._findController ?? null;

    if (pdfApplication?.initializedPromise) {
      await pdfApplication.initializedPromise;
    }

    if (primaryView?.initializedPromise) {
      await primaryView.initializedPromise;
    }

    if (!findController) {
      ztoolkit.log("[extractOpenPdfText] Find controller is not available yet");
      return "";
    }

    if (!findController._extractTextPromises?.length) {
      findController._extractText();
    }

    if (findController._extractTextPromises?.length) {
      await Promise.all(findController._extractTextPromises);
    }

    const pageTexts = (findController._pageContents ?? []).filter(
      (text: unknown) => typeof text === "string" && text.trim().length > 0,
    );
    const fullText = pageTexts.join("\n\n");
    ztoolkit.log(
      `[extractOpenPdfText] Extracted ${fullText.length} characters from ${pageTexts.length} page(s)`,
    );
    return fullText;
  } catch (error) {
    ztoolkit.log(`[extractOpenPdfText] Failed: ${String(error)}`);
    return "";
  }
}