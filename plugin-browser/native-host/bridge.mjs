// Chrome's native messaging host: a pipe between the extension and bb.
//
// Chrome starts this process, hands it the extension's stdio, and kills it
// when the extension's port closes. It owns no state: it reframes Chrome's
// length-prefixed messages as newline-delimited JSON on bb's unix socket, and
// back. bb's socket is the only thing it talks to, so a bb restart drops the
// connection and the extension reconnects a new host.
import { readFileSync } from "node:fs";
import { connect } from "node:net";

// bb binds a fresh socket on every plugin load and records it here, so the
// path this process was installed with stays valid across bb reloads.
const pointerPath = process.argv[2];
if (!pointerPath) {
  process.stderr.write("bb-browser-host: missing pointer file argument\n");
  process.exit(2);
}

let socketPath;
try {
  socketPath = JSON.parse(readFileSync(pointerPath, "utf8")).socketPath;
} catch (error) {
  process.stderr.write(`bb-browser-host: cannot read ${pointerPath}: ${error.message}\n`);
  process.exit(1);
}
if (!socketPath) {
  process.stderr.write(`bb-browser-host: ${pointerPath} names no socket\n`);
  process.exit(1);
}

const socket = connect(socketPath);
socket.on("error", (error) => {
  process.stderr.write(`bb-browser-host: ${error.message}\n`);
  process.exit(1);
});
socket.on("close", () => process.exit(0));

// Chrome -> bb. Frames are a 4-byte little-endian length then UTF-8 JSON.
let inbox = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  inbox = Buffer.concat([inbox, chunk]);
  while (inbox.length >= 4) {
    const length = inbox.readUInt32LE(0);
    if (inbox.length < 4 + length) return;
    const body = inbox.subarray(4, 4 + length);
    inbox = inbox.subarray(4 + length);
    socket.write(body);
    socket.write("\n");
  }
});
process.stdin.on("end", () => {
  socket.end();
  process.exit(0);
});

// bb -> Chrome.
let outbox = "";
socket.on("data", (chunk) => {
  outbox += chunk.toString("utf8");
  let newline = outbox.indexOf("\n");
  while (newline !== -1) {
    const line = outbox.slice(0, newline);
    outbox = outbox.slice(newline + 1);
    if (line.trim()) {
      const body = Buffer.from(line, "utf8");
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length, 0);
      process.stdout.write(Buffer.concat([header, body]));
    }
    newline = outbox.indexOf("\n");
  }
});
