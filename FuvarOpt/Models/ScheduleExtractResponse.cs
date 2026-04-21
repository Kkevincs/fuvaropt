using System.Collections.Generic;

namespace FuvarOpt.Models;

public sealed class ScheduleEmployeeDto
{
    public string Name { get; set; } = "";

    public List<string> Skills { get; set; } = new();

    public List<string> UnavailableDates { get; set; } = new();

    public List<string> UndesiredDates { get; set; } = new();

    public List<string> DesiredDates { get; set; } = new();
}

public sealed class ScheduleShiftInputDto
{
    public string Id { get; set; } = "";

    public string Start { get; set; } = "";

    public string End { get; set; } = "";

    public string Location { get; set; } = "";

    public string RequiredSkill { get; set; } = "";
}

/// <summary>Structured schedule extracted from chat (same shape for REST and MCP tool).</summary>
public sealed class ScheduleExtractResponse
{
    public List<ScheduleEmployeeDto> Employees { get; set; } = new();

    public List<ScheduleShiftInputDto> Shifts { get; set; } = new();

    /// <summary>True when there is at least one employee and one valid shift row.</summary>
    public bool Complete { get; set; }

    /// <summary>When <see cref="Complete"/> is false, human-readable items to fix (only these should be requested in follow-up).</summary>
    public List<string> MissingHints { get; set; } = new();
}
