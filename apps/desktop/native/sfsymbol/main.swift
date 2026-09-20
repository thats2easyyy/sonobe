// sfsymbol: draws SF Symbols on this Mac for Sonobe's design import. SwiftUI's
// Image(systemName:).font(.system(size:weight:)).imageScale(_:) draws the symbol into a PDF context,
// which keeps it as vector paths, and a small converter turns the PDF's operators into SVG. Symbols the
// converter can't express (masks inside masks, bitmaps, strokes) come back as a 3x PNG instead.
//
//   sfsymbol --batch       JSON requests on stdin, one per line; one JSON answer per line on stdout
//   sfsymbol heart.fill --size 17 --weight semibold --color '#F24D47' [--format svg|png|pdf]
//   sfsymbol --list        every symbol name this Mac has
//
// A batch request: {"id": 1, "name": "heart.fill", "size": 17, "weight": "semibold", "scale": "medium",
// "colors": ["#F24D47FF"]}. More than one color draws the palette rendering mode. The answer is
// {"id": 1, "ok": true, "svg": "<svg ...>", "width": 20.5, "height": 18.3}, or "png" (base64) with
// "pixelScale" and "fallback" (why it isn't an SVG), or {"ok": false, "error": ..., "suggestions": [...]}
// for a name this Mac doesn't have. "restriction" carries Apple's usage note for restricted symbols.
// width and height are the symbol's frame, which SwiftUI lays out. SwiftUI doesn't clip a symbol to it,
// so a badge can reach past it: "overflow" says how far past each edge (top, right, bottom, left, in
// points), and the SVG (its viewBox starts at minus left, minus top) and the PNG cover that too.
//
// Apple's symbol artwork is drawn on the person's Mac at import time and never stored in this repo.
// ImageRenderer needs macOS 13; on older systems every request answers with an error saying so.

import AppKit
import CoreGraphics
import Foundation
import SwiftUI

struct HelperError: Error {
    let message: String
    var suggestions: [String] = []
}

struct Request: Decodable {
    var id: Int?
    var name: String
    var size: Double?
    var weight: String?
    var scale: String?
    var colors: [String]?
    var format: String?
}

struct Answer: Encodable {
    var id: Int?
    var ok: Bool
    var svg: String?
    var png: String?
    var pixelScale: Double?
    var width: Double?
    var height: Double?
    var overflow: [Double]?
    var fallback: String?
    var restriction: String?
    var error: String?
    var suggestions: [String]?
}

let resources = URL(fileURLWithPath: "/System/Library/CoreServices/CoreGlyphs.bundle/Contents/Resources")
let osVersion = { () -> String in
    let v = ProcessInfo.processInfo.operatingSystemVersion
    return "\(v.majorVersion).\(v.minorVersion)\(v.patchVersion > 0 ? ".\(v.patchVersion)" : "")"
}()

/// Symbol names, search keywords and usage restrictions from the system's glyph bundle, read on first use.
enum Catalog {
    static let names: [String] = NSArray(contentsOf: resources.appendingPathComponent("symbol_order.plist")) as? [String] ?? []
    static let keywords: [String: [String]] = NSDictionary(contentsOf: resources.appendingPathComponent("symbol_search.plist")) as? [String: [String]] ?? [:]
    static let restrictions: [String: String] = NSDictionary(contentsOf: resources.appendingPathComponent("symbol_restrictions.strings")) as? [String: String] ?? [:]
}

func editDistance(_ a: [Character], _ b: [Character]) -> Int {
    if a.isEmpty { return b.count }
    if b.isEmpty { return a.count }
    var previous = Array(0...b.count)
    var current = [Int](repeating: 0, count: b.count + 1)
    for i in 1...a.count {
        current[0] = i
        for j in 1...b.count {
            current[j] = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1))
        }
        swap(&previous, &current)
    }
    return previous[b.count]
}

/// Names close to one this Mac doesn't have: near spellings first ("heart.filled"), then symbols whose
/// name parts or search keywords share words with it ("close" finds xmark, "arrow-left" arrow.left),
/// then looser spellings. Shorter names first within each group.
func suggestions(for query: String, limit: Int = 3) -> [String] {
    let q = Array(query.lowercased())
    let strong = max(1, q.count / 5), loose = max(2, q.count / 4)
    let words = Set(query.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init))
    var near: [(name: String, distance: Int)] = []
    var far: [(name: String, distance: Int)] = []
    var related: [(name: String, hits: Int)] = []
    let all = Set(Catalog.names)
    let digits = q.first?.isNumber == true
    for name in Catalog.names {
        // Skip localized and right-to-left variants (heart.text.square.ar, .rtl) and numbered badges
        // (1.magnifyingglass) unless the name asked for looks like one.
        if let dot = name.lastIndex(of: "."), all.contains(String(name[..<dot])) {
            let suffix = String(name[name.index(after: dot)...])
            if (suffix.count == 2 || suffix == "rtl") && !["up", "tv"].contains(suffix) && !query.hasSuffix("." + suffix) { continue }
        }
        if name.first?.isNumber == true && !digits { continue }
        let distance = editDistance(q, Array(name))
        if distance <= strong { near.append((name, distance)) } else if distance <= loose { far.append((name, distance)) }
        var terms = Set(name.split(separator: ".").map(String.init))
        for keyword in Catalog.keywords[name] ?? [] { terms.insert(keyword.lowercased()) }
        let hits = words.intersection(terms).count
        if hits > 0 { related.append((name, hits)) }
    }
    let bySpelling = { (a: (name: String, distance: Int), b: (name: String, distance: Int)) in a.distance != b.distance ? a.distance < b.distance : a.name.count < b.name.count }
    near.sort(by: bySpelling)
    far.sort(by: bySpelling)
    related.sort { a, b in a.hits != b.hits ? a.hits > b.hits : a.name.count != b.name.count ? a.name.count < b.name.count : a.name < b.name }
    var out: [String] = []
    for name in near.map(\.name) + related.map(\.name) + far.map(\.name) where !out.contains(name) {
        out.append(name)
        if out.count == limit { break }
    }
    return out
}

let weights: [String: Font.Weight] = ["ultralight": .ultraLight, "thin": .thin, "light": .light, "regular": .regular, "medium": .medium, "semibold": .semibold, "bold": .bold, "heavy": .heavy, "black": .black]
let scales: [String: Image.Scale] = ["small": .small, "medium": .medium, "large": .large]

func color(_ hex: String) throws -> Color {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6 || s.count == 8, let v = UInt64(s, radix: 16) else { throw HelperError(message: "\(hex) isn't a color. Use #RRGGBB or #RRGGBBAA.") }
    let rgba = s.count == 6 ? (v << 8) | 0xFF : v
    return Color(.sRGB, red: Double((rgba >> 24) & 0xFF) / 255, green: Double((rgba >> 16) & 0xFF) / 255, blue: Double((rgba >> 8) & 0xFF) / 255, opacity: Double(rgba & 0xFF) / 255)
}

struct Spec {
    var name: String
    var size: CGFloat
    var weight: Font.Weight
    var scale: Image.Scale
    var colors: [Color]
}

func spec(_ r: Request) throws -> Spec {
    let name = r.name.trimmingCharacters(in: .whitespaces)
    if name.isEmpty { throw HelperError(message: "Name a symbol, like heart.fill.") }
    guard NSImage(systemSymbolName: name, accessibilityDescription: nil) != nil else {
        throw HelperError(message: "“\(name)” isn't an SF Symbol on this Mac (macOS \(osVersion)).", suggestions: suggestions(for: name))
    }
    let size = r.size ?? 17
    guard size.isFinite, size >= 1, size <= 1000 else { throw HelperError(message: "A symbol's size is 1 to 1000 points, not \(String(format: "%g", size)).") }
    let w = (r.weight ?? "regular").lowercased()
    guard let weight = weights[w] else { throw HelperError(message: "\(w) isn't a weight. Use one of \(weights.keys.sorted().joined(separator: ", ")).") }
    let sc = (r.scale ?? "medium").lowercased()
    guard let scale = scales[sc] else { throw HelperError(message: "\(sc) isn't a scale. Use small, medium or large.") }
    let colors = try (r.colors?.isEmpty == false ? r.colors! : ["#000000"]).prefix(3).map(color)
    return Spec(name: name, size: CGFloat(size), weight: weight, scale: scale, colors: colors)
}

/// Image(systemName:) as SwiftUI draws it. One color is the monochrome rendering mode; two or three are palette.
@MainActor func symbolView(_ s: Spec) -> some View {
    let c = s.colors
    return Image(systemName: s.name)
        .font(.system(size: s.size, weight: s.weight))
        .imageScale(s.scale)
        .symbolRenderingMode(c.count > 1 ? .palette : .monochrome)
        .foregroundStyle(c[0], c.count > 1 ? c[1] : c[0], c.count > 2 ? c[2] : c[0])
}

/// The symbol as a one-page PDF (vector paths) and its frame in points.
@available(macOS 13.0, *)
@MainActor func drawPDF(_ s: Spec) throws -> (data: Data, size: CGSize) {
    let renderer = ImageRenderer(content: symbolView(s))
    let data = NSMutableData()
    var frame = CGSize.zero
    var failed = false
    renderer.render { size, draw in
        frame = size
        var box = CGRect(origin: .zero, size: size)
        guard let consumer = CGDataConsumer(data: data as CFMutableData), let ctx = CGContext(consumer: consumer, mediaBox: &box, nil) else {
            failed = true
            return
        }
        ctx.beginPDFPage(nil)
        draw(ctx)
        ctx.endPDFPage()
        ctx.closePDF()
    }
    if failed || frame.width <= 0 || frame.height <= 0 { throw HelperError(message: "Couldn't draw \(s.name).") }
    return (data as Data, frame)
}

/// A PNG at `pixelScale` with the same frame as the PDF, plus the overflow around it, so PNG and SVG answers line up.
@available(macOS 13.0, *)
@MainActor func drawPNG(_ s: Spec, frame: CGSize, overflow o: Insets, pixelScale: CGFloat) throws -> Data {
    let renderer = ImageRenderer(content: symbolView(s).frame(width: frame.width, height: frame.height).padding(EdgeInsets(top: o.top, leading: o.left, bottom: o.bottom, trailing: o.right)))
    renderer.scale = pixelScale
    guard let image = renderer.cgImage, let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
        throw HelperError(message: "Couldn't draw \(s.name).")
    }
    return png
}

// MARK: PDF content stream to SVG paths
//
// SwiftUI draws a symbol as filled paths. Layers that erase others (the gap around a badge, the hole
// in a pin) arrive as luminosity soft masks, which become SVG <mask> elements.

/// Points past each edge of a symbol's frame.
struct Insets {
    var top: CGFloat = 0, right: CGFloat = 0, bottom: CGFloat = 0, left: CGFloat = 0
    var isEmpty: Bool { top == 0 && right == 0 && bottom == 0 && left == 0 }

    init() {}

    /// How far `drawn` reaches past a frame of `size` at the origin. Slivers under 0.01 pt are rounding.
    init(drawn: CGRect, size: CGSize) {
        guard !drawn.isNull else { return }
        let past = { (v: CGFloat) in v > 0.01 ? (v * 1000).rounded(.up) / 1000 : 0 }
        (top, right, bottom, left) = (past(-drawn.minY), past(drawn.maxX - size.width), past(drawn.maxY - size.height), past(-drawn.minX))
    }
}

final class Converter {
    struct State { var ctm: CGAffineTransform; var fill: String; var alpha: CGFloat; var mask: String?; var components: Int }
    var state = State(ctm: .identity, fill: "#000000", alpha: 1, mask: nil, components: 1)
    var stack: [State] = []
    var d = ""
    /// The path in `d`, for its bounds.
    var path = CGMutablePath()
    /// What the painted paths outside masks cover, in SVG coordinates. It can reach past the frame.
    var drawn = CGRect.null
    /// Masks cover the whole drawing, which is known only at the end.
    static let maskArea = "@area@"
    /// Where each mask lets paint through, when that's bounded: SwiftUI fills whole areas under some masks.
    var reveals: [String: CGRect] = [:]
    /// The masks being converted: whether they're luminosity masks, and where they let paint through so far.
    var building: [(luminosity: Bool, reveal: CGRect)] = []
    var out: [String] = []
    var defs: [String] = []
    var masks = 0
    var images = 0
    /// Soft masks being converted right now: a masked path inside one is a mask inside a mask.
    var maskDepth = 0
    var nestedMasks = false
    var unsupported: Set<String> = []
    let width: CGFloat, height: CGFloat
    let table: CGPDFOperatorTableRef
    var streams: [CGPDFContentStreamRef] = []

    init(width: CGFloat, height: CGFloat, table: CGPDFOperatorTableRef) { self.width = width; self.height = height; self.table = table }

    static func of(_ info: UnsafeMutableRawPointer?) -> Converter { Unmanaged<Converter>.fromOpaque(info!).takeUnretainedValue() }

    /// A PDF point in SVG coordinates (y down).
    func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        let p = CGPoint(x: x, y: y).applying(state.ctm)
        // Masks paint "infinite" rectangles; pull those corners in to just outside the drawing.
        let far = 4 * max(width, height)
        return CGPoint(x: min(max(p.x, -far), width + far), y: height - min(max(p.y, -far), height + far))
    }

    func str(_ p: CGPoint) -> String { "\(fmt(p.x)) \(fmt(p.y))" }

    func move(_ p: CGPoint) {
        d += "M\(str(p)) "
        path.move(to: p)
    }

    func line(_ p: CGPoint) {
        d += "L\(str(p)) "
        if path.isEmpty { path.move(to: p) } else { path.addLine(to: p) }
    }

    func curve(_ c1: CGPoint, _ c2: CGPoint, _ p: CGPoint) {
        d += "C\(str(c1)) \(str(c2)) \(str(p)) "
        if path.isEmpty { path.move(to: p) } else { path.addCurve(to: p, control1: c1, control2: c2) }
    }

    func close() {
        d += "Z "
        if !path.isEmpty { path.closeSubpath() }
    }

    func discard() {
        d = ""
        path = CGMutablePath()
    }

    func fmt(_ v: CGFloat) -> String {
        let r = ((v.isFinite ? min(max(v, -1e6), 1e6) : 0) * 1000).rounded() / 1000
        if r == r.rounded() { return String(Int(r)) }
        var text = String(format: "%.3f", Double(r))
        while text.hasSuffix("0") { text.removeLast() }
        return text
    }

    func emit(evenOdd: Bool) {
        defer { discard() }
        guard !d.isEmpty else { return }
        if maskDepth > 0 && state.mask != nil { nestedMasks = true }
        // Bounds without control points, and only where the path's mask lets it through.
        var box = path.boundingBoxOfPath
        if let mask = state.mask, let reveal = reveals[mask] { box = box.intersection(reveal) }
        if let last = building.indices.last {
            // Black paints nothing into a luminosity mask.
            if state.alpha > 0 && !(building[last].luminosity && state.fill == "#000000") { building[last].reveal = building[last].reveal.union(box) }
        } else if state.alpha > 0 {
            drawn = drawn.union(box)
        }
        let opacity = state.alpha < 1 ? " fill-opacity=\"\(fmt(state.alpha))\"" : ""
        let mask = state.mask.map { " mask=\"url(#\($0))\"" } ?? ""
        out.append("<path d=\"\(d.trimmingCharacters(in: .whitespaces))\" fill=\"\(state.fill)\"\(evenOdd ? " fill-rule=\"evenodd\"" : "")\(opacity)\(mask)/>")
    }

    func run(_ stream: CGPDFContentStreamRef) {
        streams.append(stream)
        let scanner = CGPDFScannerCreate(stream, table, Unmanaged.passUnretained(self).toOpaque())
        CGPDFScannerScan(scanner)
        CGPDFScannerRelease(scanner)
        streams.removeLast()
    }

    func resource(_ category: String, _ name: UnsafePointer<CChar>) -> CGPDFObjectRef? {
        guard let stream = streams.last else { return nil }
        return CGPDFContentStreamGetResource(stream, category, name)
    }

    /// A form XObject: its Matrix applies on top of the current transform.
    func runForm(_ form: CGPDFStreamRef) {
        guard let dict = CGPDFStreamGetDictionary(form) else { return }
        var matrix: CGPDFArrayRef?
        if CGPDFDictionaryGetArray(dict, "Matrix", &matrix), let matrix, CGPDFArrayGetCount(matrix) == 6 {
            var m = [CGPDFReal](repeating: 0, count: 6)
            for i in 0..<6 { CGPDFArrayGetNumber(matrix, i, &m[i]) }
            state.ctm = CGAffineTransform(a: m[0], b: m[1], c: m[2], d: m[3], tx: m[4], ty: m[5]).concatenating(state.ctm)
        }
        var resources: CGPDFDictionaryRef?
        CGPDFDictionaryGetDictionary(dict, "Resources", &resources)
        guard let parent = streams.last else { return }
        let stream = CGPDFContentStreamCreateWithStream(form, resources ?? dict, parent)
        run(stream)
        CGPDFContentStreamRelease(stream)
    }

    /// A soft mask (ExtGState SMask) as an SVG mask over everything painted until the state is restored.
    func softMask(_ smask: CGPDFDictionaryRef) -> String? {
        var group: CGPDFStreamRef?
        guard CGPDFDictionaryGetStream(smask, "G", &group), let group else { return nil }
        var kind: UnsafePointer<CChar>?
        let luminosity = CGPDFDictionaryGetName(smask, "S", &kind) && kind.map { String(cString: $0) } == "Luminosity"
        var backdrop: CGPDFReal = 0
        var bc: CGPDFArrayRef?
        if CGPDFDictionaryGetArray(smask, "BC", &bc), let bc { CGPDFArrayGetNumber(bc, 0, &backdrop) }
        let saved = (state, stack, out, d, path)
        state = State(ctm: state.ctm, fill: "#000000", alpha: 1, mask: nil, components: 1)
        stack = []
        out = []
        path = CGMutablePath()
        building.append((luminosity, .null))
        maskDepth += 1
        runForm(group)
        maskDepth -= 1
        let reveal = building.removeLast().reveal
        let children = out.joined()
        (state, stack, out, d, path) = saved
        let id = "m\(masks)"
        masks += 1
        // A luminosity mask over a light backdrop lets everything through but what it paints black.
        if !(luminosity && backdrop > 0) { reveals[id] = reveal }
        let base = luminosity ? "<rect \(Converter.maskArea) fill=\"\(hex(backdrop, backdrop, backdrop))\"/>" : ""
        defs.append("<mask id=\"\(id)\" maskUnits=\"userSpaceOnUse\" \(Converter.maskArea)\(luminosity ? "" : " style=\"mask-type:alpha\"")>\(base)\(children)</mask>")
        return id
    }
}

func numbers(_ scanner: CGPDFScannerRef, _ count: Int) -> [CGFloat] {
    var out = [CGFloat](repeating: 0, count: count)
    for i in (0..<count).reversed() {
        var v: CGPDFReal = 0
        CGPDFScannerPopNumber(scanner, &v)
        out[i] = v
    }
    return out
}

/// Components of a color space operand of `cs`: device spaces by name, ICC profiles by their N.
func components(_ c: Converter, _ name: UnsafePointer<CChar>) -> Int {
    switch String(cString: name) {
    case "DeviceGray", "CalGray": return 1
    case "DeviceRGB", "CalRGB": return 3
    case "DeviceCMYK": return 4
    default: break
    }
    guard let obj = c.resource("ColorSpace", name) else { return 3 }
    var array: CGPDFArrayRef?, stream: CGPDFStreamRef?
    guard CGPDFObjectGetValue(obj, .array, &array), let array, CGPDFArrayGetStream(array, 1, &stream), let stream, let dict = CGPDFStreamGetDictionary(stream) else { return 3 }
    var n: CGPDFInteger = 3
    CGPDFDictionaryGetInteger(dict, "N", &n)
    return Int(n)
}

func hex(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> String {
    let (r, g, b) = (r.isFinite ? r : 0, g.isFinite ? g : 0, b.isFinite ? b : 0)
    return String(format: "#%02X%02X%02X", Int((min(max(r, 0), 1) * 255).rounded()), Int((min(max(g, 0), 1) * 255).rounded()), Int((min(max(b, 0), 1) * 255).rounded()))
}

func colorHex(_ n: [CGFloat]) -> String? {
    switch n.count {
    case 1: return hex(n[0], n[0], n[0])
    case 3: return hex(n[0], n[1], n[2])
    case 4: return hex((1 - n[0]) * (1 - n[3]), (1 - n[1]) * (1 - n[3]), (1 - n[2]) * (1 - n[3]))
    default: return nil
    }
}

/// The PDF drawing as SVG, or why it can't be one (a bitmap, masks inside masks, drawing the converter
/// skips), and how far its paths reach past the frame either way.
func svg(fromPDF data: Data, size: CGSize) -> (svg: String?, reason: String?, overflow: Insets) {
    guard let provider = CGDataProvider(data: data as CFData), let doc = CGPDFDocument(provider), let page = doc.page(at: 1) else { return (nil, "the PDF drawing didn't parse", Insets()) }
    let table = CGPDFOperatorTableCreate()!
    defer { CGPDFOperatorTableRelease(table) }
    func op(_ name: String, _ body: @escaping CGPDFOperatorCallback) { CGPDFOperatorTableSetCallback(table, name, body) }
    op("q") { _, info in let c = Converter.of(info); c.stack.append(c.state) }
    op("Q") { _, info in let c = Converter.of(info); if let s = c.stack.popLast() { c.state = s } }
    op("cm") { s, info in let c = Converter.of(info); let n = numbers(s, 6); c.state.ctm = CGAffineTransform(a: n[0], b: n[1], c: n[2], d: n[3], tx: n[4], ty: n[5]).concatenating(c.state.ctm) }
    op("m") { s, info in let c = Converter.of(info); let n = numbers(s, 2); c.move(c.pt(n[0], n[1])) }
    op("l") { s, info in let c = Converter.of(info); let n = numbers(s, 2); c.line(c.pt(n[0], n[1])) }
    op("c") { s, info in let c = Converter.of(info); let n = numbers(s, 6); c.curve(c.pt(n[0], n[1]), c.pt(n[2], n[3]), c.pt(n[4], n[5])) }
    op("h") { _, info in Converter.of(info).close() }
    op("re") { s, info in
        let c = Converter.of(info); let n = numbers(s, 4)
        c.move(c.pt(n[0], n[1]))
        c.line(c.pt(n[0] + n[2], n[1]))
        c.line(c.pt(n[0] + n[2], n[1] + n[3]))
        c.line(c.pt(n[0], n[1] + n[3]))
        c.close()
    }
    op("f") { _, info in Converter.of(info).emit(evenOdd: false) }
    op("F") { _, info in Converter.of(info).emit(evenOdd: false) }
    op("f*") { _, info in Converter.of(info).emit(evenOdd: true) }
    // Clip paths are the forms' bounding boxes; the drawing stays inside them anyway.
    op("n") { _, info in Converter.of(info).discard() }
    for stroke in ["S", "s", "B", "B*", "b", "b*", "v", "y", "sh", "BI"] {
        op(stroke) { _, info in let c = Converter.of(info); c.unsupported.insert("strokes or shadings"); c.discard() }
    }
    op("cs") { s, info in
        let c = Converter.of(info)
        var name: UnsafePointer<CChar>?
        if CGPDFScannerPopName(s, &name), let name { c.state.components = components(c, name) }
    }
    op("rg") { s, info in let c = Converter.of(info); c.state.fill = colorHex(numbers(s, 3)) ?? c.state.fill }
    op("g") { s, info in let c = Converter.of(info); c.state.fill = colorHex(numbers(s, 1)) ?? c.state.fill }
    op("k") { s, info in let c = Converter.of(info); c.state.fill = colorHex(numbers(s, 4)) ?? c.state.fill }
    op("sc") { s, info in let c = Converter.of(info); c.state.fill = colorHex(numbers(s, c.state.components)) ?? c.state.fill }
    op("scn") { s, info in let c = Converter.of(info); c.state.fill = colorHex(numbers(s, c.state.components)) ?? c.state.fill }
    op("gs") { s, info in
        let c = Converter.of(info)
        var name: UnsafePointer<CChar>?
        guard CGPDFScannerPopName(s, &name), let name, let obj = c.resource("ExtGState", name) else { return }
        var state: CGPDFDictionaryRef?
        guard CGPDFObjectGetValue(obj, .dictionary, &state), let state else { return }
        var ca: CGPDFReal = 1
        if CGPDFDictionaryGetNumber(state, "ca", &ca) { c.state.alpha = ca }
        var smask: CGPDFDictionaryRef?
        if CGPDFDictionaryGetDictionary(state, "SMask", &smask), let smask { c.state.mask = c.softMask(smask) }
        var none: UnsafePointer<CChar>?
        if CGPDFDictionaryGetName(state, "SMask", &none) { c.state.mask = nil }
        var blend: UnsafePointer<CChar>?
        if CGPDFDictionaryGetName(state, "BM", &blend), let blend, !["Normal", "Compatible"].contains(String(cString: blend)) { c.unsupported.insert("blend modes") }
    }
    op("Do") { s, info in
        let c = Converter.of(info)
        var name: UnsafePointer<CChar>?
        guard CGPDFScannerPopName(s, &name), let name, let obj = c.resource("XObject", name) else { return }
        var stream: CGPDFStreamRef?
        guard CGPDFObjectGetValue(obj, .stream, &stream), let stream, let dict = CGPDFStreamGetDictionary(stream) else { return }
        var subtype: UnsafePointer<CChar>?
        CGPDFDictionaryGetName(dict, "Subtype", &subtype)
        if subtype.map({ String(cString: $0) }) == "Form" {
            let saved = c.state
            c.runForm(stream)
            c.state = saved
        } else {
            c.images += 1
        }
    }
    let converter = Converter(width: size.width, height: size.height, table: table)
    let content = CGPDFContentStreamCreateWithPage(page)
    converter.run(content)
    CGPDFContentStreamRelease(content)
    let o = Insets(drawn: converter.drawn, size: size)
    // Reasons read as "it uses …" in Sonobe's import notes.
    if converter.images > 0 { return (nil, "bitmap drawing", o) }
    // resvg, which draws Sonobe's headless screenshots, can't draw a mask inside a mask.
    if converter.nestedMasks { return (nil, "masks inside masks", o) }
    if !converter.unsupported.isEmpty { return (nil, converter.unsupported.sorted().joined(separator: " and "), o) }
    // Paths keep the frame's coordinates; the viewBox and the masks grow to cover what reaches past it.
    let f = converter.fmt
    let x = f(-o.left), y = f(-o.top), w = f(size.width + o.left + o.right), h = f(size.height + o.top + o.bottom)
    let area = "x=\"\(x)\" y=\"\(y)\" width=\"\(w)\" height=\"\(h)\""
    let defs = converter.defs.isEmpty ? "" : "<defs>\(converter.defs.joined().replacingOccurrences(of: Converter.maskArea, with: area))</defs>"
    return ("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"\(w)\" height=\"\(h)\" viewBox=\"\(x) \(y) \(w) \(h)\">\(defs)\(converter.out.joined())</svg>", nil, o)
}

let rounded = { (v: CGFloat) in (Double(v) * 1000).rounded() / 1000 }

/// One batch request: an SVG when the converter can express the symbol, else a 3x PNG.
@MainActor func answer(_ request: Request) -> Answer {
    var out = Answer(id: request.id, ok: false)
    guard #available(macOS 13.0, *) else {
        out.error = "Drawing SF Symbols needs macOS 13 or later; this Mac has macOS \(osVersion)."
        return out
    }
    do {
        let s = try spec(request)
        let (pdf, frame) = try drawPDF(s)
        out.width = rounded(frame.width)
        out.height = rounded(frame.height)
        let converted = svg(fromPDF: pdf, size: frame)
        let o = converted.overflow
        if !o.isEmpty { out.overflow = [o.top, o.right, o.bottom, o.left].map(rounded) }
        if let markup = converted.svg, request.format != "png" {
            out.svg = markup
        } else {
            out.png = try drawPNG(s, frame: frame, overflow: o, pixelScale: 3).base64EncodedString()
            out.pixelScale = 3
            out.fallback = request.format == "png" ? "a PNG request" : converted.reason
        }
        if let note = Catalog.restrictions[s.name] { out.restriction = note }
        out.ok = true
    } catch let err as HelperError {
        out.error = err.message
        if !err.suggestions.isEmpty { out.suggestions = err.suggestions }
    } catch {
        out.error = "Couldn't draw \(request.name): \(error.localizedDescription)"
    }
    return out
}

func write(_ data: Data, to handle: FileHandle = .standardOutput) {
    handle.write(data)
}

func fail(_ message: String) -> Never {
    write(Data(("sfsymbol: " + message + "\n").utf8), to: .standardError)
    exit(1)
}

/// JSON lines in, JSON lines out, until stdin closes. A bad line gets an error answer; the batch goes on.
@MainActor func batch() {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    let decoder = JSONDecoder()
    while let line = readLine(strippingNewline: true) {
        if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
        autoreleasepool {
            var result: Answer
            do {
                result = answer(try decoder.decode(Request.self, from: Data(line.utf8)))
            } catch {
                result = Answer(id: nil, ok: false, error: "That line isn't a symbol request: \(error.localizedDescription)")
            }
            var data = (try? encoder.encode(result)) ?? Data(#"{"ok":false,"error":"Couldn't encode the answer."}"#.utf8)
            data.append(0x0A)
            write(data)
        }
    }
}

/// One symbol from the command line, for trying things by hand.
@MainActor func single(_ args: [String]) {
    var request = Request(name: "")
    var format = "svg"
    var rest = args
    while !rest.isEmpty {
        let arg = rest.removeFirst()
        func value() -> String {
            if rest.isEmpty { fail("\(arg) needs a value.") }
            return rest.removeFirst()
        }
        switch arg {
        case "--size": request.size = Double(value())
        case "--weight": request.weight = value()
        case "--scale": request.scale = value()
        case "--color": request.colors = value().split(separator: ",").map(String.init)
        case "--format": format = value()
        default:
            if arg.hasPrefix("--") { fail("\(arg) isn't an option. Use --size, --weight, --scale, --color or --format.") }
            request.name = arg
        }
    }
    if request.name.isEmpty { fail("name a symbol, like heart.fill, or pass --batch or --list.") }
    guard ["svg", "png", "pdf"].contains(format) else { fail("\(format) isn't a format. Use svg, png or pdf.") }
    guard #available(macOS 13.0, *) else { fail("drawing SF Symbols needs macOS 13 or later; this Mac has macOS \(osVersion).") }
    if format == "pdf" {
        do { write(try drawPDF(try spec(request)).data) } catch let err as HelperError { fail(err.message) } catch { fail(error.localizedDescription) }
        return
    }
    request.format = format
    let result = answer(request)
    guard result.ok else {
        let hint = result.suggestions.map { " Did you mean \($0.joined(separator: ", "))? Run --list to see every name." } ?? ""
        fail((result.error ?? "couldn't draw \(request.name).") + hint)
    }
    if let markup = result.svg {
        write(Data((markup + "\n").utf8))
    } else if let png = result.png, let bytes = Data(base64Encoded: png) {
        if format == "svg" { write(Data("sfsymbol: \(request.name) is a 3x PNG: it uses \(result.fallback ?? "drawing the SVG converter skips").\n".utf8), to: .standardError) }
        write(bytes)
    }
}

MainActor.assumeIsolated {
    let args = Array(CommandLine.arguments.dropFirst())
    switch args.first {
    case "--list":
        if Catalog.names.isEmpty { fail("this Mac has no symbol list (macOS \(osVersion)).") }
        write(Data((Catalog.names.joined(separator: "\n") + "\n").utf8))
    case "--batch": batch()
    default: single(args)
    }
}
