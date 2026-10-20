import http from "node:http";
import { Host } from "./host.mjs";
import { errorObject } from "./engine.mjs";
const token = process.env.ISLET_DEV_TOKEN;
if (!token || token.length < 16)
  throw new Error("ISLET_DEV_TOKEN must contain at least 16 characters.");
const clients = new Set();
const host = new Host({
  emit: (event, payload) => {
    const frame = `data: ${JSON.stringify({ event, payload })}\n\n`;
    for (const client of clients) client.write(frame);
  },
});
await host.startCli();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):1420$/.test(origin)) {
    res.writeHead(403).end("Origin rejected");
    return;
  }
  if (
    req.headers.authorization !== `Bearer ${token}` &&
    url.searchParams.get("token") !== token
  ) {
    res.writeHead(401).end("Unauthorized");
    return;
  }
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === "/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (url.pathname !== "/request" || req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024 * 1024) {
      res.writeHead(413).end();
      return;
    }
  }
  try {
    const { operation, payload } = JSON.parse(body);
    if (operation === "dialog.open" || operation === "dialog.save")
      throw Object.assign(
        new Error(
          "Native file dialogs are available in the desktop application.",
        ),
        { code: "NATIVE_ONLY" },
      );
    if (operation === "app.openExternal")
      throw Object.assign(
        new Error("Open external links in the native application."),
        { code: "NATIVE_ONLY" },
      );
    const result = await host.request(operation, payload);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ result }));
  } catch (e) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: errorObject(e) }));
  }
});
server.listen(1421, "127.0.0.1", () =>
  process.stdout.write("Islet development host listening on 127.0.0.1:1421\n"),
);
const close = async () => {
  for (const client of clients) client.end();
  server.close();
  await host.close();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
