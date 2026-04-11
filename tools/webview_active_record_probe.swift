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
        let check = "document.readyState === 'complete' && typeof uploadedRecordForDept === 'function'"
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
let deptKey = (args.first ?? "radiology_duty")
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "'", with: "\\'")
let urlString = args.dropFirst().first ?? "http://127.0.0.1:8000/on_call_look_up%206/"
let js = """
(function() {
  window.__probeDone = false;
  window.__probeResult = null;
  (async function() {
    try {
      if (typeof loadUploadedSpecialties === 'function') await loadUploadedSpecialties();
      const deptKey = '\(deptKey)';
      const record = typeof uploadedRecordForDept === 'function' ? uploadedRecordForDept(deptKey) : null;
      let dbRecord = null;
      let allRecords = [];
      try {
        dbRecord = typeof getPdfRecord === 'function' ? await getPdfRecord(deptKey) : null;
      } catch (_) {
        dbRecord = null;
      }
      try {
        allRecords = typeof getAllPdfRecords === 'function' ? await getAllPdfRecords() : [];
      } catch (_) {
        allRecords = [];
      }
      const now = new Date('2026-04-10T10:00:00+03:00');
      const schedDate = typeof getScheduleDate === 'function' ? getScheduleDate(now).date : now;
      const schedKey = typeof fmtKey === 'function' ? fmtKey(schedDate) : '';
      const dept = (typeof ROTAS !== 'undefined' && ROTAS) ? ROTAS[deptKey] : null;
      const rawRows = dept && dept.schedule ? (dept.schedule[schedKey] || []) : [];
      const specialtyRows =
        deptKey === 'pediatrics' && typeof getPediatricsEntries === 'function' ? getPediatricsEntries(schedKey, now)
        : deptKey === 'liver' && typeof getLiverEntries === 'function' ? getLiverEntries(schedKey, now)
        : deptKey === 'hematology' && typeof getHematologyEntries === 'function' ? getHematologyEntries(schedKey, now)
        : [];
      const liverAfterRows =
        deptKey === 'liver' && typeof normalizeLiverRowsForDisplay === 'function'
          ? normalizeLiverRowsForDisplay([
              { role:'Day Coverage', name:'May/Attalaah' },
              { role:'Night On-Call (9PM–9AM)', name:'SMRO' },
              { role:'2nd On-Call', name:'May' },
              { role:'3rd On-Call', name:'Noora' },
            ], '09/04', new Date('2026-04-09T22:00:00+03:00'))
          : [];
      const currentRows = (typeof getEntries === 'function' && dept) ? getEntries(deptKey, dept, schedKey, now, deptKey) : [];
      window.__probeResult = {
        deptKey,
        uploadedRecord: record ? {
          deptKey: record.deptKey || '',
          name: record.name || '',
          parsedActive: !!record.parsedActive,
          isActive: record.isActive !== false,
          review: record.review || null,
          audit: record.audit || null,
          issueCount: record.audit && record.audit.issues ? record.audit.issues.length : 0,
          entryCount: Array.isArray(record.entries) ? record.entries.length : 0,
        } : null,
        dbRecord: dbRecord ? {
          deptKey: dbRecord.deptKey || '',
          name: dbRecord.name || '',
          parsedActive: !!dbRecord.parsedActive,
          isActive: dbRecord.isActive !== false,
          review: dbRecord.review || null,
          audit: dbRecord.audit || null,
          issueCount: dbRecord.audit && dbRecord.audit.issues ? dbRecord.audit.issues.length : 0,
          entryCount: Array.isArray(dbRecord.entries) ? dbRecord.entries.length : 0,
        } : null,
        matchingRecords: Array.isArray(allRecords) ? allRecords
          .filter(r => (r.deptKey || '') === deptKey)
          .map(r => ({
            name: r.name || '',
            parsedActive: !!r.parsedActive,
            isActive: r.isActive !== false,
            review: r.review || null,
            audit: r.audit || null,
            entryCount: Array.isArray(r.entries) ? r.entries.length : 0,
          })) : [],
        schedKey,
        rawRows: Array.isArray(rawRows) ? rawRows.map(row => ({
          name: row.name || '',
          role: row.role || '',
          phone: row.phone || '',
          section: row.section || '',
        })) : [],
        specialtyRows: Array.isArray(specialtyRows) ? specialtyRows.map(row => ({
          name: row.name || '',
          role: row.role || '',
          phone: row.phone || '',
          section: row.section || '',
        })) : [],
        liverAfterRows: Array.isArray(liverAfterRows) ? liverAfterRows.map(row => ({
          name: row.name || '',
          role: row.role || '',
          phone: row.phone || '',
          section: row.section || '',
        })) : [],
        currentRows: Array.isArray(currentRows) ? currentRows.map(row => ({
          name: row.name || '',
          role: row.role || '',
          phone: row.phone || '',
          section: row.section || '',
        })) : [],
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
