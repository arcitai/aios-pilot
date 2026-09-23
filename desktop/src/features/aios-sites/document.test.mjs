import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_SITE_DOCUMENT_BYTES,
  MAX_SITE_HTML_CODE_UNITS,
  MAX_SITE_CSS_CODE_UNITS,
  MAX_SITE_JS_CODE_UNITS,
  MAX_SITE_TITLE_CODE_UNITS,
  isSiteChannelDescription,
  newSiteDocument,
  parseSiteDocument,
  serializeSiteDocument,
  siteChannelDescription,
  siteChannelName,
} from "./document.ts";

const lengthContract = JSON.parse(
  readFileSync(
    new URL(
      "../../../../fixtures/aios-sites/site-v1-length-contract.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const siteFixture = JSON.parse(
  readFileSync(
    new URL("../../../../fixtures/aios-sites/site-v1.json", import.meta.url),
    "utf8",
  ),
);

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

test("shared Sites fixture and Unicode field limits match UTF-16 code units", () => {
  assert.deepEqual(lengthContract.limits, {
    title: MAX_SITE_TITLE_CODE_UNITS,
    indexHtml: MAX_SITE_HTML_CODE_UNITS,
    styleCss: MAX_SITE_CSS_CODE_UNITS,
    appJs: MAX_SITE_JS_CODE_UNITS,
    document: MAX_SITE_DOCUMENT_BYTES,
  });
  assert.deepEqual(
    parseSiteDocument(
      JSON.stringify(siteFixture),
      siteFixture.parentBusinessChannelId,
    ),
    siteFixture,
  );

  const { sample } = lengthContract.unicode;
  const danishTitle = sample.repeat(lengthContract.unicode.validTitleCodeUnits);
  assert.equal(danishTitle.length, 100);
  assert.ok(
    new TextEncoder().encode(danishTitle).byteLength > danishTitle.length,
  );
  assert.doesNotThrow(() =>
    serializeSiteDocument(newSiteDocument(siteId, parentId, danishTitle)),
  );
  assert.throws(
    () =>
      newSiteDocument(
        siteId,
        parentId,
        sample.repeat(lengthContract.unicode.overflowTitleCodeUnits),
      ),
    /Too big/,
  );

  const unicodeHtml = newSiteDocument(siteId, parentId, "Unicode HTML");
  unicodeHtml.files.indexHtml = sample.repeat(
    lengthContract.unicode.validIndexHtmlCodeUnits,
  );
  assert.ok(
    new TextEncoder().encode(unicodeHtml.files.indexHtml).byteLength >
      MAX_SITE_HTML_CODE_UNITS,
  );
  assert.doesNotThrow(() => serializeSiteDocument(unicodeHtml));

  const unicodeStyles = newSiteDocument(siteId, parentId, "Unicode styles");
  unicodeStyles.files.styleCss = sample.repeat(
    lengthContract.unicode.validStyleCssCodeUnits,
  );
  unicodeStyles.files.appJs = sample.repeat(
    lengthContract.unicode.validAppJsCodeUnits,
  );
  assert.ok(
    new TextEncoder().encode(unicodeStyles.files.styleCss).byteLength >
      MAX_SITE_CSS_CODE_UNITS,
  );
  assert.ok(
    new TextEncoder().encode(unicodeStyles.files.appJs).byteLength >
      MAX_SITE_JS_CODE_UNITS,
  );
  assert.doesNotThrow(() => serializeSiteDocument(unicodeStyles));
});

test("each Sites v1 field limit rejects the first excess UTF-16 code unit", () => {
  const document = newSiteDocument(siteId, parentId, "Boundary");
  assert.throws(() =>
    serializeSiteDocument({
      ...document,
      title: "x".repeat(MAX_SITE_TITLE_CODE_UNITS + 1),
    }),
  );
  assert.throws(() =>
    serializeSiteDocument({
      ...document,
      files: {
        ...document.files,
        indexHtml: "x".repeat(MAX_SITE_HTML_CODE_UNITS + 1),
      },
    }),
  );
  assert.throws(() =>
    serializeSiteDocument({
      ...document,
      files: {
        ...document.files,
        styleCss: "x".repeat(MAX_SITE_CSS_CODE_UNITS + 1),
      },
    }),
  );
  assert.throws(() =>
    serializeSiteDocument({
      ...document,
      files: {
        ...document.files,
        appJs: "x".repeat(MAX_SITE_JS_CODE_UNITS + 1),
      },
    }),
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
