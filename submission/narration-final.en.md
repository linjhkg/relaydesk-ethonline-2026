# English subtitles translation — timing pending human narration

Hello, this is RelayDesk. It addresses event-link handover: an organizer wants a volunteer to maintain the registration link without handing over a wallet, domain ownership, or all administrative permissions.

We use ENSv2's Permissioned Resolver to separate editing rights. One boundary matters: this deployment grants permissions across an entire resolver instance, not a single name. Independent activities should therefore use separate instances. We do not claim that a shared instance automatically isolates permissions by name.

First, the product workflow. The homepage is explicitly labelled as a local simulation. It neither connects a wallet nor sends transactions. The organizer grants URL editing, the volunteer updates the registration link, and revocation blocks subsequent edits while preserving the last successful link. This demonstrates the workflow, not on-chain proof.

Now the real evidence. We registered relaydesk2026.eth on the dedicated ETHOnline Sepolia deployment. Registration, delegation, an independent volunteer update, and revocation are backed by eight successful transactions. The evidence page links to the explorer and files containing actual accounts, contracts, and permission checks.

Before delegation, the volunteer could write neither url nor description. After delegation, root permissions stayed at zero, with only the URL-key TEXT role granted. A different wallet successfully updated the event link. The organizer then revoked the role. A subsequent simulation from the same volunteer returned the decoded authorization error. The dedicated Universal Resolver continued returning the last event URL.

We also checked that the volunteer held no registry permission to replace the resolver, addressing a higher-level path around text-role revocation. Before signatures, the application rechecks the account, network, contract and transaction contents. It supports Sepolia only, never reads private keys, and does not automatically approve wallet prompts.

An important correction during development was discovering that the general beta and the dedicated hackathon deployment differed in both API and permission semantics. We verified the deployed ABI, changed the implementation and tests, and reran the flow on the correct deployment. Older transactions remain clearly labelled historical evidence.

Finally, attribution: Codex generated most code and automated tests, with Claude cross-reviewing. I directed the goals and scope, prepared accounts, and participated in operation and result verification. This is disclosed. The current verified prototype covers one activity; the two-activity comparison remains incomplete. Thank you.
