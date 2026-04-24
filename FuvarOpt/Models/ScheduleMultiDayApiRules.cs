using System;
using System.Collections.Generic;

namespace FuvarOpt.Models;

/// <summary>
/// Rules for the schedule service <c>POST .../schedules/problem/multi-day</c> (documented in MCP and UI).
/// </summary>
public static class ScheduleMultiDayApiRules
{
    /// <summary>
    /// Multi-day problems require at least two flights whose <see cref="ScheduleFlightDurationDto.Start"/>
    /// fall on different calendar dates (compare by date, not time-of-day).
    /// </summary>
    public static bool HasAtLeastTwoDistinctFlightStartDays(IReadOnlyList<ScheduleFlightDto> flights)
    {
        var days = new HashSet<string>(StringComparer.Ordinal);
        foreach (var f in flights)
        {
            if (f.Duration is null || string.IsNullOrWhiteSpace(f.Duration.Start))
            {
                continue;
            }

            var key = CalendarDayKeyFromIso(f.Duration.Start);
            if (key is not null)
            {
                days.Add(key);
            }
        }

        return days.Count >= 2;
    }

    private static string? CalendarDayKeyFromIso(string s)
    {
        var t = s.Trim();
        if (t.Length >= 10 && t[4] == '-' && t[7] == '-')
        {
            return t.Substring(0, 10);
        }

        if (DateTime.TryParse(s, out var dt))
        {
            return dt.ToString("yyyy-MM-dd");
        }

        return null;
    }
}
