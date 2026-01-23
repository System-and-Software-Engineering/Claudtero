import type { ChatMessage } from "../ai/chatClient";

/**
 * In-memory chat sessions.
 * TODO: 
 * Later we can persis this per-item in Zotero storage, but memory is fine for MVP
 */
const sessions = new Map<string, ChatMessage[]>();

export function getSession(sessionId: string): ChatMessage[] {
    let session = sessions.get(sessionId);
    if (!session) {
        session = [];
        sessions.set(sessionId, session);
    }
    return session;
}

export function resetSession(sessionId: string): void {
    sessions.delete(sessionId);
}

export function appendMessage(sessionId: string, msg: ChatMessage): void {
    const session = getSession(sessionId);
    session.push(msg);
}