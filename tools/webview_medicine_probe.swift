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
        self.webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        super.init()
        self.webView.navigationDelegate = self
    }

    func start() { webView.load(URLRequest(url: url)) }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        waitReady()
    }

    private func waitReady(attempts: Int = 0) {
        let check = """
        document.readyState === 'complete' &&
        typeof loadUploadedSpecialties === 'function' &&
        typeof uploadedRecordForDept === 'function' &&
        typeof getPdfHref === 'function' &&
        typeof showExactDept === 'function'
        """
        webView.evaluateJavaScript(check) { [weak self] result, _ in
            guard let self else { return }
            if let ok = result as? Bool, ok {
                self.run()
                return
            }
            if attempts > 120 {
                fputs("App not ready\n", stderr)
                NSApp.terminate(nil)
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                self.waitReady(attempts: attempts + 1)
            }
        }
    }

    private func run() {
        webView.evaluateJavaScript(js) { _, error in
            if let error {
                fputs("Probe JS error: \(error)\n", stderr)
                NSApp.terminate(nil)
                return
            }
            self.poll()
        }
    }

    private func poll(attempts: Int = 0) {
        webView.evaluateJavaScript("window.__probeDone ? JSON.stringify(window.__probeResult) : ''") { result, _ in
            if let text = result as? String, !text.isEmpty {
                print(text)
                NSApp.terminate(nil)
                return
            }
            if attempts > 160 {
                fputs("Probe timed out\n", stderr)
                NSApp.terminate(nil)
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                self.poll(attempts: attempts + 1)
            }
        }
    }
}

let urlString = Array(CommandLine.arguments.dropFirst()).first ?? "http://127.0.0.1:8000/on_call_look_up%206/"
let js = """
(function() {
  window.__probeDone = false;
  window.__probeResult = null;
  (async function() {
    try {
      await loadUploadedSpecialties();
      const medOnCall = uploadedRecordForDept('medicine_on_call');
      const med = uploadedRecordForDept('medicine');
      const medOnCallPdf = await getPdfHref('medicine_on_call');
      const medPdf = await getPdfHref('medicine');
      await showExactDept('medicine_on_call');
      await new Promise(r => setTimeout(r, 300));
      const rows = Array.from(document.querySelectorAll('.drow')).map(row => ({
        name: (row.querySelector('.ddrname')?.textContent || '').trim(),
        role: (row.querySelector('.drrole')?.textContent || '').trim(),
        section: (row.querySelector('.dsection')?.textContent || '').trim(),
      }));
      const empty = document.querySelector('.results .empty');
      const previewBtn = document.querySelector('[data-preview="medicine_on_call"]');
      if (previewBtn) {
        previewBtn.click();
        await new Promise(r => setTimeout(r, 400));
      }
      window.__probeResult = {
        medicine_on_call_record: medOnCall ? {
          deptKey: medOnCall.deptKey || '',
          originalDeptKey: medOnCall.originalDeptKey || '',
          name: medOnCall.name || '',
          parsedActive: !!medOnCall.parsedActive,
          isActive: !!medOnCall.isActive,
          entryCount: Array.isArray(medOnCall.entries) ? medOnCall.entries.length : 0,
        } : null,
        medicine_record: med ? {
          deptKey: med.deptKey || '',
          originalDeptKey: med.originalDeptKey || '',
          name: med.name || '',
          parsedActive: !!med.parsedActive,
          isActive: !!med.isActive,
          entryCount: Array.isArray(med.entries) ? med.entries.length : 0,
        } : null,
        medicine_on_call_pdf: medOnCallPdf ? {
          name: medOnCallPdf.name || '',
          href: medOnCallPdf.href || ''
        } : null,
        medicine_pdf: medPdf ? {
          name: medPdf.name || '',
          href: medPdf.href || ''
        } : null,
        renderedRows: rows,
        renderedEmpty: empty ? (empty.textContent || '').trim() : '',
        searchValue: document.getElementById('search')?.value || '',
        previewName: document.getElementById('pdfPreviewName')?.textContent || '',
        previewFrameSrc: document.getElementById('pdfFrame')?.getAttribute('src') || '',
        openHref: document.getElementById('openPdfBtn')?.getAttribute('href') || '',
        previewButtonExists: !!previewBtn
      };
    } catch (err) {
      window.__probeResult = { error: String(err && err.message ? err.message : err) };
    }
    window.__probeDone = true;
  })();
})();
"""

let app = NSApplication.shared
let delegate = ProbeDelegate(url: URL(string: urlString)!, js: js)
app.setActivationPolicy(.prohibited)
delegate.start()
app.run()
