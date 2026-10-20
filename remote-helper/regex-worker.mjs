import { parentPort } from "node:worker_threads";
import { findMatches, errorObject } from "./engine.mjs";
parentPort.on("message", ({ id, text, source, flags, meta }) => {
  try {
    const result = findMatches(text, new RegExp(source, flags), meta);
    parentPort.postMessage({ id, result, limited: !!result.limited });
  } catch (error) {
    parentPort.postMessage({ id, error: errorObject(error) });
  }
});
