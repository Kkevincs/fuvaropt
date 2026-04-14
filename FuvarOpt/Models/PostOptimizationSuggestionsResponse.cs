using System.Collections.Generic;

namespace FuvarOpt.Models;

public sealed class PostOptimizationSuggestionsResponse
{
    public List<string> Suggestions { get; set; } = new();
}
