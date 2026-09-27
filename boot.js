// boot.js -- the landing page: check the firmware, warm the cache, hand off.
//
// This replaces the inline <script> in the old index.html. Behaviour changes
// versus that version:
//
//  * 13.52 ONLY. The old page listed 13.02/13.04/13.50/13.52 and offered a
//    tap-to-override on anything else. This build has a single kernel table,
//    so an off-target console is stopped here, with no override, because the
//    alternative is writing 13.52 RVAs into a different kernel's .data.
//
//  * NO TAP GATE. The old page waited for a click/keypress after the appcache
//    finished downloading on a first run, and again on every cache update.
//    That was the single biggest source of "it just sits there" -- the page
//    looked stuck because it was waiting for an input that was easy to miss.
//    Caching now happens in the background and the run starts as soon as the
//    firmware check passes.
//
//  * FAIL FAST ON THE CACHE. If the offline cache cannot be built, the run is
//    still attempted rather than blocked behind a retry prompt.

import { parseUa, SUPPORTED_FW } from "./ps4_offsets.js";
import * as ui from "./ui.js";

// The landing page only has two steps, so switch the bar to the short table
// before init() paints it. Doing this after init() would flash the full
// fifteen-step list for one frame.
ui.useBootSteps();
ui.init();

const params = new URLSearchParams(location.search);

function toJb(extra) {
  const q = params.toString();
  const target = "jb.html" + (q ? (extra ? "&" + extra : "?" + q) : extra ? "?" + extra : "");
  return target;
}

function run() {
  location.replace(toJb());
}

// ---------------------------------------------------------------------------
// Step 1: firmware
// ---------------------------------------------------------------------------
ui.setStep("boot");
const ua = parseUa(navigator.userAgent);
ui.sub(0.5, "user agent parsed");

if (!ua.off) {
  ui.log("FW", ua.key || "(not a PlayStation 4 user agent)", "bad");
  if (ua.key) {
    ui.log(
      "GATE-FAIL",
      ua.key +
        " -- this build supports " +
        SUPPORTED_FW +
        " only, and there is no override",
      "bad",
    );
  } else {
    ui.log(
      "GATE-FAIL",
      "the user agent does not identify a PS4 (" +
        String(navigator.userAgent).slice(0, 60) +
        ")",
      "bad",
    );
  }
  ui.finish(false, "requires " + SUPPORTED_FW);
} else {
  ui.sub(1, ua.key);
  ui.log("FW", ua.key, "ok");
  ui.log(
    "GATE",
    "single-firmware build -- " + SUPPORTED_FW + " is the only supported target",
    "ok",
  );
  ui.title("RAW GAME", "13.52 · " + ua.key);
  start();
}

// ---------------------------------------------------------------------------
// Step 2: warm the offline cache in the background, then run
// ---------------------------------------------------------------------------
function start() {
  ui.setStep("warm", "prefetching modules + payload");

  // Warm the module graph and the payload in parallel with the appcache
  // update. Neither has to finish before the run starts -- jb.js re-requests
  // anything that is not ready yet, and the cache means a second run pays
  // nothing -- but on a first run this overlaps ~300 KB of downloads with the
  // cache write instead of serialising them.
  const warms = [
    fetch("jb.js")
      .then(function (r) {
        return r.ok ? r.arrayBuffer() : null;
      })
      .catch(function () {}),
    fetch("goldhen.bin")
      .then(function (r) {
        return r.ok ? r.arrayBuffer() : null;
      })
      .catch(function () {}),
    fetch("patches/1352.bin")
      .then(function (r) {
        return r.ok ? r.arrayBuffer() : null;
      })
      .catch(function () {}),
  ];
  Promise.all(warms).then(function () {
    ui.sub(0.5, "assets warm");
  });

  // The offline cache is best-effort and never blocks the run.
  const ac = window.applicationCache;
  const hasManifest =
    !!ac && document.documentElement.hasAttribute("manifest");

  if (!hasManifest) {
    ui.log("CACHE", "no appcache on this page -- running online", "warn");
    ui.sub(1, "running");
    setTimeout(run, 0);
    return;
  }

  if (!navigator.onLine) {
    ui.log("CACHE", "offline -- using the cached copy", "ok");
    ui.sub(1, "offline, running from cache");
    setTimeout(run, 60);
    return;
  }

  if (ac.status === ac.UPDATEREADY) {
    try {
      ac.swapCache();
      ui.log("CACHE", "update applied", "ok");
    } catch (e) {
      ui.log("CACHE", "swapCache refused: " + (e && e.message), "warn");
    }
    // No reload: the page is already the new build's entry point, and a
    // reload would just add a round trip before the run.
    ui.sub(1, "running");
    setTimeout(run, 0);
    return;
  }

  if (ac.status === ac.IDLE) {
    ui.log("CACHE", "cached -- ready offline", "ok");
    ui.sub(1, "running");
    setTimeout(run, 0);
    return;
  }

  // A cache download is in flight. Start the run now and let it finish in the
  // background; the run only needs the assets it actually reads, and those are
  // being warmed above.
  ui.log("CACHE", "updating in the background -- not blocking the run", "warn");
  ac.addEventListener(
    "cached",
    function () {
      ui.log("CACHE", "cached for offline use", "ok");
    },
    false,
  );
  ac.addEventListener(
    "noupdate",
    function () {
      ui.log("CACHE", "already up to date", "ok");
    },
    false,
  );
  ac.addEventListener(
    "error",
    function () {
      ui.log("CACHE", "cache update failed -- continuing online", "warn");
    },
    false,
  );
  ui.sub(1, "running");
  setTimeout(run, 0);
}
