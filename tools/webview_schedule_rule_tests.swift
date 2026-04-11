import Foundation
import WebKit
import AppKit

final class ProbeDelegate: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    let url: URL

    init(url: URL) {
        self.url = url
        self.webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        super.init()
        self.webView.navigationDelegate = self
    }

    func start() { webView.load(URLRequest(url: url)) }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        waitReady()
    }

    private func waitReady(attempts: Int = 0) {
        let check = "document.readyState === 'complete' && typeof runSpecialtyScheduleRuleTests === 'function'"
        webView.evaluateJavaScript(check) { [weak self] result, _ in
            guard let self else { return }
            if let ok = result as? Bool, ok {
                self.run()
                return
            }
            if attempts > 80 {
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
        let js = "JSON.stringify(runSpecialtyScheduleRuleTests())"
        webView.evaluateJavaScript(js) { result, error in
            if let error {
                fputs("Probe JS error: \(error)\n", stderr)
                NSApp.terminate(nil)
                return
            }
            if let text = result as? String {
                print(text)
            }
            NSApp.terminate(nil)
        }
    }
}

let urlString = CommandLine.arguments.dropFirst().first ?? "http://127.0.0.1:8000/on_call_look_up%206/"
let app = NSApplication.shared
let delegate = ProbeDelegate(url: URL(string: urlString)!)
app.setActivationPolicy(.prohibited)
delegate.start()
app.run()
