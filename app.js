(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const sampleOrder = 'SKU,Ordered Qty,Unit Price\nBOX-100,100,24.50\nTAPE-200,50,12.00\nLABEL-300,30,8.00\nGLOVE-400,20,39.00';
  const sampleReceived = 'SKU,Received Qty\nBOX-100,92\nTAPE-200,50\nLABEL-300,30\nGLOVE-400,20';
  const sampleInvoice = 'SKU,Invoiced Qty,Unit Price\nBOX-100,100,24.50\nTAPE-200,50,13.00\nLABEL-300,30,8.00\nGLOVE-400,20,39.00';
  let active = null;
  let activeSource = '';
  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: $('currency').value, maximumFractionDigits: 2 }).format(cents / 100);
  const setStatus = (message, error = false) => {
    const element = $('status'); element.textContent = message; element.classList.toggle('error', error);
  };
  function paintResults(result) {
    $('skus').textContent = result.totalSKUs;
    $('mismatches').textContent = result.issueRows;
    $('overcharge').textContent = money(result.estimatedOverCents);
    const body = $('rows'); body.replaceChildren();
    for (const item of result.items) {
      const tr = document.createElement('tr');
      for (const value of [item.sku, item.ordered, item.received, item.invoiced]) {
        const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td);
      }
      const issues = document.createElement('td');
      issues.className = item.issues.length ? 'issues' : 'ok';
      issues.textContent = item.issues.join(' · ') || '✓ Matched'; tr.appendChild(issues);
      const amount = document.createElement('td');
      amount.textContent = item.estimatedOverCents ? money(item.estimatedOverCents) : '—'; tr.appendChild(amount);
      body.appendChild(tr);
    }
  }
  function render(result, source) {
    active = result; activeSource = source;
    $('results').hidden = false;
    $('result-source').textContent = source;
    paintResults(result);
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('demo').addEventListener('click', () => {
    try {
      render(POMatch.compare(sampleOrder, sampleReceived, sampleInvoice), 'DEMO — synthetic sample data only.');
      setStatus('Sample processed. Choose your own files to run a real comparison.');
    } catch (error) { setStatus(error.message, true); }
  });
  for (const id of ['order', 'received', 'invoice']) {
    $(id).addEventListener('change', () => {
      $(id + '-name').textContent = $(id).files[0]?.name || 'Choose a CSV file';
    });
  }
  $('currency').addEventListener('change', () => {
    if (active) {
      $('result-source').textContent = activeSource + ' Currency display updated — no conversion performed.';
      paintResults(active);
    }
  });
  $('analyze').addEventListener('click', async () => {
    const files = ['order', 'received', 'invoice'].map(id => $(id).files[0]);
    if (files.some(file => !file)) { setStatus('Select all three CSV files or try the sample.', true); return; }
    if (files.some(file => file.size > 5 * 1024 * 1024)) { setStatus('Maximum file size: 5 MB each.', true); return; }
    $('analyze').disabled = true;
    try {
      const texts = await Promise.all(files.map(file => file.text()));
      render(POMatch.compare(...texts), 'Compared locally using your three files. No data was uploaded.');
      setStatus('Comparison complete. Download the discrepancies if useful.');
    } catch (error) { setStatus(error?.message || 'Unable to read the CSV files.', true); }
    finally { $('analyze').disabled = false; }
  });
  $('download').addEventListener('click', () => {
    if (!active) return;
    const blob = new Blob([POMatch.exportCSV(active)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'pomatch-discrepancies.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  });
})();
