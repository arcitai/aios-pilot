import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SITE_DOCUMENT_BYTES,
  isSiteChannelDescription,
  newSiteDocument,
  parseSiteDocument,
  serializeSiteDocument,
  siteChannelDescription,
  siteChannelName,
} from "./document.ts";

const parentId = "11111111-1111-4111-8111-111111111111";
const siteId = "22222222-2222-4222-8222-222222222222";

test("Sites v1 serializes a strict, parent-bound canvas document", () => {
  const document = newSiteDocument(siteId, parentId, "Acme launch page");
  document.files.indexHtml = "<main>Acme</main>";
  const encoded = serializeSiteDocument(document);

  assert.deepEqual(parseSiteDocument(encoded, parentId), document);
  assert.throws(
    () => parseSiteDocument(encoded, "different-business"),
    /different business workspace/,
  );
  assert.throws(
    () =>
      parseSiteDocument(
        encoded.replace('"schemaVersion": 1', '"schemaVersion": 2'),
      ),
    /supported Sites v1 schema/,
  );
  assert.throws(
    () =>
      parseSiteDocument(
        encoded.replace(
          '"kind": "aios.site",',
          '"kind": "aios.site",\n  "unexpected": true,',
        ),
      ),
    /supported Sites v1 schema/,
  );
});

test("Sites document rejects invalid ids, blank titles, and oversized UTF-8 content", () => {
  assert.throws(() => newSiteDocument("../outside", parentId, "Unsafe"));
  assert.throws(() => newSiteDocument(siteId, parentId, "   "));

  const tooLarge = JSON.stringify({
    ...newSiteDocument(siteId, parentId, "Large"),
    files: {
      indexHtml: "x".repeat(MAX_SITE_DOCUMENT_BYTES),
      styleCss: "",
      appJs: "",
    },
  });
  assert.throws(() => parseSiteDocument(tooLarge), /200 KB limit/);
});

test("site channel marker is exact and scoped to the business parent", () => {
  const description = siteChannelDescription(parentId);
  assert.ok(description.includes(parentId));
  assert.equal(isSiteChannelDescription(description, parentId), true);
  assert.equal(
    isSiteChannelDescription(
      description,
      "33333333-3333-4333-8333-333333333333",
    ),
    false,
  );
  assert.equal(
    isSiteChannelDescription(`${description} extra`, parentId),
    false,
  );
});

test("channel names are readable, bounded, and safe for Buzz channel metadata", () => {
  const name = siteChannelName(
    "Café: April / landing page",
    "aaaaaaaa-1234-4567-abcd-0123456789ef",
  );
  assert.equal(name, "site-cafe-april-landing-page-89ef");
  assert.ok(name.length <= 48);
  assert.match(name, /^[a-z0-9-]+$/);
});
