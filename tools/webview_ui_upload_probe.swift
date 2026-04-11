import Foundation
import WebKit
import AppKit

final class ProbeDelegate: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    let url: URL
    let js: String

    init(url: URL, js: String) {
        self.url = url
        self.js = js
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        self.webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        self.webView.navigationDelegate = self
    }

    func start() {
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        waitForAppReady()
    }

    private func waitForAppReady(attempts: Int = 0) {
        let readyCheck = """
        document.readyState === 'complete' &&
        typeof parseUploadedPdf === 'function' &&
        typeof Auditor !== 'undefined' &&
        !!document.getElementById('pdfUploadInline') &&
        !!document.getElementById('uploadStatus')
        """
        webView.evaluateJavaScript(readyCheck) { [weak self] result, _ in
            guard let self else { return }
            if let ok = result as? Bool, ok {
                self.runProbe()
                return
            }
            if attempts > 100 {
                fputs("App scripts did not become ready.\n", stderr)
                NSApp.terminate(nil)
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                self.waitForAppReady(attempts: attempts + 1)
            }
        }
    }

    private func runProbe() {
        webView.evaluateJavaScript(js) { [weak self] _, error in
            if let error {
                fputs("Probe injection error: \(error)\n", stderr)
                NSApp.terminate(nil)
                return
            }
            self?.poll()
        }
    }

    private func poll(attempts: Int = 0) {
      let script = "window.__probeDone ? JSON.stringify(window.__probeResult) : ''"
        webView.evaluateJavaScript(script) { result, _ in
            if let text = result as? String, !text.isEmpty {
                print(text)
                NSApp.terminate(nil)
                return
            }
            if attempts > 200 {
                fputs("Probe timed out.\n", stderr)
                NSApp.terminate(nil)
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                self.poll(attempts: attempts + 1)
            }
        }
    }
}

let args = Array(CommandLine.arguments.dropFirst())
let inputPath = args.first
let defaultPdfPath = "/Users/Muath/Downloads/MISC DUTY ROTA 05-09 April 2026 (Week 1) 2.pdf"
let pdfPath = inputPath ?? defaultPdfPath
let pdfURL = URL(fileURLWithPath: pdfPath)
let pdfName = pdfURL.lastPathComponent
let pdfData = (try? Data(contentsOf: pdfURL)) ?? Data()
let pdfBase64 = pdfData.base64EncodedString()
let escapedName = pdfName
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "'", with: "\\'")
let appURLString = args.dropFirst().first ?? "http://127.0.0.1:8000/on_call_look_up%206/"

let probeJS = """
(function() {
  window.__probeDone = false;
  window.__probeResult = null;
  (async function() {
    try {
      const fileName = '\(escapedName)';
      const raw = atob('\(pdfBase64)');
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const file = new File([blob], fileName, { type: 'application/pdf' });

      const input = document.getElementById('pdfUploadInline');
      const status = document.getElementById('uploadStatus');
      if (!input || !status) throw new Error('Upload UI elements not found');

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));

      let tries = 0;
      while (tries < 240) {
        await new Promise(r => setTimeout(r, 250));
        const text = (status.innerText || '').trim();
        if (text && !/Checking uploaded PDF|Checking \\d+ uploaded PDFs/i.test(text)) {
          const uploaded = (typeof uploadedRecordForDept === 'function') ? uploadedRecordForDept('radiology_duty') : null;
          const dept = (typeof ROTAS !== 'undefined' && ROTAS) ? ROTAS['radiology_duty'] : null;
          const now = new Date();
          const schedKey = (typeof fmtKey === 'function' && typeof getScheduleDate === 'function')
            ? fmtKey(getScheduleDate(now).date)
            : '';
          const liveEntries = (typeof getEntries === 'function' && dept)
            ? getEntries('radiology_duty', dept, schedKey, now, '')
            : [];
          const recordEntries = uploaded && Array.isArray(uploaded.entries) ? uploaded.entries : [];
          const grouped = {};
          recordEntries.forEach(entry => {
            const section = (entry.section || '(none)').trim();
            if (!grouped[section]) grouped[section] = [];
            grouped[section].push({
              name: entry.name || '',
              role: entry.role || '',
            });
          });
          if (typeof showExactDept === 'function') {
            showExactDept('radiology_duty');
            await new Promise(r => setTimeout(r, 400));
          }
          const resultCardEmpty = document.querySelector('.results .empty');
          const resultEmptyText = resultCardEmpty ? (resultCardEmpty.textContent || '').trim() : '';
          if (typeof showPdfPreview === 'function') {
            await showPdfPreview('radiology_duty');
            await new Promise(r => setTimeout(r, 400));
          }
          const previewName = document.getElementById('pdfPreviewName')?.textContent || '';
          const searchableSource = uploaded && uploaded.parsedActive && liveEntries && liveEntries.length
            ? 'new'
            : 'old';
          const viewerSource = previewName && uploaded && previewName.trim() === (uploaded.name || '').trim()
            ? 'new'
            : (previewName ? 'old' : 'none');
          const blockReasons = [];
          if (dept && dept.verified === false) blockReasons.push('dept.verified=false');
          if (uploaded && uploaded.review && uploaded.review.auditRejected) blockReasons.push('review.auditRejected');
          if (uploaded && uploaded.review && uploaded.review.parsing) blockReasons.push('review.parsing');
          if (uploaded && uploaded.audit && Array.isArray(uploaded.audit.issues)) {
            uploaded.audit.issues
              .filter(issue => issue && issue.severity === 'error')
              .forEach(issue => blockReasons.push(`${issue.issueType}: ${issue.explanation}`));
          }
          const defaultRawText = (typeof getRawPdfTextForDept === 'function')
            ? await getRawPdfTextForDept('radiology_duty')
            : '';
          window.__probeResult = {
            statusText: text,
            statusHtml: status.innerHTML,
            parsedActive: !!(uploaded && uploaded.parsedActive),
            searchable: !!(uploaded && uploaded.parsedActive),
            review: uploaded && uploaded.review ? uploaded.review : null,
            audit: uploaded && uploaded.audit ? uploaded.audit : null,
            activeFile: uploaded ? (uploaded.name || '') : '',
            deptVerified: dept ? dept.verified : null,
            parserRowsCount: recordEntries.length,
            liveEntriesCount: Array.isArray(liveEntries) ? liveEntries.length : 0,
            extractedSections: Object.keys(grouped),
            extractedDoctorsPerSection: grouped,
            publishable: !!(uploaded && uploaded.audit && uploaded.audit.publishable),
            exactBlockReason: blockReasons.join(' | ') || null,
            searchableSource,
            viewerSource,
            viewerFile: previewName.trim(),
            renderedEmptyText: resultEmptyText,
            defaultRawTextMatchesUploaded: !!(uploaded && uploaded.rawText && defaultRawText && uploaded.rawText === defaultRawText)
          };
          window.__probeDone = true;
          return;
        }
        tries += 1;
      }
      window.__probeResult = {
        error: 'Timed out waiting for upload status update',
        statusText: (status.innerText || '').trim(),
        statusHtml: status.innerHTML
      };
    } catch (err) {
      window.__probeResult = { error: String(err && err.message ? err.message : err) };
    }
    window.__probeDone = true;
  })();
})();
"""

let app = NSApplication.shared
let delegate = ProbeDelegate(url: URL(string: appURLString)!, js: probeJS)
app.setActivationPolicy(.prohibited)
delegate.start()
app.run()
