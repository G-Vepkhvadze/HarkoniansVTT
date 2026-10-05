# HarkoniansVTT 6.4.1

Foundry VTT v13 integration for Harkonians.

## 6.4.1 changes

- Uses a dedicated initial gold bootstrap endpoint when a Foundry Actor is linked.
- Normal Foundry → Harkonians gold updates use an optimistic `expectedGold` check so stale clients receive a 409 conflict instead of overwriting a newer balance.
- A 409 conflict is resolved by treating Harkonians as authoritative and applying the returned server balance to Foundry without echoing it back.
- Remote gold updates and state resyncs are suppressed from the local actor-update sync hook, preventing feedback loops.
- Unrelated Actor updates no longer trigger gold synchronization.
- Purchase delivery is idempotent using `flags.harkoniansvtt.purchaseId`.
- A successful Item delivery is never refunded just because the completion ACK fails; the purchase remains pending for reconciliation.
- Supabase Realtime uses the proper ES-module import.
- The release workflow uses a frozen Yarn install, validates the tag/version match, verifies the built payload, and creates the `stable` release.

## Build

```bash
yarn install --frozen-lockfile
yarn build
```

The Foundry install payload is produced in `dist/`.

## Release

Update `src/module.json`, commit the changes, then create and push the matching version tag:

```bash
git tag v6.4.1
git push origin v6.4.1
```

GitHub Actions builds the module and refreshes the `stable` release used by Foundry's manifest/download URLs.

## Backend requirement

Version 6.4.1 expects the Harkonians backend to expose:

- `POST /api/foundry/gold/bootstrap`
- `POST /api/foundry/gold/sync` with optional `expectedGold`

The companion backend patch is included separately with this release bundle.
