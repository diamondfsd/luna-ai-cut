import type { OperationResult } from "./common.js"

export type CapabilityDomain = "project" | "media" | "timeline" | "preview" | "render" | "ai" | "jobs"

export interface CapabilityDescriptor {
  readonly id: string
  readonly domain: CapabilityDomain
  readonly version: string
  readonly available: boolean
  readonly description?: string
  readonly methods: readonly string[]
  readonly constraints?: Record<string, unknown>
}

export interface CapabilitiesListRequest {
  readonly domain?: CapabilityDomain
}

export interface CapabilityDescribeRequest {
  readonly capabilityId: string
}

export type CapabilitiesListResult = OperationResult<readonly CapabilityDescriptor[]>
export type CapabilityDescribeResult = OperationResult<CapabilityDescriptor | null>
