(function() {
  document.addEventListener('DOMContentLoaded', () => {
    const uploadDropZone = document.getElementById('uploadDropZone');
    const fileInput = document.getElementById('billFileInput');
    const processingState = document.getElementById('uploadProcessing');
    const resultState = document.getElementById('uploadResult');
    const resultAmount = document.getElementById('resultAmount');
    const resultViewLink = document.getElementById('resultViewLink');
    const uploadAnotherBtn = document.getElementById('uploadAnotherBtn');
    const ocrPreview = document.getElementById('ocrPreview');
    const ocrTextBox = document.getElementById('ocrTextBox');

    if (!uploadDropZone || !fileInput) return;

    // Click to upload
    uploadDropZone.addEventListener('click', () => {
      fileInput.click();
    });

    // Drag and drop support
    uploadDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadDropZone.classList.add('is-dragover');
    });

    uploadDropZone.addEventListener('dragleave', () => {
      uploadDropZone.classList.remove('is-dragover');
    });

    uploadDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadDropZone.classList.remove('is-dragover');
      if (e.dataTransfer.files.length) {
        handleFileUpload(e.dataTransfer.files[0]);
      }
    });

    // File selection
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        handleFileUpload(e.target.files[0]);
      }
    });

    // Reset flow
    uploadAnotherBtn.addEventListener('click', () => {
      fileInput.value = ''; // Reset input
      resultState.style.display = 'none';
      processingState.style.display = 'none';
      uploadDropZone.style.display = 'flex';
      if (ocrPreview) ocrPreview.style.display = 'none';
    });

    function handleFileUpload(file) {
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!isImage && !isPdf) {
        alert('Please upload an image or PDF file (JPG, PNG, PDF).');
        return;
      }

      // Show processing
      uploadDropZone.style.display = 'none';
      processingState.style.display = 'flex';

      const formData = new FormData();
      formData.append('file', file);

      fetch('/api/bills/upload', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin' // Ensure cookie is sent
      })
      .then(res => res.json())
      .then(data => {
        processingState.style.display = 'none';
        
        if (data.ok && data.bill) {
          showResult(data.bill);
        } else {
          alert('Upload failed: ' + (data.error || 'Unknown error'));
          uploadDropZone.style.display = 'flex';
        }
      })
      .catch(err => {
        console.error(err);
        processingState.style.display = 'none';
        uploadDropZone.style.display = 'flex';
        alert('Network error occurred.');
      });
    }

    function showResult(bill) {
      resultState.style.display = 'flex';
      
      // Format amount as INR
      const amount = bill.total_amount || bill.detected_amount || 0;
      resultAmount.textContent = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR'
      }).format(amount);

      // Set view link
      if (bill.s3_url) {
        resultViewLink.href = bill.s3_url;
      }

      // Show OCR/JSON debug info
      if (ocrPreview && ocrTextBox) {
        ocrPreview.style.display = 'block';
        const debugData = {
          vendor: bill.vendor_name,
          gstin: bill.vendor_gstin,
          bill_date: bill.bill_date,
          amounts: {
             total: bill.total_amount,
             taxable: bill.subtotal,
             cgst: bill.cgst_amount,
             sgst: bill.sgst_amount,
             igst: bill.igst_amount
          },
          items: bill.items
        };
        ocrTextBox.textContent = JSON.stringify(debugData, null, 2);
      }
    }
  });
})();
