// jsdom does not implement the <dialog> methods (jsdom/jsdom#3294) — emulate
// just enough for components built on the native dialog element.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement, returnValue?: string) {
    if (returnValue !== undefined) this.returnValue = returnValue
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}
