import { describe, expect, it } from 'vitest'

import {
  acquireAiEditingSourceWriteOwnership,
  isAiEditingSourceWriteOwned,
} from './project-source-write-ownership'

describe('AI editing source write ownership', () => {
  it('remains active until every owner releases and tolerates repeated release', () => {
    const releaseFirst = acquireAiEditingSourceWriteOwnership()
    const releaseSecond = acquireAiEditingSourceWriteOwnership()
    expect(isAiEditingSourceWriteOwned()).toBe(true)

    releaseFirst()
    releaseFirst()
    expect(isAiEditingSourceWriteOwned()).toBe(true)

    releaseSecond()
    expect(isAiEditingSourceWriteOwned()).toBe(false)
  })
})
