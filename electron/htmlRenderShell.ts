const SHELL_NONCE = 'luna-html-render-shell-v1'

const shellDocument = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${SHELL_NONCE}'; style-src 'unsafe-inline'; frame-src 'self' data:; img-src data: blob:; font-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <style>
    html, body, #render-frame { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
    #render-frame { display: block; border: 0; pointer-events: none; }
  </style>
</head>
<body>
  <iframe id="render-frame" sandbox="allow-same-origin" aria-hidden="true"></iframe>
  <script nonce="${SHELL_NONCE}">
    (() => {
      const frame = document.getElementById('render-frame')
      const forbiddenElements = new Set([
        'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
        'base', 'link', 'meta', 'form'
      ])
      const urlAttributes = new Set([
        'action', 'cite', 'data', 'formaction', 'href', 'ping', 'poster',
        'src', 'srcset', 'xlink:href'
      ])
      const frameCsp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

      function safeResourceReference(value) {
        const normalized = value.trim().toLowerCase()
        return normalized.startsWith('data:') || normalized.startsWith('blob:') || normalized.startsWith('#')
      }

      function sanitizeDocument(source) {
        for (const element of Array.from(source.querySelectorAll('*'))) {
          if (forbiddenElements.has(element.tagName.toLowerCase())) {
            element.remove()
            continue
          }
          for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase()
            if (name.startsWith('on') || name === 'srcdoc') {
              element.removeAttribute(attribute.name)
              continue
            }
            if (urlAttributes.has(name) && !safeResourceReference(attribute.value)) {
              element.removeAttribute(attribute.name)
            }
          }
        }
      }

      function copyAttributes(source, target) {
        for (const attribute of Array.from(source.attributes)) {
          target.setAttribute(attribute.name, attribute.value)
        }
      }

      function waitForFrameDocument() {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('HTML render frame did not load')), 5000)
          frame.onload = () => {
            clearTimeout(timeout)
            resolve(frame.contentDocument)
          }
          frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + frameCsp + '"></head><body></body></html>'
        })
      }

      function withTimeout(promise, timeoutMs) {
        return Promise.race([
          promise.then(() => true),
          new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
        ])
      }

      async function waitForResources(target, warnings) {
        if (target.fonts) {
          const fontsReady = await withTimeout(target.fonts.ready, 10000)
          if (!fontsReady) warnings.push('Font loading timed out')
        }

        const images = Array.from(target.images)
        const imageResults = await Promise.all(images.map(async (image) => {
          try {
            if (typeof image.decode === 'function') await image.decode()
            else if (!image.complete) {
              await new Promise((resolve, reject) => {
                image.addEventListener('load', resolve, { once: true })
                image.addEventListener('error', reject, { once: true })
              })
            }
            return true
          } catch {
            return false
          }
        }))
        const failedImages = imageResults.filter((loaded) => !loaded).length
        if (failedImages > 0) warnings.push(failedImages + ' image(s) could not be loaded')
      }

      function nextPaint(target) {
        return new Promise((resolve) => {
          target.defaultView.requestAnimationFrame(() => {
            target.defaultView.requestAnimationFrame(resolve)
          })
        })
      }

      async function render(request) {
        const warnings = []
        const target = await waitForFrameDocument()
        const source = new DOMParser().parseFromString(request.html, 'text/html')
        sanitizeDocument(source)

        copyAttributes(source.documentElement, target.documentElement)
        copyAttributes(source.body, target.body)

        const baseStyle = target.createElement('style')
        baseStyle.textContent = 'html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }'
        target.head.appendChild(baseStyle)
        for (const style of Array.from(source.head.querySelectorAll('style'))) {
          target.head.appendChild(target.importNode(style, true))
        }
        const suppliedStyle = target.createElement('style')
        suppliedStyle.textContent = request.css
        target.head.appendChild(suppliedStyle)
        for (const node of Array.from(source.body.childNodes)) {
          target.body.appendChild(target.importNode(node, true))
        }

        const timeMs = Math.max(0, Number(request.timeMs) || 0)
        target.documentElement.style.setProperty('--luna-time', String(timeMs / 1000))
        target.documentElement.style.setProperty('--luna-time-ms', String(timeMs))
        await waitForResources(target, warnings)
        await nextPaint(target)

        for (const animation of target.getAnimations()) {
          try {
            animation.pause()
            animation.currentTime = timeMs
          } catch (error) {
            warnings.push('An animation could not be positioned: ' + String(error))
          }
        }
        await nextPaint(target)
        return { warnings }
      }

      Object.defineProperty(window, '__lunaRenderHtml', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: render,
      })
    })()
  </script>
</body>
</html>`

export const HTML_RENDER_SHELL_URL = `data:text/html;charset=utf-8,${encodeURIComponent(shellDocument)}`
