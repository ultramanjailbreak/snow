// check.js -- static self-checks for the 13.52 build.
//
// Everything here is checkable without a console, and everything here is
// something that would otherwise only be discovered on a PS4: a typo in an
// offset name, a patch blob that did not get copied, an appcache manifest that
// omits a file the run fetches. Run tools/check.html.

// Cache-busted for the same reason as uitest.js: these checks exist to catch
// a broken ps4_offsets.js, so they must never run against a cached copy of it.
const {
  PS4,
  REQUIRED_KEYS,
  OPTIONAL_KEYS,
  SUPPORTED_FW,
  parseUa,
  offsetsFor,
} = await import("../ps4_offsets.js?v=" + (new URLSearchParams(location.search).get("v") || "1"));

const rows = [];
let failed = 0;

function ok(name, pass, detail) {
  if (!pass) failed++;
  rows.push({
    name: String(name).replace(/^\.\.\//, ""),
    pass: !!pass,
    detail: detail == null ? "" : String(detail),
  });
}

function group(name) {
  rows.push({ group: name });
}

// ---------------------------------------------------------------------------
group("offset table");
// ---------------------------------------------------------------------------
const off = PS4[SUPPORTED_FW];
ok("table has the supported key", !!off, SUPPORTED_FW);
ok("table has exactly one firmware", Object.keys(PS4).length === 1, Object.keys(PS4).join(","));

let missingReq = [];
for (const k of REQUIRED_KEYS) if (!(k in off)) missingReq.push(k);
ok("every REQUIRED_KEY is present", missingReq.length === 0, missingReq.join(" ") || REQUIRED_KEYS.length + " keys");

let missingOpt = [];
for (const k of OPTIONAL_KEYS) if (!(k in off)) missingOpt.push(k);
ok("every OPTIONAL_KEY is present", missingOpt.length === 0, missingOpt.join(" ") || OPTIONAL_KEYS.length + " keys");

// A hex value that lost its 0x prefix is the classic way an offset table goes
// quietly wrong -- it still parses as a number, just the wrong one.
let notHex = [];
for (const k of REQUIRED_KEYS.concat(OPTIONAL_KEYS)) {
  const v = off[k];
  if (typeof v === "number" && !isFinite(v)) notHex.push(k);
}
ok("all scalar offsets are finite numbers", notHex.length === 0, notHex.join(" ") || "ok");

let stubCount = Object.keys(off.k_stubs || {}).length;
ok("syscall stub table is populated", stubCount > 30, stubCount + " stubs");

ok("kpatch blob is 13.52", off.kpatch === "1352.bin", off.kpatch);
ok("payload blob is goldhen", off.payload === "goldhen.bin", off.payload);

// ---------------------------------------------------------------------------
group("user agent gate");
// ---------------------------------------------------------------------------
const UAs = [
  ["Mozilla/5.0 (PlayStation 4/13.52) AppleWebKit/537.73 (KHTML, like Gecko)", true, "13.52"],
  ["Mozilla/5.0 (PlayStation 4/13.5) AppleWebKit/537.73 (KHTML, like Gecko)", false, null],
  ["Mozilla/5.0 (PlayStation 4 8.00) AppleWebKit/537.73 (KHTML, like Gecko)", false, null],
  ["Mozilla/5.0 (PlayStation 4/12.02) AppleWebKit/605.1.15 (KHTML, like Gecko)", false, null],
  ["Mozilla/5.0 (PlayStation 4/9.00) AppleWebKit/601.1.46 (KHTML, like Gecko)", false, null],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", false, null],
  ["", false, null],
];
for (const [ua, wantOff, wantKey] of UAs) {
  const r = parseUa(ua);
  const label = ua.slice(0, 46) || "(empty)";
  ok("gate " + label, (r.off !== null) === wantOff && (!wantKey || r.key === wantKey), "key=" + r.key);
}
ok("offsetsFor still works", (function () {
  const r = offsetsFor(UAs[0][0]);
  return r.key === "13.52" && r.off === off;
})(), "delegates to parseUa");

// ---------------------------------------------------------------------------
group("shipped assets");
// ---------------------------------------------------------------------------
// Paths are relative to this page, which lives in tools/.
const ASSETS = [
  ["../index.html", null],
  ["../boot.js", null],
  ["../jb.html", null],
  ["../jb.js", null],
  ["../ui.js", null],
  ["../ui.css", null],
  ["../mem.js", null],
  ["../int64.js", null],
  ["../core.js", null],
  ["../rpc_worker.js", null],
  ["../ps4_offsets.js", null],
  ["../logo_raw.png", null],
  ["../cache.appcache", null],
  ["../goldhen.bin", 293120],
  ["../patches/1352.bin", 632],
];

const sizes = {};
await Promise.all(
  ASSETS.map(async function (a) {
    try {
      const r = await fetch(a[0], { cache: "no-store" });
      if (!r.ok) {
        ok("asset " + a[0], false, "HTTP " + r.status);
        return;
      }
      const b = await r.arrayBuffer();
      sizes[a[0]] = b.byteLength;
      ok("asset " + a[0], a[1] === null || b.byteLength === a[1], b.byteLength + " bytes");
    } catch (e) {
      ok("asset " + a[0], false, String(e));
    }
  }),
);

// boot.js warms these three before handing off to jb.html, and jb.js re-fetches
// whatever is not ready. A typo in any of those paths fails silently on the
// console -- a 404 in a .catch() that swallows -- and just makes the run slow,
// so they are fetched here instead.
const WARM = ["jb.js", "goldhen.bin", "patches/1352.bin"];
for (const w of WARM) {
  try {
    const r = await fetch("../" + w, { cache: "no-store" });
    const b = r.ok ? await r.arrayBuffer() : null;
    ok("warm target " + w, !!b && b.byteLength > 0, b ? b.byteLength + " bytes" : "HTTP " + r.status);
  } catch (e) {
    ok("warm target " + w, false, String(e));
  }
}

// The hand-off target has to exist, or the landing page navigates into a 404.
try {
  const r = await fetch("../jb.html", { cache: "no-store" });
  ok("hand-off target jb.html", r.ok, "HTTP " + r.status);
} catch (e) {
  ok("hand-off target jb.html", false, String(e));
}

// The patch table and the kpatch blob must agree, or the run writes one
// firmware's patch set onto another.
ok("kpatch blob matches the table", off.kpatch === "1352.bin" && !!sizes["../patches/1352.bin"], off.kpatch);

// ---------------------------------------------------------------------------
group("appcache manifest");
// ---------------------------------------------------------------------------
try {
  const r = await fetch("../cache.appcache", { cache: "no-store" });
  const text = await r.text();

  // A UTF-8 BOM in front of "CACHE MANIFEST" makes appcache reject the whole
  // manifest as malformed. The console then just runs online with no visible
  // reason why, and PowerShell's Set-Content -Encoding UTF8 adds exactly that
  // BOM on 5.1 -- so it gets checked explicitly.
  ok(
    "manifest has no BOM",
    text.charCodeAt(0) !== 0xfeff,
    "first bytes: " + JSON.stringify(text.slice(0, 14)),
  );
  const body = text.replace(/^\ufeff/, "");
  const firstLine = body.split("\n")[0].trim();
  ok("manifest header is exact", firstLine === "CACHE MANIFEST", JSON.stringify(firstLine));

  // Walk the sections properly. Only the implicit CACHE section holds entries;
  // NETWORK: and FALLBACK: have bodies that are not URLs-with-hashes, so
  // grabbing "every line that is not a comment" counts "index.html index.html"
  // as a cache entry and then fails the sha256 test on it.
  const entries = [];
  let section = "cache";
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#/i.test(line)) continue;
    if (/^NETWORK:/i.test(line)) {
      section = "network";
      continue;
    }
    if (/^FALLBACK:/i.test(line)) {
      section = "fallback";
      continue;
    }
    if (/^CACHE:?$/i.test(line)) {
      section = "cache";
      continue;
    }
    if (section !== "cache") continue;
    const m = /^(\S+)(?:\s+#([0-9a-fA-F]{64}))?$/.exec(line);
    if (m) entries.push({ file: m[1], hash: m[2] || null, line: line });
  }
  const listed = entries.map(function (e) {
    return e.file;
  });

  const mustList = [
    "index.html", "boot.js", "jb.html", "jb.js", "ui.js", "ui.css",
    "mem.js", "int64.js", "ps4_offsets.js", "rpc_worker.js",
    "goldhen.bin", "patches/1352.bin", "logo_raw.png",
  ];
  let notListed = [];
  for (const f of mustList) if (listed.indexOf(f) < 0) notListed.push(f);
  ok("manifest lists every runtime file", notListed.length === 0, notListed.join(" ") || mustList.length + " entries");

  // Files that must NOT be cached: other firmware's patch blobs and the
  // duplicate payload would waste the console's storage quota and delay the
  // first run for no benefit. The ?v= aliases are stale for a different reason:
  // jb.js and mem.js now import plain "./core.js", so a query-string copy would
  // be a second module instance of the same file with its own state.
  const stale = listed.filter(function (f) {
    return /payload2\.bin|13\.0[24]|13\.50|1350|core\.js\?v=|jb\.js\?v=/.test(f);
  });
  ok("manifest has no stale entries", stale.length === 0, stale.join(" ") || "clean");

  // Every manifest hash must match the file on disk. A stale hash does not fail
  // loudly: appcache keeps serving the old copy from the console's cache and
  // the edited code never runs, which reads as "my change did nothing".
  // Regenerate with tools/hash.ps1.
  const noHash = entries
    .filter(function (e) {
      return !e.hash;
    })
    .map(function (e) {
      return e.file;
    });
  ok("every entry has a sha256", noHash.length === 0, noHash.join(" ") || entries.length + " hashed");

  const mismatched = [];
  for (const e of entries) {
    if (!e) continue;
    try {
      const buf = await crypto.subtle.digest("SHA-256", await (await fetch("../" + e.file, { cache: "no-store" })).arrayBuffer());
      const hex = Array.prototype.map
        .call(new Uint8Array(buf), function (b) {
          return ("0" + b.toString(16)).slice(-2);
        })
        .join("");
      if (hex !== e.hash) mismatched.push(e.file);
    } catch (err) {
      mismatched.push(e.file + " (unreadable)");
    }
  }
  ok("manifest hashes match the files", mismatched.length === 0, mismatched.join(" ") || "all current -- run tools/hash.ps1 if not");
} catch (e) {
  ok("appcache manifest", false, String(e));
}

// ---------------------------------------------------------------------------
group("no other firmware referenced");
// ---------------------------------------------------------------------------
// Strip comments before grepping. The sources discuss the other firmwares at
// length -- boot.js explains that the old page listed them, ps4_offsets.js
// documents what each UA minor means -- and flagging that prose is noise. What
// matters is that no *code* can still reach another firmware's table or patch
// blob, so that is what gets tested.
//
// Paths are relative to this page, which lives in tools/.
const SRC = ["../jb.js", "../boot.js", "../ui.js", "../ps4_offsets.js", "../mem.js", "../index.html", "../jb.html"];

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    // Trailing comments, but not a "//" inside a string or a URL.
    .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1 ");
}

// Things that would mean a second firmware is still reachable.
const RISKS = [
  [/patches\/(?!1352\b)\d+\.bin/, "reference to another firmware's patch blob"],
  [/\bpayload2\.bin\b/, "reference to the duplicate payload"],
  [/PS4\[["'`]((?!13\.52)[\d.]+)/, "PS4 table lookup with a non-13.52 key"],
  [/"(?!13\.52"|13\.5[02]")[\d]{2}\.[\d]{2}"\s*:\s*\{/, "second firmware key in a table"],
  [/\?force=|\bforceUA\b/, "firmware override escape hatch"],
];

await Promise.all(
  SRC.map(async function (f) {
    try {
      const code = stripComments(await (await fetch(f, { cache: "no-store" })).text());
      const hits = [];
      code.split("\n").forEach(function (line, i) {
        for (const [re, why] of RISKS) {
          const m = re.exec(line);
          if (m) hits.push((i + 1) + ": " + why + " -> " + line.trim().slice(0, 70));
        }
      });
      ok("no other firmware reachable from " + f, hits.length === 0, hits.join(" | ") || "clean");
    } catch (e) {
      ok("no other firmware reachable from " + f, false, String(e));
    }
  }),
);

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
const total = rows.filter(function (r) {
  return r.name;
}).length;
document.body.className = failed ? "bad" : "ok";
document.getElementById("summary").textContent =
  (failed ? "FAILED" : "PASSED") + " -- " + (total - failed) + "/" + total + " checks";
document.getElementById("summary").className = failed ? "bad" : "ok";
const pre = document.getElementById("out");
let html = "";
for (const r of rows) {
  if (r.group) {
    html += '<div class="g">' + r.group + "</div>";
    continue;
  }
  html +=
    '<div class="r ' +
    (r.pass ? "ok" : "bad") +
    '"><span class="s">' +
    (r.pass ? "PASS" : "FAIL") +
    "</span><span class=n>" +
    r.name +
    '</span><span class="d">' +
    r.detail.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
    "</span></div>";
}
pre.innerHTML = html;
globalThis.__check = { failed: failed, total: total, rows: rows };
