import { isBinaryWorkbook } from "../spreadsheets/formats";
export const isDocx = (path: string) => /\.docx$/i.test(path);
export const isOfficeBinary = (path: string) =>
  isDocx(path) || isBinaryWorkbook(path);
export function decodeOffice(text: string) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
export function encodeOffice(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
export async function blankDocx() {
  const { default: blankUrl } = await import("./blank.docx?url");
  const response = await fetch(blankUrl);
  if (!response.ok)
    throw new Error("Could not load the bundled blank document.");
  return {
    text: encodeOffice(new Uint8Array(await response.arrayBuffer())),
    binary: true,
  };
}
