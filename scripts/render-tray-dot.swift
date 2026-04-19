#!/usr/bin/env swift
// Reads src-tauri/png/tray-plain.png, overlays a red dot in the top-right,
// writes src-tauri/png/tray-dot.png at the same pixel dimensions. Run from
// the repo root:
//
//   swift scripts/render-tray-dot.swift
//
// The script lives in-repo so regenerating the unread-variant icon whenever
// the plain tray icon changes is a one-liner; no external image tooling
// (ImageMagick, PIL, sharp) is required beyond the Swift stdlib that ships
// with Xcode Command Line Tools.

import AppKit
import Foundation

let repoRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let inputURL = repoRoot.appendingPathComponent("src-tauri/png/tray-plain.png")
let outputURL = repoRoot.appendingPathComponent("src-tauri/png/tray-dot.png")

guard FileManager.default.fileExists(atPath: inputURL.path) else {
    FileHandle.standardError.write(
        "tray-plain.png not found at \(inputURL.path)\n".data(using: .utf8)!)
    exit(1)
}

// Read the source at its native pixel resolution (not point resolution —
// NSImage.size is in points, which on a retina machine is half the pixel
// count and would produce a 2x-upscaled output).
let sourceData: Data
do {
    sourceData = try Data(contentsOf: inputURL)
} catch {
    FileHandle.standardError.write("failed to read tray-plain.png: \(error)\n".data(using: .utf8)!)
    exit(2)
}
guard let sourceRep = NSBitmapImageRep(data: sourceData) else {
    FileHandle.standardError.write("failed to decode tray-plain.png\n".data(using: .utf8)!)
    exit(2)
}
let pixW = sourceRep.pixelsWide
let pixH = sourceRep.pixelsHigh

guard let outRep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: pixW,
    pixelsHigh: pixH,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 32
) else {
    FileHandle.standardError.write("failed to allocate output rep\n".data(using: .utf8)!)
    exit(3)
}

NSGraphicsContext.saveGraphicsState()
defer { NSGraphicsContext.restoreGraphicsState() }
guard let context = NSGraphicsContext(bitmapImageRep: outRep) else {
    FileHandle.standardError.write("failed to create graphics context\n".data(using: .utf8)!)
    exit(4)
}
NSGraphicsContext.current = context

let bounds = NSRect(x: 0, y: 0, width: pixW, height: pixH)
sourceRep.draw(in: bounds)

// Red dot in the top-right, sized so it reads clearly at menu-bar scale
// without swallowing the underlying glyph. White halo provides contrast
// against dark menu-bar backgrounds.
let widthF: CGFloat = CGFloat(pixW)
let heightF: CGFloat = CGFloat(pixH)
let dotDiameter: CGFloat = widthF * CGFloat(0.48)
let inset: CGFloat = 1.0
let dotX: CGFloat = widthF - dotDiameter - inset
let dotY: CGFloat = heightF - dotDiameter - inset
let dotRect = NSRect(x: dotX, y: dotY, width: dotDiameter, height: dotDiameter)

NSColor.white.setFill()
NSBezierPath(ovalIn: dotRect.insetBy(dx: -1, dy: -1)).fill()

NSColor(calibratedRed: 0.94, green: 0.23, blue: 0.23, alpha: 1.0).setFill()
NSBezierPath(ovalIn: dotRect).fill()

context.flushGraphics()

guard let pngData = outRep.representation(using: NSBitmapImageRep.FileType.png, properties: [:]) else {
    FileHandle.standardError.write("failed to encode png\n".data(using: .utf8)!)
    exit(5)
}

try pngData.write(to: outputURL)
print("wrote \(outputURL.path) (\(pixW)x\(pixH), \(pngData.count) bytes)")
