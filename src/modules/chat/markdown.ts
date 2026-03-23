function appendText(fragment: DocumentFragment, doc: Document, text: string) {
  if (!text) {
    return;
  }
  fragment.appendChild(doc.createTextNode(text));
}

function appendInlineMarkdown(
  target: HTMLElement,
  doc: Document,
  source: string,
) {
  const fragment = doc.createDocumentFragment();
  const pattern =
    /(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    appendText(fragment, doc, source.slice(lastIndex, match.index));
    const token = match[0];

    if (match[1] && match[2]) {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (linkMatch) {
        const link = doc.createElement("a");
        link.href = linkMatch[2];
        link.textContent = linkMatch[1];
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "chat-pane__md-link";
        fragment.appendChild(link);
      }
    } else if (match[3]) {
      const code = doc.createElement("code");
      code.textContent = token.slice(1, -1);
      code.className = "chat-pane__md-inline-code";
      fragment.appendChild(code);
    } else if (match[4] || match[5]) {
      const strong = doc.createElement("strong");
      strong.textContent = token.slice(2, -2);
      fragment.appendChild(strong);
    } else if (match[6] || match[7]) {
      const emphasis = doc.createElement("em");
      emphasis.textContent = token.slice(1, -1);
      fragment.appendChild(emphasis);
    } else {
      appendText(fragment, doc, token);
    }

    lastIndex = pattern.lastIndex;
  }

  appendText(fragment, doc, source.slice(lastIndex));
  target.appendChild(fragment);
}

function appendParagraph(target: HTMLElement, doc: Document, lines: string[]) {
  if (!lines.length) {
    return;
  }

  const paragraph = doc.createElement("p");
  paragraph.className = "chat-pane__md-paragraph";

  lines.forEach((line, index) => {
    if (index > 0) {
      paragraph.appendChild(doc.createElement("br"));
    }
    appendInlineMarkdown(paragraph, doc, line);
  });

  target.appendChild(paragraph);
}

function appendHeading(
  target: HTMLElement,
  doc: Document,
  level: number,
  text: string,
) {
  const heading = doc.createElement(`h${Math.min(Math.max(level, 1), 6)}`);
  heading.className = "chat-pane__md-heading";
  appendInlineMarkdown(heading, doc, text);
  target.appendChild(heading);
}

function appendList(
  target: HTMLElement,
  doc: Document,
  lines: string[],
  ordered: boolean,
) {
  const list = doc.createElement(ordered ? "ol" : "ul");
  list.className = "chat-pane__md-list";

  for (const line of lines) {
    const content = ordered
      ? line.replace(/^\d+\.\s+/, "")
      : line.replace(/^[-*+]\s+/, "");
    const item = doc.createElement("li");
    appendInlineMarkdown(item, doc, content);
    list.appendChild(item);
  }

  target.appendChild(list);
}

function appendBlockquote(target: HTMLElement, doc: Document, lines: string[]) {
  const blockquote = doc.createElement("blockquote");
  blockquote.className = "chat-pane__md-blockquote";
  appendParagraph(
    blockquote,
    doc,
    lines.map((line) => line.replace(/^>\s?/, "")),
  );
  target.appendChild(blockquote);
}

function appendCodeBlock(
  target: HTMLElement,
  doc: Document,
  lines: string[],
  language = "",
) {
  const pre = doc.createElement("pre");
  pre.className = "chat-pane__md-code-block";
  const code = doc.createElement("code");
  if (language) {
    code.setAttribute("data-language", language);
  }
  code.textContent = lines.join("\n");
  pre.appendChild(code);
  target.appendChild(pre);
}

function appendHorizontalRule(target: HTMLElement, doc: Document) {
  const rule = doc.createElement("hr");
  rule.className = "chat-pane__md-rule";
  target.appendChild(rule);
}

export function renderMarkdown(
  target: HTMLElement,
  doc: Document,
  source: string,
) {
  target.textContent = "";
  target.classList.add("chat-pane__message-content");

  const normalizedSource = source.replace(/\r\n?/g, "\n");
  const lines = normalizedSource.split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(/^```([^\s`]*)\s*$/);
    if (fenceMatch) {
      const codeLines: string[] = [];
      const language = fenceMatch[1] ?? "";
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      appendCodeBlock(target, doc, codeLines, language);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      appendHeading(target, doc, headingMatch[1].length, headingMatch[2]);
      index += 1;
      continue;
    }

    if (/^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      appendHorizontalRule(target, doc);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index]);
        index += 1;
      }
      appendBlockquote(target, doc, quoteLines);
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const listLines: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      appendList(target, doc, listLines, false);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const listLines: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      appendList(target, doc, listLines, true);
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```/.test(lines[index]) &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !/^[-*+]\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    appendParagraph(target, doc, paragraphLines);
  }

  if (!target.childNodes.length) {
    appendParagraph(target, doc, [source]);
  }
}