/**
 * MVP
 * Returns selected text from the active Zotero PDF reader if available.
 * If nothing is selected, returns an empty string.
 */

export async function getSelectedPdfText(): Promise<string> {
    try {
        // This works when the PDF is open in a tab
        // TODO: Improve later for separate reader windows
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

/**
 * Response type for Docling health check
 */
interface DoclingHealthResponse {
    status: string;
    docling_available: boolean;
    version: string;
}

/**
 * Response type for Docling extract
 */
interface DoclingExtractResponse {
    success: boolean;
    text?: string;
    error?: string;
    length?: number;
}

/**
 * Checks if Docling service is available
 */
async function isDoclingAvailable(ztoolkit: any): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            if (ztoolkit?.log) {
                ztoolkit.log("[Docling] Checking if service is available...");
            }

            const xhr = new XMLHttpRequest();
            xhr.timeout = 1000; // 1 second timeout

            xhr.onload = function() {
                if (xhr.status === 200 && xhr.responseText) {
                    try {
                        const data = JSON.parse(xhr.responseText) as DoclingHealthResponse;
                        if (ztoolkit?.log) {
                            ztoolkit.log(`[Docling] Service available: ${data.docling_available}, status: ${xhr.status}`);
                        }
                        resolve(data.docling_available === true);
                    } catch (parseErr) {
                        if (ztoolkit?.log) {
                            ztoolkit.log("[Docling] Failed to parse health response:", parseErr);
                        }
                        resolve(false);
                    }
                } else {
                    if (ztoolkit?.log) {
                        ztoolkit.log(`[Docling] Service returned status: ${xhr.status}, responseText: ${xhr.responseText ? 'present' : 'null'}`);
                    }
                    resolve(false);
                }
            };

            xhr.onerror = function() {
                if (ztoolkit?.log) {
                    ztoolkit.log("[Docling] Network error - service not reachable");
                }
                resolve(false);
            };

            xhr.ontimeout = function() {
                if (ztoolkit?.log) {
                    ztoolkit.log("[Docling] Request timeout - service not responding");
                }
                resolve(false);
            };

            xhr.open('GET', 'http://localhost:5555/health', true);
            xhr.send();
        } catch (err) {
            if (ztoolkit?.log) {
                ztoolkit.log("[Docling] Exception in isDoclingAvailable:", err);
            }
            resolve(false);
        }
    });
}

/**
 * Extracts PDF text using Docling service
 */
async function extractWithDocling(pdfPath: string, ztoolkit: any): Promise<string> {
    return new Promise((resolve) => {
        try {
            if (ztoolkit?.log) {
                ztoolkit.log(`[Docling] Extracting text from: ${pdfPath}`);
            }

            const xhr = new XMLHttpRequest();
            xhr.timeout = 60000 * 10; // 60 second timeout

            xhr.onload = function() {
                if (xhr.status === 200 && xhr.responseText) {
                    try {
                        const result = JSON.parse(xhr.responseText) as DoclingExtractResponse;

                        if (result.success && result.text) {
                            if (ztoolkit?.log) {
                                ztoolkit.log(`[Docling] SUCCESS: Extracted ${result.text.length} characters`);
                            }
                            resolve(result.text);
                        } else {
                            if (ztoolkit?.log) {
                                ztoolkit.log(`[Docling] ERROR: ${result.error || 'Unknown error'}`);
                            }
                            resolve("");
                        }
                    } catch (parseErr) {
                        if (ztoolkit?.log) {
                            ztoolkit.log("[Docling] Failed to parse extract response:", parseErr);
                        }
                        resolve("");
                    }
                } else {
                    if (ztoolkit?.log) {
                        ztoolkit.log(`[Docling] Service returned status: ${xhr.status}, responseText: ${xhr.responseText ? 'present' : 'null'}`);
                    }
                    resolve("");
                }
            };

            xhr.onerror = function() {
                if (ztoolkit?.log) {
                    ztoolkit.log("[Docling] Network error during extraction");
                }
                resolve("");
            };

            xhr.ontimeout = function() {
                if (ztoolkit?.log) {
                    ztoolkit.log("[Docling] Extraction timeout (60s exceeded)");
                }
                resolve("");
            };

            xhr.open('POST', 'http://localhost:5555/extract', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify({ path: pdfPath }));
        } catch (err) {
            if (ztoolkit?.log) {
                ztoolkit.log("[Docling] EXCEPTION:", err);
            }
            resolve("");
        }
    });
}

/**
 * Extracts the full text content from a PDF attachment.
 * First tries Docling service if available, then falls back to other methods.
 */
export async function getFullPdfText(itemID: number, ztoolkit: any): Promise<string> {
    try {
        if (ztoolkit?.log) {
            ztoolkit.log(`[getFullPdfText] Starting with itemID: ${itemID}`);
        }

        const Zotero = (globalThis as any).Zotero;
        if (!Zotero) {
            if (ztoolkit?.log) {
                ztoolkit.log("[getFullPdfText] ERROR: Zotero not found in globalThis");
            }
            return "";
        }

        const item = Zotero.Items.get(itemID);
        if (!item) {
            if (ztoolkit?.log) {
                ztoolkit.log(`[getFullPdfText] ERROR: Item not found for itemID: ${itemID}`);
            }
            return "";
        }

        if (ztoolkit?.log) {
            ztoolkit.log(`[getFullPdfText] Item found. Type: ${item.itemType}, isRegularItem: ${item.isRegularItem()}, isAttachment: ${item.isAttachment()}`);
        }

        // If this is a regular item, find the first PDF attachment
        let pdfItem = item;
        if (item.isRegularItem()) {
            if (ztoolkit?.log) {
                ztoolkit.log("[getFullPdfText] Item is regular item, searching for PDF attachment...");
            }
            const attachments = Zotero.Items.get(item.getAttachments());
            if (ztoolkit?.log) {
                ztoolkit.log(`[getFullPdfText] Found ${attachments?.length || 0} attachments`);
            }
            const pdfAttachment = attachments.find(
                (att: any) => att.attachmentContentType === "application/pdf"
            );
            if (!pdfAttachment) {
                if (ztoolkit?.log) {
                    ztoolkit.log("[getFullPdfText] ERROR: No PDF attachment found");
                }
                return "";
            }
            pdfItem = pdfAttachment;
            if (ztoolkit?.log) {
                ztoolkit.log(`[getFullPdfText] PDF attachment found with ID: ${pdfItem.id}`);
            }
        }

        // Check if it's a PDF attachment
        if (!pdfItem.isAttachment() || pdfItem.attachmentContentType !== "application/pdf") {
            if (ztoolkit?.log) {
                ztoolkit.log(`[getFullPdfText] ERROR: Item is not a PDF attachment. isAttachment: ${pdfItem.isAttachment()}, contentType: ${pdfItem.attachmentContentType}`);
            }
            return "";
        }

        // Get PDF file path (needed for Docling)
        const pdfPath = await pdfItem.getFilePathAsync();
        if (!pdfPath) {
            if (ztoolkit?.log) {
                ztoolkit.log("[getFullPdfText] ERROR: Could not get PDF file path");
            }
            return "";
        }

        if (ztoolkit?.log) {
            ztoolkit.log(`[getFullPdfText] PDF file path: ${pdfPath}`);
        }

        // Method 0: Try Docling first if available
        const doclingAvailable = await isDoclingAvailable(ztoolkit);
        if (doclingAvailable) {
            if (ztoolkit?.log) {
                ztoolkit.log("[getFullPdfText] Docling service is available, trying...");
            }
            const doclingText = await extractWithDocling(pdfPath, ztoolkit);
            if (doclingText.trim().length > 0) {
                return doclingText.trim();
            } else {
                if (ztoolkit?.log) {
                    ztoolkit.log("[getFullPdfText] Docling returned empty text, falling back to other methods");
                }
            }
        } else {
            if (ztoolkit?.log) {
                ztoolkit.log("[getFullPdfText] Docling service not available, using fallback methods");
            }
        }

        if (ztoolkit?.log) {
            ztoolkit.log("[getFullPdfText] ERROR: No content retrieved from PDF after all attempts");
        }
        return "";

    } catch (err) {
        if (ztoolkit?.log) {
            ztoolkit.log("[getFullPdfText] EXCEPTION caught:", err);
        }
        return "";
    }
}

