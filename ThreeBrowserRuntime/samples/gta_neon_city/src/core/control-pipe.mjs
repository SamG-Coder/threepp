function send(socket, value) {
  socket.write(`${JSON.stringify(value)}\n`);
}

export async function createDevelopmentControlServer(handler) {
  const configured = globalThis.process?.env?.THREEBROWSER_GTA_CONTROL_PIPE;
  if (!configured) return null;
  try {
    const { createServer } = await import("node:net");
    const pipePath = configured === "1" ? "\\\\.\\pipe\\ThreeBrowserGtaNeonCity" : configured;
    const server = createServer(socket => {
      socket.setEncoding("utf8");
      let pending = "";
      socket.on("data", async chunk => {
        pending += chunk;
        if (pending.length > 1_048_576) {
          send(socket, { id: null, ok: false, error: "control request exceeded 1 MiB" });
          pending = "";
          return;
        }
        for (;;) {
          const newline = pending.indexOf("\n");
          if (newline < 0) break;
          const line = pending.slice(0, newline).trim();
          pending = pending.slice(newline + 1);
          if (!line) continue;
          let request;
          try {
            request = JSON.parse(line);
            const result = await handler(request);
            send(socket, { id: request.id ?? null, ok: true, result });
          } catch (error) {
            send(socket, { id: request?.id ?? null, ok: false, error: error?.message || String(error) });
          }
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(pipePath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    console.log(`[GTA Neon City] development control pipe listening at ${pipePath}`);
    return {
      path: pipePath,
      close() { return new Promise(resolve => server.close(resolve)); },
    };
  } catch (error) {
    console.warn(`[GTA Neon City] control pipe unavailable: ${error?.message || error}`);
    return null;
  }
}
