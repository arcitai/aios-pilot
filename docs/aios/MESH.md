# Buzz Mesh

Buzz Mesh lets members of one Buzz relay run agents on models hosted by other
members. A shared model runs on the serving member's computer; selecting it
does not copy inference to the requesting computer.

## Sharing and admission

Share compute is opt-in. The member chooses a model for this computer; an
installed model is already local, and a catalog model is downloaded here when
sharing starts. Buzz only reports the model to relay discovery after a real
inference request succeeds. While that probe is pending or unsuccessful, the
node remains unready and publishes no serving model or serve target.

The current Buzz relay membership supplies the serving node's trusted owner
roster. Buzz intersects member identities with current relay membership and
configures MeshLLM to admit only those owners. A MeshLLM join token is a
bootstrap pointer; having the pointer or reaching the relay does not by itself
grant inference access. Clients also present their owner identity when they
join.

## Client status

The client stays in `starting` until the selected member's join call returns.
A live local HTTP ingress alone does not mean the client joined. A failed join
is reported as a failed client status. Before an agent starts, Buzz separately
checks that its selected model can answer an inference request.

The desktop's MeshLLM API and console URLs use loopback. Mesh transport may use
Iroh relays for peer connectivity; the desktop does not publish MeshLLM mesh
presence through the SDK's public Nostr discovery path.

## Implementation and proof

- Native constructor and status shaping: `desktop/src-tauri/src/mesh_llm/mod.rs`
- Startup readiness probe and runtime installation: `desktop/src-tauri/src/commands/mesh_llm.rs`
- Share-compute wording and role-aware status: `desktop/src/features/mesh-compute/ui/MeshComputeSettingsCard.tsx`
- Native regression coverage: `desktop/src-tauri/src/mesh_llm/mod_tests.rs`
- UI and E2E coverage: `desktop/src/features/mesh-compute/shareToggleState.test.mjs` and `desktop/tests/e2e/mesh-compute.spec.ts`
- Local admission smoke: `crates/buzz-relay/examples/mesh_admission_smoke.rs`

The admission smoke uses multiple local processes and local-only sockets. It is
not proof of a two-machine network path; transport behavior across separate
hosts still needs an appropriately scoped live check.
