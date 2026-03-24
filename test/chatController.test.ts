import { assert } from "chai";
import {
  getAvailableModels,
  handlePreparedChatSend,
  prepareChatRequest,
} from "../src/modules/chat/chatController";
import { DEFAULT_SYSTEM_PROMPT } from "../src/modules/chat/systemPrompt";
import { getSession, resetSession } from "../src/modules/chat/sessionStore";
import {
  createFetchResponse,
  installGlobalZtoolkit,
  installPdfContext,
  installPrefs,
  restoreTestGlobals,
  snapshotTestGlobals,
  type TestGlobalsSnapshot,
} from "./helpers/testSupport";

describe("chat controller", function () {
  let snapshot: TestGlobalsSnapshot;

  beforeEach(function () {
    snapshot = snapshotTestGlobals();
  });

  afterEach(function () {
    resetSession("session-a");
    resetSession("session-b");
    resetSession("failure-session");
    restoreTestGlobals(snapshot);
  });

  it("builds a selected-text request from the source page without leaking secrets", async function () {
    installPrefs({
      goetheApiKey: "top-secret-api-key",
      goetheModel: "goethe-chat-model",
    });
    installPdfContext({
      currentPage: 2,
      pageTexts: ["Intro page", "Important source passage", "Result page"],
    });
    installGlobalZtoolkit({ selectedText: "Ignored reader selection" });

    const prepared = await prepareChatRequest({
      sessionId: "session-a",
      provider: "goethe",
      model: "",
      userText: "Explain this quote.",
      selectedText: "Selected claim from the PDF.",
      selectedPageNumber: 2,
    });

    assert.strictEqual(prepared.settings.apiKey, "top-secret-api-key");
    assert.strictEqual(prepared.settings.model, "goethe-chat-model");
    assert.include(
      prepared.finalUserContent,
      "Selected PDF text:\nSelected claim from the PDF.",
    );
    assert.include(
      prepared.finalUserContent,
      "Page 2\nImportant source passage",
    );
    assert.notInclude(prepared.finalUserContent, "top-secret-api-key");
  });

  it("keeps the prepared context payload identical across providers for the same selected-text request", async function () {
    installPrefs({
      localPort: "11434",
      ollamaModel: "local-model",
      goetheApiKey: "secret",
      goetheModel: "remote-model",
    });
    installPdfContext({
      currentPage: 1,
      pageTexts: ["The selected page text."],
    });
    installGlobalZtoolkit({ selectedText: "Selection from reader" });

    const request = {
      sessionId: "session-a",
      model: "",
      userText: "What does this mean?",
      selectedText: "Selection from reader",
      selectedPageNumber: 1,
    } as const;

    const goethePrepared = await prepareChatRequest({
      ...request,
      provider: "goethe",
    });
    const ollamaPrepared = await prepareChatRequest({
      ...request,
      provider: "ollama",
    });

    assert.strictEqual(
      goethePrepared.finalUserContent,
      ollamaPrepared.finalUserContent,
    );
    assert.notStrictEqual(goethePrepared.settings.model, ollamaPrepared.settings.model);
  });

  it("builds whole-document context for broad questions when no selection exists", async function () {
    installPrefs({
      goetheApiKey: "secret",
      goetheModel: "goethe-chat-model",
    });
    installPdfContext({
      attachmentText:
        "Full paper text covering introduction, methods, results, and conclusion.",
    });
    installGlobalZtoolkit({ selectedText: "" });
    globalThis.fetch = async () =>
      createFetchResponse({
        jsonData: {
          choices: [
            {
              message: {
                content:
                  '{"mode":"whole_document","reason":"summary","keywords":["summary"]}',
              },
            },
          ],
        },
      });

    const prepared = await prepareChatRequest({
      sessionId: "session-a",
      provider: "goethe",
      model: "",
      userText: "Summarize the paper.",
    });

    assert.include(prepared.finalUserContent, "Document context mode: whole_document");
    assert.include(
      prepared.finalUserContent,
      "Full paper text covering introduction, methods, results, and conclusion.",
    );
    assert.include(prepared.finalUserContent, '"mode": "whole_document"');
  });

  it("returns configured models for both providers", function () {
    installPrefs({
      ollamaModel: "qwen2.5:latest",
      goetheModel: "gpt-4o-mini",
    });

    const catalog = getAvailableModels();

    assert.deepEqual(catalog.providers, [
      {
        provider: "ollama",
        label: "Ollama",
        models: [{ label: "qwen2.5:latest", value: "qwen2.5:latest" }],
      },
      {
        provider: "goethe",
        label: "Goethe Uni",
        models: [{ label: "gpt-4o-mini", value: "gpt-4o-mini" }],
      },
    ]);
  });

  it("appends the system prompt only once across repeated sends", async function () {
    installPrefs({
      goetheApiKey: "secret",
    });
    installGlobalZtoolkit({ selectedText: "" });
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return createFetchResponse({
        jsonData: {
          choices: [
            {
              message: { content: `Assistant reply ${callCount}` },
            },
          ],
        },
      });
    };

    const preparedRequest = {
      settings: {
        apiKey: "secret",
        model: "goethe-model",
        temperature: 0.2,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
      },
      finalUserContent: "User question:\nExplain the methods.",
    };

    await handlePreparedChatSend(
      {
        sessionId: "session-b",
        provider: "goethe",
        model: "goethe-model",
        userText: "Explain the methods.",
      },
      preparedRequest,
    );
    await handlePreparedChatSend(
      {
        sessionId: "session-b",
        provider: "goethe",
        model: "goethe-model",
        userText: "Now summarize the conclusion.",
      },
      {
        ...preparedRequest,
        finalUserContent: "User question:\nNow summarize the conclusion.",
      },
    );

    const session = getSession("session-b");
    assert.strictEqual(
      session.filter((message) => message.role === "system").length,
      1,
    );
    assert.strictEqual(session.length, 5);
    assert.deepEqual(
      session.map((message) => message.role),
      ["system", "user", "assistant", "user", "assistant"],
    );
  });

  it("fails safely on provider errors without appending a user or assistant message", async function () {
    installPrefs({
      goetheApiKey: "secret",
    });
    installGlobalZtoolkit({ selectedText: "" });
    globalThis.fetch = async () => {
      throw new Error("provider unavailable");
    };

    const preparedRequest = {
      settings: {
        apiKey: "secret",
        model: "goethe-model",
        temperature: 0.2,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
      },
      finalUserContent: "User question:\nWhat is the main finding?",
    };

    let thrownError: unknown;

    try {
      await handlePreparedChatSend(
        {
          sessionId: "failure-session",
          provider: "goethe",
          model: "goethe-model",
          userText: "What is the main finding?",
        },
        preparedRequest,
      );
    } catch (error) {
      thrownError = error;
    }

    assert.instanceOf(thrownError, Error);
    assert.include(String((thrownError as Error).message), "provider unavailable");

    const session = getSession("failure-session");
    assert.deepEqual(session.map((message) => message.role), ["system"]);
  });
});