# AI use and authorship disclosure

This document is written after implementation to disclose the actual workflow. It is not a backdated design artifact or a claim of human-authored code.

## AI-generated or assisted work

- Codex generated and revised application files under `src/`, `public/`, `web/`, `scripts/`, `verification/` and `test/`, plus the Node server, build configuration and project documentation.
- Native Codex helper agents contributed bounded implementation, testing and review tasks. Their work was integrated and verified by the main agent.
- Claude, through a new desktop session attached to the clean repository, reviewed ENS documentation, ABIs, assumptions and registration sequencing. Its maintained reports are `docs/claude-review.md` and `docs/claude-setup-guide.md`.
- No AI-generated visual assets or synthetic narration are represented as human work. A final video must use the participant's own narration.
- Official ENS ABI arrays and npm dependencies are reused third-party material, not newly authored contracts. Sources and pinned versions are documented in `src/abi/README.md` and the lockfile.

## Human participation

The participant supplied the goal and resource constraints, directed the move toward Web3, approved and challenged scope/implementation decisions, registered and connected service accounts, supplied the dedicated wallet, and participated in wallet operations and review of results. The participant did not hand-write the application code. Personal contribution statements in the video and submission must reflect what the participant actually did.

## New versus reused

Project work in this repository began after the official hackathon kickoff. Earlier project-specific discussions were excluded from this clean implementation. Existing public libraries, official protocol artifacts and build tools are explicitly identified as reused. The commit history, START.md and collaboration/evidence documents record development progress.

## Prompt and specification records

This was not an OpenSpec/Kiro/spec-kit project. The product and API requirements used to direct generation are present in the implementation history, README, START.md, and `docs/collaboration-log.md`. That collaboration log is explicitly a summary, not a verbatim transcript. We do not invent missing original prompt transcripts or pretend reconstructed records were created earlier. Any additional retained technical prompts provided for submission must be labeled accurately and exclude private credentials and unrelated personal information.

Eligibility is determined by ETHGlobal. Disclosure of extensive AI generation does not by itself guarantee eligibility under the event's meaningful-human-involvement requirement.
