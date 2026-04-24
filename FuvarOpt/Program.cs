using System;
using System.IO;
using System.Threading;
using DotNetEnv;
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
        LoadEnvFromRepoRoot();
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
                "/api/schedule/from-message",
                async (
                    ScheduleFromMessageRequest? body,
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
                            .ExtractScheduleFromMessageAsync(body.Message, cancellationToken)
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
            .WithName("CreateScheduleFromMessage")
            .Produces<ScheduleExtractResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status503ServiceUnavailable);

        app.MapPost(
                "/api/schedule/post-optimization-suggestions",
                async (
                    PostScheduleOptimizationSuggestionsRequest? body,
                    GeminiRouteExtractionService gemini,
                    CancellationToken cancellationToken) =>
                {
                    if (body is null || string.IsNullOrWhiteSpace(body.SolvedScheduleJson))
                    {
                        return Results.BadRequest(new { error = "SolvedScheduleJson is required." });
                    }

                    try
                    {
                        var result = await gemini
                            .GetPostScheduleOptimizationSuggestionsAsync(
                                body.SolvedScheduleJson,
                                body.AnalyzeResponseJson,
                                cancellationToken)
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
            .WithName("PostScheduleOptimizationSuggestions")
            .Produces<PostOptimizationSuggestionsResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status503ServiceUnavailable);

        app.MapPost(
                "/api/route-problem/post-optimization-suggestions",
                async (
                    PostOptimizationSuggestionsRequest? body,
                    GeminiRouteExtractionService gemini,
                    CancellationToken cancellationToken) =>
                {
                    if (body is null || string.IsNullOrWhiteSpace(body.OptimizedRouteJson))
                    {
                        return Results.BadRequest(new { error = "OptimizedRouteJson is required." });
                    }

                    try
                    {
                        var result = await gemini
                            .GetPostOptimizationSuggestionsAsync(body.OptimizedRouteJson, cancellationToken)
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
            .WithName("PostOptimizationSuggestions")
            .Produces<PostOptimizationSuggestionsResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status503ServiceUnavailable);

        app.Run();
    }

    /// <summary>Loads the first <c>.env</c> found walking up from the current directory (repo root).</summary>
    private static void LoadEnvFromRepoRoot()
    {
        var cur = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (cur != null)
        {
            var candidate = Path.Combine(cur.FullName, ".env");
            if (File.Exists(candidate))
            {
                Env.Load(candidate);
                return;
            }

            cur = cur.Parent;
        }
    }
}
