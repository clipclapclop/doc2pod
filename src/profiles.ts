import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { CUES, VOICES, type Cue, type HostProfile, type ShowProfile, type Voice } from "./types.js";

const STANDARD_CUES: Cue[] = ["laugh", "chuckle", "sigh", "gasp"];

function profile(
  id: string,
  description: string,
  style: string,
  roleA: string,
  roleB: string,
  medical = false,
): ShowProfile {
  return {
    id,
    description,
    style,
    hosts: [
      { id: "host_a", name: "Alex", role: roleA, voice: "tara" },
      { id: "host_b", name: "Jordan", role: roleB, voice: "zac" },
    ],
    allowedCues: medical ? ["sigh"] : [...STANDARD_CUES],
    medical,
  };
}

export const BUILTIN_PROFILES: Record<string, ShowProfile> = Object.fromEntries(
  [
    profile(
      "expert-curious",
      "A domain expert explains the source to an intelligent, curious non-specialist.",
      "Warm, clear, and collaborative. The curious host asks useful questions without pretending ignorance.",
      "A careful domain expert who explains mechanisms, evidence, and uncertainty.",
      "An informed lay host who asks concise clarifying and consequence-focused questions.",
    ),
    profile(
      "expert-skeptic",
      "A domain expert discusses the source with a constructive skeptic.",
      "Respectful disagreement. Challenges must target evidence and assumptions rather than create artificial conflict.",
      "A careful expert grounded only in the supplied source.",
      "A methodical skeptic who probes evidence, limitations, and alternative interpretations.",
    ),
    profile(
      "friendly-rivals",
      "Two informed fans discuss the material with playful rivalry.",
      "Energetic and lightly adversarial, never hostile. Banter must not displace substantive source coverage.",
      "An informed enthusiast with one perspective or allegiance.",
      "An equally informed enthusiast with a contrasting perspective or allegiance.",
    ),
    profile(
      "coenthusiasts",
      "Two knowledgeable enthusiasts explore the source together.",
      "Relaxed, specific, and naturally excited without hype or repetitive agreement.",
      "A technically knowledgeable enthusiast who focuses on how things work.",
      "A knowledgeable enthusiast who focuses on practical consequences and comparisons.",
    ),
    profile(
      "clinical-results",
      "A careful medical explainer walks through personal clinical results with a patient advocate.",
      "Calm, literal, and non-alarmist. Preserve values, units, reference ranges, caveats, and uncertainty. Never add diagnosis, treatment, prognosis, or reassurance not present in the source.",
      "A medical-results explainer who accurately restates only the supplied document.",
      "A patient advocate who asks what each result means within the limits of the document.",
      true,
    ),
    profile(
      "medical-research",
      "A medical researcher discusses new findings with a methodical skeptic.",
      "Cautious and evidence-focused. Separate observed results from hypotheses and preserve study limitations.",
      "A research explainer who accurately describes methods, results, and uncertainty.",
      "A skeptical reviewer who probes design, effect size, generalizability, and limitations.",
      true,
    ),
  ].map((item) => [item.id, item]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHost(value: unknown, id: "host_a" | "host_b"): HostProfile {
  if (!isRecord(value)) throw new Error(`Custom profile ${id} must be an object`);
  const name = value.name;
  const role = value.role;
  const voice = value.voice;
  if (typeof name !== "string" || !name.trim()) throw new Error(`Custom profile ${id}.name is required`);
  if (typeof role !== "string" || role.trim().length < 10) throw new Error(`Custom profile ${id}.role must be descriptive`);
  if (typeof voice !== "string" || !VOICES.includes(voice as Voice)) {
    throw new Error(`Custom profile ${id}.voice must be one of: ${VOICES.join(", ")}`);
  }
  return { id, name: name.trim(), role: role.trim(), voice: voice as Voice };
}

export async function loadProfile(format?: string, customPath?: string): Promise<ShowProfile> {
  if (format && customPath) throw new Error("Use either --format or --profile, not both");
  if (!format && !customPath) throw new Error("Either --format or --profile is required");
  if (format) {
    const found = BUILTIN_PROFILES[format];
    if (!found) throw new Error(`Unknown format '${format}'. Valid formats: ${Object.keys(BUILTIN_PROFILES).join(", ")}`);
    return structuredClone(found);
  }

  const raw = YAML.parse(await readFile(customPath!, "utf8")) as unknown;
  if (!isRecord(raw)) throw new Error("Custom profile must be a YAML object");
  const hosts = raw.hosts;
  if (!Array.isArray(hosts) || hosts.length !== 2) throw new Error("Custom profile must define exactly two hosts");
  const allowedCues = raw.allowedCues ?? STANDARD_CUES;
  if (!Array.isArray(allowedCues) || allowedCues.some((cue) => typeof cue !== "string" || !CUES.includes(cue as Cue))) {
    throw new Error(`allowedCues must contain only: ${CUES.join(", ")}`);
  }
  const id = raw.id;
  const description = raw.description;
  const style = raw.style;
  if (typeof id !== "string" || !id.trim()) throw new Error("Custom profile id is required");
  if (typeof description !== "string" || !description.trim()) throw new Error("Custom profile description is required");
  if (typeof style !== "string" || style.trim().length < 10) throw new Error("Custom profile style must be descriptive");
  const parsed: ShowProfile = {
    id: id.trim(),
    description: description.trim(),
    style: style.trim(),
    hosts: [parseHost(hosts[0], "host_a"), parseHost(hosts[1], "host_b")],
    allowedCues: allowedCues as Cue[],
    medical: raw.medical === true,
  };
  if (parsed.hosts[0].voice === parsed.hosts[1].voice) throw new Error("The two hosts must use distinct voices");
  return parsed;
}

export function overrideVoices(profile: ShowProfile, voiceA?: string, voiceB?: string): ShowProfile {
  const result = structuredClone(profile);
  for (const [voice, index] of [[voiceA, 0], [voiceB, 1]] as const) {
    if (voice === undefined) continue;
    if (!VOICES.includes(voice as Voice)) throw new Error(`Invalid voice '${voice}'. Valid voices: ${VOICES.join(", ")}`);
    result.hosts[index].voice = voice as Voice;
  }
  if (result.hosts[0].voice === result.hosts[1].voice) throw new Error("The two hosts must use distinct voices");
  return result;
}
