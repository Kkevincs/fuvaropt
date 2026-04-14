namespace FuvarOpt.Options;

public sealed class GeminiOptions
{
    public const string SectionName = "Gemini";

    public string ApiKey { get; set; } = "";

    public string Model { get; set; } = "gemini-2.0-flash";
}
