function stripLeadingBullet(text: string): string {
  return text.replace(/^\s*[•\-\*]\s*/, "").trim();
}

type Props = {
  title?: string;
  description?: string;
  /** Gemini insights, shown as cards. */
  insights?: string[] | null;
  loading?: boolean;
  error?: string | null;
  /** How many cards to show (scheduling uses more when analyze+constraints). */
  maxItems?: number;
};

export function ScheduleInsightsReport({
  title = "Schedule insights",
  description = "AI suggestions from your solved schedule (Gemini). Review before changing assignments.",
  insights = null,
  loading = false,
  error = null,
  maxItems = 3,
}: Props) {
  const top = (insights ?? []).slice(0, maxItems).map(stripLeadingBullet).filter(Boolean);

  if (!loading && error === null && top.length === 0) {
    return null;
  }

  const colsClass =
    maxItems <= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-4 sm:px-5">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs text-slate-500">{description}</p>

      {loading && (
        <div className={`mt-4 grid gap-3 ${colsClass}`}>
          {Array.from({ length: Math.min(6, maxItems) }, (_, i) => i).map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-white/10 bg-slate-950/60 px-3 py-4"
            >
              <div className="h-3 w-24 rounded bg-slate-700/80" />
              <div className="mt-3 h-10 rounded bg-slate-800/80" />
            </div>
          ))}
        </div>
      )}

      {!loading && error !== null && (
        <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}

      {!loading && error === null && top.length > 0 && (
        <div className={`mt-4 grid gap-3 ${colsClass}`}>
          {top.map((text, idx) => (
            <div
              key={idx}
              className="flex flex-col rounded-xl border border-amber-500/25 bg-amber-950/30 px-4 py-3 ring-1 ring-amber-500/10"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400/90">
                Insight {idx + 1}
              </span>
              <p className="mt-2 text-sm leading-relaxed text-slate-100">{text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
