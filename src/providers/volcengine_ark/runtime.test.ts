import { describe, expect, it } from "vitest";
import {
  buildSeedanceSubmitBody,
  normalizeSeedanceTask,
  readSeedanceSubmitInput,
  volcengineArkActionHandlers,
} from "./runtime.ts";

describe("Volcengine Ark Seedance runtime", () => {
  it("builds the official structured content request with defaults", () => {
    const input = readSeedanceSubmitInput({
      prompt: "A cat watches the sunrise.",
      images: [{ url: "https://example.com/first.png", role: "first_frame" }],
    });

    expect(buildSeedanceSubmitBody(input)).toEqual({
      model: "doubao-seedance-2-0-260128",
      content: [
        { type: "text", text: "A cat watches the sunrise." },
        {
          type: "image_url",
          image_url: { url: "https://example.com/first.png" },
          role: "first_frame",
        },
      ],
      return_last_frame: false,
      generate_audio: true,
      resolution: "720p",
      ratio: "adaptive",
      duration: 5,
      watermark: false,
    });
  });

  it("rejects incompatible frame and reference inputs", () => {
    expect(() =>
      readSeedanceSubmitInput({
        images: [{ url: "https://example.com/first.png", role: "first_frame" }],
        videos: [{ url: "https://example.com/reference.mp4", role: "reference_video" }],
      }),
    ).toThrow("frame images cannot be mixed");
  });

  it("allows custom Ark Endpoint IDs without model-name inference", () => {
    expect(
      readSeedanceSubmitInput({
        model: "ep-20260831-example",
        prompt: "A landscape shot.",
        resolution: "1080p",
      }).model,
    ).toBe("ep-20260831-example");
  });

  it("normalizes succeeded and terminal task states", () => {
    expect(
      normalizeSeedanceTask(
        {
          id: "cgt-1",
          model: "doubao-seedance-2-0-260128",
          status: "succeeded",
          content: { video_url: "https://example.com/video.mp4" },
          duration: "5",
          usage: { total_tokens: 100 },
        },
        "fallback",
      ),
    ).toMatchObject({
      taskId: "cgt-1",
      state: "succeeded",
      videoUrl: "https://example.com/video.mp4",
      duration: 5,
      usage: { totalTokens: 100 },
    });
    expect(
      normalizeSeedanceTask(
        { id: "cgt-2", status: "expired", error: { code: "Expired", message: "Task expired" } },
        "fallback",
      ),
    ).toMatchObject({ taskId: "cgt-2", state: "expired", error: { code: "Expired" } });
  });

  it("maps upstream not-found responses to invalid_input with HTTP 404 details", async () => {
    const fetcher = async (): Promise<Response> =>
      new Response(JSON.stringify({ error: { code: "NotFound", message: "Task not found" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });

    await expect(
      volcengineArkActionHandlers.get_seedance_video_generation(
        { taskId: "cgt-missing" },
        { apiKey: "secret", fetcher: fetcher as typeof fetch },
      ),
    ).rejects.toMatchObject({
      status: 404,
      code: "invalid_input",
      message: "Task not found",
    });
  });
});
