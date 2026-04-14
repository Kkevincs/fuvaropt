/** Matches FuvarOpt PostOptimizationSuggestionsResponse (camelCase JSON). */
export type PostOptimizationSuggestionsResponse = {
  suggestions: string[];
};

export function normalizePostOptimizationSuggestions(
  raw: unknown,
): PostOptimizationSuggestionsResponse {
  if (raw === null || typeof raw !== "object") {
    return { suggestions: [] };
  }
  const o = raw as Record<string, unknown>;
  const sug = o.suggestions ?? o.Suggestions;
  return {
    suggestions: Array.isArray(sug)
      ? sug.filter((x): x is string => typeof x === "string" && x.trim() !== "")
      : [],
  };
}
