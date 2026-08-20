(function (TN) {
  TN.REVISION = TN.REVISION || "native-threepp";
  globalThis.THREE = TN;
  if (typeof window !== "undefined") {
    window.__THREE__ = TN.REVISION;
  }
  try {
    globalThis.dispatchEvent(new Event("three-ready"));
  } catch {
    /* ignore */
  }
})(globalThis.__TN = globalThis.__TN || {});
