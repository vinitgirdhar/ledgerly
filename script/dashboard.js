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
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!isImage && !isPdf) {
        alert('Please upload an image or PDF file (PNG, JPG, WebP, PDF).');
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
