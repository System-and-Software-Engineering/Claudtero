import { assert } from "chai";
import {
  extractOpenPdfAllPageTexts,
  extractOpenPdfPageText,
  extractOpenPdfText,
  getOpenPdfPageCount,
} from "../src/modules/pdf/getPdfText";
import {
  createZtoolkitMock,
  installPdfContext,
  restoreTestGlobals,
  snapshotTestGlobals,
  type TestGlobalsSnapshot,
} from "./helpers/testSupport";

describe("pdf extraction", function () {
  let snapshot: TestGlobalsSnapshot;

  beforeEach(function () {
    snapshot = snapshotTestGlobals();
  });

  afterEach(function () {
    restoreTestGlobals(snapshot);
  });

  it("uses cached attachment text before PDFWorker full-text extraction", async function () {
    const metrics = installPdfContext({
      attachmentText: "Cached full document text.",
      workerText: "Worker text should not be used.",
    });

    const text = await extractOpenPdfText(createZtoolkitMock());

    assert.strictEqual(text, "Cached full document text.");
    assert.strictEqual(metrics.fullTextCalls, 0);
  });

  it("falls back to PDFWorker full-text extraction when attachment text is empty", async function () {
    const metrics = installPdfContext({
      attachmentText: "",
      workerText: "Recovered from PDFWorker.",
    });

    const text = await extractOpenPdfText(createZtoolkitMock());

    assert.strictEqual(text, "Recovered from PDFWorker.");
    assert.strictEqual(metrics.fullTextCalls, 1);
  });

  it("returns the PDF document page count when PDF.js is available", async function () {
    installPdfContext({
      pageTexts: ["Page 1", "Page 2", "Page 3", "Page 4"],
      recognizerPages: [{ text: "Page A" }],
    });

    const pageCount = await getOpenPdfPageCount(createZtoolkitMock());
    assert.strictEqual(pageCount, 4);
  });

  it("falls back to recognizer page count when the PDF document is unavailable", async function () {
    installPdfContext({
      noPdfDocument: true,
      recognizerPages: [{ text: "One" }, { text: "Two" }, { text: "Three" }],
    });

    const pageCount = await getOpenPdfPageCount(createZtoolkitMock());
    assert.strictEqual(pageCount, 3);
  });

  it("rejects invalid page numbers without attempting extraction", async function () {
    const logs: string[] = [];
    const metrics = installPdfContext({
      pageTexts: ["Page 1"],
    });

    const text = await extractOpenPdfPageText(createZtoolkitMock(logs), 0);

    assert.strictEqual(text, "");
    assert.deepEqual(metrics.requestedPages, []);
    assert.isTrue(
      logs.some((entry) => entry.includes("Invalid page number: 0")),
    );
  });

  it("uses recognizer pages when PDF.js returns only empty per-page text", async function () {
    installPdfContext({
      pageTexts: ["", ""],
      recognizerPages: [{ text: "Recognizer page 1" }, { text: "Recognizer page 2" }],
    });

    const pages = await extractOpenPdfAllPageTexts(createZtoolkitMock());

    assert.deepEqual(pages, [
      { pageNumber: 1, text: "Recognizer page 1" },
      { pageNumber: 2, text: "Recognizer page 2" },
    ]);
  });

  it("returns an empty page list when neither PDF.js nor recognizer can extract text", async function () {
    installPdfContext({
      pageTexts: ["", ""],
      recognizerPages: [{ text: "" }, { text: "" }],
    });

    const pages = await extractOpenPdfAllPageTexts(createZtoolkitMock());
    assert.deepEqual(pages, []);
  });
});