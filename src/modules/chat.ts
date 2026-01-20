import { getLocaleID } from "../utils/locale";
import { config } from "../../package.json";

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
  openSidebarAndShowChat(mainWin, targetItemID);

  // If we have a render function and it's for the same item, update the UI
  if (currentRenderMessages && currentItemID === targetItemID) {
    currentRenderMessages();
  }
}

/**
 * Opens the sidebar if closed and scrolls to the chat pane.
 * Optionally prefills the input with text.
 */
export function openSidebarAndShowChat(
  win?: _ZoteroTypes.MainWindow,
  itemID?: number,
  prefillText?: string
) {
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
          ztoolkit.log(`Item ${itemID} is an attachment, using parent ${parentItemID}`);
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
          const input = currentBody.querySelector(".chat-pane__input") as HTMLTextAreaElement;
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

  const modelSelect = doc.createElement("select");
  modelSelect.className = "chat-pane__model-select";
  ["Claude 4.5", "Claude 3.7", "GPT-4o", "GPT-3.5"].forEach((label) => {
    const opt = doc.createElement("option");
    opt.value = label;
    opt.textContent = label;
    modelSelect.appendChild(opt);
  });
  modelSelect.value = "Claude 4.5";

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

  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    chatsByItem[itemID].push({ text, from: "me" });
    // Echo back as if from other party
    chatsByItem[itemID].push({ text, from: "other" });
    input.value = "";
    renderMessages();
    updateSendState();
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
