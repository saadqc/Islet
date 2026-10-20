import net from "node:net";
const socket = process.env.ISLET_ASKPASS_SOCKET,
  token = process.env.ISLET_ASKPASS_TOKEN;
if (!socket || !token) process.exit(1);
const client = net.createConnection(socket);
let buffer = "";
const timer = setTimeout(() => {
  client.destroy();
  process.exit(1);
}, 120000);
client.on("connect", () =>
  client.write(
    JSON.stringify({
      token,
      hostId: process.env.ISLET_ASKPASS_HOST,
      prompt: process.argv.slice(2).join(" "),
    }) + "\n",
  ),
);
client.on("data", (d) => (buffer += d));
client.on("end", () => {
  clearTimeout(timer);
  process.stdout.write(buffer);
});
client.on("error", () => process.exit(1));
