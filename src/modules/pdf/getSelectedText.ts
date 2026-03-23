interface ReaderSelectionToolkit {
    Reader?: {
        getSelectedText?(reader: unknown): Promise<unknown> | unknown;
    };
}

interface SelectedTextGlobals {
    Zotero_Tabs?: {
        selectedID?: unknown;
    };
    Zotero?: {
        Reader?: {
            getByTabID?(tabId: unknown): unknown;
        };
    };
    ztoolkit?: ReaderSelectionToolkit;
}

function getSelectedTextGlobals(): SelectedTextGlobals {
    return globalThis as typeof globalThis & SelectedTextGlobals;
}

export async function getSelectedPdfText(): Promise<string> {
    try {
        const globals = getSelectedTextGlobals();
        const tabId = globals.Zotero_Tabs?.selectedID;
        const reader = globals.Zotero?.Reader?.getByTabID?.(tabId);
        if (!reader) {
            return "";
        }

        const selectedText = await globals.ztoolkit?.Reader?.getSelectedText?.(reader);
        return typeof selectedText === "string" ? selectedText.trim() : "";
    } catch {
        return "";
    }
}