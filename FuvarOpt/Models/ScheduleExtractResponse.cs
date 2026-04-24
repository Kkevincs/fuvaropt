using System.Collections.Generic;

namespace FuvarOpt.Models;

public sealed class ScheduleDateTimeRangeDto
{
    public string Start { get; set; } = "";

    public string End { get; set; } = "";
}

/// <summary>Employee row for planning JSON (flights-based schedule).</summary>
public sealed class SchedulePlanningEmployeeDto
{
    public string Id { get; set; } = "";

    public string Name { get; set; } = "";

    public List<string> Skills { get; set; } = new();

    public string ExpectedShiftStart { get; set; } = "";

    public string EarliestShiftStart { get; set; } = "";

    public int DailyMinWorkingHour { get; set; }

    public int DailyMaxWorkingHour { get; set; }

    public int WeeklyWorkedHours { get; set; }

    public int WeeklyMaxWorkingHours { get; set; }

    public int MonthlyWorkedHours { get; set; }

    public int MonthlyMaxWorkingHours { get; set; }

    public List<ScheduleDateTimeRangeDto> UnavailableDates { get; set; } = new();

    public List<ScheduleDateTimeRangeDto> UndesiredDates { get; set; } = new();

    public List<ScheduleDateTimeRangeDto> DesiredDates { get; set; } = new();
}

public sealed class ScheduleFlightRequiredEmployeesDto
{
    public List<string> Skills { get; set; } = new();

    public int NumberOfEmployees { get; set; }
}

public sealed class ScheduleFlightDurationDto
{
    public string Start { get; set; } = "";

    public string End { get; set; } = "";
}

public sealed class ScheduleFlightDto
{
    public string Id { get; set; } = "";

    public ScheduleFlightDurationDto Duration { get; set; } = new();

    public List<ScheduleFlightRequiredEmployeesDto> RequiredEmployees { get; set; } = new();
}

/// <summary>Structured planning extract from chat (employees + flights). Same shape for REST and MCP.</summary>
public sealed class ScheduleExtractResponse
{
    public List<SchedulePlanningEmployeeDto> Employees { get; set; } = new();

    public List<ScheduleFlightDto> Flights { get; set; } = new();

    public bool Complete { get; set; }

    public List<string> MissingHints { get; set; } = new();
}
