import type { ChatMessage } from "../ai/chatClient";

/**
 * In-memory chat sessions.
 * Sessions are persisted to Zotero storage directory and loaded on demand.
 */
const sessions = new Map<string, ChatMessage[]>();

// Track if sessions have been loaded from disk
let sessionsLoaded = false;

/**
 * Get the path to the sessions storage file
 */
function getSessionsFilePath(): string {
    const Zotero = (globalThis as any).Zotero;
    const dataDir = Zotero.DataDirectory.dir;
    // Store in Zotero data directory under 'claudtero-sessions.json'
    return PathUtils.join(dataDir, 'claudtero-sessions.json');
}

/**
 * Load all sessions from disk
 */
async function loadSessionsFromDisk(ztoolkit: any): Promise<void> {
    if (ztoolkit?.log) {
        ztoolkit.log(`[SessionStore] loadSessionsFromDisk called. sessionsLoaded: ${sessionsLoaded}`);
    }

    if (sessionsLoaded) {
        if (ztoolkit?.log) {
            ztoolkit.log("[SessionStore] Sessions already loaded, skipping");
        }
        return;
    }

    try {
        const filePath = getSessionsFilePath();

        if (ztoolkit?.log) {
            ztoolkit.log(`[SessionStore] Loading sessions from: ${filePath}`);
        }

        // Check if file exists
        const fileExists = await IOUtils.exists(filePath);
        if (ztoolkit?.log) {
            ztoolkit.log(`[SessionStore] File exists: ${fileExists}`);
        }

        if (!fileExists) {
            if (ztoolkit?.log) {
                ztoolkit.log("[SessionStore] No saved sessions file found, starting fresh");
            }
            sessionsLoaded = true;
            return;
        }

        // Read file content
        const content = await IOUtils.readUTF8(filePath);
        if (ztoolkit?.log) {
            ztoolkit.log(`[SessionStore] File content length: ${content.length} bytes`);
            ztoolkit.log(`[SessionStore] File content preview: ${content.substring(0, 200)}...`);
        }

        const data = JSON.parse(content);
        if (ztoolkit?.log) {
            ztoolkit.log(`[SessionStore] Parsed JSON, keys: ${Object.keys(data).join(', ')}`);
        }

        // Restore sessions
        sessions.clear();
        for (const [sessionId, messages] of Object.entries(data)) {
            sessions.set(sessionId, messages as ChatMessage[]);
            if (ztoolkit?.log) {
                ztoolkit.log(`[SessionStore] Restored session "${sessionId}" with ${(messages as ChatMessage[]).length} messages`);
            }
        }

        if (ztoolkit?.log) {
            ztoolkit.log(`[SessionStore] ✅ Successfully loaded ${sessions.size} sessions from disk`);
            ztoolkit.log(`[SessionStore] Current session keys: ${Array.from(sessions.keys()).join(', ')}`);
        }

        sessionsLoaded = true;
    } catch (err) {
        if (ztoolkit?.log) {
            ztoolkit.log("[SessionStore] ❌ Error loading sessions:", err);
            ztoolkit.log("[SessionStore] Error stack:", (err as Error).stack);
        }
        sessionsLoaded = true; // Mark as loaded even on error to avoid repeated attempts
    }
}

/**
 * Save all sessions to disk
 */
async function saveSessionsToDisk(ztoolkit: any): Promise<void> {
    try {
        const filePath = getSessionsFilePath();

        if (ztoolkit?.log) {
            ztoolkit.log(`[SessionStore] saveSessionsToDisk called. Current sessions: ${sessions.size}`);
            ztoolkit.log(`[SessionStore] Session keys to save: ${Array.from(sessions.keys()).join(', ')}`);
        }

        // Convert Map to plain object for JSON serialization
        const data: Record<string, ChatMessage[]> = {};
        for (const [sessionId, messages] of sessions.entries()) {
            data[sessionId] = messages;
            if (ztoolkit?.log) {
                ztoolkit.log(`[SessionStore] Saving session "${sessionId}" with ${messages.length} messages`);
            }
        }

        const json = JSON.stringify(data, null, 2);
        if (ztoolkit?.log) {
            ztoolkit.log(`[SessionStore] JSON length: ${json.length} bytes`);
            ztoolkit.log(`[SessionStore] JSON preview: ${json.substring(0, 300)}...`);
        }

        await IOUtils.writeUTF8(filePath, json);

        if (ztoolkit?.log) {
            ztoolkit.log(`[SessionStore] ✅ Successfully saved ${sessions.size} sessions to: ${filePath}`);
        }
    } catch (err) {
        if (ztoolkit?.log) {
            ztoolkit.log("[SessionStore] ❌ Error saving sessions:", err);
            ztoolkit.log("[SessionStore] Error stack:", (err as Error).stack);
        }
    }
}

/**
 * Debounced save function to avoid too frequent disk writes
 */
let saveTimeout: number | null = null;
function debouncedSave(ztoolkit: any): void {
    if (saveTimeout !== null) {
        clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
        saveSessionsToDisk(ztoolkit);
        saveTimeout = null;
    }, 1000) as unknown as number; // Save 1 second after last change
}

/**
 * Get a session by ID, loading from disk if needed
 */
export async function getSession(sessionId: string, ztoolkit: any): Promise<ChatMessage[]> {
    if (ztoolkit?.log) {
        ztoolkit.log(`[SessionStore] getSession called for: "${sessionId}"`);
    }

    // Ensure sessions are loaded
    await loadSessionsFromDisk(ztoolkit);

    if (ztoolkit?.log) {
        ztoolkit.log(`[SessionStore] After load, available sessions: ${Array.from(sessions.keys()).join(', ')}`);
    }

    let session = sessions.get(sessionId);
    if (!session) {
        if (ztoolkit?.log) {
            ztoolkit.log(`[SessionStore] Session "${sessionId}" not found, creating new empty session`);
        }
        session = [];
        sessions.set(sessionId, session);
        debouncedSave(ztoolkit); // Save the new empty session
    } else {
        if (ztoolkit?.log) {
            ztoolkit.log(`[SessionStore] ✅ Found existing session "${sessionId}" with ${session.length} messages`);
        }
    }
    return session;
}

/**
 * Get a session synchronously (for backward compatibility)
 * This should only be used after ensuring sessions are loaded
 */
export function getSessionSync(sessionId: string): ChatMessage[] {
    let session = sessions.get(sessionId);
    if (!session) {
        session = [];
        sessions.set(sessionId, session);
    }
    return session;
}

/**
 * Reset/delete a session
 */
export async function resetSession(sessionId: string, ztoolkit: any): Promise<void> {
    await loadSessionsFromDisk(ztoolkit);
    sessions.delete(sessionId);
    await saveSessionsToDisk(ztoolkit); // Save immediately when resetting
}

/**
 * Append a message to a session
 */
export async function appendMessage(sessionId: string, msg: ChatMessage, ztoolkit: any): Promise<void> {
    const session = await getSession(sessionId, ztoolkit);
    session.push(msg);
    debouncedSave(ztoolkit); // Debounce to avoid too frequent saves
}

/**
 * Check if this is a new session (no messages yet, not even system prompt)
 */
export async function isNewSession(sessionId: string, ztoolkit: any): Promise<boolean> {
    await loadSessionsFromDisk(ztoolkit);
    const session = sessions.get(sessionId);
    return !session || session.length === 0;
}

/**
 * Initialize the session store (call on plugin startup)
 */
export async function initSessionStore(ztoolkit: any): Promise<void> {
    await loadSessionsFromDisk(ztoolkit);
}

/**
 * Clean up old sessions for items that no longer exist
 * Call this periodically or on plugin shutdown
 *
 * Note: With PDF filename-based session keys, cleanup is less critical
 * but we still remove sessions for legacy itemID-based keys
 */
export async function cleanupOldSessions(ztoolkit: any): Promise<void> {
    await loadSessionsFromDisk(ztoolkit);

    const Zotero = (globalThis as any).Zotero;

    let removedCount = 0;

    for (const sessionId of sessions.keys()) {
        // Only cleanup legacy itemID-based sessions (numeric or "item-{id}")
        // PDF filename-based sessions (pdf:filename.pdf) are kept
        if (sessionId.startsWith('pdf:')) {
            continue; // Skip PDF filename-based sessions
        }

        // Try to parse as itemID (legacy format)
        const itemIdMatch = sessionId.match(/^(\d+)$/);
        if (itemIdMatch) {
            const itemId = parseInt(itemIdMatch[1], 10);
            try {
                const item = Zotero.Items.get(itemId);
                if (!item) {
                    // Item doesn't exist anymore, remove session
                    sessions.delete(sessionId);
                    removedCount++;
                }
            } catch {
                // Error getting item, assume it doesn't exist
                sessions.delete(sessionId);
                removedCount++;
            }
        }
    }

    if (removedCount > 0) {
        if (ztoolkit?.log) {
            ztoolkit.log(`[SessionStore] Cleaned up ${removedCount} old legacy sessions`);
        }
        await saveSessionsToDisk(ztoolkit);
    }
}


