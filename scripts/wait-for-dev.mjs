const deadline = Date.now() + 30000;
while (Date.now() < deadline) {
  try {
    const response = await fetch("http://127.0.0.1:1420/");
    if (response.ok) {
      console.log("Development UI is ready");
      process.exit(0);
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
throw new Error("Development UI did not become ready within30 seconds");
