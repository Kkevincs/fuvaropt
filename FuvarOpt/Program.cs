using System;
using System.Threading;
using FuvarOpt.Mcp;
using FuvarOpt.Models;
using FuvarOpt.Options;
using FuvarOpt.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.OpenApi.Models;
using ModelContextProtocol.AspNetCore;
using System.Text.Json;

namespace FuvarOpt;

public static class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        builder.Services.ConfigureHttpJsonOptions(o =>
        {
            o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            o.SerializerOptions.PropertyNameCaseInsensitive = true;
        });

        builder.Services.Configure<GeminiOptions>(builder.Configuration.GetSection(GeminiOptions.SectionName));

        builder.Services.AddSingleton<RouteOptimizationAnalysisService>();

        builder.Services.AddHttpClient<GeminiRouteExtractionService>(client =>
        {
            client.BaseAddress = new Uri("https://generativelanguage.googleapis.com/");
            client.Timeout = TimeSpan.FromMinutes(3);
        });

        builder.Services
            .AddMcpServer()
            .WithHttpTransport(o =>
            {
                o.Stateless = true;
            })
            .WithTools<RouteMcpTools>();

        builder.Services.AddEndpointsApiExplorer();
        builder.Services.AddSwaggerGen(options =>
        {
            options.SwaggerDoc("v1", new OpenApiInfo
            {
                Title = "FuvarOpt API",
                Version = "v1",
            });
        });

        builder.Services.AddCors(options =>
        {
            options.AddDefaultPolicy(policy =>
            {
                policy.WithOrigins(
                        "http://localhost:5173",
                        "http://127.0.0.1:5173")
                    .AllowAnyHeader()
                    .AllowAnyMethod();
            });
        });

        var app = builder.Build();

        if (app.Environment.IsDevelopment())
        {
            app.UseSwagger();
            app.UseSwaggerUI(options =>
            {
                options.SwaggerEndpoint("/swagger/v1/swagger.json", "FuvarOpt v1");
            });
        }

        app.UseCors();

        app.MapMcp("/mcp");

        app.MapGet("/", () => Results.Ok(new { name = "FuvarOpt", version = "1.0" }));

        app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

        app.MapPost(
                "/api/route-problem",
                ([FromBody] RouteProblemRequest? body) =>
                {
                    try
                    {
                        var req = body ?? new RouteProblemRequest();
                        var result = RouteProblemBuilder.FromRequest(req);
                        return Results.Ok(result);
                    }
                    catch (ArgumentException ex)
                    {
                        return Results.BadRequest(new { error = ex.Message });
                    }
                })
            .WithName("CreateRouteProblem")
            .Produces<RouteProblemResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest);

        app.MapGet(
                "/api/route-problem",
                (
                    [FromQuery] int vehicleCount = 0,
                    [FromQuery] int addressCount = 0,
                    [FromQuery] int warehouseCount = 0,
                    [FromQuery] int packages = 0) =>
                {
                    try
                    {
                        var result = RouteProblemBuilder.FromCounts(
                            vehicleCount,
                            addressCount,
                            warehouseCount,
                            packages);
                        return Results.Ok(result);
                    }
                    catch (ArgumentException ex)
                    {
                        return Results.BadRequest(new { error = ex.Message });
                    }
                })
            .WithName("GetRouteProblem");

        app.MapPost(
                "/api/route-problem/from-message",
                async (
                    RouteProblemFromMessageRequest? body,
                    GeminiRouteExtractionService gemini,
                    CancellationToken cancellationToken) =>
                {
                    if (body is null || string.IsNullOrWhiteSpace(body.Message))
                    {
                        return Results.BadRequest(new { error = "Message is required." });
                    }

                    try
                    {
                        var result = await gemini
                            .ExtractFromMessageAsync(body.Message, cancellationToken)
                            .ConfigureAwait(false);
                        return Results.Ok(result);
                    }
                    catch (InvalidOperationException ex)
                    {
                        return Results.Json(
                            new { error = ex.Message },
                            statusCode: StatusCodes.Status503ServiceUnavailable);
                    }
                    catch (ArgumentException ex)
                    {
                        return Results.BadRequest(new { error = ex.Message });
                    }
                })
            .WithName("CreateRouteProblemFromMessage")
            .Produces<RouteProblemResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status503ServiceUnavailable);

        app.MapPost(
                "/api/route-problem/timefold",
                (TimefoldProblemRequest? body) =>
                {
                    if (body is null)
                    {
                        return Results.BadRequest(new { error = "Body is required." });
                    }

                    if (string.IsNullOrWhiteSpace(body.Name))
                    {
                        return Results.BadRequest(new { error = "Name is required." });
                    }

                    if (body.Vehicles is null || body.Vehicles.Count == 0)
                    {
                        return Results.BadRequest(new { error = "At least one vehicle is required." });
                    }

                    if (body.SouthWestCorner is null || body.SouthWestCorner.Length < 2
                        || body.NorthEastCorner is null || body.NorthEastCorner.Length < 2)
                    {
                        return Results.BadRequest(new { error = "Bounding box must be [latitude, longitude] arrays." });
                    }

                    if (body.SouthWestCorner[0] >= body.NorthEastCorner[0]
                        || body.SouthWestCorner[1] >= body.NorthEastCorner[1])
                    {
                        return Results.BadRequest(new { error = "Invalid bounding box (south-west must be south/west of north-east)." });
                    }

                    return Results.Ok(new { ok = true, received = body.Name });
                })
            .WithName("SubmitTimefoldProblem")
            .Produces<object>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest);

        app.Run();
    }
}
