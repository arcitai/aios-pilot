import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

type VoiceFixtureWindow = Window & {
  __AIOS_MIC__: { opened: number; stopped: number };
};

async function setup(page: Page) {
  await page.addInitScript(() => {
    const fixture = { opened: 0, stopped: 0 };
    (window as VoiceFixtureWindow).__AIOS_MIC__ = fixture;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        fixture.opened += 1;
        const audio = new AudioContext({ sampleRate: 48_000 });
        const destination = audio.createMediaStreamDestination();
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        gain.gain.value = 0;
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            fixture.stopped += 1;
            stop();
            void audio.close();
          };
        }
        return destination.stream;
      },
    });
  });
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: TEST_IDENTITIES.tyler.pubkey,
        name: "Fizz",
        personaId: "builtin:fizz",
        status: "running",
        channelNames: ["agents"],
      },
    ],
  });
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("Voice Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  const action = page.getByTestId("business-voice-action");
  await expect(action).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as VoiceFixtureWindow).__AIOS_MIC__.opened,
    ),
  ).toBe(0);
  return action;
}

test("business voice requests a synthetic microphone only on click and starts the exact workspace huddle", async ({
  page,
}) => {
  const action = await setup(page);
  await action
    .getByRole("button", { name: "Start voice", exact: true })
    .click();
  await expect(
    action.getByRole("button", { name: "End voice session", exact: true }),
  ).toBeVisible();
  const log = await page.evaluate(() => window.__BUZZ_E2E_COMMAND_LOG__ ?? []);
  const start = log.find((row) => row.command === "start_huddle");
  expect(start?.payload).toMatchObject({
    expectedRelayUrl: "ws://localhost:3000",
    expectedSignerPubkey: "deadbeef".repeat(8),
    memberPubkeys: [TEST_IDENTITIES.tyler.pubkey],
  });
  expect(start?.payload?.parentChannelId).toBeTruthy();
  const confirm = log.find((row) => row.command === "confirm_huddle_active");
  expect(confirm?.payload).toMatchObject({
    expectedRelayUrl: "ws://localhost:3000",
    expectedSignerPubkey: "deadbeef".repeat(8),
  });
  await action
    .getByRole("button", { name: "End voice session", exact: true })
    .click();
  await expect(
    action.getByRole("button", { name: "Start voice", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as VoiceFixtureWindow).__AIOS_MIC__.stopped,
    ),
  ).toBeGreaterThan(0);
});

for (const beforeMicrophone of [true, false]) {
  test(`a voice binding mismatch ${beforeMicrophone ? "before" : "after"} microphone setup fails closed`, async ({
    page,
  }) => {
    const action = await setup(page);
    await page.evaluate((beforeMicrophone) => {
      const native = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (
              command: string,
              args?: Record<string, unknown>,
            ) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const invoke = native.invoke;
      native.invoke = async (command, args) => {
        const result = await invoke(command, args);
        return command === "get_huddle_state" &&
          result &&
          args?.expectedSignerPubkey &&
          (beforeMicrophone ||
            (window as VoiceFixtureWindow).__AIOS_MIC__.opened > 0)
          ? {
              ...(result as Record<string, unknown>),
              workspace_signer_pubkey: "11".repeat(32),
            }
          : result;
      };
    }, beforeMicrophone);
    await action
      .getByRole("button", { name: "Start voice", exact: true })
      .click();
    await expect(action.getByRole("alert")).toContainText("could not be bound");
    await expect(
      action.getByRole("button", { name: "Start voice", exact: true }),
    ).toBeEnabled();
    if (beforeMicrophone) {
      expect(
        await page.evaluate(
          () => (window as VoiceFixtureWindow).__AIOS_MIC__.opened,
        ),
      ).toBe(0);
    } else {
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as VoiceFixtureWindow).__AIOS_MIC__.stopped,
          ),
        )
        .toBeGreaterThan(0);
    }
    const log = await page.evaluate(
      () => window.__BUZZ_E2E_COMMAND_LOG__ ?? [],
    );
    expect(log.some((row) => row.command === "confirm_huddle_active")).toBe(
      false,
    );
    expect(log.some((row) => row.command === "end_huddle")).toBe(true);
  });
}
