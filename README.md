# RelayDesk — bounded event-link handover

An ETHOnline 2026 From Scratch prototype. An organizer delegates the `url` text key to an independent volunteer, then revokes that permission without removing the published link.

**Permissions cover the entire Resolver instance, NOT one name.** Separate activities should use separate instances. Other names may reference a resolver or share its records; global per-name isolation is not claimed.

## Try it

- [Public demo](https://relaydesk-ethonline-2026.xianche0614076.chatgpt.site)
- [Live evidence](https://relaydesk-ethonline-2026.xianche0614076.chatgpt.site/evidence)
- `/`: labelled wallet-free simulation. Hosted state is isolated per visitor; the localhost Node server uses shared in-memory demo state.
- `/sepolia`: dedicated ETHOnline reads, simulations, explicit wallet confirmation and receipt checks.
- `/register`: direct EOA registration, persisted plans, exact-price test-token approval and verified factory deployment.

## Verified status — September 8, 2026

Eight successful transactions on the **dedicated ETHOnline deployment**: mint, deploy, commit, approve, register, grant, volunteer edit, revoke. The final check decodes `EACUnauthorizedAccountRoles` for url and description, observes zero volunteer root/key roles and no tested registry resolver-management bypass. The dedicated Universal Resolver still returns the last URL.

- Name: `relaydesk2026.eth`
- Resolver: `0xb5Fc7c9fE83750a40F1701B68718d9fE8E53D707`
- [Evidence and transaction hashes](docs/hackathon-e2e-2026-09-08.md)
- [Verified ABI provenance](src/abi/README.md)
- [AI use and actual human contribution](AI_USAGE.md)

September 5 evidence used a **different deployment** and is historical only. Two-activity comparison, final video and official submission are not implied by this single-activity result.

## Run and verify

Requires Node.js 24+. Dependencies are pinned in package-lock.json.

```sh
npm ci --ignore-scripts
npm test
npm run check
npm start
```

Open http://127.0.0.1:4317 . Stop with Ctrl+C. No private key or API secret is required. Only a browser wallet signs.

```sh
npm run build
npm run verify:public
npm run preflight
node scripts/live-handover-check.mjs --expect=denied
```

The build emits a static site in `dist/`. Preflight verifies network and contract bytecode only. The live checker performs read-only RPC calls and simulations, never broadcasts. Later role changes can correctly make it fail; saved success is never substituted. Last full run: 165 tests passed.

## Architecture and safety boundaries

- `src/domain.mjs`: simulated workflow, separate from chain evidence.
- `src/ens-chain.mjs`: explicit dedicated Universal Resolver, verified factory implementation, DNS-byte setters, grantSetterRoles/revokeRoles and root/key inspection.
- `src/registration.mjs`: Grant[] initialization, fixed contracts, exact deployment proof, live commitment bounds and price checks.
- `public/`, `web/browser-entry.mjs`, `src/browser-runtime.mjs`: browser UI and isolated static runtime.
- `test/`: wrong networks, stale wallets, duplicate sends, unverified backups, decoded errors and permission scope.

Only Sepolia (11155111). MockUSDC is free test currency. No mainnet transfers, private-key import, automatic signature approval or HCA delegation. CCIP-read is disabled. This is not a security certification of arbitrary resolvers.

## License

Original RelayDesk code and documentation are available under the [MIT License](LICENSE).
Reused third-party dependencies and official ENS artifacts retain their original
licenses and attribution; this license does not relicense those materials. See
`src/abi/README.md` and the dependency lockfile for provenance. AI and human
contributions remain disclosed in `AI_USAGE.md`.

## Development history

Work began after kickoff in a clean repository. The public export retains technical commits and dates; privacy exclusions and hash changes are documented in [PUBLICATION.md](PUBLICATION.md). AI-generated code is disclosed, not represented as human-written. Organizers determine eligibility.

Sources: [ENS prizes](https://ethglobal.com/events/ethonline2026/prizes/ens), [dedicated deployment](https://feature-permres-inode-refact.docs-bao.pages.dev/learn/deployments#sepolia-ensv2-beta), [event rules](https://ethglobal.com/events/ethonline2026/info/details).
