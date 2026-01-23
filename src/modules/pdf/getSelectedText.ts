/**
 * MVP
 * Returns selected text from the active Zotero PDF reader if available.
 * If nothing is selected, returns an empty string.
 */

export async function getSelectedPdfText(): Promise<string> {
    try {
        // This works when the PDF is open in a tab
        // TODO: Improve later for separate reader windows
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tabId = (globalThis as any).Zotero_Tabs?.selectedID;
        const reader = (globalThis as any).Zotero?.Reader?.getByTabID?.(tabId);
        if (!reader) return "";

        // ztoolkit is typically initialized in the template; use it if available.
        const ztoolkit = (globalThis as any).ztoolkit;
        if (!ztoolkit?.Reader?.getSelectedText) return "";

        const text = await ztoolkit.Reader.getSelectedText(reader);
        return (text ?? "").trim();
    } catch {
        return "";
    }
}