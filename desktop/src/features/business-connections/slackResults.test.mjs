import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SLACK_CHANNEL_RESULTS,
  mergeSlackChannelResults,
} from "./slackResults.ts";

function channel(id, name = `channel-${id}`) {
  return {
    id,
    name,
    isPrivate: false,
    url: `https://app.slack.com/archives/${id}`,
  };
}

test("Slack channel paging deduplicates IDs and keeps the latest metadata", () => {
  const results = mergeSlackChannelResults(
    [channel("C00000001"), channel("C00000002")],
    [channel("C00000002", "renamed"), channel("C00000003")],
  );
  assert.deepEqual(
    results.map((item) => item.id),
    ["C00000001", "C00000002", "C00000003"],
  );
  assert.equal(results[1].name, "renamed");
});

test("Slack channel paging never accumulates beyond its explicit cap", () => {
  const results = mergeSlackChannelResults(
    Array.from({ length: MAX_SLACK_CHANNEL_RESULTS }, (_, index) =>
      channel(`C${String(index).padStart(8, "0")}`),
    ),
    [channel("C99999999")],
  );
  assert.equal(results.length, MAX_SLACK_CHANNEL_RESULTS);
  assert.notEqual(results.at(-1)?.id, "C99999999");
});
