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
        let check = "document.readyState === 'complete' && typeof Auditor !== 'undefined' && typeof loadUploadedSpecialties === 'function'"
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
            if attempts > 200 {
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
      await Promise.all([
        Auditor.auditSystemState(),
        Auditor.auditAllStoredRecords(),
        Auditor.auditAllExistingSpecialties(),
        Auditor.runGoldenTests(),
      ]);
      const queue = Auditor.getQueue ? Auditor.getQueue() : [];
      const grouped = {};
      queue.forEach(item => {
        const key = item.specialty || 'unknown';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({
          severity: item.severity || '',
          issueType: item.issueType || '',
          explanation: item.explanation || '',
        });
      });
      const passed = [];
      const failed = [];
      Object.entries(ROTAS).forEach(([key, dept]) => {
        if (dept.hidden) return;
        const issues = grouped[key] || [];
        const hasError = issues.some(issue => issue.severity === 'error');
        const payload = {
          specialty: key,
          label: dept.label || key,
          verified: dept.verified !== false,
          auditBlocked: !!dept.auditBlocked,
          issueCount: issues.length,
          issues,
        };
        if (hasError || dept.auditBlocked) failed.push(payload);
        else passed.push(payload);
      });
      window.__probeResult = { passed, failed };
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
