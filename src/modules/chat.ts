import { getLocaleID } from "../utils/locale";
import { config } from "../../package.json";
import { getAvailableModels, handleChatSend } from "./chat/chatController";
import type { AIProvider } from "./ai/modelCatalog";
import { it } from "node:test";


type ChatEntry = { text: string; from: "me" | "other" };
const chatsByItem: Record<number, ChatEntry[]> = {};

let paneKey = "";

// Global reference to the current render function for external updates
let currentRenderMessages: (() => void) | null = null;
let currentItemID: number | null = null;
let currentBody: HTMLElement | null = null;

/**
 * Send a message to the sidebar chat from external sources (e.g., context menu, popup).
 * Opens the sidebar if not already open and scrolls to the chat pane.
 */
export function sendToSidebarChat(text: string, itemID?: number) {
  const mainWin = Zotero.getMainWindow();
  if (!mainWin) return;

  // Use the provided itemID or the currently selected item
  const targetItemID = itemID ?? currentItemID ?? Zotero.getActiveZoteroPane()?.getSelectedItems()?.[0]?.id;
  if (!targetItemID) {
    ztoolkit.log("No item selected to send message to");
    return;
  }

  // Ensure chat history exists for this item
  if (!chatsByItem[targetItemID]) {
    chatsByItem[targetItemID] = [];
  }

  // Add the message
  chatsByItem[targetItemID].push({ text, from: "me" });
  // Echo back as if from other party (for now, until AI integration)
  chatsByItem[targetItemID].push({ text, from: "other" });

  // Open sidebar and scroll to chat pane
  openSidebarAndShowChat(mainWin);

  // If we have a render function and it's for the same item, update the UI
  if (currentRenderMessages && currentItemID === targetItemID) {
    currentRenderMessages();
  }
}

/**
 * Opens the sidebar if closed and scrolls to the chat pane.
 */
export function openSidebarAndShowChat(win?: _ZoteroTypes.MainWindow) {
  const mainWin = win ?? Zotero.getMainWindow();
  if (!mainWin) return;

  const ZoteroContextPane = mainWin.ZoteroContextPane;

  // Open the context pane if not visible
  if (ZoteroContextPane && !ZoteroContextPane.splitter?.getAttribute("state")?.includes("open")) {
    // Try to open the pane
    const splitter = ZoteroContextPane.splitter;
    if (splitter) {
      splitter.setAttribute("state", "open");
    }
  }

  // Scroll to our chat pane if we have a paneKey
  if (paneKey && currentBody) {
    const details = currentBody.closest("item-details");
    if (details) {
      // Resize to full height
      onUpdateHeight({ body: currentBody });
      // @ts-expect-error 'item-details' is a custom element on Zotero
      details.scrollToPane(paneKey);
    }
  }
}

export class ChatPaneSection {
  static registerChatPaneSection() {
    const key = Zotero.ItemPaneManager.registerSection({
      paneID: "chat",
      pluginID: addon.data.config.addonID,

      header: {
        l10nID: getLocaleID("item-section-chat-head-text"),
        icon: "chrome://zotero/skin/20/universal/save.svg",
      },

      sidenav: {
        l10nID: getLocaleID("item-section-chat-sidenav-tooltip"),
        icon: "chrome://zotero/skin/20/universal/save.svg",
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
            // @ts-expect-error 'item-details' is a custom element on Zotero
            details.scrollToPane(paneKey);
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
  if (!chatsByItem[itemID]) {
    chatsByItem[itemID] = [];
  }

  // Store references for external access
  currentItemID = itemID;
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

  const renderMessages = () => {
    messagesBox.textContent = "";
    if (!chatsByItem[itemID].length) {
      const empty = doc.createElement("div");
      empty.className = "chat-pane__empty";
      empty.textContent = "No messages yet.";
      messagesBox.appendChild(empty);
      return;
    }
    for (const msg of chatsByItem[itemID]) {
      const p = doc.createElement("div");
      p.textContent = msg.text;
      p.className = `chat-pane__message chat-pane__message--${msg.from}`;
      p.style.whiteSpace = "pre-wrap"; // Preserve line breaks and wrap text
      messagesBox.appendChild(p);
    }
    messagesBox.scrollTop = messagesBox.scrollHeight;
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

    // Show user's message immediately
    chatsByItem[itemID].push({ text, from: "me" });
    input.value = "";
    renderMessages();
    updateSendState();

    // Disable UI during request
    sendButton.disabled = true;
    input.disabled = true;

    // Add a place holder bubble while waiting
    const thinking: ChatEntry = { text: "...", from: "other" };
    chatsByItem[itemID].push(thinking);
    renderMessages();

    try {
      // Use itemID as a simple per-item session key
      const sessionId = String(itemID);

      const result = await handleChatSend({
        sessionId,
        provider,
        model,
        userText: text,
      });

      thinking.text = result.assistantText;
      renderMessages();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      thinking.text = `Error; ${msg}`;
      renderMessages();
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
    onUpdateHeight({ body });
  };

  const win = doc.defaultView;
  win?.addEventListener("resize", handleResize);

  // Cleanup on re-render (optional, prevents duplicate listeners)
  const observer = new MutationObserver(() => {
    win?.removeEventListener("resize", handleResize);
  });
  observer.observe(body, { childList: true });
}

function onUpdateHeight({ body }: { body: HTMLElement }) {
  const details = body.closest("item-details");
  const head = body.closest("item-pane-custom-section")?.querySelector(".head");

  body.style.height = `${details!.querySelector(".zotero-view-item")!.clientHeight - head!.clientHeight - 8}px`;
}
