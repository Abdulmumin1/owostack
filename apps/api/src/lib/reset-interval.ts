export function normalizeResetInterval(
  resetInterval: string | null | undefined,
): string {
  if (!resetInterval) {
    return "none";
  }

  return resetInterval === "never" ? "none" : resetInterval;
}
