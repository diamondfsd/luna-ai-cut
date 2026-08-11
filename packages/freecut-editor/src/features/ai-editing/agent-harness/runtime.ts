import type {
  AgentHarnessModelOutput,
  AgentHarnessResult,
  AgentHarnessToolExchange,
  RunAgentHarnessOptions,
} from './types'

export class AgentHarnessProtocolError extends Error {
  constructor() {
    super('助手这次没有按约定返回处理结果，已自动重试多次。请再试一次。')
    this.name = 'AgentHarnessProtocolError'
  }
}

export async function runAgentHarness<TObservation>(
  options: RunAgentHarnessOptions<TObservation>,
): Promise<AgentHarnessResult<TObservation>> {
  const observations = [...(options.initialObservations ?? [])]
  let reply = ''
  let callIndex = observations.length
  let forceFinalization = false

  for (let round = 0; round <= options.maxRounds; round += 1) {
    if (options.signal?.aborted) break
    const finalizationRound = forceFinalization || round === options.maxRounds
    options.onEvent?.({
      type: 'model-request',
      round,
      protocol: options.driver.protocol,
      messageCount: options.driver.messageCount,
    })

    let step
    try {
      step = await options.driver.request({ round })
    } catch (error) {
      options.onEvent?.({
        type: 'model-error',
        round,
        protocol: options.driver.protocol,
        error,
      })
      if (!options.canRecoverFromModelError(observations)) throw error
      return { status: 'completed', reply, observations }
    }

    options.onEvent?.({
      type: 'model-response',
      round,
      protocol: options.driver.protocol,
      step,
    })

    if (step.kind === 'fallback') {
      return {
        status: 'fallback',
        reply,
        observations,
        ...(step.content === undefined ? {} : { fallbackContent: step.content }),
      }
    }

    if (step.kind === 'protocol-error') {
      options.onEvent?.({
        type: 'protocol-error',
        round,
        protocol: options.driver.protocol,
      })
      if (finalizationRound) throw new AgentHarnessProtocolError()
      const shouldFinalizeNext = round === options.maxRounds - 1
      options.driver.recordProtocolError(
        step.raw,
        shouldFinalizeNext
          ? `${options.protocolRepairPrompt}\n\n${options.finalizationPrompt}`
          : options.protocolRepairPrompt,
      )
      if (shouldFinalizeNext) forceFinalization = true
      continue
    }

    const output: AgentHarnessModelOutput = step.output
    if (output.content) reply = output.content
    if (output.toolCalls.length === 0) {
      if (options.canCompleteFromText({ output, observations })) {
        options.onTextCompletion?.(output.content)
        return { status: 'completed', reply: output.content, observations }
      }
      if (finalizationRound) return { status: 'exhausted', reply, observations }
      options.driver.recordContinuation(
        output,
        round === options.maxRounds - 1
          ? options.finalizationPrompt
          : options.continuationPrompt,
      )
      continue
    }

    if (finalizationRound) return { status: 'exhausted', reply, observations }

    const exchanges: AgentHarnessToolExchange<TObservation>[] = []
    let finalizeAfterTool = false
    for (const call of output.toolCalls.slice(0, options.maxToolCallsPerRound)) {
      if (options.signal?.aborted) break
      options.onEvent?.({ type: 'tool-start', round, call })
      const observation = await options.executeTool(call, callIndex, round)
      callIndex += 1
      observations.push(observation)
      const exchange = { call, observation }
      exchanges.push(exchange)
      options.onEvent?.({ type: 'tool-result', round, exchange })
      if (options.shouldStopAfterTool(observations)) {
        return { status: 'completed', reply, observations }
      }
      if (options.shouldFinalizeAfterTool?.(observations)) {
        finalizeAfterTool = true
        break
      }
    }
    if (options.signal?.aborted) break
    options.driver.recordToolResults(output, exchanges)
    if (finalizeAfterTool || round === options.maxRounds - 1) {
      options.driver.recordUserPrompt(options.finalizationPrompt)
      forceFinalization = true
    }
  }

  return { status: 'exhausted', reply, observations }
}
