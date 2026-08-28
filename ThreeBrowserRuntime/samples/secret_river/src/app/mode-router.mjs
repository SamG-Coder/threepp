function requireMode(mode, id) {
  if (!mode || typeof mode !== "object") {
    throw new TypeError(`Secret River mode "${id}" did not return a mode object.`);
  }
  if (typeof mode.frame !== "function") {
    throw new TypeError(`Secret River mode "${id}" must provide frame(frameContext).`);
  }
  if (typeof mode.resize !== "function") {
    throw new TypeError(`Secret River mode "${id}" must provide resize(viewport).`);
  }
  if (typeof mode.dispose !== "function") {
    throw new TypeError(`Secret River mode "${id}" must provide dispose().`);
  }
  return mode;
}

async function safelyDispose(mode, onError) {
  if (!mode) return;
  try {
    await mode.dispose();
  } catch (error) {
    onError?.(error, { phase: "dispose", modeId: mode.id ?? "unknown" });
  }
}

/**
 * Owns one active canvas mode at a time. Mode factories may load asynchronously,
 * but the current mode remains renderable until its replacement is ready.
 */
export function createModeRouter({ factories, onError } = {}) {
  if (!factories || typeof factories !== "object") {
    throw new TypeError("Secret River needs a mode factory table.");
  }

  let activeMode = null;
  let activeId = null;
  let pendingId = null;
  let pendingTransition = null;
  let latestViewport = null;
  let disposed = false;

  async function activate(id) {
    const nextId = String(id || "");
    if (disposed) return false;
    if (activeId === nextId && !pendingTransition) return true;
    if (pendingTransition) return false;

    const factory = factories[nextId];
    if (typeof factory !== "function") {
      const error = new Error(`Unknown Secret River mode "${nextId}".`);
      activeMode?.setError?.(error);
      onError?.(error, { phase: "load", modeId: nextId });
      return false;
    }

    pendingId = nextId;
    activeMode?.setLoading?.(nextId);
    pendingTransition = (async () => {
      let candidateMode = null;
      try {
        const nextMode = requireMode(await factory(), nextId);
        candidateMode = nextMode;
        if (disposed) {
          await safelyDispose(nextMode, onError);
          candidateMode = null;
          return false;
        }

        if (latestViewport) nextMode.resize(latestViewport);
        const previousMode = activeMode;
        activeMode = nextMode;
        activeId = nextId;
        candidateMode = null;
        pendingId = null;
        await safelyDispose(previousMode, onError);
        return true;
      } catch (error) {
        await safelyDispose(candidateMode, onError);
        pendingId = null;
        activeMode?.setLoading?.(null);
        activeMode?.setError?.(error);
        onError?.(error, { phase: "load", modeId: nextId });
        return false;
      } finally {
        pendingTransition = null;
      }
    })();
    return pendingTransition;
  }

  function resize(viewport) {
    latestViewport = Object.freeze({ ...viewport });
    activeMode?.resize(latestViewport);
  }

  function frame(frameContext) {
    if (disposed) return false;
    if (!activeMode) return false;
    activeMode.frame(frameContext);
    return true;
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    if (pendingTransition) await pendingTransition;
    const previousMode = activeMode;
    activeMode = null;
    activeId = null;
    pendingId = null;
    await safelyDispose(previousMode, onError);
  }

  return {
    activate,
    resize,
    frame,
    dispose,
    get activeId() {
      return activeId;
    },
    get pendingId() {
      return pendingId;
    },
    get transitioning() {
      return Boolean(pendingTransition);
    },
  };
}
