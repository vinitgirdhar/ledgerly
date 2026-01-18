(function () {
  document.addEventListener('DOMContentLoaded', () => {
    initGreetingAndUser();
    initOnboardingWizard();
    if (window.ToastManager) {
      ToastManager.attachTriggers(document);
    }
  });

  function initGreetingAndUser() {
    // Fetch current user
    fetch('/api/me', { credentials: 'same-origin' })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.user) {
          const headline = document.querySelector('.headline');
          if (headline) {
            headline.textContent = `Namaste, ${data.user.username}!`;
          }
        }
      })
      .catch(() => {
        // Fallback: keep default text
      });

    // Update greeting based on time
    function updateGreeting() {
      const hour = new Date().getHours();
      const eyebrow = document.querySelector('.eyebrow');
      if (!eyebrow) return;

      if (hour < 12) {
        eyebrow.textContent = 'Good morning';
      } else if (hour < 18) {
        eyebrow.textContent = 'Good afternoon';
      } else {
        eyebrow.textContent = 'Good evening';
      }
    }

    updateGreeting();
    // Update greeting every minute
    setInterval(updateGreeting, 60000);
  }

  function initOnboardingWizard() {
    const modal = document.getElementById('onboardingModal');
    if (!modal) return;

    const wizardSteps = Array.from(modal.querySelectorAll('.wizard-step'));
    const panels = Array.from(modal.querySelectorAll('.wizard-panel'));

    const progressLabels = {
      profile: document.querySelector('[data-progress-label="profile"]'),
      catalog: document.querySelector('[data-progress-label="catalog"]'),
      inventory: document.querySelector('[data-progress-label="inventory"]'),
      integrations: document.querySelector('[data-progress-label="integrations"]'),
    };

    const progressFills = {
      profile: document.querySelector('[data-progress-fill="profile"]'),
      catalog: document.querySelector('[data-progress-fill="catalog"]'),
      inventory: document.querySelector('[data-progress-fill="inventory"]'),
      integrations: document.querySelector('[data-progress-fill="integrations"]'),
    };

    const totalEl = document.querySelector('[data-progress-total]');

    const completion = {
      profile: 45,
      catalog: 0,
      inventory: 0,
      integrations: 20,
    };

    const minStepPercent = {
      profile: 45,
      catalog: 25,
      inventory: 30,
      integrations: 20,
    };

    const updateProgressDisplay = () => {
      const avg = Math.round(
        Object.values(completion).reduce((sum, val) => sum + val, 0) /
          Object.keys(completion).length
      );
      if (totalEl) totalEl.textContent = `${avg}%`;

      Object.entries(progressFills).forEach(([key, el]) => {
        if (!el) return;
        const pct = Math.min(100, completion[key]);
        el.style.transform = `scaleX(${pct / 100})`;
        const bar = el.parentElement;
        if (bar) bar.setAttribute('aria-valuenow', String(pct));
      });

      Object.entries(progressLabels).forEach(([key, label]) => {
        if (!label) return;
        const pct = Math.min(100, completion[key]);
        label.textContent = pct >= 95 ? 'Done' : pct >= 40 ? 'In progress' : pct > 0 ? 'Started' : 'Missing';
      });
    };

    const showStep = (step) => {
      wizardSteps.forEach((button) => {
        const isActive = button.dataset.step === step;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', String(isActive));
      });

      panels.forEach((panel) => {
        const match = panel.id === `step-${step}`;
        panel.classList.toggle('is-hidden', !match);
        panel.setAttribute('aria-hidden', match ? 'false' : 'true');
      });
    };

    wizardSteps.forEach((button) => {
      button.addEventListener('click', () => showStep(button.dataset.step));
    });

    modal.querySelectorAll('[data-nav-step]').forEach((btn) => {
      btn.addEventListener('click', () => showStep(btn.dataset.navStep));
    });

    modal.querySelectorAll('[data-complete-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const step = btn.dataset.completeStep;
        if (!step) return;

        const current = completion[step] || 0;
        const bump = Math.max(minStepPercent[step] || 20, current + 30);
        completion[step] = Math.min(100, bump);
        updateProgressDisplay();

        const currentIndex = wizardSteps.findIndex((item) => item.dataset.step === step);
        const next = wizardSteps[currentIndex + 1];
        if (next) showStep(next.dataset.step);
      });
    });

    document.querySelectorAll('[data-step-target]').forEach((trigger) => {
      trigger.addEventListener('click', () => {
        const targetStep = trigger.dataset.stepTarget;
        if (targetStep) showStep(targetStep);
      });
    });

    updateProgressDisplay();
  }
})();
