import assert from "node:assert/strict";
import test from "node:test";

import { newSiteDocument } from "./document.ts";
import { buildStandaloneHtml } from "./preview.ts";

const parentId = "11111111-1111-4111-8111-111111111111";
const siteId = "22222222-2222-4222-8222-222222222222";

test("standalone export is one offline HTML file without workspace identity", () => {
  const document = newSiteDocument(siteId, parentId, "Acme & Partners");
  document.files.indexHtml = "<main><h1>Welcome</h1></main>";
  document.files.styleCss = "h1::after { content: '</style>'; }";
  document.files.appJs = "document.title = '</script><script>bad()</script>'";
  const html = buildStandaloneHtml(document);

  assert.match(html, /<title>Acme &amp; Partners<\/title>/);
  assert.match(html, /<main><h1>Welcome<\/h1><\/main>/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, new RegExp(parentId));
  assert.doesNotMatch(html, new RegExp(siteId));
  assert.match(html, /<\\\/style>/i);
  assert.match(html, /<\\\/script>/i);
});
