import { unlinkSync } from "node:fs";

const socketPath = "/tmp/my-socket.sock";

// Remove the socket file if it already exists from a previous run
try {
  unlinkSync(socketPath);
} catch {}

const server = Bun.serve({
  unix: socketPath,
  async fetch(req) {
    console.log(`REQ ${JSON.stringify(req)}`)
    console.log(`URL ${req.method} ${req.url}`)
    console.log(`Headers ${JSON.stringify(req.headers)}`)
    const content = await req.arrayBuffer()
    console.log(`Content ${content.byteLength}`)
    return new Response("Hello from Bun via Unix Socket!");
  },
});

console.log(`Listening on unix://${server.development ? 'dev' : socketPath}`);
