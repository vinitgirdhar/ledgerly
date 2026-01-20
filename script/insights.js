(function () {
  // -------------------------
  // Initialize on DOM ready
  // -------------------------
  document.addEventListener('DOMContentLoaded', () => {
    loadInsightsSummary();
    initScenarioChips();
    initAskInput();
    if (window.ToastManager) {
      ToastManager.attachTriggers(document);
    }
  });

  // -------------------------
  // Load Real Data from API
  // -------------------------
  async function loadInsightsSummary() {
    try {
      const response = await fetch('/api/insights/summary', { credentials: 'same-origin' });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        console.error('Failed to load insights:', data.error);
        return;
      }

      const summary = data.summary;
      
      // Update stat cards with real data
      updateMetric('revenue', formatCurrency(summary.week_income), `Net: ${formatCurrency(summary.week_net)}`);
      updateMetric('cash', formatCurrency(summary.net_cash), `This week: ${formatCurrency(summary.week_net)}`);
      
      // Calculate GST entries percentage (bill uploads have GST)
      const totalEntries = summary.source_breakdown.reduce((sum, s) => sum + s.count, 0);
      const billUploads = summary.source_breakdown.find(s => s.source === 'bill_upload')?.count || 0;
      const gstPct = totalEntries > 0 ? Math.round((billUploads / totalEntries) * 100) : 0;
      updateMetric('gst', `${gstPct}%`, `${billUploads} bills uploaded`);

      // Update trend chart bars
      updateTrendChart(summary.daily_trend);

      // Update expense radar
      updateExpenseRadar(summary);

      // Store summary for scenario calculations
      window.insightsSummary = summary;

    } catch (error) {
      console.error('Error loading insights:', error);
    }
  }

  function updateMetric(key, value, hint) {
    const valueEl = document.querySelector(`[data-metric="${key}"]`);
    const hintEl = document.querySelector(`[data-metric="${key}-hint"]`);
    if (valueEl) valueEl.textContent = value;
    if (hintEl) hintEl.textContent = hint;
  }

  function formatCurrency(amount) {
    if (amount >= 100000) {
      return `₹${(amount / 100000).toFixed(1)}L`;
    } else if (amount >= 1000) {
      return `₹${(amount / 1000).toFixed(1)}K`;
    }
    return `₹${amount.toLocaleString('en-IN')}`;
  }

  function updateTrendChart(dailyTrend) {
    const barsContainer = document.querySelector('.trend-bars');
    if (!barsContainer || !dailyTrend.length) return;

    // Find max value for scaling
    const maxVal = Math.max(...dailyTrend.map(d => Math.max(d.income, d.expense)), 1);

    // Generate bars for each day
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    barsContainer.innerHTML = dailyTrend.map(d => {
      const date = new Date(d.day);
      const dayName = days[date.getDay()];
      const income = d.income || 0;
      const pct = Math.round((income / maxVal) * 100);
      return `<div class="bar" style="--value: ${pct}%" aria-label="${dayName} ₹${income.toLocaleString('en-IN')}" title="${dayName}: ₹${income.toLocaleString('en-IN')}"></div>`;
    }).join('');

    // Update chart note
    const chartNote = document.querySelector('.trend-chart .chart-note');
    if (chartNote) {
      const totalIncome = dailyTrend.reduce((sum, d) => sum + (d.income || 0), 0);
      chartNote.textContent = `Total this week: ${formatCurrency(totalIncome)} income`;
    }
  }

  function updateExpenseRadar(summary) {
    // Update expense radar with real expense breakdown by source
    const radarRings = document.querySelectorAll('.radar-ring');
    if (!radarRings.length) return;

    // Map source types to radar categories
    const sources = summary.source_breakdown || [];
    const totalCount = sources.reduce((sum, s) => sum + s.count, 0) || 1;

    const categories = [
      { label: 'Voice', source: 'voice' },
      { label: 'Bills', source: 'bill_upload' },
      { label: 'Manual', source: 'manual' },
      { label: 'Other', source: null }
    ];

    radarRings.forEach((ring, i) => {
      if (i < categories.length) {
        const cat = categories[i];
        const sourceData = sources.find(s => s.source === cat.source);
        const count = sourceData?.count || 0;
        const pct = Math.round((count / totalCount) * 100);
        ring.setAttribute('data-label', cat.label);
        ring.style.setProperty('--percentage', pct);
      }
    });
  }

  // -------------------------
  // Scenario Chips
  // -------------------------
  function initScenarioChips() {
    const chips = document.querySelectorAll('[data-scenario]');
    
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        
        const scenario = chip.dataset.scenario;
        applyScenario(scenario);
        
        if (window.ToastManager) {
          ToastManager.show(`${chip.textContent.trim()} scenario applied.`, 'info');
        }
      });
    });
  }

  function applyScenario(scenario) {
    const summary = window.insightsSummary;
    if (!summary) return;

    let revenueMultiplier = 1;
    let expenseMultiplier = 1;
    let hint = '';

    switch (scenario) {
      case 'boost':
        revenueMultiplier = 1.1;
        hint = '+10% projected if you run a campaign';
        break;
      case 'cut':
        expenseMultiplier = 0.85;
        hint = '15% expense reduction applied';
        break;
      default:
        hint = `Net: ${formatCurrency(summary.week_net)}`;
    }

    const projectedRevenue = summary.week_income * revenueMultiplier;
    const projectedExpenses = summary.week_expenses * expenseMultiplier;
    const projectedNet = (summary.net_cash) + (projectedRevenue - summary.week_income) - (projectedExpenses - summary.week_expenses);

    updateMetric('revenue', formatCurrency(projectedRevenue), hint);
    updateMetric('cash', formatCurrency(projectedNet), `This week: ${formatCurrency(projectedRevenue - projectedExpenses)}`);
  }

  // -------------------------
  // AI Ask Input
  // -------------------------
  function initAskInput() {
    const askContainer = document.querySelector('.hero__filters');
    if (!askContainer) return;

    // Add ask input after scenario chips
    const askHtml = `
      <div class="ask-container" style="margin-top: 1rem; display: flex; gap: 0.5rem; width: 100%;">
        <input type="text" id="insightsAskInput" 
               placeholder="Ask in Hindi/English: 'Aaj kitna kamaya?' or 'Last 7 din ka trend'" 
               style="flex: 1; padding: 0.75rem 1rem; border: 1px solid #ddd; border-radius: 8px; font-size: 0.9rem;">
        <button type="button" id="insightsAskBtn" class="chip is-active" style="white-space: nowrap;">
          Ask Ledgerly
        </button>
      </div>
      <div id="askResult" style="margin-top: 1rem; display: none;"></div>
    `;
    askContainer.insertAdjacentHTML('afterend', askHtml);

    const input = document.getElementById('insightsAskInput');
    const btn = document.getElementById('insightsAskBtn');
    const resultDiv = document.getElementById('askResult');

    btn.addEventListener('click', () => askQuestion(input.value, resultDiv));
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        askQuestion(input.value, resultDiv);
      }
    });
  }

  async function askQuestion(question, resultDiv) {
    if (!question.trim()) {
      if (window.ToastManager) {
        ToastManager.show('Please enter a question', 'info');
      }
      return;
    }

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<p style="color: #888;">Thinking...</p>';

    try {
      const response = await fetch('/api/insights/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ question })
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        resultDiv.innerHTML = `<p style="color: #e74c3c;">Error: ${data.message || data.error}</p>`;
        return;
      }

      // Format the result
      let valueDisplay = data.value;
      if (data.value_format === 'currency') {
        valueDisplay = `₹${parseFloat(data.value).toLocaleString('en-IN')}`;
      } else if (data.value_format === 'percent') {
        valueDisplay = `${data.value}%`;
      }

      let html = `
        <div style="background: linear-gradient(135deg, #f8f9fa, #e9ecef); padding: 1.5rem; border-radius: 12px; border-left: 4px solid #2ecc71;">
          <h4 style="margin: 0 0 0.5rem 0; color: #333;">${data.title}</h4>
          <p style="font-size: 2rem; font-weight: 700; color: #2ecc71; margin: 0;">${valueDisplay}</p>
      `;

      // Add chart data if available
      if (data.chart !== 'none' && data.data && data.data.length > 0) {
        html += `<div style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">`;
        data.data.forEach(item => {
          const val = data.value_format === 'currency' 
            ? `₹${parseFloat(item.value).toLocaleString('en-IN')}`
            : item.value;
          html += `<span style="background: white; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.85rem;">
            <strong>${item.label}:</strong> ${val}
          </span>`;
        });
        html += `</div>`;
      }

      html += `</div>`;
      resultDiv.innerHTML = html;

      if (window.ToastManager) {
        ToastManager.show('Query executed successfully!', 'success');
      }

    } catch (error) {
      console.error('Ask error:', error);
      resultDiv.innerHTML = `<p style="color: #e74c3c;">Error: ${error.message}</p>`;
    }
  }
})();
