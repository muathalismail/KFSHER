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
        let check = "document.readyState === 'complete' && typeof extractPdfText === 'function'"
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

let args = Array(CommandLine.arguments.dropFirst())
let inputPath = args.first ?? "/Users/Muath/Downloads/V2-2026 ( Master Rota)  Neurology Duty Rota  05-04-2026.pdf"
let pdfURL = URL(fileURLWithPath: inputPath)
let pdfData = (try? Data(contentsOf: pdfURL)) ?? Data()
let pdfBase64 = pdfData.base64EncodedString()
let appURLString = args.dropFirst().first ?? "http://127.0.0.1:8000/on_call_look_up%206/"

let js = """
(function() {
  window.__probeDone = false;
  window.__probeResult = null;
  (async function() {
    try {
      const raw = atob('\(pdfBase64)');
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const file = new File([blob], 'probe.pdf', { type: 'application/pdf' });
      const text = await extractPdfText(file);
      const parsed = typeof parseNeurologyPdfEntries === 'function' ? parseNeurologyPdfEntries(text, 'neurology') : [];
      window.__probeResult = {
        textSample: (text || '').slice(0, 5000),
        parserCount: Array.isArray(parsed) ? parsed.length : 0,
        templateDetected: !!(parsed && parsed._templateDetected),
        firstRows: Array.isArray(parsed) ? parsed.slice(0, 12) : [],
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
