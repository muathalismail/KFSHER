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
        let check = "document.readyState === 'complete' && typeof search === 'function' && typeof getLatestActivePdfRecord === 'function' && !!document.getElementById('cards')"
        webView.evaluateJavaScript(check) { [weak self] result, _ in
            guard let self else { return }
            if let ok = result as? Bool, ok {
                self.run()
                return
            }
            if attempts > 100 {
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

let args = Array(CommandLine.arguments.dropFirst())
let appURLString = args.first ?? "http://127.0.0.1:8000/on_call_look_up%206/?v=20260409-truth-pass20"

let js = """
(function() {
  window.__probeDone = false;
  window.__probeResult = null;
  (async function() {
    try {
      async function inspect(deptKey, query) {
        const dept = ROTAS[deptKey] || null;
        const activeRecord = await getLatestActivePdfRecord(deptKey);
        await search(query);
        const rows = Array.from(document.querySelectorAll('.drow')).map(row => ({
          name: (row.querySelector('.ddrname')?.textContent || '').trim(),
          role: (row.querySelector('.drrole')?.textContent || '').trim(),
          section: (row.querySelector('.dsection')?.textContent || '').trim(),
        }));
        const previewBtn = document.querySelector('[data-preview]');
        const previewDept = previewBtn ? previewBtn.getAttribute('data-preview') : '';
        if (previewBtn) {
          previewBtn.click();
          await new Promise(r => setTimeout(r, 500));
        }
        const frame = document.getElementById('pdfFrame');
        const selected = uploadedRecordForDept(deptKey);
        const usableEntries = !!(selected && Array.isArray(selected.entries) && selected.entries.some(e => (e.name || '').trim()));
        return {
          homepageCardKey: deptKey,
          searchKey: query,
          directClickKey: deptKey,
          viewKey: previewDept || deptKey,
          activeSource: activeRecord ? {
            deptKey: activeRecord.deptKey,
            name: activeRecord.name || '',
            parsedActive: !!activeRecord.parsedActive,
            isActive: activeRecord.isActive !== false,
            rowsCount: Array.isArray(activeRecord.entries) ? activeRecord.entries.length : 0,
            usableEntries,
            sourceNames: Array.isArray(activeRecord.entries) ? activeRecord.entries.map(e => e.name).filter(Boolean) : []
          } : {
            deptKey,
            name: dept?.label || '',
            parsedActive: false,
            isActive: false,
            rowsCount: 0,
            usableEntries: false,
            sourceNames: []
          },
          renderedNames: rows.map(r => r.name),
          previewFrameSrc: frame ? (frame.getAttribute('src') || '') : '',
        };
      }
      window.__probeResult = {
        duty: await inspect('radiology_duty', 'radiology duty'),
        oncall: await inspect('radiology_oncall', 'radiology on-call')
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
