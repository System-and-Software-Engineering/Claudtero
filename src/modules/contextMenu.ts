import { openSidebarAndShowChat, setPendingHighlightedSelection } from "./chat";

export class ContextMenu {
  private static readonly askButtonSelector =
    '[data-claudtero-selection-action="ask"]';

  private static isRegistered = false;

  static setup() {
    if (ContextMenu.isRegistered) {
      return;
    }

    // Register into the PDF reader menu events
    Zotero.Reader.registerEventListener(
      "renderTextSelectionPopup",
      ContextMenu.onReaderPopupShow,
      addon.data.config.addonID,
    );

    ContextMenu.isRegistered = true;
  }

  static onReaderPopupShow(
    event: _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">,
  ) {
    const { reader, doc } = event;
    const annotation = event.params.annotation;

    // Selected text
    const selectedText = annotation.text ?? "";

    if (!selectedText) return;

    const popup = doc.querySelector(".selection-popup") as HTMLDivElement;
    if (!popup) {
      return;
    }

    const existingButton = popup.querySelector(
      ContextMenu.askButtonSelector,
    ) as HTMLButtonElement | null;
    if (existingButton) {
      existingButton.remove();
    }

    // Create button
    const askButton = doc.createElement("button");
    askButton.setAttribute("data-claudtero-selection-action", "ask");
    askButton.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;">
        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>
        <circle cx="9" cy="14" r="1"/>
        <circle cx="15" cy="14" r="1"/>
      </svg>
      <span style="vertical-align: middle; font-weight: 600;">Ask with Claudtero</span>
    `;
    askButton.style.cssText = `
      margin-top: 8px;
      padding: 8px 16px;
      background: linear-gradient(180deg, #f7f7f8 0%, #eef1f7 100%);
      color: #1f2430;
      border: 1px solid #d8d8dc;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
      transition: all 120ms ease;
    `;

    askButton.addEventListener("mouseenter", () => {
      askButton.style.background = "linear-gradient(180deg, #eef1f7 0%, #e5e9f2 100%)";
      askButton.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.1)";
      askButton.style.borderColor = "#c0c4cc";
    });

    askButton.addEventListener("mouseleave", () => {
      askButton.style.background = "linear-gradient(180deg, #f7f7f8 0%, #eef1f7 100%)";
      askButton.style.boxShadow = "0 1px 2px rgba(0, 0, 0, 0.05)";
      askButton.style.borderColor = "#d8d8dc";
    });

    askButton.addEventListener("click", () => {
      const itemID = reader?.itemID;
      if (!itemID) {
        return;
      }

      const rawAnnotation = annotation as typeof annotation & {
        annotationPosition?: string | { pageIndex?: number };
      };
      const position = rawAnnotation.position ?? rawAnnotation.annotationPosition ?? null;
      const parsedPosition = typeof position === "string" ? JSON.parse(position) : position;
      const pageIndex = Number(parsedPosition?.pageIndex);

      setPendingHighlightedSelection(itemID, {
        text: selectedText,
        pageNumber: Number.isFinite(pageIndex) ? pageIndex + 1 : null,
      });

      openSidebarAndShowChat(undefined, itemID);
    });

    // Add to popup
    popup.appendChild(askButton);
  }
}