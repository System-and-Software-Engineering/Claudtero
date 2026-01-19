import { config } from "../../package.json";
import { sendToSidebarChat, openSidebarAndShowChat } from "./chat";

declare const document: Document;

export class ContextMenu {
  static setup() {
    // Register into the PDF reader menu events
    Zotero.Reader.registerEventListener(
      "renderTextSelectionPopup",
      ContextMenu.onReaderPopupShow,
      addon.data.config.addonID,
    );

    ztoolkit.log(`${config.addonRef}: Context menu registered.`);
  }

  static onReaderPopupShow(
    event: _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">,
  ) {
    const { reader, doc } = event;
    const annotation = event.params.annotation;

    // Selected text
    const selectedText = annotation.text ?? "";

    ztoolkit.log("Selected text for popup chat:", selectedText);

    if (!selectedText) return;

    const popup = doc.querySelector(".selection-popup") as HTMLDivElement;
    popup.style.maxWidth = "none";

    const colors = popup.querySelector(".colors") as HTMLDivElement;
    colors.style.width = "100%";
    colors.style.justifyContent = "space-evenly";

    const document = event.doc;

    // Inject CSS if not already present
    if (!doc.querySelector(`link[href*="chatWindow.css"]`)) {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = `chrome://${config.addonRef}/content/chatWindow.css`;
      doc.documentElement?.appendChild(link);
    }

    // Main container styled like sidebar input area
    const container = document.createElement("div");
    container.className = "chat-pane__input-area popup-input-area";
    container.style.marginTop = "8px";
    container.style.minWidth = "280px";

    // Use textarea for multiline input with fixed height and scroll
    const input = document.createElement("textarea") as HTMLTextAreaElement;
    input.value = "";
    input.placeholder = "Ask about this selection...";
    input.className = "chat-pane__input";
    input.rows = 4;
    input.style.resize = "none";
    input.style.height = "80px";
    input.style.overflowY = "auto";
    input.style.width = "100%";
    container.appendChild(input);

    // Inner wrapper for model select + send icon (like sidebar)
    const inputWrapper = document.createElement("div");
    inputWrapper.className = "chat-pane__input-wrapper";

    // Send button with icon (like sidebar)
    const sendButton = document.createElement("button") as HTMLButtonElement;
    sendButton.className = "chat-pane__send";
    sendButton.setAttribute("aria-label", "Send message");
    sendButton.style.marginLeft = "auto";
    sendButton.style.marginRight = "8px";

    const sendIcon = document.createElement("img");
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

      ztoolkit.log("=== CONTEXT MENU SEND ===");
      ztoolkit.log("User input:", text);
      ztoolkit.log("Selected text:", selectedText);
      ztoolkit.log("Selected text length:", selectedText.length);

      // Escape the selected text properly for quotes and backslashes
      const escapedSelection = selectedText.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      // Combine selection and user text: "selection"\n\nuserText
      const combinedMessage = '"' + escapedSelection + '"\n\n' + text;

      ztoolkit.log("Combined message:", combinedMessage);
      ztoolkit.log("Combined message length:", combinedMessage.length);

      // Get current item from reader
      const itemID = reader?.itemID;

      // Send to sidebar chat
      sendToSidebarChat(combinedMessage, itemID);

      // Open sidebar and show chat
      openSidebarAndShowChat();

      // Clear input
      input.value = "";
      updateSendState();
    };

    // Send button click handler - NOT using capture phase
    sendButton.addEventListener("click", (ev: MouseEvent) => {
      ztoolkit.log("Send button clicked!");
      ev.stopPropagation();
      ev.preventDefault();
      send();
    });

    // Prevent ALL events on container and input from bubbling up
    const interceptEvent = (ev: Event) => {
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    };

    // Input events - capture phase to intercept early
    input.addEventListener("keydown", (ev: KeyboardEvent) => {
      interceptEvent(ev);
      // Enter sends, Shift+Enter inserts newline
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        send();
      }
    }, { capture: true });

    input.addEventListener("keyup", interceptEvent, { capture: true });
    input.addEventListener("keypress", interceptEvent, { capture: true });
    input.addEventListener("input", (ev: Event) => {
      interceptEvent(ev);
      updateSendState();
    }, { capture: true });

    // Mouse events on input
    input.addEventListener("mousedown", interceptEvent, { capture: true });
    input.addEventListener("mouseup", interceptEvent, { capture: true });
    input.addEventListener("click", interceptEvent, { capture: true });

    // Container events (but not click - let button handle that)
    container.addEventListener("keydown", interceptEvent, { capture: true });
    container.addEventListener("keyup", interceptEvent, { capture: true });
    container.addEventListener("keypress", interceptEvent, { capture: true });
    container.addEventListener("mousedown", (ev: Event) => {
      // Don't intercept if it's the send button
      if (ev.target !== sendButton && !sendButton.contains(ev.target as Node)) {
        interceptEvent(ev);
      }
    }, { capture: true });
    container.addEventListener("mouseup", (ev: Event) => {
      if (ev.target !== sendButton && !sendButton.contains(ev.target as Node)) {
        interceptEvent(ev);
      }
    }, { capture: true });

    // Button needs to stop propagation but allow click through
    sendButton.addEventListener("mousedown", (ev: Event) => {
      ev.stopPropagation();
    }, { capture: true });
    sendButton.addEventListener("mouseup", (ev: Event) => {
      ev.stopPropagation();
    }, { capture: true });

    // Add global document-level event listeners to catch Delete/Backspace before popup handlers
    const globalKeyHandler = (ev: KeyboardEvent) => {
      // Only intercept if the input is focused or event comes from our elements
      if (doc.activeElement === input || container.contains(doc.activeElement)) {
        ztoolkit.log("Global key handler intercepting:", ev.key);
        ev.stopPropagation();
        ev.stopImmediatePropagation();

        // Let the input handle it naturally
        if (ev.key === "Enter" && !ev.shiftKey && ev.type === "keydown") {
          ev.preventDefault();
          send();
        }
      }
    };

    doc.addEventListener("keydown", globalKeyHandler, { capture: true });
    doc.addEventListener("keyup", globalKeyHandler, { capture: true });
    doc.addEventListener("keypress", globalKeyHandler, { capture: true });

    updateSendState();

    // Build hierarchy
    inputWrapper.appendChild(sendButton);
    container.appendChild(inputWrapper);

    // Add to popup
    popup.appendChild(container);
  }


}