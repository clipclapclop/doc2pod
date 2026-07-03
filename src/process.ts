import { spawn, spawnSync } from "node:child_process";

export interface RunOptions {
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  sensitive?: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

export class ProcessError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(message);
  }
}

export async function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const maxCapture = 4 * 1024 * 1024;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < maxCapture) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < maxCapture) stderr += chunk;
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      const safeStderr = options.sensitive ? "subprocess details redacted in sensitive mode" : stderr.trim().slice(-4000);
      reject(new ProcessError(`${command} exited with code ${code}: ${safeStderr}`, command, code, safeStderr));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");
  });
}

export function commandExists(command: string): boolean {
  const result = spawnSync("sh", ["-c", `command -v -- ${JSON.stringify(command)}`], { stdio: "ignore" });
  return result.status === 0;
}
