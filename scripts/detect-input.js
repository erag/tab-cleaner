// detect-input.js — Injected into pages to detect unsubmitted form input
// Returns true if the page has form elements with user-modified values

(function () {
  const hasInput = Array.from(
    document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select'
    )
  ).some(function (el) {
    if (el.tagName === 'SELECT') {
      return el.selectedIndex > 0;
    }
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      return el.checked !== el.defaultChecked;
    }
    return el.value !== '' && el.value !== el.defaultValue;
  });
  return hasInput;
})();
