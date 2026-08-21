export interface MayhemModeDetector {
  isMayhemMode(tokenMint: string): Promise<boolean>;
}

export interface MayhemFilterResult<T extends { readonly token: { readonly mint: string } }> {
  readonly accepted: readonly T[];
  readonly rejectedMints: readonly string[];
}

/** Fails closed: only a confirmed non-Mayhem token can proceed. */
export async function excludeMayhemMode<T extends { readonly token: { readonly mint: string } }>(
  candidates: readonly T[],
  detector: MayhemModeDetector
): Promise<MayhemFilterResult<T>> {
  const accepted: T[] = [];
  const rejectedMints: string[] = [];
  for (const candidate of candidates) {
    if (await detector.isMayhemMode(candidate.token.mint)) rejectedMints.push(candidate.token.mint);
    else accepted.push(candidate);
  }
  return { accepted, rejectedMints };
}
