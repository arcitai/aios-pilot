import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { JSDOM } from "jsdom";

const previewUrl =
  "http://127.0.0.1:3351/previews/0123456789abcdef0123456789abcdef";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
let React;
let cleanup;
let render;
let screen;
let SitePreview;

before(async () => {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  ({ default: React } = await import("react"));
  ({ cleanup, render, screen } = await import("@testing-library/react"));
  ({ SitePreview } = await import("./SitePreview.tsx"));
});

after(() => {
  cleanup();
  dom.window.close();
});

test("keeps an explicit browser link when the preview can also embed", () => {
  render(
    React.createElement(SitePreview, {
      previewUrl,
      configured: true,
      loading: false,
      error: null,
      isCurrentSnapshot: true,
      previewExpiresAt: Date.now() + 60_000,
      onRun() {},
      disabled: false,
    }),
  );

  const link = screen.getByRole("link", { name: "Open preview in browser" });
  assert.equal(link.href, previewUrl);
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  assert.equal(
    screen.getByTitle("Sandboxed site preview").getAttribute("src"),
    previewUrl,
  );
});
