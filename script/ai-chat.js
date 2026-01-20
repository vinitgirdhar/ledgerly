(function() {
  let chatInitialized = false;

  document.addEventListener('DOMContentLoaded', () => {
    initAIChat();
  });

  function initAIChat() {
    const chatWindow = document.getElementById('chatWindow');
    const chatInput = document.getElementById('chatInput');
    const chatSendBtn = document.getElementById('chatSendBtn');
    const chatModal = document.getElementById('chatModal');

    if (!chatWindow || !chatInput || !chatSendBtn) {
      return;
    }

    // Prevent double initialization
    if (chatInitialized) return;
    chatInitialized = true;

    // Load initial summary when modal opens
    if (chatModal) {
      const observer = new MutationObserver(() => {
        if (chatModal.getAttribute('aria-hidden') === 'false' || chatModal.classList.contains('is-visible')) {
          if (chatWindow.children.length === 0) {
            loadInitialSummary();
          }
        }
      });
      observer.observe(chatModal, { attributes: true, attributeFilter: ['aria-hidden', 'class'] });
    }

    // Send button click
    chatSendBtn.addEventListener('click', () => {
      sendMessage();
    });

    // Enter key press
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendMessage();
      }
    });

    // Email insight button
    const emailBtn = document.getElementById('emailInsightBtn');
    if (emailBtn) {
      emailBtn.addEventListener('click', () => {
        if (window.ToastManager) {
          ToastManager.show('AI drafted an insights email for you.', 'info');
        }
      });
    }
  }

  async function loadInitialSummary() {
    const chatWindow = document.getElementById('chatWindow');
    if (!chatWindow) return;

    // Show loading
    addBubble('Loading your business insights...', 'ai', true);

    try {
      const response = await fetch('/api/insights/summary', { credentials: 'same-origin' });
      const data = await response.json();

      // Clear loading bubble
      chatWindow.innerHTML = '';

      if (!response.ok || !data.ok) {
        addBubble('Could not load insights. Please try again.', 'ai');
        return;
      }

      const s = data.summary;
      const weekIncome = formatCurrency(s.week_income);
      const weekExpense = formatCurrency(s.week_expenses);
      const netCash = formatCurrency(s.net_cash);
      const todayIncome = formatCurrency(s.today_income);
      const todayExpense = formatCurrency(s.today_expenses);

      // Add welcome message with real data
      addBubble(`Welcome! Here's your business snapshot:

<strong>This Week:</strong>
• Income: ${weekIncome}
• Expenses: ${weekExpense}
• Net: ${formatCurrency(s.week_net)}

<strong>Today:</strong>
• Income: ${todayIncome}
• Expenses: ${todayExpense}

<strong>Overall Position:</strong> ${netCash}

Ask me anything like "Kal kitna kamaya?" or "Total expenses"`, 'ai');

    } catch (error) {
      chatWindow.innerHTML = '';
      addBubble('Error loading insights. Check your connection.', 'ai');
    }
  }

  async function sendMessage() {
    const chatInput = document.getElementById('chatInput');
    const question = chatInput.value.trim();

    if (!question) return;

    // Clear input
    chatInput.value = '';

    // Add user message
    addBubble(question, 'user');

    // Add loading bubble
    const loadingId = 'loading-' + Date.now();
    addBubble('Thinking...', 'ai', true, loadingId);

    try {
      const response = await fetch('/api/insights/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ question })
      });

      const data = await response.json();

      // Remove loading bubble
      const loadingBubble = document.getElementById(loadingId);
      if (loadingBubble) loadingBubble.remove();

      if (!response.ok || !data.ok) {
        addBubble(`Sorry, I couldn't process that: ${data.message || data.error}`, 'ai');
        return;
      }

      // Format the response
      let valueDisplay = data.value;
      if (data.value_format === 'currency') {
        valueDisplay = formatCurrency(data.value);
      } else if (data.value_format === 'percent') {
        valueDisplay = `${data.value}%`;
      }

      let responseText = `<strong>${data.title}</strong>\n\n${valueDisplay}`;

      // Add chart data if available
      if (data.chart !== 'none' && data.data && data.data.length > 0) {
        responseText += '\n\n<strong>Breakdown:</strong>';
        data.data.forEach(item => {
          const val = data.value_format === 'currency' 
            ? formatCurrency(item.value) 
            : item.value;
          responseText += `\n• ${item.label}: ${val}`;
        });
      }

      addBubble(responseText, 'ai');

      if (window.ToastManager) {
        ToastManager.show('Query processed successfully!', 'success');
      }

    } catch (error) {
      // Remove loading bubble
      const loadingBubble = document.getElementById(loadingId);
      if (loadingBubble) loadingBubble.remove();

      addBubble(`Error: ${error.message}`, 'ai');
    }
  }

  function addBubble(text, type, isLoading = false, id = null) {
    const chatWindow = document.getElementById('chatWindow');
    if (!chatWindow) return;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble chat-bubble--${type}`;
    if (id) bubble.id = id;

    if (isLoading) {
      bubble.innerHTML = `<span class="loading-dots">${text}</span>`;
      bubble.style.opacity = '0.7';
    } else {
      // Convert newlines to <br> and preserve HTML
      bubble.innerHTML = text.replace(/\n/g, '<br>');
    }

    chatWindow.appendChild(bubble);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '₹0';
    const num = parseFloat(amount);
    if (num >= 100000) {
      return `₹${(num / 100000).toFixed(2)}L`;
    } else if (num >= 1000) {
      return `₹${(num / 1000).toFixed(1)}K`;
    }
    return `₹${num.toLocaleString('en-IN')}`;
  }
})();
