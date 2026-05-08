import ExpoModulesCore
import PDFKit

/**
 * PdfExtractorModule
 *
 * Extracts word-level text items from a PDF document using Apple PDFKit.
 * Returns a JSON string of [{page, x, y, text}] objects — one object per word.
 *
 * Word-level (not line-level) extraction is required so that:
 *   • Bank of America's two-column check section (different x per column) resolves correctly.
 *   • Citi's sidebar dollar amounts (high x) can be identified and stripped.
 *
 * Coordinate system:
 *   • PDFKit uses PDF coordinates (origin bottom-left, y increases upward).
 *   • y is returned as bounds.minY — PDFKit native, no inversion.
 *     The TypeScript parsers sort by descending y to read top-of-page first,
 *     which requires high y = top of page — matching PDFKit's convention.
 *   • x is bounds.minX (left edge of the word's bounding box).
 *
 * Extraction strategy:
 *   Call selectionsByLine() on the full page selection. For each line selection,
 *   obtain its page-level character offset via range(at:on:). Each within-line
 *   token offset is added to that base to form the page-level character index,
 *   then page.characterBounds(at:) returns the CGRect for that character
 *   directly — avoiding the O(n) cost of creating a PDFSelection per token.
 *   Only the first character of each token is sampled; its minX / minY give
 *   column-detection thresholds that are accurate enough for all bank parsers.
 */
public class PdfExtractorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PdfExtractor")

    AsyncFunction("extractTextItems") { (uri: String) -> String in
      guard let url = URL(string: uri),
            let document = PDFDocument(url: url) else {
        throw NSError(
          domain: "PdfExtractorModule",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Cannot open PDF at \(uri)"]
        )
      }

      var items: [[String: Any]] = []

      for pageIndex in 0..<document.pageCount {
        guard let page = document.page(at: pageIndex) else { continue }
        let pageNumber = pageIndex + 1

        guard let pageString = page.string, !pageString.isEmpty else { continue }
        let fullRange = NSRange(location: 0, length: (pageString as NSString).length)
        guard let fullSelection = page.selection(for: fullRange) else { continue }
        let lineSelections = fullSelection.selectionsByLine()

        for lineSelection in lineSelections {
          guard let lineString = lineSelection.string else { continue }

          // Determine where this line starts in the page character sequence so
          // that within-line token offsets can be converted to page-level offsets.
          // range(at:on:) returns the NSRange of the first contiguous run of the
          // line selection within the page's character space.
          guard lineSelection.numberOfTextRanges(on: page) > 0 else { continue }
          let lineBaseOffset = lineSelection.range(at: 0, on: page).location

          let tokens = lineString.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
          var searchRange = lineString.startIndex..<lineString.endIndex

          for token in tokens {
            guard let tokenRange = lineString.range(of: token, range: searchRange) else { continue }
            searchRange = tokenRange.upperBound..<lineString.endIndex

            let nsRange = NSRange(tokenRange, in: lineString)
            // Page-level character index of the first character in this token.
            let firstCharIdx = lineBaseOffset + nsRange.location

            // characterBounds(at:) returns the bounding box of a single character
            // without creating a PDFSelection — much cheaper than selection(for:)
            // when called for every token on every page.
            let bounds = page.characterBounds(at: firstCharIdx)
            // Skip zero-size / invisible artefacts (also catches out-of-range idx)
            if bounds.width < 0.5 || bounds.height < 0.5 { continue }

            let x = Double(bounds.minX)
            // Pass PDFKit native y (origin bottom-left, increases upward).
            // TypeScript parsers sort by descending y to read top-of-page first,
            // which requires high y = top of page — exactly PDFKit's convention.
            let y = Double(bounds.minY)

            items.append([
              "page": pageNumber,
              "x": x,
              "y": y,
              "text": token,
            ])
          }
        }
      }

      let data = try JSONSerialization.data(withJSONObject: items, options: [])
      return String(data: data, encoding: .utf8) ?? "[]"
    }
  }
}
