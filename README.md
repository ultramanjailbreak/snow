# RAW GAME — 13.52

A single-firmware build of the raw13g PS4 WebKit jailbreak loader, targeting
**PS4 13.52 only**, with a live progress bar and a log console that shows what
the run is doing at every step.

Original multi-firmware source: `raw13g.github.io`. This directory is a
self-contained, 13.52-only derivative. The original is untouched.

---

## What changed

### 1. Single firmware, hard gate

`ps4_offsets.js` now contains exactly one entry, `13.52`. The 13.02 / 13.04 /
13.50 tables are gone, and the 13.52 values are inlined rather than derived
from another entry at runtime.

The loader stops on anything that is not 13.52, and **there is no override**.
The upstream `index.html` had a tap-to-override for unlisted firmware. That is
deliberately removed: a 13.52 RVA table applied to a different kernel means
writing into kernel `.data` at the wrong address, which is a brick rather than
an error message. If you need 13.50 or older, use the upstream build.

The gate accepts a UA of the form `Mozilla/5.0 (PlayStation 4/13.52) …`. The
UA minor is parsed as **hex**, so `/13.5A` really is a 13.50.

### 2. Faster loader

- **No tap gates.** Upstream waited for a click after the appcache finished on
  a first run, and again on every cache update. That was the single largest
  source of "it just sits there". Caching is now background work and the run
  starts as soon as the firmware check passes.
- **Fail-open on the cache.** If the offline cache cannot be built, the run is
  attempted online instead of being blocked behind a retry prompt.
- **Parallel warm.** `boot.js` prefetches `jb.js`, `goldhen.bin` and
  `patches/1352.bin` concurrently with the cache update instead of after it.
  `jb.js` also kicks off its own warm before the primitive is tested, so the
  payload is already in memory by the time it is needed.
- **Batched UI writes.** All log/console/bar writes are coalesced into one DOM
  pass per frame. Upstream rebuilt the entire `<pre>` with `innerHTML` on every
  single log line, which is O(n²) over a 400-line run.
- **One module instance of `core.js`.** `jb.js` and `mem.js` now both import
  plain `./core.js`. Upstream's `core.js?v=10` plus a bare `core.js` in the
  manifest meant two specifiers for one file; they are the same URL now.

### 3. Fast injection

`mem.js` gained `writeInto(src, addr, count)` and `compareAt(expected, addr,
count)`. The primitive's carrier window is capped at `0x100` bytes by
`aimFor`, and each `write8` costs a full aim/restore round trip. Injecting the
293 KB payload byte-by-byte meant ~36 000 round trips; `writeInto` does one per
`0x100` window instead — about 2 240. Verification goes from one compare per
byte to one per window.

`writeInto`/`compareAt` are also exposed on the global `p` object alongside
`readInto`/`read8`.

### 4. Progress bar

`ui.js` owns a 15-step weighted bar. Steps are weighted by real cost, so the
primitive and the race pool — which dominate wall-clock — move the bar most.

The bar is honest about failure, which is the part that matters:

- On a run rejected by the firmware gate it stops at **0%**, step 1. It does
  not walk forward through teardown and report.
- On a run that throws mid-exploit it stops **where it actually stopped**. The
  bar shows how far the run got, not how far the code got to reading.
- Only a run where the payload thread is confirmed running reports success
  (`RUN-VERDICT` / the `payloadRunning` flag), so a green bar cannot hide a run
  that ended earlier.

### 5. Log console

Every step of the run is logged, with a timestamp, a tag, and a level. Controls:

| control | what it does |
| --- | --- |
| `all` | every line |
| `steps` | phase and step lines only |
| `proofs` | `PROOF-OK` / `PROOF-FAIL` only |
| `copy` | copy the whole log to the clipboard |
| `clear` | clear the console |
| `collapse` | fold the console away to leave just the bar |
| `N of M` | lines shown vs. lines emitted (the DOM is capped) |

A verdict panel shows the jailbreak-relevant proofs (jailbreak, KRW, kernel
patch, payload, uid) so you can see the outcome without reading 400 lines.

---

## URL parameters

### Added by this build

| param | default | meaning |
| --- | --- | --- |
| `?net=1` | off | POST the log to `/t`. **Batched**, one request per 500 ms, not one per line. Upstream did this unconditionally, which is hundreds of requests per run. |
| `?maxlines=N` | `400` | cap on console lines. The counter shows `N of M`. |
| `?quiet=1` | off | fold the console away, leave just the bar. `copy` still gets every line. |

### Inherited from upstream

| param | meaning |
| --- | --- |
| `?jb=0` | skip the jailbreak stage |
| `?patch=0` | skip the kernel patch stage |
| `?payload=0` | skip payload injection |
| `?skipjb=0` | run jailbreak even if it looks already done |
| `?keepjb=1` | leave the jailbreak in place afterwards |
| `?retry=N` | retry count |
| `?attempts=N` | primitive attempts |
| `?verbose=1` | no terse-ing of long log lines |

---

## Files

| file | role |
| --- | --- |
| `index.html` | landing page: firmware check, then hand off |
| `boot.js` | the landing page's logic (was inline) |
| `jb.html` | the run page |
| `jb.js` | the exploit. Its 3 800-line run body is unchanged from upstream |
| `ui.js` | progress bar, step list, log console, verdicts, final banner |
| `ui.css` | loader chrome |
| `ps4_offsets.js` | 13.52-only offset table + `parseUa()` |
| `mem.js` | the primitive; gained `writeInto` / `compareAt` |
| `core.js` | **unmodified** from upstream |
| `int64.js`, `rpc_worker.js` | **unmodified** from upstream |
| `goldhen.bin` | payload, 293 120 bytes |
| `patches/1352.bin` | kpatch blob, 632 bytes |
| `cache.appcache` | offline cache manifest |

`tools/` is development-only and is not in the appcache manifest:

| file | role |
| --- | --- |
| `check.html` | static build checks — run this after any edit |
| `uitest.html` | replays a recorded run through the UI in any browser |
| `hash.ps1` | regenerates the appcache hashes |

---

## Verifying a change

`core.js` is untouched, and nothing here can be exercised end-to-end without a
13.52 console. Two tools cover the rest.

**`tools/check.html`** — 49 checks: every `REQUIRED_KEYS` / `OPTIONAL_KEYS`
name is present in the 13.52 table, the table has exactly one entry, the UA gate
accepts 13.52 and rejects six other user agents, every runtime file is present
at the expected size, `boot.js`'s three warm-fetch targets resolve, the appcache
manifest lists every runtime file, contains no stale entries, has no UTF-8 BOM,
and **every manifest hash matches the file on disk**. The last group greps the
shipped sources for any code path that could still reach another firmware's
table or patch blob.

**`tools/uitest.html`** — drives the real `ui.js` with a recorded tag sequence,
so the bar, step list, console filters, verdicts panel and final banner can be
reviewed in a desktop browser:

```
tools/uitest.html                    successful run
tools/uitest.html?case=fail          stopped mid-run
tools/uitest.html?case=gate          rejected by the firmware gate
tools/uitest.html?slow=1             one line per 120 ms
tools/uitest.html?maxlines=12        console cap
tools/uitest.html?quiet=1            console folded away
```

Both tools take `&v=N` to bust the browser's module cache. Without it, editing
`ui.js` and reloading can silently serve the old module — the same trap as a
stale appcache hash, and it cost real time while building this.

---

## After editing any cached file

```
powershell -ExecutionPolicy Bypass -File tools\hash.ps1
```

Then re-open `tools/check.html`. A stale manifest hash does not fail loudly —
appcache keeps serving the old copy out of the console's storage and the edited
code never runs, which looks exactly like "my change did nothing".

The script writes UTF-8 **without** a BOM on purpose. A BOM in front of
`CACHE MANIFEST` makes the browser reject the manifest as malformed, and the
console then quietly runs online-only with nothing in the log to say why.

---

## Scope of changes, honestly

- Everything that touches the kernel is **unchanged** from upstream. The
  primitive, the race pool, the base leak, the gadget chain, the syscall stubs,
  the kpatch write and the payload write are the same code against the same
  13.52 offsets. Nothing here is retuned.
- `core.js` is byte-identical to upstream. It has a `?g=` override that could
  retune primitive timings; it was deliberately left alone rather than used to
  trade stability for speed.
- The `writeInto` / `compareAt` change is an injection-throughput change only.
  It does not alter what gets written, only how many aim/restore round trips it
  takes to write it.
- The multi-firmware table is not recoverable from this directory. If you need
  it, the upstream source is unchanged.
