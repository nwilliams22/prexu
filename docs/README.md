# Documentation index

Maintained guides audited 2026-09-20 against local `main` (`dfe5d8c`).
Code and configuration establish implemented behavior; Beads establishes open
work and acceptance. This audit did not fetch the remote or certify hardware.

| Guide | Purpose |
| --- | --- |
| [Native-player status](native-player-status.md) | Current architecture, implemented features, acceptance gaps, and pickup order |
| [Linux development](linux-dev.md) | Dependencies, launch, diagnostics, and packaging gaps |
| [Windows runtime binaries](../src-tauri/bin/README.md) | libmpv/ANGLE staging and verification |
| [Validation coverage](test-automation-plan.md) | Current local/CI checks and limits |
| [Linux hardware plan](linux-on-hardware-test-plan.md) | Manual acceptance scenarios |
| [Hardware runbook](hw-probe-runbook.md) | Probe commands and interpreting results |
| [IPC smoke test](phase1-smoke-test.md) | Small native command/event check |
| [Playback smoke test](phase2-smoke-test.md) | Current Windows/Linux playback scenarios |
| [Relay setup](remote-access-setup.md) | Actual relay arguments, URLs, and health endpoints |
| [Code signing](code-signing.md) | What the build config signs/verifies and remaining scope |
| [Changelog](../CHANGELOG.md) | Released history and source-tree changes since 0.7.1 |

## Current handoff

Work is paused after completing the documentation refresh and relay security
fixes locally. Resume with `prexu-9f4s.5`, then `prexu-9f4s.3`; the visual
harness follows the current remediation work. See the
[pickup guidance](native-player-status.md#picking-up-work) for validation,
source delivery, existing user edits, and the relay deployment requirement.

## Decisions and historical evidence

- [Linux render-API ADR](adr-native-player-render-api.md): accepted and implemented;
  packaging and broad hardware acceptance remain open.
- [macOS ADR](adr-native-player-macos.md): accepted design; native production
  integration remains future work after the HTML5 codec gate.
- [Original cross-platform ADR](adr-native-player-cross-platform.md): superseded
  historical assessment of the old Windows foreign-window approach.
- [Original native-player rollout](archive/native-player-rollout.md) and
  [original automation audit](archive/test-automation-audit.md): dated history,
  not current task lists or setup commands.
- `spike/*/FINDINGS.md`, `RUN.md`, and `FORK-PLAN.md`: experiments tied to the
  revisions and machines they describe. Their follow-up language is historical;
  check Beads and current source before following it.
- Root `TODO.md`: completed historical UI checklist. Beads replaces it for work tracking.

Generated `hw-probe-report.md` describes only its particular run. It is not a
project-wide health certificate. Local scratch files such as `PLAN.md` are not
maintained project documentation.
