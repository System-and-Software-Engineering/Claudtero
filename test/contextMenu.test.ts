import { assert } from "chai";
import { ContextMenu } from "../src/modules/contextMenu";

class FakeElement {
  childNodes: FakeElement[] = [];
  attributes = new Map<string, string>();
  style = { cssText: "", background: "", boxShadow: "", borderColor: "" };
  innerHTML = "";

  constructor(public readonly tagName: string, private readonly className = "") {}

  appendChild(child: FakeElement): FakeElement {
    this.childNodes.push(child);
    return child;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(_type: string, _listener: () => void) {
    return undefined;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return this.find((node) => node.className.split(/\s+/).includes(className));
    }

    const attributeMatch = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
    if (attributeMatch) {
      const [, name, value] = attributeMatch;
      return this.find((node) => node.getAttribute(name) === value);
    }

    return null;
  }

  private find(predicate: (node: FakeElement) => boolean): FakeElement | null {
    for (const child of this.childNodes) {
      if (predicate(child)) {
        return child;
      }

      const nested = child.find(predicate);
      if (nested) {
        return nested;
      }
    }

    return null;
  }
}

class FakeDocument {
  constructor(private readonly popup: FakeElement) {}

  querySelector(selector: string): FakeElement | null {
    if (selector === ".selection-popup") {
      return this.popup;
    }

    return this.popup.querySelector(selector);
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

describe("context menu", function () {
  it("adds only one Ask with Claudtero button when the popup is rendered multiple times", function () {
    const popup = new FakeElement("div", "selection-popup");
    const doc = new FakeDocument(popup);
    const event = {
      reader: { itemID: 1 },
      doc,
      params: {
        annotation: {
          text: "Selected text",
          position: JSON.stringify({ pageIndex: 1 }),
        },
      },
    } as unknown as _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">;

    ContextMenu.onReaderPopupShow(event);
    ContextMenu.onReaderPopupShow(event);

    const askButton = popup.querySelector(
      '[data-claudtero-selection-action="ask"]',
    );

    assert.isNotNull(askButton);
    assert.strictEqual(popup.childNodes.length, 1);
    assert.include(popup.childNodes[0].innerHTML, "Ask with Claudtero");
  });
});