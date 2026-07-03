// Local, free OCR via Apple's Vision framework — no cloud, no npm, excellent
// Danish support. The Facebook harvester runs on the operator's Mac anyway, so
// it can shell out to this to turn poster images into text.
//   swift scripts/ocr.swift <image-file>   ->  recognized text on stdout
import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count > 1,
      let image = NSImage(contentsOfFile: args[1]),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("usage: swift ocr.swift <image>\n".data(using: .utf8)!)
  exit(1)
}

let request = VNRecognizeTextRequest { req, _ in
  let obs = req.results as? [VNRecognizedTextObservation] ?? []
  let lines = obs.compactMap { $0.topCandidates(1).first?.string }
  print(lines.joined(separator: "\n"))
}
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["da-DK", "en-US"]

do {
  try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
} catch {
  FileHandle.standardError.write("OCR failed: \(error)\n".data(using: .utf8)!)
  exit(1)
}
