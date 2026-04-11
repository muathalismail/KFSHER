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
        typeof uploadedRecordForDept === 'function' &&
        typeof showPdfPreview === 'function' &&
        !!document.getElementById('pdfUploadInline') &&
        !!document.getElementById('pdfPreviewName')
        """
        webView.evaluateJavaScript(check) { [weak self] result, _ in
            guard let self else { return }
            if let ok = result as? Bool, ok {
                self.run()
                return
            }
            if attempts > 160 {
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
let inputPath = args.first ?? "/Users/Muath/Downloads/MISC DUTY ROTA 05-09 April 2026 (Week 1) 2.pdf"
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
      const raw = atob('\(pdfBase64)');
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const file = new File([blob], '\(escapedName)', { type: 'application/pdf' });

      const input = document.getElementById('pdfUploadInline');
      const status = document.getElementById('uploadStatus');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles:true }));

      let tries = 0;
      while (tries < 240) {
        await new Promise(r => setTimeout(r, 250));
        const text = (status.innerText || '').trim();
        if (text && !/Checking uploaded PDF|Checking \\d+ uploaded PDFs/i.test(text)) break;
        tries += 1;
      }

      const active = uploadedRecordForDept('radiology_duty');
      await showPdfPreview('radiology_duty');
      await new Promise(r => setTimeout(r, 600));

      const previewName = document.getElementById('pdfPreviewName')?.textContent || '';
      const frameSrc = document.getElementById('pdfFrame')?.getAttribute('src') || '';
      const openHref = document.getElementById('openPdfBtn')?.getAttribute('href') || '';
      const downloadHref = document.getElementById('downloadPdfBtn')?.getAttribute('href') || '';

      window.__probeResult = {
        activeRecord: active ? {
          name: active.name || '',
          parsedActive: !!active.parsedActive,
          isActive: !!active.isActive
        } : null,
        previewName,
        frameSrc,
        openHref,
        downloadHref,
        statusText: (status.innerText || '').trim()
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
