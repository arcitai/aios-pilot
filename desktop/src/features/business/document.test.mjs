import assert from "node:assert/strict";
import test from "node:test";
import {
  businessProgress,
  newBusinessDocument,
  parseBusinessDocument,
  serializeBusinessDocument,
} from "./document.ts";

test("business context round-trips company and attributable source text", () => {
  const doc = newBusinessDocument("Example Studio");
  doc.company.summary = "We design useful websites.";
  doc.sources.push({
    id: "brief",
    title: "Company brief",
    kind: "url",
    content: "Customer supplied text",
    url: "https://example.com/brief",
    createdAt: "2026-09-23T18:00:00.000Z",
  });
  assert.deepEqual(parseBusinessDocument(serializeBusinessDocument(doc)), doc);
});

test("rejects ordinary canvases, unknown versions, duplicate source ids and executable links", () => {
  assert.throws(() => parseBusinessDocument("# An ordinary canvas"));
  const doc = newBusinessDocument();
  assert.throws(() =>
    parseBusinessDocument(JSON.stringify({ ...doc, schemaVersion: 2 })),
  );
  const source = {
    id: "a",
    title: "A",
    kind: "note",
    content: "Text",
    createdAt: "2026-09-23T18:00:00Z",
  };
  assert.throws(() =>
    serializeBusinessDocument({ ...doc, sources: [source, source] }),
  );
  assert.throws(() =>
    serializeBusinessDocument({
      ...doc,
      sources: [{ ...source, url: "javascript:alert(1)" }],
    }),
  );
});

test("caps complete serialized documents, including UTF-8 content", () => {
  const doc = newBusinessDocument();
  doc.sources = Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    title: "Source",
    kind: "note",
    content: "ø".repeat(20000),
    createdAt: "2026-09-23T18:00:00Z",
  }));
  assert.throws(() => serializeBusinessDocument(doc), /too large/);
});

test("a connection descriptor alone does not complete the connection step", () => {
  const doc = newBusinessDocument();
  doc.connections.push({
    id: "github",
    provider: "github",
    label: "GitHub",
    status: "not_configured",
  });
  assert.equal(businessProgress(doc)[3].done, false);
});
