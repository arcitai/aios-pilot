# Business workspace voice

## Current behavior

Business voice is a user-started, private temporary huddle with the workspace's
selected main agent. Starting requires an explicit click. The existing huddle
flow requests microphone access after that click and reports setup failures;
it does not place a phone call.

Every huddle start captures the business channel, relay endpoint, and owner
signer before network work begins. Relay writes, membership reads, audio setup,
transcription posts, and cleanup use that captured scope. If the active
community or owner changes during setup, the start fails closed and rolls back
against the captured workspace. The signing key is retained only in the
in-memory huddle state for that session's cleanup and is excluded from Tauri
state serialization.

## Incoming owner-approved requests

An owned managed runtime can request a private voice huddle through the
existing signed and encrypted Nostr kind `24200` observer-frame envelope with
`frame=control`. The request binds the owner, agent, relay, current runtime
start nonce, business channel, request ID, and expiry. Requests expire within
60 seconds. This protocol is separate from ACP permission requests.

The desktop rings only for a known locally owned agent whose current runtime is
ready on the active relay and whose request channel still contains both owner
and agent. It applies a per-agent request limit and a bounded pending queue.
There is no auto-answer: Accept is an explicit click that starts the exact
scoped huddle and requests microphone access. The owner sends the encrypted
accept decision only after that huddle is bound to the requested channel,
relay, owner, and agent and the microphone is connected. Setup failure sends a
decline only while the request binding remains current. Decline and expiry
start no huddle. The CLI waits for a matching owner-signed and encrypted
decision up to the request expiry and returns `accept`, `decline`, or `timeout`
as JSON.

## Speech recognition and Danish

The current huddle speech-to-text model is NVIDIA Parakeet TDT-CTC 110M in an
INT8 sherpa-onnx package. It is English-only; the model card describes English
speech transcription, and Buzz's package and UI should not imply Danish
transcription support. The current TTS voices and agent response language are
separate capabilities and need their own language evaluation.

A plausible low-cost experiment is an **optional** multilingual Whisper tiny
model behind the existing huddle STT pipeline. sherpa-onnx documents Danish's
`da` language code and multilingual Whisper support. Its published tiny INT8
files are about 86 MB for the decoder and 12 MB for the encoder, plus the token
file; that is roughly another 99 MB unpacked, before the downloaded archive
and runtime. This is comparable to the current Parakeet package rather than a
replacement for it. No alternative model is downloaded or bundled by this
change.

Before offering Danish transcription, evaluate Danish speech from representative
speakers and huddle conditions, then measure CPU latency and transcript quality
on supported desktop hardware. Keep the model opt-in and on-demand unless that
evaluation justifies a default. Make model and language selection explicit;
do not silently run English Parakeet and present its output as Danish. Danish
TTS and the agent's ability to respond in Danish require separate validation.

## References

- [NVIDIA Parakeet TDT-CTC 110M model card](https://huggingface.co/nvidia/parakeet-tdt_ctc-110m)
- [sherpa-onnx Whisper model and file-size documentation](https://github.com/k2-fsa/sherpa-onnx/blob/master/docs/source/onnx/spoken-language-identification/pretrained_models.rst)
- [sherpa-onnx Whisper language configuration](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/offline-whisper-model-config.cc)
- [OpenAI Whisper model overview](https://github.com/openai/whisper/blob/main/README.md)
