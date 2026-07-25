export type OnboardingStep =
  | "welcome"
  | "discovery"
  | "review"
  | "goals"
  | "brand"
  | "audience"
  | "summary"
  | "provisioning"
  | "done";

// Steps that appear in the progress rail / linear flow. "provisioning" and
// "done" are terminal states reached after "summary" and are handled outside
// the rail (later tasks own their transitions), so they are intentionally
// excluded here.
export const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "discovery",
  "review",
  "goals",
  "brand",
  "audience",
  "summary",
];
