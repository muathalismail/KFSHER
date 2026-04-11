import Foundation
import WebKit
import AppKit

final class RegressionDelegate: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    let url: URL

    init(url: URL) {
        self.url = url
        self.webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        super.init()
        self.webView.navigationDelegate = self
    }

    func start() {
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        waitReady()
    }

    private func waitReady(attempts: Int = 0) {
        let check = "document.readyState === 'complete' && typeof Auditor !== 'undefined' && typeof loadUploadedSpecialties === 'function' && typeof runSpecialtyScheduleRuleTests === 'function'"
        webView.evaluateJavaScript(check) { [weak self] result, _ in
            guard let self else { return }
            if let ok = result as? Bool, ok {
                self.run()
                return
            }
            if attempts > 120 {
                fputs("Regression app not ready\n", stderr)
                exit(2)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                self.waitReady(attempts: attempts + 1)
            }
        }
    }

    private func run() {
        let js = """
        (function() {
          window.__regressionDone = false;
          window.__regressionResult = '';
          (async function() {
            try {
              await loadUploadedSpecialties();
              await Promise.all([
                Auditor.auditSystemState(),
                Auditor.auditAllStoredRecords(),
                Auditor.auditAllExistingSpecialties(),
              ]);
              const regression = await Auditor.runRegressionSuite();
              const schedules = runSpecialtyScheduleRuleTests();
              window.__regressionResult = JSON.stringify({ regression, schedules });
            } catch (err) {
              window.__regressionResult = JSON.stringify({ error: String(err && err.message ? err.message : err) });
            }
            window.__regressionDone = true;
          })();
        })();
        """
        webView.evaluateJavaScript(js) { result, error in
            if let error {
                fputs("Regression JS error: \(error)\n", stderr)
                exit(2)
            }
            self.poll()
        }
    }

    private func poll(attempts: Int = 0) {
        webView.evaluateJavaScript("window.__regressionDone ? window.__regressionResult : ''") { result, error in
            if let error {
                fputs("Regression poll error: \(error)\n", stderr)
                exit(2)
            }
            if let text = result as? String, !text.isEmpty {
                print(text)
                guard let data = text.data(using: .utf8) else {
                    fputs("Regression output missing\n", stderr)
                    exit(2)
                }
                let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                if let error = json?["error"] as? String, !error.isEmpty {
                    fputs("Regression suite error: \(error)\n", stderr)
                    exit(2)
                }
                let regression = json?["regression"] as? [String: Any]
                let golden = regression?["golden"] as? [[String: Any]] ?? []
                let realFixtures = regression?["realFixtures"] as? [[String: Any]] ?? []
                let schedules = json?["schedules"] as? [[String: Any]] ?? []
                let goldenFailures = golden.filter { ($0["passed"] as? Bool) == false }
                let realFixtureFailures = realFixtures.filter { ($0["passed"] as? Bool) == false }
                let scheduleFailures = schedules.filter { ($0["passed"] as? Bool) == false }
                if !goldenFailures.isEmpty || !realFixtureFailures.isEmpty || !scheduleFailures.isEmpty {
                    exit(1)
                }
                exit(0)
            }
            if attempts > 240 {
                fputs("Regression timed out\n", stderr)
                exit(2)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                self.poll(attempts: attempts + 1)
            }
        }
    }
}

let urlString = CommandLine.arguments.dropFirst().first ?? "http://127.0.0.1:8000/on_call_look_up%206/"
let app = NSApplication.shared
let delegate = RegressionDelegate(url: URL(string: urlString)!)
app.setActivationPolicy(.prohibited)
delegate.start()
app.run()
