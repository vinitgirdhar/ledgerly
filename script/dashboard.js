(function () {
  document.addEventListener('DOMContentLoaded', () => {
    initGreetingAndUser();
    initOnboardingWizard();
    loadEntries();
    loadLedgerEntries();
    if (window.ToastManager) {
      ToastManager.attachTriggers(document);
    }
  });

  // Function to load and display entries on dashboard
  function loadEntries() {
    fetch('/api/entries', { credentials: 'same-origin' })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.entries) {
          displayEntries(data.entries);
          updateLedgerStats(data.entries);
        }
      })
      .catch((err) => {
        console.error('Error loading entries:', err);
      });
  }

  // Function to display entries in the transactions table
  function displayEntries(entries) {
    const tbody = document.querySelector('.billing-table tbody');
    if (!tbody) return;

    // Clear existing content except header rows if any
    tbody.innerHTML = '';

    // Show latest 10 entries
    const latestEntries = entries.slice(0, 10);

    if (latestEntries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">No transactions yet. Record a voice entry or upload a bill to get started.</td></tr>';
      return;
    }

    latestEntries.forEach((entry) => {
      const row = document.createElement('tr');
      
      // Determine status based on entry type
      const entryType = entry.entry_type === 'income' ? 'paid' : 'due';
      row.setAttribute('data-status', entryType);

      // Format date
      const date = new Date(entry.created_at);
      const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

      // Generate entry ID (V for voice, E for entry)
      const entryId = `ENT-${String(entry.id).padStart(4, '0')}`;

      // Extract customer/vendor from note or use default
      let customer = 'Voice Entry';
      if (entry.note) {
        // Try to extract customer/vendor name from note
        const noteMatch = entry.note.match(/(?:from|to|customer|vendor)[:\s]+([^|,]+)/i);
        if (noteMatch) {
          customer = noteMatch[1].trim();
        } else if (entry.note.length < 30) {
          customer = entry.note.substring(0, 30);
        }
      }

      // Determine channel
      const channel = entry.note && entry.note.toLowerCase().includes('voice') ? 'Voice' : 'Manual';

      row.innerHTML = `
        <td>${entryId}</td>
        <td>${customer}</td>
        <td>₹${parseFloat(entry.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        <td>${channel}</td>
        <td><span class="status-pill status-pill--${entryType}">${entry.entry_type === 'income' ? 'Paid' : 'Expense'}</span></td>
        <td>${dateStr}</td>
      `;

      tbody.appendChild(row);
    });
  }

  // Function to update ledger statistics and all dashboard metrics
  function updateLedgerStats(entries) {
    // Calculate stats
    const today = new Date().toDateString();
    const todayEntries = entries.filter(e => new Date(e.created_at).toDateString() === today);
    
    const expensesToday = todayEntries
      .filter(e => e.entry_type === 'expense')
      .reduce((sum, e) => sum + parseFloat(e.amount), 0);
    
    const incomeToday = todayEntries
      .filter(e => e.entry_type === 'income')
      .reduce((sum, e) => sum + parseFloat(e.amount), 0);
    
    const totalIncome = entries
      .filter(e => e.entry_type === 'income')
      .reduce((sum, e) => sum + parseFloat(e.amount), 0);
    
    const totalExpenses = entries
      .filter(e => e.entry_type === 'expense')
      .reduce((sum, e) => sum + parseFloat(e.amount), 0);
    
    const netBalance = totalIncome - totalExpenses;
    
    // Update ledger snapshot card
    const ledgerTag = document.getElementById('ledgerTotalAmount');
    if (ledgerTag) {
      ledgerTag.textContent = `₹${totalIncome.toLocaleString('en-IN')}`;
    }
    
    const totalEntriesCount = document.getElementById('totalEntriesCount');
    if (totalEntriesCount) {
      totalEntriesCount.textContent = entries.length;
    }
    
    const expensesTodayAmount = document.getElementById('expensesTodayAmount');
    if (expensesTodayAmount) {
      expensesTodayAmount.textContent = `₹${expensesToday.toLocaleString('en-IN')}`;
    }
    
    const incomeTodayAmount = document.getElementById('incomeTodayAmount');
    if (incomeTodayAmount) {
      incomeTodayAmount.textContent = `₹${incomeToday.toLocaleString('en-IN')}`;
    }
    
    // Update billing metrics
    const billingTotalIncome = document.getElementById('billingTotalIncome');
    if (billingTotalIncome) {
      if (totalIncome >= 100000) {
        billingTotalIncome.textContent = `₹${(totalIncome / 100000).toFixed(1)}L`;
      } else {
        billingTotalIncome.textContent = `₹${totalIncome.toLocaleString('en-IN')}`;
      }
    }
    
    const totalIncomeAmount = document.getElementById('totalIncomeAmount');
    if (totalIncomeAmount) {
      totalIncomeAmount.textContent = `₹${totalIncome.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    }
    
    const totalIncomeNote = document.getElementById('totalIncomeNote');
    if (totalIncomeNote) {
      const incomeCount = entries.filter(e => e.entry_type === 'income').length;
      totalIncomeNote.textContent = `From ${incomeCount} income ${incomeCount === 1 ? 'entry' : 'entries'}`;
    }
    
    const totalExpensesAmount = document.getElementById('totalExpensesAmount');
    if (totalExpensesAmount) {
      totalExpensesAmount.textContent = `₹${totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    }
    
    const totalExpensesNote = document.getElementById('totalExpensesNote');
    if (totalExpensesNote) {
      const expenseCount = entries.filter(e => e.entry_type === 'expense').length;
      totalExpensesNote.textContent = `From ${expenseCount} expense ${expenseCount === 1 ? 'entry' : 'entries'}`;
    }
    
    const netBalanceAmount = document.getElementById('netBalanceAmount');
    if (netBalanceAmount) {
      netBalanceAmount.textContent = `₹${netBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
      netBalanceAmount.style.color = netBalance >= 0 ? '#16a34a' : '#dc2626';
    }
    
    // Update billing status chips
    const billingStatusChips = document.getElementById('billingStatusChips');
    if (billingStatusChips) {
      const chips = [];
      if (entries.length > 0) {
        chips.push(`<div class="billing-chip">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} recorded</div>`);
        if (totalIncome > 0) {
          chips.push(`<div class="billing-chip">Total income: ₹${totalIncome.toLocaleString('en-IN')}</div>`);
        }
      } else {
        chips.push('<div class="billing-chip">No entries yet. Record a voice entry or upload a bill.</div>');
      }
      billingStatusChips.innerHTML = chips.join('');
    }
    
    // Update income vs expense bars
    const maxAmount = Math.max(totalIncome, totalExpenses, Math.abs(netBalance)) || 1;
    const incomePercent = totalIncome > 0 ? (totalIncome / maxAmount) * 100 : 0;
    const expensePercent = totalExpenses > 0 ? (totalExpenses / maxAmount) * 100 : 0;
    const profitPercent = netBalance > 0 ? (netBalance / maxAmount) * 100 : 0;
    
    const incomeBar = document.querySelector('#incomeExpenseBars .bar-income');
    if (incomeBar) {
      incomeBar.style.setProperty('--pct', `${incomePercent}%`);
    }
    
    const incomeBarLabel = document.getElementById('incomeBarLabel');
    if (incomeBarLabel) {
      incomeBarLabel.textContent = `Income ₹${totalIncome.toLocaleString('en-IN')}`;
    }
    
    const expenseBar = document.querySelector('#incomeExpenseBars .bar-expense');
    if (expenseBar) {
      expenseBar.style.setProperty('--pct', `${expensePercent}%`);
    }
    
    const expenseBarLabel = document.getElementById('expenseBarLabel');
    if (expenseBarLabel) {
      expenseBarLabel.textContent = `Expense ₹${totalExpenses.toLocaleString('en-IN')}`;
    }
    
    const profitBar = document.querySelector('#incomeExpenseBars .bar-profit');
    if (profitBar) {
      profitBar.style.setProperty('--pct', `${profitPercent}%`);
    }
    
    const profitBarLabel = document.getElementById('profitBarLabel');
    if (profitBarLabel) {
      profitBarLabel.textContent = `Net ₹${netBalance.toLocaleString('en-IN')}`;
    }
    
    // Update recent activity
    updateRecentActivity(entries);
    
    // Update insights
    updateInsights(entries);
  }
  
  // Function to update recent activity
  function updateRecentActivity(entries) {
    const recentActivityList = document.getElementById('recentActivityList');
    if (!recentActivityList) return;
    
    recentActivityList.innerHTML = '';
    
    if (entries.length === 0) {
      recentActivityList.innerHTML = '<li style="text-align: center; padding: 1rem; color: #666;">No recent activity</li>';
      return;
    }
    
    // Show latest 5 entries
    const recentEntries = entries.slice(0, 5);
    recentEntries.forEach(entry => {
      const li = document.createElement('li');
      li.className = 'alert';
      
      const date = new Date(entry.created_at);
      const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      
      const dotColor = entry.entry_type === 'income' ? 'dot-green' : 'dot-yellow';
      const typeLabel = entry.entry_type === 'income' ? 'Income' : 'Expense';
      
      li.innerHTML = `
        <span class="dot ${dotColor}"></span>
        <div>
          <p class="alert-title">${typeLabel}: ₹${parseFloat(entry.amount).toLocaleString('en-IN')}</p>
          <p class="alert-copy">${entry.note || 'Voice entry'} · ${dateStr} ${timeStr}</p>
        </div>
      `;
      
      recentActivityList.appendChild(li);
    });
  }
  
  // Function to update insights section
  function updateInsights(entries) {
    // Recent entries
    const recentEntriesList = document.getElementById('recentEntriesList');
    if (recentEntriesList) {
      recentEntriesList.innerHTML = '';
      if (entries.length === 0) {
        recentEntriesList.innerHTML = '<li>No entries yet</li>';
      } else {
        const recent = entries.slice(0, 3);
        recent.forEach(entry => {
          const li = document.createElement('li');
          const date = new Date(entry.created_at);
          const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
          li.innerHTML = `<span>${entry.entry_type === 'income' ? 'Income' : 'Expense'}: ₹${parseFloat(entry.amount).toLocaleString('en-IN')}</span><span class="pill">${dateStr}</span>`;
          recentEntriesList.appendChild(li);
        });
      }
    }
    
    // Activity summary
    const activitySummaryList = document.getElementById('activitySummaryList');
    if (activitySummaryList) {
      activitySummaryList.innerHTML = '';
      if (entries.length === 0) {
        activitySummaryList.innerHTML = '<li>No activity yet</li>';
      } else {
        const today = new Date().toDateString();
        const todayCount = entries.filter(e => new Date(e.created_at).toDateString() === today).length;
        const incomeCount = entries.filter(e => e.entry_type === 'income').length;
        const expenseCount = entries.filter(e => e.entry_type === 'expense').length;
        
        const li1 = document.createElement('li');
        li1.innerHTML = `<strong>Today:</strong> ${todayCount} ${todayCount === 1 ? 'entry' : 'entries'} recorded`;
        activitySummaryList.appendChild(li1);
        
        const li2 = document.createElement('li');
        li2.innerHTML = `<strong>Total:</strong> ${incomeCount} income, ${expenseCount} expense entries`;
        activitySummaryList.appendChild(li2);
      }
    }
    
    // Quick stats
    const quickStatsList = document.getElementById('quickStatsList');
    if (quickStatsList) {
      quickStatsList.innerHTML = '';
      if (entries.length === 0) {
        quickStatsList.innerHTML = '<li>No stats available</li>';
      } else {
        const totalIncome = entries.filter(e => e.entry_type === 'income').reduce((sum, e) => sum + parseFloat(e.amount), 0);
        const totalExpenses = entries.filter(e => e.entry_type === 'expense').reduce((sum, e) => sum + parseFloat(e.amount), 0);
        const netBalance = totalIncome - totalExpenses;
        
        const li1 = document.createElement('li');
        li1.innerHTML = `<strong>Total entries:</strong> ${entries.length}`;
        quickStatsList.appendChild(li1);
        
        const li2 = document.createElement('li');
        li2.innerHTML = `<strong>Net balance:</strong> ₹${netBalance.toLocaleString('en-IN')}`;
        quickStatsList.appendChild(li2);
      }
    }
  }

  // Function to load entries for ledger modal
  function loadLedgerEntries() {
    fetch('/api/entries', { credentials: 'same-origin' })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.entries) {
          displayLedgerEntries(data.entries);
        }
      })
      .catch((err) => {
        console.error('Error loading ledger entries:', err);
      });
  }

  // Function to display entries in ledger modal
  function displayLedgerEntries(entries) {
    const ledgerTable = document.querySelector('#ledgerModal .ledger-table');
    if (!ledgerTable) return;

    // Clear existing rows except header
    const existingRows = ledgerTable.querySelectorAll('.ledger-row:not(.ledger-row--head)');
    existingRows.forEach(row => row.remove());

    if (entries.length === 0) {
      const row = document.createElement('div');
      row.className = 'ledger-row';
      row.innerHTML = '<span colspan="5" style="text-align: center; padding: 2rem;">No ledger entries yet. Record a voice entry or upload a bill to get started.</span>';
      ledgerTable.appendChild(row);
      return;
    }

    // Sort entries by date (oldest first) for proper balance calculation
    const sortedEntries = [...entries].sort((a, b) => {
      return new Date(a.created_at) - new Date(b.created_at);
    });

    // Show latest 20 entries (most recent)
    const latestEntries = sortedEntries.slice(-20);
    let runningBalance = 0;

    latestEntries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'ledger-row';

      const date = new Date(entry.created_at);
      const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

      const amount = parseFloat(entry.amount);
      const note = entry.note || 'Voice entry';

      if (entry.entry_type === 'income') {
        runningBalance += amount;
        row.innerHTML = `
          <span>${dateStr}</span>
          <span>${note}</span>
          <span></span>
          <span>₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          <span>₹${runningBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        `;
      } else {
        runningBalance -= amount;
        row.innerHTML = `
          <span>${dateStr}</span>
          <span>${note}</span>
          <span>₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          <span></span>
          <span>₹${runningBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        `;
      }

      ledgerTable.appendChild(row);
    });
  }

  // Export function to refresh entries (can be called after voice entry is created)
  window.refreshDashboardEntries = function() {
    loadEntries();
    loadLedgerEntries();
  };

  // Refresh ledger entries when ledger modal opens
  const ledgerModal = document.getElementById('ledgerModal');
  if (ledgerModal) {
    const observer = new MutationObserver(() => {
      if (ledgerModal.getAttribute('aria-hidden') === 'false') {
        loadLedgerEntries();
      }
    });
    observer.observe(ledgerModal, { attributes: true, attributeFilter: ['aria-hidden'] });
  }

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

  // ================================
  // Bill Upload Functionality
  // ================================
  function initBillUpload() {
    const dropZone = document.getElementById('uploadDropZone');
    const fileInput = document.getElementById('billFileInput');
    const processingEl = document.getElementById('uploadProcessing');
    const resultEl = document.getElementById('uploadResult');
    const resultAmount = document.getElementById('resultAmount');
    const resultViewLink = document.getElementById('resultViewLink');
    const ocrPreview = document.getElementById('ocrPreview');
    const ocrTextBox = document.getElementById('ocrTextBox');
    const uploadAnotherBtn = document.getElementById('uploadAnotherBtn');

    if (!dropZone || !fileInput) return;

    // Click to open file picker
    dropZone.addEventListener('click', () => fileInput.click());

    // Drag and drop handlers
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFileUpload(files[0]);
      }
    });

    // File input change
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        handleFileUpload(fileInput.files[0]);
      }
    });

    // Upload another button
    if (uploadAnotherBtn) {
      uploadAnotherBtn.addEventListener('click', resetUploadUI);
    }

    function resetUploadUI() {
      dropZone.style.display = 'flex';
      processingEl.style.display = 'none';
      resultEl.style.display = 'none';
      ocrPreview.style.display = 'none';
      fileInput.value = '';
    }

    async function handleFileUpload(file) {
      // Validate file type
      const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        alert('Please upload an image file (PNG, JPG, WebP, etc.)');
        return;
      }

      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        alert('File size must be less than 10MB');
        return;
      }

      // Show processing state
      dropZone.style.display = 'none';
      processingEl.style.display = 'flex';
      resultEl.style.display = 'none';
      ocrPreview.style.display = 'none';

      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/bills/upload', {
          method: 'POST',
          credentials: 'same-origin',
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || data.error || 'Upload failed');
        }

        // Show success result
        processingEl.style.display = 'none';
        resultEl.style.display = 'flex';

        // Display detected amount
        if (data.bill && data.bill.detected_amount) {
          resultAmount.textContent = `₹${data.bill.detected_amount.toLocaleString('en-IN')}`;
        } else {
          resultAmount.textContent = 'Amount not detected';
        }

        // Display confidence score
        const confidenceEl = document.getElementById('resultConfidence');
        if (confidenceEl && data.bill && typeof data.bill.confidence === 'number') {
          const pct = Math.round(data.bill.confidence * 100);
          let badgeClass = 'confidence-high';
          if (pct < 60) badgeClass = 'confidence-low';
          else if (pct < 80) badgeClass = 'confidence-medium';
          
          confidenceEl.innerHTML = `<span class="confidence-badge ${badgeClass}">${pct}% confidence</span>`;
          confidenceEl.style.display = 'block';
        } else if (confidenceEl) {
          confidenceEl.style.display = 'none';
        }

        // Show link to uploaded file (local path)
        if (resultViewLink && data.bill && data.bill.s3_url) {
          resultViewLink.href = data.bill.s3_url;
          resultViewLink.style.display = 'inline-flex';
        }

        // Show OCR text preview
        if (data.bill && data.bill.ocr_text) {
          ocrTextBox.textContent = data.bill.ocr_text;
          ocrPreview.style.display = 'block';
        }

        // Show toast notification
        if (window.ToastManager) {
          ToastManager.show('Bill uploaded and processed successfully!', 'success');
        }

      } catch (error) {
        console.error('Upload error:', error);
        processingEl.style.display = 'none';
        dropZone.style.display = 'flex';
        
        if (window.ToastManager) {
          ToastManager.show(`Upload failed: ${error.message}`, 'error');
        } else {
          alert(`Upload failed: ${error.message}`);
        }
      }
    }
  }

  // Initialize bill upload when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    initBillUpload();
  });
})();
