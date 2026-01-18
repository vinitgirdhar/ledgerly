(function (global) {
  let stack = null;

  function ensureStack() {
    if (stack && document.body.contains(stack)) {
      return stack;
    }
    stack = document.getElementById('toastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'toastStack';
      stack.className = 'toast-stack';
      stack.setAttribute('aria-live', 'assertive');
      stack.setAttribute('aria-atomic', 'true');
      document.body.appendChild(stack);
    }
    if (!stack.dataset.bound) {
      stack.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-dismiss="toast"]');
        if (!btn) return;
        const toastEl = btn.closest('.toast');
        if (toastEl) dismiss(toastEl);
      });
      stack.dataset.bound = '1';
    }
    return stack;
  }

  function show(message, intent = 'info', title) {
    if (!message) return null;
    const container = ensureStack();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.intent = intent;

    if (title) {
      const heading = document.createElement('h4');
      heading.textContent = title;
      toast.appendChild(heading);
    }

    const body = document.createElement('p');
    body.textContent = message;
    toast.appendChild(body);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.dataset.dismiss = 'toast';
    closeBtn.textContent = 'Close';
    toast.appendChild(closeBtn);

    container.appendChild(toast);

    let dismissed = false;
    const hide = () => {
      if (!dismissed) {
        dismissed = true;
        dismiss(toast);
      }
    };

    let timer = setTimeout(hide, 4000);
    toast.addEventListener('mouseenter', () => {
      clearTimeout(timer);
    });
    toast.addEventListener('mouseleave', () => {
      timer = setTimeout(hide, 2000);
    });

    return toast;
  }

  function dismiss(toast) {
    if (!toast) return;
    toast.style.animation = 'toast-out 0.2s ease forwards';
    toast.addEventListener('animationend', () => {
      toast.remove();
    }, { once: true });
  }

  function attachTriggers(root = document) {
    const triggers = root.querySelectorAll('[data-toast]');
    triggers.forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        const message = trigger.getAttribute('data-toast');
        if (!message) return;
        const intent = trigger.getAttribute('data-intent') || 'info';
        const title = trigger.getAttribute('data-toast-title') || undefined;
        show(message, intent, title);

        if (trigger.tagName === 'A') {
          const href = trigger.getAttribute('href') || '';
          if (href === '#' || href.startsWith('javascript:')) {
            event.preventDefault();
          }
        } else if (trigger.tagName === 'BUTTON' && trigger.type === 'button') {
          event.preventDefault();
        }
      });
    });
  }

  global.ToastManager = {
    ensureStack,
    show,
    dismiss,
    attachTriggers,
  };
})(window);
