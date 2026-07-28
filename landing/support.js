document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('support-modal')
  const openButtons = document.querySelectorAll('[data-support-open]')
  const closeButtons = modal?.querySelectorAll('[data-support-close]') ?? []
  let returnFocus = null

  if (!modal || openButtons.length === 0) return

  const close = () => {
    modal.hidden = true
    document.body.classList.remove('support-modal-open')
    if (returnFocus instanceof HTMLElement) returnFocus.focus()
    returnFocus = null
  }

  const open = (button) => {
    returnFocus = button
    modal.hidden = false
    document.body.classList.add('support-modal-open')
    modal.querySelector('[data-support-close]')?.focus()
  }

  openButtons.forEach((button) => {
    button.addEventListener('click', () => open(button))
  })
  closeButtons.forEach((button) => {
    button.addEventListener('click', close)
  })
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close()
  })
  document.addEventListener('keydown', (event) => {
    if (modal.hidden) return
    if (event.key === 'Escape') close()
    if (event.key === 'Tab') {
      event.preventDefault()
      modal.querySelector('[data-support-close]')?.focus()
    }
  })
})
