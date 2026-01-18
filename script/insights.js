(function () {
  const scenarios = {
    base: {
      revenue: '₹12.4L',
      revenueHint: 'Up 6% vs last week',
      cash: '₹4.8L',
      cashHint: 'Runway 5.5 weeks',
      gst: '92%',
      gstHint: '3 filings pending review',
    },
    boost: {
      revenue: '₹13.7L',
      revenueHint: '+18% if you launch the festival offer',
      cash: '₹5.6L',
      cashHint: 'Runway 6.2 weeks',
      gst: '95%',
      gstHint: 'Auto reminders sent to vendors',
    },
    cut: {
      revenue: '₹11.8L',
      revenueHint: 'Stable even with expense trims',
      cash: '₹6.3L',
      cashHint: 'Runway 7.1 weeks',
      gst: '89%',
      gstHint: 'Follow-up needed on 5 invoices',
    },
  };

  const chips = document.querySelectorAll('[data-scenario]');
  const metrics = {
    revenue: document.querySelector('[data-metric="revenue"]'),
    revenueHint: document.querySelector('[data-metric="revenue-hint"]'),
    cash: document.querySelector('[data-metric="cash"]'),
    cashHint: document.querySelector('[data-metric="cash-hint"]'),
    gst: document.querySelector('[data-metric="gst"]'),
    gstHint: document.querySelector('[data-metric="gst-hint"]'),
  };

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      const scenarioKey = chip.dataset.scenario;
      const state = scenarios[scenarioKey];
      if (!state) return;
      metrics.revenue.textContent = state.revenue;
      metrics.revenueHint.textContent = state.revenueHint;
      metrics.cash.textContent = state.cash;
      metrics.cashHint.textContent = state.cashHint;
      metrics.gst.textContent = state.gst;
      metrics.gstHint.textContent = state.gstHint;
      if (window.ToastManager) {
        ToastManager.show(`${chip.textContent.trim()} scenario applied.`, 'info');
      }
    });
  });

  if (window.ToastManager) {
    ToastManager.attachTriggers(document);
  }
})();
