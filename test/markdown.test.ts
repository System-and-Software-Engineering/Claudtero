import { assert } from "chai";
import { renderMarkdown } from "../src/modules/chat/markdown";

class FakeTextNode {
  constructor(private value: string) {}

  get textContent(): string {
    return this.value;
  }

  set textContent(nextValue: string) {
    this.value = nextValue;
  }
}

class FakeDocumentFragment {
  childNodes: Array<FakeElement | FakeTextNode> = [];

  appendChild(node: FakeElement | FakeTextNode): FakeElement | FakeTextNode {
    this.childNodes.push(node);
    return node;
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }
}

class FakeClassList {
  constructor(private element: FakeElement) {}

  add(...tokens: string[]) {
    const values = this.element.className.split(/\s+/).filter(Boolean);

    for (const token of tokens) {
      if (!values.includes(token)) {
        values.push(token);
      }
    }

    this.element.className = values.join(" ");
  }
}

class FakeElement {
  childNodes: Array<FakeElement | FakeTextNode> = [];
  attributes = new Map<string, string>();
  className = "";
  classList = new FakeClassList(this);

  constructor(
    public readonly tagName: string,
    public readonly ownerDocument: FakeDocument,
  ) {}

  appendChild(
    node: FakeElement | FakeTextNode | FakeDocumentFragment,
  ): FakeElement | FakeTextNode | FakeDocumentFragment {
    if (node instanceof FakeDocumentFragment) {
      for (const child of node.childNodes) {
        this.childNodes.push(child);
      }
      return node;
    }

    this.childNodes.push(node);
    return node;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  set href(value: string) {
    this.setAttribute("href", value);
  }

  set target(value: string) {
    this.setAttribute("target", value);
  }

  set rel(value: string) {
    this.setAttribute("rel", value);
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.childNodes = value ? [new FakeTextNode(value)] : [];
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const tokens = selector
      .trim()
      .split(/\s+/)
      .map((token) => token.toLowerCase());
    const results: FakeElement[] = [];

    const visit = (node: FakeElement, path: FakeElement[]) => {
      for (const child of node.childNodes) {
        if (!(child instanceof FakeElement)) {
          continue;
        }

        const childPath = [...path, child];
        if (matchesSelectorPath(childPath, tokens)) {
          results.push(child);
        }
        visit(child, childPath);
      }
    };

    visit(this, []);
    return results;
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName.toLowerCase(), this);
  }

  createTextNode(text: string): FakeTextNode {
    return new FakeTextNode(text);
  }

  createDocumentFragment(): FakeDocumentFragment {
    return new FakeDocumentFragment();
  }
}

function matchesSelectorPath(path: FakeElement[], tokens: string[]): boolean {
  let pathIndex = path.length - 1;

  for (let tokenIndex = tokens.length - 1; tokenIndex >= 0; tokenIndex -= 1) {
    while (pathIndex >= 0 && path[pathIndex].tagName !== tokens[tokenIndex]) {
      pathIndex -= 1;
    }

    if (pathIndex < 0) {
      return false;
    }

    pathIndex -= 1;
  }

  return true;
}

describe("markdown rendering", function () {
  it("renders headings, lists, links, inline code, and fenced code blocks", function () {
    const doc = new FakeDocument();
    const target = doc.createElement("div");

    renderMarkdown(
      target as unknown as HTMLElement,
      doc as unknown as Document,
      [
        "# Heading",
        "",
        "- first item",
        "- second item",
        "",
        "See [example](https://example.com) and `code`.",
        "",
        "```ts",
        "const answer = 42;",
        "```",
      ].join("\n"),
    );

    assert.strictEqual(target.querySelector("h1")?.textContent, "Heading");
    assert.deepEqual(
      Array.from(target.querySelectorAll("li")).map((node) => node.textContent),
      ["first item", "second item"],
    );
    assert.strictEqual(
      target.querySelector("a")?.getAttribute("href"),
      "https://example.com",
    );
    assert.strictEqual(target.querySelector("a")?.textContent, "example");
    assert.strictEqual(target.querySelector("code")?.textContent, "code");
    assert.include(target.querySelector("pre code")?.textContent ?? "", "const answer = 42;");
  });

  it("renders an empty source into an empty paragraph container instead of crashing", function () {
    const doc = new FakeDocument();
    const target = doc.createElement("div");

    renderMarkdown(target as unknown as HTMLElement, doc as unknown as Document, "");

    assert.strictEqual(target.querySelectorAll("p").length, 1);
    assert.strictEqual(target.textContent, "");
  });

  it("renders large markdown within the performance budget", function () {
    this.timeout(5000);

    const doc = new FakeDocument();
    const target = doc.createElement("div");
    const largeMarkdown = Array.from({ length: 600 }, (_, index) => {
      return [
        `## Section ${index + 1}`,
        "",
        "- point A",
        "- point B",
        "",
        `Paragraph with [link](https://example.com/${index}) and \`code\`.`,
      ].join("\n");
    }).join("\n\n");

    const start = Date.now();
    renderMarkdown(
      target as unknown as HTMLElement,
      doc as unknown as Document,
      largeMarkdown,
    );
    const durationMs = Date.now() - start;

    assert.isAbove(target.querySelectorAll("h2").length, 500);
    assert.isBelow(durationMs, 1000);
  });
});