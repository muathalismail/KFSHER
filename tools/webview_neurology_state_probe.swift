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
        let check = "document.readyState === 'complete' && typeof uploadedRecordForDept === 'function' && typeof getEntries === 'function'"
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
            if attempts > 120 {
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
      if (typeof loadUploadedSpecialties === 'function') await loadUploadedSpecialties();
      const deptKey = 'neurology';
      const uploaded = typeof uploadedRecordForDept === 'function' ? uploadedRecordForDept(deptKey) : null;
      const dbRecord = typeof getPdfRecord === 'function' ? await getPdfRecord(deptKey) : null;
      const allRecords = typeof getAllPdfRecords === 'function' ? await getAllPdfRecords() : [];
      const tomorrow = new Date('2026-04-10T22:00:00+03:00');
      const schedDate = typeof getScheduleDate === 'function' ? getScheduleDate(tomorrow).date : tomorrow;
      const schedKey = typeof fmtKey === 'function' ? fmtKey(schedDate) : '';
      const dept = (typeof ROTAS !== 'undefined' && ROTAS) ? ROTAS[deptKey] : null;
      const entries = (typeof getEntries === 'function' && dept) ? getEntries(deptKey, dept, schedKey, tomorrow, 'neurology') : [];
      window.__probeResult = {
        uploadedRecord: uploaded ? {
          name: uploaded.name || '',
          deptKey: uploaded.deptKey || '',
          parsedActive: !!uploaded.parsedActive,
          isActive: uploaded.isActive !== false,
          review: uploaded.review || null,
          audit: uploaded.audit || null,
          entryCount: Array.isArray(uploaded.entries) ? uploaded.entries.length : 0
        } : null,
        dbRecord: dbRecord ? {
          name: dbRecord.name || '',
          deptKey: dbRecord.deptKey || '',
          parsedActive: !!dbRecord.parsedActive,
          isActive: dbRecord.isActive !== false,
          review: dbRecord.review || null,
          audit: dbRecord.audit || null,
          entryCount: Array.isArray(dbRecord.entries) ? dbRecord.entries.length : 0
        } : null,
        relatedRecords: Array.isArray(allRecords) ? allRecords
          .filter(r => {
            const key = (r.deptKey || '').toLowerCase();
            const name = (r.name || '').toLowerCase();
            return key.includes('neuro') || name.includes('neuro');
          })
          .map(r => ({
            name: r.name || '',
            deptKey: r.deptKey || '',
            parsedActive: !!r.parsedActive,
            isActive: r.isActive !== false,
            review: r.review || null,
            audit: r.audit || null,
            entryCount: Array.isArray(r.entries) ? r.entries.length : 0
          })) : [],
        schedKey,
        tomorrowNightRows: Array.isArray(entries) ? entries.map(e => ({
          name: e.name || '',
          role: e.role || '',
          phone: e.phone || '',
          date: e.date || '',
          sourceSpecialty: e.specialty || '',
          section: e.section || ''
        })) : []
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
