import net from "node:net";

const pipePath = "\\\\.\\pipe\\ThreeBrowserNeonCityOrientationProbe";
const socket = net.createConnection(pipePath);
socket.setEncoding("utf8");
let buffer = "";
let sequence = 0;
const pending = new Map();

socket.on("data", chunk => {
  buffer += chunk;
  for (;;) {
    const end = buffer.indexOf("\n");
    if (end < 0) break;
    const response = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const item = pending.get(response.id);
    if (!item) continue;
    pending.delete(response.id);
    response.ok ? item.resolve(response.result) : item.reject(new Error(response.error));
  }
});

await new Promise((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("error", reject);
});

function request(op, values = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.write(`${JSON.stringify({ id, op, ...values })}\n`);
  });
}

let state = await request("snapshot");
console.log("BEFORE", JSON.stringify({ story: state.story, phone: state.phone }));
for (let guard = 0; guard < 12 && state.story?.controlsLocked; guard += 1) {
  await request("story", { action: "advance", skip: true });
  state = (await request("advance", { steps: 2 })).state;
}
await request("action", { action: "phone" });
state = (await request("advance", { steps: 32 })).state;
console.log("LAUNCHER", JSON.stringify({ story: state.story, phone: state.phone }));
await request("render");
await request("screenshot", { path: "C:\\ThreeBrowser\\artifacts\\phone-orientation-probe\\launcher-current.png" });
await request("action", { action: "interact" });
state = (await request("advance", { steps: 32 })).state;
console.log("APP", JSON.stringify({ phone: state.phone }));
await request("render");
await request("screenshot", { path: "C:\\ThreeBrowser\\artifacts\\phone-orientation-probe\\wallet-current.png" });
socket.end();
