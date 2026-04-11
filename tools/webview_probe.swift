import Foundation
import WebKit
import AppKit

final class ProbeDelegate: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    let url: URL
    let js: String
    var done = false

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
        let readyCheck = "document.readyState === 'complete' && typeof parseUploadedPdf === 'function' && typeof detectDeptKeyFromPdf === 'function' && typeof Auditor !== 'undefined'"
        webView.evaluateJavaScript(readyCheck) { [weak self] result, error in
            guard let self else { return }
            if let ok = result as? Bool, ok {
                self.runProbe()
                return
            }
            if attempts > 80 {
                fputs("App scripts did not become ready.\n", stderr)
                self.done = true
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
                self?.done = true
                NSApp.terminate(nil)
                return
            }
            self?.poll()
        }
    }

    private func poll(attempts: Int = 0) {
        let script = "window.__probeDone ? JSON.stringify(window.__probeResult) : ''"
        webView.evaluateJavaScript(script) { [weak self] result, error in
            guard let self else { return }
            if let text = result as? String, !text.isEmpty {
                print(text)
                self.done = true
                NSApp.terminate(nil)
                return
            }
            if attempts > 160 {
                fputs("Probe timed out.\n", stderr)
                self.done = true
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
let defaultPdfPath = "/Users/Muath/Documents/New project 4/on_call_look_up 6/assets/pdfs/MISC DUTY ROTA March 29-02 April 2026 (Week 5) 1.pdf"
let pdfPath = inputPath ?? defaultPdfPath
let pdfUrl = URL(fileURLWithPath: pdfPath)
let pdfName = pdfUrl.lastPathComponent
let pdfData = (try? Data(contentsOf: pdfUrl)) ?? Data()
let pdfBase64 = pdfData.base64EncodedString()

let escapedName = pdfName
  .replacingOccurrences(of: "\\", with: "\\\\")
  .replacingOccurrences(of: "'", with: "\\'")
let appURLString = args.dropFirst().first ?? "http://127.0.0.1:8001/"

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
      const detected = await detectDeptKeyFromPdf(file);
      const deptKey = detected.deptKey || 'radiology_duty';
      const parsed = await parseUploadedPdf(file, deptKey);
      const previous = await getPdfRecord(deptKey);
      const audit = await Auditor.auditParsedRecord({
        deptKey,
        name: file.name,
        entries: parsed.entries || [],
        textSample: parsed.textSample || '',
        rawText: parsed.rawText || '',
        specialtyLabel: specialtyLabelForKey(deptKey, file.name),
        specialtyUncertain: !!detected.uncertain
      }, previous);
      const bySection = {};
      (audit.annotatedEntries || []).forEach(entry => {
        const key = entry.section || 'Unknown';
        if (!bySection[key]) bySection[key] = [];
        bySection[key].push({
          name: entry.name || '',
          role: entry.role || '',
          phone: entry.phone || '',
          confidence: entry._confidence || '',
          rowIssues: entry._rowIssues || []
        });
      });
      const review = {
        specialty: !!detected.uncertain,
        parsing: !audit.publishable || !(parsed.entries || []).length,
        auditRejected: !audit.publishable,
        auditErrors: (audit.issues || []).filter(i => i.severity === 'error').map(i => i.explanation),
        auditWarnings: (audit.issues || []).filter(i => i.severity === 'warn').map(i => i.explanation),
      };
      const uploadRecord = {
        deptKey,
        specialty: deptKey,
        specialtyLabel: specialtyLabelForKey(deptKey, file.name),
        icon: specialtyIconForKey(deptKey, file.name),
        specialtyUncertain: !!detected.uncertain,
        name: file.name,
        uploadedAt: Date.now(),
        blob: file,
        detectionSource: detected.source,
        parsedActive: !!audit.publishable,
        entries: audit.annotatedEntries || parsed.entries || [],
        textSample: parsed.textSample || '',
        rawText: parsed.rawText || '',
        audit: {
          overallConfidence: audit.overallConfidence || '',
          approved: !!audit.approved,
          publishable: !!audit.publishable,
          issues: audit.issues || [],
        },
        review,
      };
      if (audit.publishable) {
        await saveActivePdfRecord(uploadRecord);
      } else {
        await saveRejectedPdfRecord(uploadRecord);
      }
      await loadUploadedSpecialties();
      const saved = await getPdfRecord(deptKey);
      window.__probeResult = {
        detected,
        previousState: previous ? {
          parsedActive: !!previous.parsedActive,
          review: previous.review || null,
          issueCount: previous.audit && previous.audit.issues ? previous.audit.issues.length : 0
        } : null,
        entryCount: (parsed.entries || []).length,
        publishable: !!audit.publishable,
        approved: !!audit.approved,
        overallConfidence: audit.overallConfidence || '',
        issues: audit.issues || [],
        sections: bySection,
        savedState: saved ? {
          deptKey: saved.deptKey,
          parsedActive: !!saved.parsedActive,
          isActive: !!saved.isActive,
          review: saved.review || null,
          issueCount: saved.audit && saved.audit.issues ? saved.audit.issues.length : 0
        } : null,
        searchable: !!uploadedRecordForDept(deptKey) && !!uploadedRecordForDept(deptKey).parsedActive
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
