import { dirname, extname, join, parse, resolve } from "node:path";

export const DEFAULT_FORMAT = "expert-curious";
export const DEFAULT_DETAIL = "balanced" as const;

export function defaultOutputPath(inputPath: string): string {
  const absolute = resolve(inputPath);
  const extension = extname(absolute).toLowerCase();
  const name = extension === ".txt" || extension === ".md" ? parse(absolute).name : parse(absolute).base;
  return join(dirname(absolute), `${name}.mp3`);
}

export function isDocumentShorthand(value: string): boolean {
  const extension = extname(value).toLowerCase();
  return extension === ".txt" || extension === ".md";
}
