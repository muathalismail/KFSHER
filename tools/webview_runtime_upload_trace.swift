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

    func start() { webView.load(URLRequest(url: url)) }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        waitReady()
    }

    private func waitReady(attempts: Int = 0) {
        let check = """
        document.readyState === 'complete' &&
        typeof loadUploadedSpecialties === 'function' &&
        !!document.getElementById('pdfUploadInline') &&
        !!document.getElementById('uploadStatus')
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
            if attempts > 240 {
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

let args = Array(CommandLine.arguments.dropFirst())
let inputPath = args.first ?? ""
let appURLString = args.dropFirst().first ?? "http://127.0.0.1:8000/on_call_look_up%206/"
let pdfURL = URL(fileURLWithPath: inputPath)
let pdfName = pdfURL.lastPathComponent
let pdfData = (try? Data(contentsOf: pdfURL)) ?? Data()
let pdfBase64 = pdfData.base64EncodedString()
let escapedName = pdfName
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "'", with: "\\'")

let js = """
(function() {
  window.__probeDone = false;
  window.__probeResult = null;
  (async function() {
    try {
      await loadUploadedSpecialties();
      const previous = typeof getPdfRecord === 'function' ? await getPdfRecord('medicine_on_call') : null;
      const previousUploadedAt = Number(previous?.uploadedAt || 0);
      const raw = atob('\(pdfBase64)');
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const file = new File([new Blob([bytes], { type:'application/pdf' })], '\(escapedName)', { type:'application/pdf' });

      const input = document.getElementById('pdfUploadInline');
      const status = document.getElementById('uploadStatus');
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles:true }));

      let record = null;
      let active = null;
      let displayRows = [];
      for (let i = 0; i < 240; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 250));
        record = typeof getPdfRecord === 'function' ? await getPdfRecord('medicine_on_call') : null;
        active = typeof uploadedRecordForDept === 'function' ? uploadedRecordForDept('medicine_on_call') : null;
        if (record && record.name === file.name && Number(record.uploadedAt || 0) > previousUploadedAt) break;
      }
      if (typeof getEntries === 'function' && typeof fmtKey === 'function' && typeof getScheduleDate === 'function') {
        const now = new Date();
        const schedKey = fmtKey(getScheduleDate(now).date);
        displayRows = (getEntries('medicine_on_call', ROTAS.medicine_on_call, schedKey, now, '') || []).map(entry => ({
          role: entry.role || '',
          name: entry.name || '',
          phone: entry.phone || '',
          section: entry.section || '',
        }));
      }

      window.__probeResult = {
        statusText: String(status?.innerText || '').trim(),
        record: record ? {
          name: record.name || '',
          uploadedAt: Number(record.uploadedAt || 0),
          parsedActive: !!record.parsedActive,
          isActive: record.isActive !== false,
          review: record.review || null,
          audit: record.audit || null,
          diagnostics: record.diagnostics || null,
        } : null,
        active: active ? {
          name: active.name || '',
          uploadedAt: Number(active.uploadedAt || 0),
          parsedActive: !!active.parsedActive,
          isActive: active.isActive !== false,
          review: active.review || null,
          audit: active.audit || null,
          diagnostics: active.diagnostics || null,
        } : null,
        displayRows,
      };
    } catch (err) {
      window.__probeResult = { error: String(err && err.message ? err.message : err) };
    }
    window.__probeDone = true;
  })();
})();
"""

let app = NSApplication.shared
let delegate = ProbeDelegate(url: URL(string: appURLString)!, js: js)
app.setActivationPolicy(.prohibited)
delegate.start()
app.run()
