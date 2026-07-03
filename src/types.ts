export const DETAILS = ["concise", "balanced", "thorough"] as const;
export type Detail = (typeof DETAILS)[number];

export const VOICES = ["tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe"] as const;
export type Voice = (typeof VOICES)[number];

export const CUES = ["laugh", "chuckle", "sigh", "cough", "sniffle", "groan", "yawn", "gasp"] as const;
export type Cue = (typeof CUES)[number];

export const TONES = ["neutral", "warm", "curious", "skeptical", "playful", "excited", "serious", "empathetic"] as const;
export type Tone = (typeof TONES)[number];

export const PACES = ["slow", "normal", "brisk"] as const;
export type Pace = (typeof PACES)[number];

export interface HostProfile {
  id: "host_a" | "host_b";
  name: string;
  role: string;
  voice: Voice;
}

export interface ShowProfile {
  id: string;
  description: string;
  style: string;
  hosts: [HostProfile, HostProfile];
  allowedCues: Cue[];
  medical: boolean;
}

export interface CoverageItem {
  id: string;
  topic: string;
  importance: "essential" | "major" | "supporting";
}

export type TurnPart =
  | { kind: "speech"; text: string }
  | { kind: "cue"; cue: Cue };

export interface ScriptTurn {
  id: string;
  speaker: "host_a" | "host_b";
  parts: TurnPart[];
  delivery: {
    tone: Tone;
    pace: Pace;
    pauseAfterMs: number;
  };
}

export interface EpisodeDraft {
  title: string;
  description: string;
  blueprint: {
    sourceSummary: string;
    targetScriptWords: number;
    budgetRationale: string;
    coverage: CoverageItem[];
  };
  turns: ScriptTurn[];
}

export const REVIEW_CODES = [
  "incomplete_coverage",
  "unsupported_claim",
  "distorted_uncertainty",
  "duplication",
  "role_drift",
  "unsafe_medical_inference",
  "poor_flow",
] as const;
export type ReviewCode = (typeof REVIEW_CODES)[number];

export interface ReviewIssue {
  code: ReviewCode;
  severity: "warning" | "error";
  message: string;
  turnIds: string[];
}

export interface ReviewResult {
  passed: boolean;
  issues: ReviewIssue[];
}

export interface TtsManifestTurn {
  id: string;
  speaker: "host_a" | "host_b";
  voice: Voice;
  prompt: string;
  pauseAfterMs: number;
}

export interface BuildResult {
  status: "ok";
  outputPath: string;
  title: string;
  description: string;
  durationSeconds: number;
  sourceSha256: string;
  sourceWords: number;
  scriptWords: number;
  outputInputRatio: number;
  format: string;
  detail: Detail;
  review: {
    repairs: number;
    passed: boolean;
    issueCodes: ReviewCode[];
  };
  warnings: string[];
  workDir?: string;
}
