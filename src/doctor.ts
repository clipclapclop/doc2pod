import { statfs } from "node:fs/promises";
import { run } from "./process.js";

export interface DoctorCheck {
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
  remediation?: string;
}

async function checked(
  name: string,
  command: string,
  args: string[],
  validate?: (output: string) => boolean,
  successMessage?: string,
): Promise<DoctorCheck> {
  try {
    const result = await run(command, args);
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (validate && !validate(output)) return { name, status: "error", message: "Required capability not found" };
    return { name, status: "ok", message: successMessage ?? output.split("\n").find(Boolean) ?? "available" };
  } catch (error) {
    return { name, status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export async function runDoctor(): Promise<DoctorCheck[]> {
  const image = process.env.DOC2POD_TTS_IMAGE ?? "doc2pod-orpheus:local";
  const checks = await Promise.all([
    checked("codex", "codex", ["--version"]),
    checked("codex-auth", "codex", ["login", "status"], (output) => /Logged in/i.test(output), "Codex authentication available"),
    checked("ffmpeg-mp3", "ffmpeg", ["-hide_banner", "-encoders"], (output) => output.includes("libmp3lame"), "libmp3lame encoder available"),
    checked("gpu-lock", process.env.DOC2POD_FLOCK ?? "flock", ["--version"], undefined, "GPU job locking available"),
    checked("docker", "docker", ["info", "--format", "{{json .Runtimes}}"], undefined, "Docker daemon accessible"),
    checked("nvidia-driver", "nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"]),
    checked("nvidia-container-runtime", "docker", ["info", "--format", "{{json .Runtimes}}"], (output) => output.includes("nvidia"), "NVIDIA runtime registered"),
    checked("orpheus-image", "docker", ["image", "inspect", image, "--format", "{{.Id}}"]),
  ]);
  try {
    const stats = await statfs(process.cwd());
    const freeGiB = Number(stats.bavail * stats.bsize) / 1024 ** 3;
    checks.push({
      name: "disk-space",
      status: freeGiB >= 15 ? "ok" : "warning",
      message: `${freeGiB.toFixed(1)} GiB free`,
      ...(freeGiB < 15 ? { remediation: "Free at least 15 GiB for the model image and temporary WAV segments." } : {}),
    });
  } catch (error) {
    checks.push({ name: "disk-space", status: "warning", message: `Could not inspect disk space: ${String(error)}` });
  }
  const remediations: Record<string, string> = {
    codex: "Install the Codex CLI and ensure it is on PATH.",
    "codex-auth": "Run `codex login` interactively.",
    "ffmpeg-mp3": "Install FFmpeg with libmp3lame support.",
    "gpu-lock": "Install util-linux so the `flock` command is available.",
    docker: "Start Docker and grant this user access to its socket; on Manjaro, verify docker.service and docker group membership.",
    "nvidia-driver": "Install a Manjaro-supported NVIDIA driver for the RTX 3080 and reboot, then verify `nvidia-smi`.",
    "nvidia-container-runtime": "Install and configure NVIDIA Container Toolkit for Docker, then restart Docker.",
    "orpheus-image": "Accept the gated Orpheus model terms, set HF_TOKEN, then run `docker buildx build --load --secret id=hf_token,env=HF_TOKEN -t doc2pod-orpheus:local tts-worker`.",
  };
  return checks.map((check) => {
    const remediation = remediations[check.name];
    return check.status === "error" && remediation ? { ...check, remediation } : check;
  });
}
