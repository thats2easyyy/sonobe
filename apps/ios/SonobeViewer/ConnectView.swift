import AVFoundation
import SwiftUI
import VisionKit

/// Before a preview is open: scan Sonobe's Preview on Phone code, paste its link, or reopen the last one.
struct ConnectView: View {
    @Bindable var model: ViewerModel
    @State private var link = ""
    @State private var scanning = false
    @State private var cameraProblem: String?

    private var canScan: Bool { DataScannerViewController.isSupported }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("In Sonobe on your computer, choose Viewer → Preview on Phone, then scan the code or paste its link. This phone needs to be on the same Wi-Fi.")
                        .foregroundStyle(.secondary)
                }
                if canScan {
                    Section {
                        Button("Scan Code", systemImage: "qrcode.viewfinder") { startScanning() }
                        if let cameraProblem {
                            Text(cameraProblem).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                Section("Preview link") {
                    // Verbatim, or SwiftUI reads the example as Markdown and draws it as a link.
                    TextField(text: $link, prompt: Text(verbatim: "http://192.168.1.20:52345/p/…/")) { Text("Preview link") }
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .onSubmit { model.open(text: link) }
                        .accessibilityIdentifier("previewLink")
                    Button("Open") { model.open(text: link) }
                        .disabled(link.isEmpty)
                    PasteButton(payloadType: String.self) { values in
                        guard let value = values.first else { return }
                        link = value
                        model.open(text: value)
                    }
                    if let error = model.inputError {
                        Text(error).font(.footnote).foregroundStyle(.red)
                    }
                }
                if let recent = model.recent {
                    Section("Recent") {
                        Button(Self.address(of: recent), systemImage: "clock.arrow.circlepath") { model.openRecent() }
                    }
                }
            }
            .navigationTitle("Sonobe Viewer")
            .sheet(isPresented: $scanning) {
                QRScanner { value in
                    scanning = false
                    model.open(text: value)
                }
                .ignoresSafeArea()
            }
        }
    }

    /// Asks for the camera the first time, and explains what to do when it's off.
    private func startScanning() {
        cameraProblem = nil
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            scanning = DataScannerViewController.isAvailable
            if !scanning { cameraProblem = "The camera isn't available right now. Paste the link instead." }
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                Task { @MainActor in
                    if granted { startScanning() } else { cameraProblem = Self.cameraOff }
                }
            }
        default:
            cameraProblem = Self.cameraOff
        }
    }

    /// "192.168.1.20:52345": which computer, and which Preview on Phone session.
    private static func address(of url: URL) -> String {
        guard let host = url.host() else { return url.absoluteString }
        return url.port.map { "\(host):\($0)" } ?? host
    }

    private static let cameraOff = "Sonobe Viewer can't use the camera. Turn on Camera for Sonobe Viewer in Settings, or paste the link instead."
}

/// VisionKit's live scanner, reporting the first QR code it reads.
private struct QRScanner: UIViewControllerRepresentable {
    let found: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced, isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(found: found) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let found: (String) -> Void
        private var done = false
        init(found: @escaping (String) -> Void) { self.found = found }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !done else { return }
            for item in addedItems {
                if case let .barcode(code) = item, let value = code.payloadStringValue {
                    done = true
                    dataScanner.stopScanning()
                    found(value)
                    return
                }
            }
        }
    }
}
