import path from "path";
import { promises as fs } from "fs";
import { pathToFileURL } from "url";
import writeAtomic from "write-file-atomic";

export const fileURL = (file: string) => pathToFileURL(file).href;

export async function writeText(file: string, text: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeAtomic(file, text, { encoding: "utf8" });
}
