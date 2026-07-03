import { describe, expect, test } from "vitest";
import { DEFAULT_DETAIL, DEFAULT_FORMAT, defaultOutputPath, isDocumentShorthand } from "../src/options.js";

describe("agent-friendly defaults", () => {
  test("uses a general balanced episode by default", () => {
    expect(DEFAULT_FORMAT).toBe("expert-curious");
    expect(DEFAULT_DETAIL).toBe("balanced");
  });

  test("derives an MP3 beside the source document", () => {
    expect(defaultOutputPath("/tmp/research.report.md")).toBe("/tmp/research.report.mp3");
    expect(defaultOutputPath("/tmp/notes.txt")).toBe("/tmp/notes.mp3");
  });

  test("recognizes supported document shorthand only", () => {
    expect(isDocumentShorthand("report.md")).toBe(true);
    expect(isDocumentShorthand("REPORT.TXT")).toBe(true);
    expect(isDocumentShorthand("build")).toBe(false);
    expect(isDocumentShorthand("report.pdf")).toBe(false);
  });
});
