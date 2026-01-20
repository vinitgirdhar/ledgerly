(function () {
  let mediaRecorder = null;
  let audioChunks = [];
  let recognition = null;
  let isRecording = false;
  let transcribedText = '';
  let recordingStream = null;
  let voiceEntryInitialized = false;

  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    // Try to initialize immediately
    setTimeout(() => {
      initVoiceEntry();
    }, 100);
    
    // Also initialize when modal opens (in case it wasn't ready before)
    const voiceModal = document.getElementById('voiceModal');
    if (voiceModal) {
      // Watch for modal opening
      const observer = new MutationObserver(() => {
        if (voiceModal.getAttribute('aria-hidden') === 'false') {
          setTimeout(() => {
            if (!voiceEntryInitialized) {
              console.log('Modal opened, initializing voice entry...');
              initVoiceEntry();
            }
          }, 50);
        }
      });
      observer.observe(voiceModal, { attributes: true, attributeFilter: ['aria-hidden'] });
      
      // Also listen for modal visibility class changes
      voiceModal.addEventListener('transitionend', () => {
        if (voiceModal.classList.contains('is-visible') && !voiceEntryInitialized) {
          setTimeout(() => {
            console.log('Modal became visible, initializing voice entry...');
            initVoiceEntry();
          }, 50);
        }
      });
    }
  });

  function initVoiceEntry() {
    const voiceModal = document.getElementById('voiceModal');
    if (!voiceModal) {
      console.warn('Voice modal not found');
      return;
    }

    const recordBtn = document.getElementById('voiceRecordBtn') || voiceModal.querySelector('.voice-controls .voice-btn:nth-child(1)');
    const processBtn = document.getElementById('voiceProcessBtn') || voiceModal.querySelector('.voice-controls .voice-btn:nth-child(2)');
    const simulateBtn = document.getElementById('voiceSimulateBtn') || voiceModal.querySelector('.modal-primary');
    const transcriptEl = voiceModal.querySelector('.voice-transcript');
    const voiceWave = voiceModal.querySelector('.voice-wave');

    if (!recordBtn || !processBtn || !simulateBtn || !transcriptEl) {
      console.warn('Voice modal elements not found', { recordBtn, processBtn, simulateBtn, transcriptEl });
      return;
    }

    // Prevent double initialization
    if (recordBtn.dataset.voiceInitialized === 'true') {
      return;
    }
    recordBtn.dataset.voiceInitialized = 'true';
    voiceEntryInitialized = true;
    
    console.log('Voice entry initialized successfully');

    // Check browser support
    const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
    const hasSpeechRecognition = 
      typeof window.SpeechRecognition !== 'undefined' || 
      typeof window.webkitSpeechRecognition !== 'undefined';

    // Initialize Speech Recognition
    if (hasSpeechRecognition) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'hi-IN'; // Hindi-India as primary, will also understand Hinglish and English

      recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }

        // Store transcription but don't display it until "Simulate entry" is clicked
        if (finalTranscript) {
          transcribedText += finalTranscript;
        }
        // Keep showing "Listening..." during recording, don't update with transcript
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'no-speech') {
          // This is normal, just keep listening
          return;
        }
        stopRecording();
        if (window.ToastManager) {
          ToastManager.show('Speech recognition error. Please try again.', 'error');
        }
      };

      recognition.onend = () => {
        if (isRecording) {
          // Restart recognition if we're still supposed to be recording
          try {
            recognition.start();
          } catch (e) {
            console.error('Failed to restart recognition:', e);
          }
        }
      };
    }

    // Record button handler
    recordBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Record button clicked, isRecording:', isRecording);
      
      if (isRecording) {
        stopRecording();
      } else {
        await startRecording();
      }
    }, true); // Use capture phase to intercept early

    // Process button handler - shows the transcribed text
    processBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // If still recording, stop it first
      if (isRecording) {
        stopRecording();
        setTimeout(() => {
          showTranscript();
        }, 500);
      } else {
        showTranscript();
      }
      
      function showTranscript() {
        if (!transcribedText.trim()) {
          if (window.ToastManager) {
            ToastManager.show('Please record something first.', 'info');
          } else {
            alert('Please record something first.');
          }
          return;
        }
        
        // Show the transcript
        const transcriptEl = document.querySelector('#voiceModal .voice-transcript');
        if (transcriptEl) {
          transcriptEl.textContent = `"${transcribedText.trim()}"`;
        }
        
        if (window.ToastManager) {
          ToastManager.show('Transcript ready. Click "Simulate entry" to save to database.', 'info');
        }
      }
    }, true); // Use capture phase

    // Simulate entry button handler - shows transcript and processes everything
    simulateBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // If still recording, stop it first
      if (isRecording) {
        stopRecording();
        // Wait a moment for final transcription to complete
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // If no transcribed text, use the sample text from the modal (for demo/simulation)
      if (!transcribedText.trim()) {
        const transcriptEl = document.querySelector('#voiceModal .voice-transcript');
        if (transcriptEl) {
          // Extract text from quotes, e.g., "5 kilo chawal 500 rupaye mein becha"
          const displayedText = transcriptEl.textContent.replace(/^[""]|[""]$/g, '').trim();
          if (displayedText && displayedText !== 'Listening... Speak now' && displayedText !== 'Recording complete. Click Simulate entry to process.' && displayedText !== 'No speech detected. Please try again.') {
            transcribedText = displayedText;
          }
        }
      }
      
      if (!transcribedText.trim()) {
        if (window.ToastManager) {
          ToastManager.show('Please record something first or use the sample text.', 'error');
        } else {
          alert('Please record something first.');
        }
        return;
      }

      // Show the transcript before processing
      const transcriptEl = document.querySelector('#voiceModal .voice-transcript');
      if (transcriptEl) {
        transcriptEl.textContent = `"${transcribedText.trim()}"`;
      }

      // Now process the entry
      await processVoiceEntry();
    }, true); // Use capture phase

    // Reset when modal closes
    voiceModal.addEventListener('transitionend', () => {
      if (voiceModal.getAttribute('aria-hidden') === 'true' && !voiceModal.classList.contains('is-visible')) {
        resetVoiceEntry();
      }
    });

    // Also reset when closing via close button
    voiceModal.querySelectorAll('[data-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        resetVoiceEntry();
      });
    });
  }

  async function startRecording() {
    try {
      isRecording = true;
      transcribedText = '';
      
      const recordBtn = document.getElementById('voiceRecordBtn');
      const transcriptEl = document.querySelector('#voiceModal .voice-transcript');
      const voiceWave = document.querySelector('#voiceModal .voice-wave');
      
      console.log('Starting recording...', { recordBtn, transcriptEl, voiceWave });

      if (recordBtn) {
        recordBtn.textContent = 'Stop';
        recordBtn.classList.add('recording');
      }

      if (transcriptEl) {
        transcriptEl.textContent = '"Listening... Speak now"';
      }

      if (voiceWave) {
        voiceWave.classList.add('is-active');
      }

      // Start speech recognition if available
      if (recognition) {
        try {
          recognition.start();
        } catch (e) {
          // Already started, ignore
          if (e.name !== 'InvalidStateError') {
            throw e;
          }
        }
      }

      // Also try MediaRecorder for audio capture (optional, for future use)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
        recordingStream = stream;

        const options = { mimeType: 'audio/webm' };
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          options.mimeType = 'audio/webm;codecs=opus';
        }

        mediaRecorder = new MediaRecorder(stream, options);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };

        mediaRecorder.start(1000); // Collect data every second
      } catch (err) {
        console.warn('MediaRecorder not available or permission denied:', err);
        // Continue with just speech recognition
      }

    } catch (error) {
      console.error('Error starting recording:', error);
      stopRecording();
      if (window.ToastManager) {
        ToastManager.show('Could not start recording. Please check microphone permissions.', 'error');
      }
    }
  }

  function stopRecording() {
    isRecording = false;

    const recordBtn = document.getElementById('voiceRecordBtn');
    const voiceWave = document.querySelector('#voiceModal .voice-wave');
    const transcriptEl = document.querySelector('#voiceModal .voice-transcript');
    
    console.log('Stopping recording...');

    if (recordBtn) {
      recordBtn.textContent = 'Record';
      recordBtn.classList.remove('recording');
    }

    if (voiceWave) {
      voiceWave.classList.remove('is-active');
    }

    if (recognition) {
      try {
        recognition.stop();
      } catch (e) {
        // Already stopped, ignore
      }
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }

    if (recordingStream) {
      recordingStream.getTracks().forEach(track => track.stop());
      recordingStream = null;
    }

    // Show "Recording complete" message, but don't show transcript yet
    if (transcriptEl) {
      if (transcribedText.trim()) {
        transcriptEl.textContent = '"Recording complete. Click Simulate entry to process."';
      } else {
        transcriptEl.textContent = '"No speech detected. Please try again."';
      }
    }
  }

  function resetVoiceEntry() {
    stopRecording();
    transcribedText = '';
    const transcriptEl = document.querySelector('#voiceModal .voice-transcript');
    if (transcriptEl) {
      transcriptEl.textContent = '"5 kilo chawal 500 rupaye mein becha"';
    }
    audioChunks = [];
  }

  async function processVoiceEntry() {
    const simulateBtn = document.getElementById('voiceSimulateBtn') || document.querySelector('#voiceModal .modal-primary');
    const transcriptEl = document.querySelector('#voiceModal .voice-transcript');
    
    if (!simulateBtn) {
      console.error('Simulate button not found');
      return;
    }
    const originalText = simulateBtn.textContent;

    try {
      simulateBtn.disabled = true;
      simulateBtn.textContent = 'Processing...';
      
      // Show processing message
      if (transcriptEl) {
        transcriptEl.textContent = '"Processing transcription and extracting data..."';
      }

      console.log('Processing transcript:', transcribedText);

      const response = await fetch('/api/voice/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          transcript: transcribedText.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Processing failed');
      }

      // Show success message with extracted data
      if (transcriptEl) {
        const amount = data.entry?.amount || 0;
        const entryType = data.entry?.entry_type || 'entry';
        transcriptEl.textContent = `"✓ Processed: ₹${amount.toLocaleString('en-IN')} ${entryType}"`;
      }

      if (window.ToastManager) {
        const amount = data.entry?.amount || 0;
        const entryType = data.entry?.entry_type || 'entry';
        ToastManager.show(
          `Voice entry processed! ₹${amount.toLocaleString('en-IN')} ${entryType} added to ledger.`,
          'success'
        );
      }

      // Refresh dashboard entries
      if (window.refreshDashboardEntries) {
        window.refreshDashboardEntries();
      }

      // Reset after a short delay to show success
      setTimeout(() => {
        resetVoiceEntry();
      }, 2000);

    } catch (error) {
      console.error('Error processing voice entry:', error);
      
      if (transcriptEl) {
        transcriptEl.textContent = `"Error: ${error.message}"`;
      }
      
      if (window.ToastManager) {
        ToastManager.show(`Failed to process entry: ${error.message}`, 'error');
      } else {
        alert(`Failed to process entry: ${error.message}`);
      }
    } finally {
      simulateBtn.disabled = false;
      simulateBtn.textContent = originalText;
    }
  }
})();
