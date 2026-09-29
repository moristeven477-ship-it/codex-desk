# Recent-first phone history — 0.6.1

## Result

A phone no longer waits for CLI attachment and 30 complete turns before showing an uncached conversation. It requests the newest two turn headers and the newest 20 items per turn through the official paginated APIs. These messages appear while attachment continues. An additional bounded read after subscribing recovers messages written during attachment; sending still requires current CLI state. Neither preview nor cache overrides CLI permissions.

Older turns and the earlier messages/tools within a turn have separate loading buttons. Already cached content expands locally. Large caches written by earlier Desk versions initially render only their newest two turns / 20 items, avoiding a full transcript render. Existing records are retained, including contiguous older pages. Complete snapshots and rollback replace stale data; full live snapshots clear obsolete item cursors.

The phone cache increases from **50 to 300 MiB** per pairing. The 80-conversation LRU bound and 25 MiB per-snapshot parsing bound remain. Settings display the actual limit. Clearing preserves computer history and phone drafts.

## Validation

- **40 unit/service tests**: bounded read-only recent pages; legacy fallback and older-page cursors; contiguous item merging, CLI edits/removals and disjoint snapshots; full versus summary event cursor handling; existing permissions, remote access and protocol checks.
- **25 desktop browser workflows** passed. Desktop pagination, native terminal preparation, CLI priority, permissions, font controls, images, Fast, steering, goals and compaction remain covered.
- **16 phone browser workflows** passed. The new scenario uses 40 synthetic turns with 44 tool records per turn, holds the CLI attachment response, and confirms that the latest answers render independently. Earlier turns/items paginate without duplicates. A message added while attachment is held is recovered before sending becomes available.
- The synthetic uncached page appeared in **160–280 ms** in local runs with attachment deliberately blocked. Its latest page was **325,308 bytes**, compared with **11,586,947 bytes** for the previous 30-turn response. These are workstation fixture measurements, not handset speed guarantees.
- A synthetic 30-turn cache written in the old format restores with two visible turns and at most 20 items each while all network history reads remain held. Both earlier turns and earlier items expand from the existing local cache.
- The browser writes seventeen 18 MiB snapshots, verifies a retained total above 280 MiB but no more than 300 MiB, evicts the oldest large record, and retains the bootstrap index. Malformed and unavailable storage still fall back safely.
- **Real CLI 0.154.0 and 0.158.0** passed isolated loopback-provider validation. Checks include two recent turns, opaque item cursors without gaps/duplicates, older turn pages, metadata-only attachment and preserved YOLO settings. No real user workspace, credentials or model provider is used.
- Android release unit tests and lint passed. The APK keeps the existing signing certificate and embedded Tailscale engine.
- The packaged Ubuntu AppImage passed native IPC, clipboard/images, startup modes, Fast, steering, goals, compaction, completion notices, phone access while hidden, and background terminal reuse/survival.
- A CLI YOLO change received while an older attachment response is delayed stays authoritative after synchronization. This race was reproduced before retaining control events across the final history read.

The old renderer was also tested with CLI attachment held: the latest answer remained absent and the new test failed before the renderer change.

## Limits

There is no physical handset attached. First reads still require the computer and depend on the installed CLI's read speed. One unusually large individual tool item can still make a page large; the protocol limit is an item count. Older CLI versions without item pagination use the legacy full-page fallback. This release does not add a full offline app launcher or automatically preload all older history.

## Reproduce

```sh
npm ci
npm run format:check
npm run typecheck
npm test
npm run test:e2e
npm run test:remote
npm run test:steer
npm run package:linux
DESK_EXECUTABLE="$PWD/release/codex-desk-0.6.1-x86_64.AppImage" npm run test:native
```

Use dedicated temporary workspaces. See [Android build and integration checks](ANDROID.md#build-android-from-source).
