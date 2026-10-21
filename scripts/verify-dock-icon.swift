import AppKit
import Foundation

// Read the icon through the same running-application metadata used by the Dock.
// This catches a valid ICNS that was omitted from the app's Info.plist or bundle.
func pixels(_ image: NSImage) -> [UInt8] {
    let size = 128
    let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: size * 4,
        bitsPerPixel: 32
    )!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    image.draw(in: NSRect(x: 0, y: 0, width: size, height: size),
               from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    return Array(UnsafeBufferPointer(start: bitmap.bitmapData, count: size * size * 4))
}

func difference(_ left: [UInt8], _ right: [UInt8]) -> Double {
    zip(left, right).reduce(0.0) { $0 + abs(Double($1.0) - Double($1.1)) }
        / Double(left.count)
}

guard CommandLine.arguments.count >= 3,
      let pid = Int32(CommandLine.arguments[2]) else {
    fatalError("Usage: verify-dock-icon.swift <app bundle> <running pid> [preview.png]")
}
let appURL = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
guard let bundle = Bundle(url: appURL),
      let iconName = bundle.object(forInfoDictionaryKey: "CFBundleIconFile") as? String,
      let resources = bundle.resourceURL,
      let expected = NSImage(contentsOf: resources.appendingPathComponent(
        iconName.hasSuffix(".icns") ? iconName : iconName + ".icns"
      )),
      let running = NSRunningApplication(processIdentifier: pid),
      let actual = running.icon,
      running.bundleURL?.standardizedFileURL == appURL else {
    fatalError("Running app must resolve its own bundle and declared icon")
}
let expectedPixels = pixels(expected)
let dockDifference = difference(expectedPixels, pixels(actual))
let finderDifference = difference(
    expectedPixels, pixels(NSWorkspace.shared.icon(forFile: appURL.path))
)
// Allow system color conversion/resampling; a generic placeholder differs widely.
guard dockDifference < 8, finderDifference < 8 else {
    fatalError("macOS resolved a stale/placeholder icon: Dock=\(dockDifference), Finder=\(finderDifference)")
}
if CommandLine.arguments.count > 3,
   let tiff = actual.tiffRepresentation,
   let bitmap = NSBitmapImageRep(data: tiff),
   let png = bitmap.representation(using: .png, properties: [:]) {
    try png.write(to: URL(fileURLWithPath: CommandLine.arguments[3]))
}
print("{\"dockIconVerified\":true,\"finderIconVerified\":true,\"dockPixelDifference\":\(dockDifference),\"finderPixelDifference\":\(finderDifference)}")
