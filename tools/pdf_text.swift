import Foundation
import PDFKit

struct Args {
    var path: String
    var pages: [Int] = []
}

func parseArgs() -> Args? {
    var args = CommandLine.arguments.dropFirst()
    guard let path = args.first else { return nil }
    args = args.dropFirst()
    var pages: [Int] = []
    if let index = args.firstIndex(of: "--pages"), index < args.endIndex {
        let next = args[args.index(after: index)]
        pages = next.split(separator: ",").compactMap { Int($0) }
    }
    return Args(path: path, pages: pages)
}

guard let cfg = parseArgs() else {
    fputs("usage: swift pdf_text.swift <pdf-path> [--pages 1,2]\n", stderr)
    exit(2)
}

let url = URL(fileURLWithPath: cfg.path)
guard let doc = PDFDocument(url: url) else {
    fputs("failed to open PDF: \(cfg.path)\n", stderr)
    exit(1)
}

let requestedPages = cfg.pages.isEmpty ? Array(1...doc.pageCount) : cfg.pages
print("PAGES \(doc.pageCount)")
for pageNumber in requestedPages where pageNumber >= 1 && pageNumber <= doc.pageCount {
    let index = pageNumber - 1
    let text = doc.page(at: index)?.string ?? ""
    print("----- PAGE \(pageNumber) -----")
    print(text)
}
