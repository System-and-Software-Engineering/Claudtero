import { getLocaleID } from "../utils/locale";
import { config } from "../../package.json";
import { getAvailableModels, handleChatSend } from "./chat/chatController";
import type { AIProvider } from "./ai/modelCatalog";
import { getSession } from "./chat/sessionStore";
import type { ChatMessage } from "./ai/chatClient";

let paneKey = "";

// Global reference to the current render function for external updates
let currentRenderMessages: (() => void) | null = null;
let currentItemID: number | null = null;
let currentSessionId: string | null = null;
let currentBody: HTMLElement | null = null;

/**
 * Sanitize text to remove invalid XML/HTML characters that could cause DOMException
 */
function sanitizeText(text: string): string {
  if (!text) return '';

  try {
    // Remove control characters except newlines, tabs, and carriage returns
    // XML 1.0 only allows: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
    let cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

    // Remove invalid Unicode surrogate pairs
    cleaned = cleaned.replace(/[\uD800-\uDFFF]/g, '');

    // Remove any remaining problematic characters
    cleaned = cleaned.replace(/[\uFFFE\uFFFF]/g, '');

    return cleaned;
  } catch (err) {
    ztoolkit.log('[Sanitize] Error sanitizing text:', err);
    // Fallback: return empty string if sanitization fails
    return '';
  }
}

/**
 * Simple Markdown to HTML converter for chat messages
 * Supports: **bold**, *italic*, `code`, ```code blocks```, # headings, - lists, links
 * Uses XHTML-compliant tags for Firefox/Zotero compatibility
 */
function markdownToHtml(markdown: string): string {
  // First sanitize the input to remove invalid characters
  let html = sanitizeText(markdown);

  // Escape HTML to prevent XSS
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks (```code```) - must be done before inline code
  // Use [\s\S] to match any character including newlines
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

  // Inline code (`code`) - must not span multiple lines
  html = html.replace(/`([^`\n]+?)`/g, '<code>$1</code>');

  // Bold must be processed BEFORE italic to avoid conflicts
  // **text** - at least one non-whitespace character, doesn't cross newlines
  html = html.replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>');
  // __text__
  html = html.replace(/__([^\n_]+?)__/g, '<strong>$1</strong>');

  // Italic - only match if not already part of bold (already processed)
  // *text* - single asterisk, not at start/end of word boundary
  html = html.replace(/\b\*([^\n*]+?)\*\b/g, '<em>$1</em>');
  // Also match italic at start/end of string or after whitespace
  html = html.replace(/(^|\s)\*([^\n*]+?)\*(\s|$)/g, '$1<em>$2</em>$3');

  // _text_ - single underscore
  html = html.replace(/\b_([^\n_]+?)_\b/g, '<em>$1</em>');
  html = html.replace(/(^|\s)_([^\n_]+?)_(\s|$)/g, '$1<em>$2</em>$3');

  // Headings (# H1, ## H2, ### H3, etc.) - must be at start of line
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Lists (- item or * item) - must be at start of line
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>\s*)+/g, '<ul>$&</ul>');

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Line breaks - use XHTML self-closing tag
  html = html.replace(/\n/g, '<br />');

  return html;
}

/**
 * Send a message to the sidebar chat from external sources (e.g., context menu, popup).
 * Opens the sidebar if not already open and scrolls to the chat pane.
 * Note: This function is deprecated and should be updated to use sessions
 */
export function sendToSidebarChat(text: string, itemID?: number) {
  const mainWin = Zotero.getMainWindow();
  if (!mainWin) return;

  // Use the provided itemID or the currently selected item
  const targetItemID =
    itemID ??
    currentItemID ??
    Zotero.getActiveZoteroPane()?.getSelectedItems()?.[0]?.id;
  if (!targetItemID) {
    ztoolkit.log("No item selected to send message to");
    return;
  }

  // Open sidebar and scroll to chat pane
  openSidebarAndShowChat(mainWin, targetItemID, text);
}

/**
 * Opens the sidebar if closed and scrolls to the chat pane.
 * Optionally prefills the input with text.
 */
export function openSidebarAndShowChat(
  win?: _ZoteroTypes.MainWindow,
  itemID?: number,
  prefillText?: string,
) {
  const mainWin = win ?? Zotero.getMainWindow();
  if (!mainWin) return;

  const ZoteroContextPane = mainWin.ZoteroContextPane;

  // Open the context pane if not visible
  if (
    ZoteroContextPane &&
    !ZoteroContextPane.splitter?.getAttribute("state")?.includes("open")
  ) {
    // Try to open the pane
    const splitter = ZoteroContextPane.splitter;
    if (splitter) {
      splitter.setAttribute("state", "open");
    }
  }

  // Don't switch items if user is in a reader - just open the sidebar
  // Switching items would close the PDF reader
  const readerTab = Zotero.Reader.getByTabID(mainWin.Zotero_Tabs.selectedID);

  // If we're in a reader, don't try to switch items at all
  // Just use the current sidebar content
  if (!readerTab) {
    // If we have an itemID, check if it's an attachment and get parent if needed
    let targetItemID = itemID;
    if (itemID) {
      const item = Zotero.Items.get(itemID);
      if (item && item.isAttachment()) {
        // If it's an attachment, use the parent item for the chat
        const parentItemID = item.parentItemID;
        if (parentItemID) {
          targetItemID = parentItemID;
          ztoolkit.log(
            `Item ${itemID} is an attachment, using parent ${parentItemID}`,
          );
        }
      }
    }

    // If targetItemID is provided and different from current, switch to that item
    if (targetItemID && targetItemID !== currentItemID) {
      const zoteroPane = Zotero.getActiveZoteroPane();
      if (zoteroPane) {
        const item = Zotero.Items.get(targetItemID);
        if (item) {
          zoteroPane.selectItem(targetItemID);
        }
      }
    }
  }

  // Wait a bit for the pane to render if needed
  setTimeout(() => {
    // Scroll to our chat pane if we have a paneKey
    if (paneKey && currentBody && currentBody.isConnected) {
      const details = currentBody.closest("item-details");
      if (details) {
        // First, uncollapse the section if it's collapsed
        const section = currentBody.closest("item-pane-custom-section");
        if (section) {
          const head = section.querySelector(".head") as HTMLElement;
          if (head) {
            const ariaExpanded = head.getAttribute("aria-expanded");
            //ztoolkit.log("Section aria-expanded:", ariaExpanded);

            // If aria-expanded is "false", the section is collapsed - expand it
            if (ariaExpanded === "false") {
              //ztoolkit.log("Section is collapsed, clicking head to expand");
              head.click(); // Toggle to expand
            } else {
              //ztoolkit.log("Section is already expanded");
            }
          }
        }

        // Then resize to full height and scroll to pane
        onUpdateHeight({ body: currentBody });
        // @ts-expect-error 'item-details' is a custom element on Zotero
        details.scrollToPane(paneKey);

        // If prefillText is provided, set it in the input
        if (prefillText) {
          const input = currentBody.querySelector(
            ".chat-pane__input",
          ) as HTMLTextAreaElement;
          if (input) {
            input.value = prefillText;
            input.focus();
            // Move cursor to end
            input.setSelectionRange(input.value.length, input.value.length);
            // Trigger input event to update send button state
            const doc = input.ownerDocument;
            if (doc) {
              const inputEvent = doc.createEvent("HTMLEvents");
              inputEvent.initEvent("input", true, false);
              input.dispatchEvent(inputEvent);
            }
          }
        }
      }
    }
  }, 50);
}

export class ChatPaneSection {
  static registerChatPaneSection() {
    const key = Zotero.ItemPaneManager.registerSection({
      paneID: "chat",
      pluginID: addon.data.config.addonID,

      header: {
        l10nID: getLocaleID("item-section-chat-head-text"),
        icon: `chrome://${config.addonRef}/content/icons/ai-icon.svg`,
      },

      sidenav: {
        l10nID: getLocaleID("item-section-chat-sidenav-tooltip"),
        icon: `chrome://${config.addonRef}/content/icons/ai-icon-small.svg`,
      },
      onItemChange: ({ item, setEnabled, tabType }) => {
        // First: only enabled in reader context
        const isReader = tabType === "reader";

        // Second: check if item has PDFs
        let hasPDF = false;
        if (item) {
          if (
            item.isAttachment() &&
            item.attachmentContentType === "application/pdf"
          ) {
            hasPDF = true;
          } else if (item.isRegularItem()) {
            const attachments = Zotero.Items.get(item.getAttachments());
            hasPDF = attachments.some(
              (att: Zotero.Item) =>
                att.attachmentContentType === "application/pdf",
            );
          }
        }

        // Enable only if BOTH conditions are true
        const enabled = isReader && hasPDF;
        setEnabled(enabled);
        return enabled;
      },
      onRender,
      sectionButtons: [
        {
          type: "fullHeight",
          icon: `chrome://${config.addonRef}/content/icons/full-16.svg`,
          l10nID: getLocaleID("item-section-chat-fullHeight"),
          onClick: ({ body }) => {
            const details = body.closest("item-details");
            onUpdateHeight({ body });
            if (details) {
              // @ts-expect-error 'item-details' is a custom element on Zotero
              details.scrollToPane(paneKey);
            }
          },
        },
      ],
    });
    if (key) paneKey = key;
  }
}

function onRender({ body, item }: { body: HTMLElement; item: Zotero.Item }) {
  body.textContent = "";

  // Doc is a document that "owns" a body. It is the main docmunt that defines the pane.
  const doc = body.ownerDocument!; // tell TS this is not null
  // Injecting CSS file
  if (!doc.querySelector(`link[href*="chatWindow.css"]`)) {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = `chrome://${config.addonRef}/content/chatWindow.css`;
    doc.documentElement?.appendChild(link);
  }

  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.minHeight = "150px"; // give it some space

  if (!item) {
    body.textContent = "Select an item to start chatting.";
    return;
  }

  const itemID = item.id as number;

  // Generate sessionId based on PDF filename (same logic as in send handler)
  let sessionId = String(itemID); // Fallback to itemID
  try {
    let pdfItem = item;
    if (item.isRegularItem()) {
      const attachments = Zotero.Items.get(item.getAttachments());
      const pdfAttachment = attachments.find(
        (att: any) => att.attachmentContentType === "application/pdf"
      );
      if (pdfAttachment) {
        pdfItem = pdfAttachment;
      }
    }

    if (pdfItem.isAttachment()) {
      const filename = pdfItem.attachmentFilename;
      if (filename) {
        sessionId = `pdf:${filename}`;
        ztoolkit.log(`[Chat UI] Using PDF filename as session key: ${sessionId}`);
      }
    }
  } catch (err) {
    ztoolkit.log("[Chat UI] Error getting PDF filename, using itemID:", err);
  }

  // Store references for external access
  currentItemID = itemID;
  currentSessionId = sessionId;
  currentBody = body;

  const container = doc.createElement("div");
  container.className = "chat-pane";
  container.style.flex = "1"; // fill available height from Zotero pane

  const messagesBox = doc.createElement("div");
  messagesBox.className = "chat-pane__messages";

  // Prevent scroll from bubbling to parent pane
  messagesBox.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      const atTop = messagesBox.scrollTop === 0;
      const atBottom =
        messagesBox.scrollTop + messagesBox.clientHeight >=
        messagesBox.scrollHeight;

      // Only stop propagation if we're actually scrolling within bounds
      if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) {
        e.stopPropagation();
      }
    },
    { passive: false },
  );

  const renderMessages = async () => {
    messagesBox.textContent = "";

    if (!currentSessionId) {
      const empty = doc.createElement("div");
      empty.className = "chat-pane__empty";
      empty.textContent = "No messages yet.";
      messagesBox.appendChild(empty);
      return;
    }

    try {
      // Load session from store
      const session = await getSession(currentSessionId, ztoolkit);

      // Filter out system and context messages for display
      // Only show user and assistant messages
      const displayMessages = session.filter(msg => msg.role === 'user' || msg.role === 'assistant');

      if (displayMessages.length === 0) {
        const empty = doc.createElement("div");
        empty.className = "chat-pane__empty";
        empty.textContent = "No messages yet.";
        messagesBox.appendChild(empty);
        return;
      }

      for (const msg of displayMessages) {
        const p = doc.createElement("div");

        try {
          // Use innerHTML with markdown rendering instead of textContent
          const sanitized = sanitizeText(msg.content);
          const html = markdownToHtml(sanitized);
          p.innerHTML = html;
        } catch (err) {
          ztoolkit.log("[Chat UI] Error rendering message with innerHTML:", err);
          // Fallback to plain text if markdown rendering fails
          p.textContent = msg.content;
        }

        // Map role to UI class: user -> me, assistant -> other
        const from = msg.role === 'user' ? 'me' : 'other';
        p.className = `chat-pane__message chat-pane__message--${from}`;
        p.style.whiteSpace = "pre-wrap"; // Preserve line breaks and wrap text
        messagesBox.appendChild(p);
      }

      messagesBox.scrollTop = messagesBox.scrollHeight;
    } catch (err) {
      ztoolkit.log("Error rendering messages:", err);
      const errorDiv = doc.createElement("div");
      errorDiv.className = "chat-pane__empty";
      errorDiv.textContent = "Error loading messages.";
      messagesBox.appendChild(errorDiv);
    }
  };

  // Store render function for external updates
  currentRenderMessages = renderMessages;

  renderMessages();

  // Outer container for input area
  const inputArea = doc.createElement("div");
  inputArea.className = "chat-pane__input-area";

  // Load providers + models from backend
  const catalog = getAvailableModels();
  const providers = catalog.providers;

  const providerSelect = doc.createElement("select");
  providerSelect.className = "chat-pane__model-select";

  const modelSelect = doc.createElement("select");
  modelSelect.className = "chat-pane__model-select";

  /**
   * Helper: rebuild the model select based on the chosen provider
   */
  const renderModelsForProvider = (provider: AIProvider) => {
    modelSelect.textContent = "";
    const entry = providers.find((p) => p.provider === provider);
    if (!entry) return;

    for (const m of entry.models) {
      const opt = doc.createElement("option");
      opt.value = m.value; // API model id
      opt.textContent = m.label; // UI label
      modelSelect.appendChild(opt);
    }

    // Default to first model
    modelSelect.value = entry.models[0]?.value ?? "";
  };

  // Fill provider select
  for (const p of providers) {
    const opt = doc.createElement("option");
    opt.value = p.provider;
    opt.textContent = p.label;
    providerSelect.appendChild(opt);
  }

  // Default provider = first in catalog
  const defaultProvider = providers[0]?.provider ?? "openai";
  providerSelect.value = defaultProvider;
  renderModelsForProvider(defaultProvider);

  // Update models when provider changes
  providerSelect.addEventListener("change", () => {
    renderModelsForProvider(providerSelect.value as AIProvider);
  });

  // Inner wrapper for input + send icon
  const inputWrapper = doc.createElement("div");
  inputWrapper.className = "chat-pane__input-wrapper";

  // Use textarea for multiline input
  const input = doc.createElement("textarea") as HTMLTextAreaElement;
  input.placeholder = `Explore and understand the paper`;
  input.className = "chat-pane__input";
  input.rows = 2;

  // Use icon button
  const sendButton = doc.createElement("button") as HTMLButtonElement;
  sendButton.className = "chat-pane__send";
  sendButton.setAttribute("aria-label", "Send message");
  const sendIcon = doc.createElement("img");
  sendIcon.src = `chrome://${config.addonRef}/content/icons/Send.png`;
  sendIcon.alt = "Send";
  sendIcon.className = "chat-pane__send-icon";
  sendButton.appendChild(sendIcon);

  const updateSendState = () => {
    sendButton.disabled = !input.value.trim();
  };

  // const send = () => {
  //   const text = input.value.trim();
  //   if (!text) return;
  //   chatsByItem[itemID].push({ text, from: "me" });
  //   // Echo back as if from other party
  //   chatsByItem[itemID].push({ text, from: "other" });
  //   input.value = "";
  //   renderMessages();
  //   updateSendState();
  // };

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;

    const provider = providerSelect.value as AIProvider;
    const model = modelSelect.value;

    // Clear input immediately
    input.value = "";
    updateSendState();

    // Disable UI during request
    sendButton.disabled = true;
    input.disabled = true;

    try {
      // Use PDF filename as session key for stability across restarts
      // This ensures the session persists even if itemID changes
      const item = Zotero.Items.get(itemID);
      let sessionId = currentSessionId || String(itemID); // Use stored sessionId or fallback

      if (item) {
        try {
          // Get the PDF attachment item
          let pdfItem = item;
          if (item.isRegularItem()) {
            const attachments = Zotero.Items.get(item.getAttachments());
            const pdfAttachment = attachments.find(
              (att: any) => att.attachmentContentType === "application/pdf"
            );
            if (pdfAttachment) {
              pdfItem = pdfAttachment;
            }
          }

          // Get the filename from the attachment
          if (pdfItem.isAttachment()) {
            const filename = pdfItem.attachmentFilename;
            if (filename) {
              // Use filename as session key (more stable than itemID)
              sessionId = `pdf:${filename}`;
              ztoolkit.log(`Using PDF filename as session key: ${sessionId}`);
            }
          }
        } catch (err) {
          ztoolkit.log("Error getting PDF filename, using itemID:", err);
        }
      }

      // Check if this is the first message BEFORE calling handleChatSend
      // This way we check before user message is added to session
      const session = await getSession(sessionId, ztoolkit);
      const isFirstMessage = session.length === 0 || (session.length === 1 && session[0].role === 'system');

      // Add loading indicator
      const loadingDiv = doc.createElement("div");
      loadingDiv.className = "chat-pane__message chat-pane__message--loading";

      const spinner = doc.createElement("div");
      spinner.className = "chat-pane__loading-spinner";

      const loadingText = doc.createElement("span");
      loadingText.className = "chat-pane__loading-text";

      // Show "Extracting PDF..." if it's the first message
      loadingText.textContent = isFirstMessage ? "Extracting PDF..." : "Thinking...";

      loadingDiv.appendChild(spinner);
      loadingDiv.appendChild(loadingText);

      // Call handleChatSend which will append user message and context
      // User message is added FIRST, so we can render it immediately
      const sendPromise = handleChatSend({
        sessionId,
        provider,
        model,
        userText: text,
        itemID: itemID, // Pass itemID for PDF text extraction
      });

      // Render immediately to show user's message
      // Small delay to ensure the message is saved to session
      await new Promise(resolve => setTimeout(resolve, 10));
      if (currentRenderMessages) {
        await currentRenderMessages();
      }

      // Add loading indicator after user message is shown
      messagesBox.appendChild(loadingDiv);
      messagesBox.scrollTop = messagesBox.scrollHeight;

      // If it's the first message, we need to wait for PDF extraction before changing text
      if (isFirstMessage) {
        // Create a promise that resolves when context message is added
        // We'll poll the session to detect when context is added
        const waitForExtraction = async () => {
          const startTime = Date.now();
          const maxWaitTime = 60000 * 10; // 30 seconds max

          while (Date.now() - startTime < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, 500)); // Check every 500ms

            const currentSession = await getSession(sessionId, ztoolkit);
            // Check if context message has been added (it comes after system and user)
            const hasContext = currentSession.some(msg => msg.role === 'context');

            if (hasContext && loadingDiv.isConnected) {
              loadingText.textContent = "Thinking...";
              break;
            }
          }
        };

        // Start polling in background
        waitForExtraction();
      }

      // Now wait for the AI response (including PDF extraction on first message)
      const result = await sendPromise;

      // Remove loading indicator
      loadingDiv.remove();

      // Update UI with the assistant's response
      if (currentRenderMessages) {
        await currentRenderMessages();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ztoolkit.log("Error sending message:", msg);

      // Show error in UI
      if (currentRenderMessages) {
        await currentRenderMessages();
      }
    } finally {
      input.disabled = false;
      sendButton.disabled = !input.value.trim();
      input.focus();
    }
  };

  sendButton.addEventListener("click", send);
  input.addEventListener("keydown", (ev: KeyboardEvent) => {
    // Enter sends, Shift+Enter inserts newline
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      send();
    }
  });
  input.addEventListener("input", updateSendState);
  updateSendState();

  // Build hierarchy: input wrapper contains input + send button
  inputWrapper.appendChild(providerSelect);
  inputWrapper.appendChild(modelSelect);
  inputWrapper.appendChild(sendButton);

  // Input area contains input wrapper, then model select below
  inputArea.appendChild(input);
  inputArea.appendChild(inputWrapper);

  // Main container holds messages + input area
  container.appendChild(messagesBox);
  container.appendChild(inputArea);
  body.appendChild(container);

  // Add resize listener
  const handleResize = () => {
    // Check if body is still connected to the DOM before updating
    if (body && body.isConnected) {
      onUpdateHeight({ body });
    } else {
      // Remove listener if body is no longer in DOM
      win?.removeEventListener("resize", handleResize);
    }
  };

  const win = doc.defaultView;
  win?.addEventListener("resize", handleResize);
}

function onUpdateHeight({ body }: { body: HTMLElement }) {
  // Double-check that body is still in the DOM
  if (!body || !body.isConnected) {
    return;
  }

  const details = body.closest("item-details");
  const head = body.closest("item-pane-custom-section")?.querySelector(".head");

  if (!details || !head) {
    // Silently return - this is normal during certain render states
    return;
  }

  const viewItem = details.querySelector(".zotero-view-item");
  if (!viewItem) {
    // Silently return - this is normal during certain render states
    return;
  }

  body.style.height = `${viewItem.clientHeight - (head as HTMLElement).clientHeight - 8}px`;
}
