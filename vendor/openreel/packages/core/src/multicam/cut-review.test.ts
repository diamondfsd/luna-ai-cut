import { describe, expect, it } from "vitest";
import {
  acceptMulticamCut,
  createMulticamCutReview,
  nudgeMulticamCut,
  rejectMulticamCut,
  reviewedMulticamEdit,
} from "./cut-review";

const edit = {
  duration: 6,
  segments: [
    { angleId: "a", startTime: 0, endTime: 2, reason: "speaker" as const, confidence: 1 },
    { angleId: "b", startTime: 2, endTime: 4, reason: "speaker" as const, confidence: 1 },
    { angleId: "a", startTime: 4, endTime: 6, reason: "speaker" as const, confidence: 1 },
  ],
};

describe("multicam cut review", () => {
  it("accepts, rejects, and nudges generated cuts", () => {
    const review = createMulticamCutReview(edit);
    const secondId = review.segments[1]!.reviewId;
    expect(acceptMulticamCut(review, secondId).segments[1]?.status).toBe("accepted");
    const nudged = nudgeMulticamCut(review, secondId, 250);
    expect(nudged.segments[0]?.endTime).toBe(2.25);
    expect(nudged.segments[1]?.startTime).toBe(2.25);
    const rejected = rejectMulticamCut(review, secondId);
    expect(reviewedMulticamEdit(rejected).segments).toHaveLength(1);
    expect(reviewedMulticamEdit(rejected).segments[0]).toMatchObject({
      angleId: "a",
      startTime: 0,
      endTime: 6,
    });
  });
});
