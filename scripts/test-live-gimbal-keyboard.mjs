import assert from 'node:assert/strict'

import { bindLiveGimbalKeyboard } from '../src/lib/liveGimbalKeyboard.ts'

class TestElement {
  constructor(blocked = false) {
    this.blocked = blocked
  }

  closest() {
    return this.blocked ? this : null
  }
}

globalThis.Element = TestElement

const windowTarget = new EventTarget()
const documentTarget = new EventTarget()
const pad = new TestElement()
const commands = []
let pointerActive = false
const dispose = bindLiveGimbalKeyboard({
  window: windowTarget,
  document: documentTarget,
  isPadTarget: (target) => target === pad,
  isPointerActive: () => pointerActive,
  onMove: (position) => commands.push(position),
  onStop: () => commands.push('stop'),
})

function key(type, code, properties = {}) {
  const event = new Event(type, { cancelable: true })
  for (const [name, value] of Object.entries({ code, ...properties })) {
    Object.defineProperty(event, name, { value })
  }
  windowTarget.dispatchEvent(event)
  return event
}

for (const [code, position] of [
  ['KeyW', { x: 0, y: 0.5 }],
  ['KeyA', { x: -0.5, y: 0 }],
  ['KeyS', { x: 0, y: -0.5 }],
  ['KeyD', { x: 0.5, y: 0 }],
]) {
  assert.equal(key('keydown', code).defaultPrevented, true)
  assert.deepEqual(commands.at(-1), position)
  const count = commands.length
  key('keydown', code, { repeat: true })
  assert.equal(commands.length, count, 'held keys must not resend movement')
  key('keyup', code)
  assert.equal(commands.at(-1), 'stop', 'releasing the last key must stop')
}

key('keydown', 'KeyW')
key('keydown', 'ShiftLeft', { shiftKey: true })
assert.deepEqual(commands.at(-1), { x: 0, y: 1 }, 'Shift must accelerate an already held direction')
key('keydown', 'KeyD', { shiftKey: true })
assert.ok(Math.abs(Math.hypot(commands.at(-1).x, commands.at(-1).y) - 1) < 1e-12, 'full-speed diagonal must remain capped')
key('keyup', 'ShiftLeft', { shiftKey: false })
assert.ok(Math.abs(Math.hypot(commands.at(-1).x, commands.at(-1).y) - 0.5) < 1e-12, 'releasing Shift must immediately restore medium speed')
key('keyup', 'KeyD')
key('keyup', 'KeyW')

for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
  key('keydown', 'ShiftRight', { shiftKey: true })
  key('keydown', code, { shiftKey: true })
  assert.equal(Math.hypot(commands.at(-1).x, commands.at(-1).y), 1)
  key('keyup', code, { shiftKey: true })
  assert.equal(commands.at(-1), 'stop', 'releasing the direction must stop even with Shift held')
  key('keyup', 'ShiftRight', { shiftKey: false })
}

key('keydown', 'KeyW', { shiftKey: true })
key('keydown', 'ShiftRight', { shiftKey: true })
key('keyup', 'ShiftLeft', { shiftKey: true })
assert.deepEqual(commands.at(-1), { x: 0, y: 1 }, 'holding the other Shift key must retain full speed')
windowTarget.dispatchEvent(new Event('blur'))
assert.equal(commands.at(-1), 'stop', 'blur must stop full-speed movement')
key('keydown', 'KeyW')
assert.deepEqual(commands.at(-1), { x: 0, y: 0.5 }, 'blur must reset full-speed state')
key('keyup', 'KeyW')

key('keydown', 'KeyW')
key('keydown', 'KeyD')
assert.ok(Math.abs(Math.hypot(commands.at(-1).x, commands.at(-1).y) - 0.5) < 1e-12)
key('keyup', 'KeyD')
assert.deepEqual(commands.at(-1), { x: 0, y: 0.5 }, 'release must preserve remaining direction')
key('keydown', 'KeyS')
assert.equal(commands.at(-1), 'stop', 'opposite directions must cancel')
key('keyup', 'KeyS')
assert.deepEqual(commands.at(-1), { x: 0, y: 0.5 })
windowTarget.dispatchEvent(new Event('blur'))
assert.equal(commands.at(-1), 'stop')
const countAfterBlur = commands.length
key('keyup', 'KeyW')
assert.equal(commands.length, countAfterBlur, 'blur must clear held keys')

for (const properties of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { target: new TestElement(true) }]) {
  const count = commands.length
  assert.equal(key('keydown', 'KeyW', properties).defaultPrevented, false)
  assert.equal(commands.length, count, 'typing and shortcuts must not move the camera')
}

assert.equal(key('keydown', 'ArrowUp').defaultPrevented, false)
key('keydown', 'ArrowUp', { target: pad })
assert.deepEqual(commands.at(-1), { x: 0, y: 1 }, 'focused arrow controls retain their speed')
key('keyup', 'ArrowUp')

for (const [surface, eventType] of [
  [windowTarget, 'pointerdown'],
  [documentTarget, 'focusin'],
  [documentTarget, 'visibilitychange'],
]) {
  key('keydown', 'KeyD')
  documentTarget.hidden = true
  surface.dispatchEvent(new Event(eventType))
  assert.equal(commands.at(-1), 'stop', `${eventType} must stop movement`)
}

pointerActive = true
const countDuringPointer = commands.length
key('keydown', 'KeyW')
assert.equal(commands.length, countDuringPointer, 'keyboard must not compete with pointer control')
pointerActive = false
key('keydown', 'KeyA')
dispose()
assert.equal(commands.at(-1), 'stop', 'unmount must stop movement')
const countAfterDispose = commands.length
key('keydown', 'KeyW')
assert.equal(commands.length, countAfterDispose, 'unmount must remove listeners')

console.log('live gimbal keyboard tests passed')
