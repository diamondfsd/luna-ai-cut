# Timeline Acceptance Files

`timeline.test` always runs the normal source check and full build first. It then reads only direct
`tests/*.acceptance.json` files and evaluates them against the compiled `EditProgram`. No acceptance
files is a passing test run.

```json
{
  "version": 1,
  "name": "main sequence",
  "assertions": [
    { "id": "enough-edits", "kind": "operationCount", "min": 8, "max": 30 },
    { "id": "enough-shots", "kind": "operationType", "operation": "insertClip", "min": 6 },
    { "id": "target-length", "kind": "outputDuration", "minSeconds": 30, "maxSeconds": 45 },
    { "id": "changed-area", "kind": "changedDuration", "maxSeconds": 45 },
    { "id": "title", "kind": "requiredText", "text": "Luna", "caseSensitive": false }
  ]
}
```

Count and duration assertions require at least one lower or upper bound. Assertion ids must be unique
inside a file. `outputDuration` is the latest end time among range-bearing build operations;
`changedDuration` merges their overlapping ranges before summing. `requiredText` inspects text
insertions, HTML insertions, and text updates. Directory entries, file count, per-file bytes, total
bytes, and total assertion count are bounded before evaluation.
