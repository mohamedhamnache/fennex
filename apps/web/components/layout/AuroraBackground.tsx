/**
 * Fixed, full-viewport aurora field: slow-drifting indigo/violet/fuchsia blobs
 * behind all app content. Pure CSS (see globals.css `.aurora-*`), GPU-cheap,
 * and disabled under prefers-reduced-motion. Sits at z-0; content sits above.
 */
export function AuroraBackground() {
  return (
    <div className="aurora-field" aria-hidden>
      <div className="aurora-blob aurora-blob-1" />
      <div className="aurora-blob aurora-blob-2" />
      <div className="aurora-blob aurora-blob-3" />
      {/* subtle top vignette so the top bar reads cleanly over the glow */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background/60 to-transparent" />
    </div>
  );
}
