import { BrowserWindow, app, session, type Session } from 'electron'
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'

import type { DeepSeekHarnessToolDefinition } from '../src/shared/types'
import type { LunaEditorSdkContext, LunaEditorSdkProvider, LunaEditorSdkRequest } from './luna-editor-sdk/contracts'
import { LunaEditorSdkError } from './luna-editor-sdk/contracts'
import { isAllowedBrowserRequestUrl, isBlockedBrowserHostname, isPrivateIpAddress, validateBrowserUrl } from './deepseekBrowserPolicy'

const BROWSER_PROVIDER_ID = 'browser'
const BROWSER_PARTITION_PREFIX = 'luna-assistant-browser-'
const LOAD_TIMEOUT_MS = 30_000
const ACTION_SETTLE_MS = 750
const MAX_REF_LENGTH = 16
const MAX_TYPE_LENGTH = 5_000
const MAX_PAGE_TEXT_LENGTH = 20_000
const MAX_PAGE_ELEMENTS = 100

const BROWSER_TOOL_DEFINITIONS: DeepSeekHarnessToolDefinition[] = [
  {
    name: 'browser.open',
    description: '在隔离的隐藏浏览器中打开一个公开 HTTP 或 HTTPS 网页，并返回页面摘要。只用于查找当前知识不足的资料。',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', minLength: 1, maxLength: 2_048 } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser.read',
    description: '读取当前网页的标题、正文和可操作元素。元素会得到短期 ref，后续 click、type、press 必须使用最近一次读取返回的 ref。',
    parameters: {
      type: 'object',
      properties: {
        maxTextChars: { type: 'integer', minimum: 1_000, maximum: MAX_PAGE_TEXT_LENGTH },
        maxElements: { type: 'integer', minimum: 1, maximum: MAX_PAGE_ELEMENTS },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browser.click',
    description: '点击最近一次 browser.read 返回的页面元素。',
    parameters: {
      type: 'object',
      properties: { ref: { type: 'string', pattern: '^r[0-9]+$' } },
      required: ['ref'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser.type',
    description: '向最近一次 browser.read 返回的文本输入框填写文字；出于安全原因不能填写密码框。',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', pattern: '^r[0-9]+$' },
        text: { type: 'string', maxLength: MAX_TYPE_LENGTH },
      },
      required: ['ref', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser.press',
    description: '在最近一次 browser.read 返回的输入元素上按键，常用于提交搜索。允许 Enter、Tab、Escape、ArrowDown、ArrowUp。',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', pattern: '^r[0-9]+$' },
        key: { type: 'string', enum: ['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp'] },
      },
      required: ['ref', 'key'],
      additionalProperties: false,
    },
  },
]

const BROWSER_TOOL_NAMES = new Set(BROWSER_TOOL_DEFINITIONS.map((tool) => tool.name))
const interactiveSelector = 'a[href],button,input,textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="textbox"]'

interface BrowserPageSummary {
  url: string
  title: string
  text: string
  elements: Array<{
    ref: string
    tag: string
    role?: string
    text: string
    ariaLabel?: string
    placeholder?: string
    href?: string
    inputType?: string
    disabled?: boolean
  }>
}

interface BrowserState {
  window: BrowserWindow
  pageRevision: number
  refsRevision: number
  refs: Set<string>
  queue: Promise<void>
}

const browserStates = new Map<string, BrowserState>()
const protectedSessions = new WeakSet<Session>()

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new LunaEditorSdkError('ABORTED', '网页操作已取消。')
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function requireString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`浏览器参数 ${name} 无效。`)
  }
  return value
}

function optionalInteger(value: unknown, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`浏览器参数 ${name} 无效。`)
  }
  return value
}

async function assertPublicHost(url: URL): Promise<void> {
  if (isBlockedBrowserHostname(url.hostname)) throw new Error('浏览器不能访问本机、局域网或其他内部地址。')
  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true })
    if (addresses.length === 0 || addresses.some((address) => isPrivateIpAddress(address.address))) {
      throw new Error('浏览器不能访问解析到内部网络的地址。')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('不能访问')) throw error
    throw new Error('网页地址无法解析。')
  }
}

function partitionForSession(sessionId: string): string {
  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 32)
  return `${BROWSER_PARTITION_PREFIX}${digest}`
}

function installSessionPolicy(browserSession: Session): void {
  if (protectedSessions.has(browserSession)) return
  protectedSessions.add(browserSession)
  browserSession.setPermissionCheckHandler(() => false)
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  browserSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (!isAllowedBrowserRequestUrl(details.url)) {
      callback({ cancel: true })
      return
    }
    if (details.resourceType !== 'mainFrame') {
      callback({ cancel: false })
      return
    }
    let url: URL
    try {
      url = new URL(details.url)
    } catch {
      callback({ cancel: true })
      return
    }
    void assertPublicHost(url).then(
      () => callback({ cancel: false }),
      () => callback({ cancel: true }),
    )
  })
}

function installWindowPolicy(browserWindow: BrowserWindow): void {
  browserWindow.setMenuBarVisibility(false)
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  browserWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
  const preventUnsafeNavigation = (event: Electron.Event, url: string): void => {
    if (!isAllowedBrowserRequestUrl(url)) event.preventDefault()
  }
  browserWindow.webContents.on('will-navigate', preventUnsafeNavigation)
  browserWindow.webContents.on('will-redirect', preventUnsafeNavigation)
}

function createBrowserWindow(browserSession: Session): BrowserWindow {
  const browserWindow = new BrowserWindow({
    show: false,
    width: 1_280,
    height: 900,
    skipTaskbar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      session: browserSession,
      backgroundThrottling: false,
    },
  })
  installWindowPolicy(browserWindow)
  browserWindow.webContents.on('render-process-gone', () => {
    if (!browserWindow.isDestroyed()) browserWindow.destroy()
  })
  return browserWindow
}

function getBrowserState(context: LunaEditorSdkContext): BrowserState {
  if (!app.isReady()) throw new LunaEditorSdkError('WINDOW_UNAVAILABLE', '网页助手尚未准备好。')
  const existing = browserStates.get(context.sessionId)
  if (existing && !existing.window.isDestroyed()) return existing
  const browserSession = session.fromPartition(partitionForSession(context.sessionId), { cache: false })
  installSessionPolicy(browserSession)
  const browserWindow = createBrowserWindow(browserSession)
  const state: BrowserState = {
    window: browserWindow,
    pageRevision: 0,
    refsRevision: -1,
    refs: new Set(),
    queue: Promise.resolve(),
  }
  browserWindow.once('closed', () => {
    if (browserStates.get(context.sessionId) === state) browserStates.delete(context.sessionId)
  })
  browserWindow.webContents.on('did-navigate', () => invalidateRefs(state))
  browserWindow.webContents.on('did-navigate-in-page', () => invalidateRefs(state))
  browserStates.set(context.sessionId, state)
  return state
}

function invalidateRefs(state: BrowserState): void {
  state.pageRevision += 1
  state.refsRevision = -1
  state.refs.clear()
}

function enqueue<T>(state: BrowserState, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  const run = state.queue.then(async () => {
    throwIfAborted(signal)
    return operation()
  }, async () => {
    throwIfAborted(signal)
    return operation()
  })
  state.queue = run.then(() => undefined, () => undefined)
  return run
}

async function loadUrl(state: BrowserState, url: URL, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  await assertPublicHost(url)
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      if (!state.window.isDestroyed()) state.window.webContents.stop()
      reject(new LunaEditorSdkError('ABORTED', '网页操作已取消。'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LunaEditorSdkError('TIMEOUT', '网页加载超时。')), LOAD_TIMEOUT_MS)
  })
  try {
    await Promise.race([state.window.loadURL(url.toString()), timeout, aborted])
    throwIfAborted(signal)
    invalidateRefs(state)
  } finally {
    if (timer) clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

async function settlePage(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ACTION_SETTLE_MS))
  throwIfAborted(signal)
}

function pageReadScript(maxTextChars: number, maxElements: number): string {
  return `(() => {
    const selector = ${JSON.stringify(interactiveSelector)};
    const limitText = (value, limit) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    document.querySelectorAll('[data-luna-browser-ref]').forEach((element) => element.removeAttribute('data-luna-browser-ref'));
    const elements = [];
    let index = 0;
    for (const element of document.querySelectorAll(selector)) {
      if (elements.length >= ${String(maxElements)} || !visible(element)) continue;
      const ref = 'r' + String(++index);
      element.setAttribute('data-luna-browser-ref', ref);
      const tag = element.tagName.toLowerCase();
      const type = element instanceof HTMLInputElement ? element.type.toLowerCase() : undefined;
      elements.push({
        ref,
        tag,
        role: element.getAttribute('role') || undefined,
        text: limitText(element.innerText || element.textContent, 160),
        ariaLabel: element.getAttribute('aria-label') || undefined,
        placeholder: 'placeholder' in element ? limitText(element.placeholder, 160) : undefined,
        href: element instanceof HTMLAnchorElement ? element.href.slice(0, 500) : undefined,
        inputType: type,
        disabled: 'disabled' in element ? Boolean(element.disabled) : undefined,
      });
    }
    return {
      url: location.href,
      title: document.title,
      text: limitText(document.body && document.body.innerText, ${String(maxTextChars)}),
      elements,
    };
  })()`
}

async function readPage(state: BrowserState, maxTextChars = 12_000, maxElements = 80): Promise<BrowserPageSummary> {
  const value: unknown = await state.window.webContents.executeJavaScript(pageReadScript(maxTextChars, maxElements), true)
  const result = requireRecord(value, '网页内容格式无效。')
  const elements = Array.isArray(result.elements) ? result.elements : []
  state.refs = new Set(elements.flatMap((element) => {
    const record = element && typeof element === 'object' ? element as Record<string, unknown> : undefined
    return typeof record?.ref === 'string' ? [record.ref] : []
  }))
  state.refsRevision = state.pageRevision
  return {
    url: typeof result.url === 'string' ? result.url : '',
    title: typeof result.title === 'string' ? result.title : '',
    text: typeof result.text === 'string' ? result.text : '',
    elements: elements.filter((element): element is BrowserPageSummary['elements'][number] => Boolean(element && typeof element === 'object')) as BrowserPageSummary['elements'],
  }
}

function requireRef(state: BrowserState, value: unknown): string {
  const ref = requireString(value, 'ref', MAX_REF_LENGTH)
  if (!/^r\d+$/u.test(ref) || state.refsRevision !== state.pageRevision || !state.refs.has(ref)) {
    throw new Error('页面元素 ref 已失效，请先重新读取当前网页。')
  }
  return ref
}

function elementActionScript(ref: string, action: 'click' | 'type' | 'press', value?: string): string {
  const refLiteral = JSON.stringify(ref)
  const valueLiteral = JSON.stringify(value ?? '')
  if (action === 'click') {
    return `(() => { const element = document.querySelector('[data-luna-browser-ref="' + ${refLiteral} + '"]'); if (!element) throw new Error('页面元素不存在。'); element.click(); return { tag: element.tagName.toLowerCase() }; })()`
  }
  if (action === 'type') {
    return `(() => {
      const element = document.querySelector('[data-luna-browser-ref="' + ${refLiteral} + '"]');
      if (!element) throw new Error('页面元素不存在。');
      const type = element instanceof HTMLInputElement ? element.type.toLowerCase() : '';
      if (type === 'password') throw new Error('出于安全原因不能填写密码框。');
      if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement) && element.getAttribute('contenteditable') !== 'true') throw new Error('ref 不是文本输入框。');
      element.focus();
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (!setter) throw new Error('无法填写此输入框。');
        setter.call(element, ${valueLiteral});
      } else { element.textContent = ${valueLiteral}; }
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return { tag: element.tagName.toLowerCase() };
    })()`
  }
  return `(() => {
    const element = document.querySelector('[data-luna-browser-ref="' + ${refLiteral} + '"]');
    if (!element) throw new Error('页面元素不存在。');
    element.focus();
    const key = ${valueLiteral};
    const init = { key, code: key, bubbles: true, cancelable: true };
    element.dispatchEvent(new KeyboardEvent('keydown', init));
    element.dispatchEvent(new KeyboardEvent('keypress', init));
    element.dispatchEvent(new KeyboardEvent('keyup', init));
    if (key === 'Enter' && element instanceof HTMLInputElement && element.form) element.form.requestSubmit();
    return { key };
  })()`
}

async function runElementAction(state: BrowserState, ref: string, action: 'click' | 'type' | 'press', value: string | undefined, signal: AbortSignal): Promise<BrowserPageSummary> {
  await state.window.webContents.executeJavaScript(elementActionScript(ref, action, value), true)
  await settlePage(signal)
  return readPage(state)
}

async function executeBrowserRequest(request: LunaEditorSdkRequest, context: LunaEditorSdkContext): Promise<unknown> {
  const state = getBrowserState(context)
  return enqueue(state, context.signal, async () => {
    const args = requireRecord(request.args, '浏览器参数格式无效。')
    if (request.name === 'browser.open') {
      const url = validateBrowserUrl(requireString(args.url, 'url', 2_048))
      await loadUrl(state, url, context.signal)
      return { action: 'open', page: await readPage(state) }
    }
    if (request.name === 'browser.read') {
      const maxTextChars = optionalInteger(args.maxTextChars, 'maxTextChars', 12_000, 1_000, MAX_PAGE_TEXT_LENGTH)
      const maxElements = optionalInteger(args.maxElements, 'maxElements', 80, 1, MAX_PAGE_ELEMENTS)
      return { action: 'read', page: await readPage(state, maxTextChars, maxElements) }
    }
    const ref = requireRef(state, args.ref)
    if (request.name === 'browser.click') return { action: 'click', ref, page: await runElementAction(state, ref, 'click', undefined, context.signal) }
    if (request.name === 'browser.type') {
      const text = requireString(args.text, 'text', MAX_TYPE_LENGTH)
      return { action: 'type', ref, page: await runElementAction(state, ref, 'type', text, context.signal) }
    }
    if (request.name === 'browser.press') {
      const key = requireString(args.key, 'key', 20)
      if (!['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp'].includes(key)) throw new Error('浏览器不允许此按键。')
      return { action: 'press', ref, key, page: await runElementAction(state, ref, 'press', key, context.signal) }
    }
    throw new Error(`未知的浏览器能力：${request.name}`)
  })
}

export function createDeepSeekBrowserProvider(): LunaEditorSdkProvider {
  return {
    id: BROWSER_PROVIDER_ID,
    namespaces: ['browser'],
    getTools: () => BROWSER_TOOL_DEFINITIONS,
    execute: executeBrowserRequest,
  }
}

export function browserToolNames(): string[] {
  return [...BROWSER_TOOL_NAMES]
}

export async function disposeDeepSeekBrowser(): Promise<void> {
  const states = [...browserStates.values()]
  browserStates.clear()
  await Promise.all(states.map(async (state) => {
    if (!state.window.isDestroyed()) state.window.destroy()
  }))
}

app.on('before-quit', () => {
  void disposeDeepSeekBrowser()
})
