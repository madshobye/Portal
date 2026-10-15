// Local macOS video decoder for replay.cjs. No camera or network access.
// Protocol: one JSON line, then Float64-LE timestamp + width*height*4 RGBA per frame.
import Foundation
import AVFoundation
import Accelerate

func run() throws {
    guard (3...4).contains(CommandLine.arguments.count), let limit = Int(CommandLine.arguments[2]), limit >= 64 else {
        throw NSError(domain: "QRReplay", code: 1, userInfo: [NSLocalizedDescriptionKey: "Usage: video-frames recording.mov limit [width|long-edge]"])
    }
    let resizeMode = CommandLine.arguments.count == 4 ? CommandLine.arguments[3] : "width"
    guard ["width", "long-edge"].contains(resizeMode) else { throw NSError(domain: "QRReplay", code: 3) }
    let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
    guard let track = asset.tracks(withMediaType: .video).first else { throw NSError(domain: "QRReplay", code: 2) }
    let transform = track.preferredTransform
    let bounds = CGRect(origin: .zero, size: track.naturalSize).applying(transform).standardized
    let source = bounds.size
    let scale = min(1, Double(limit) / Double(resizeMode == "long-edge" ? max(source.width, source.height) : source.width))
    let width = max(1, Int((Double(source.width) * scale).rounded()))
    let height = max(1, Int((Double(width) * source.height / source.width).rounded()))
    let reader = try AVAssetReader(asset: asset)
    let settings: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    let output: AVAssetReaderOutput
    if transform.isIdentity {
        // Preserve the existing landscape decoding path for recorded baselines.
        output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
    } else {
        // Apply phone orientation during decoding; never rewrite the source movie.
        let composition = AVMutableVideoComposition()
        composition.renderSize = source
        composition.frameDuration = track.minFrameDuration.isNumeric && track.minFrameDuration.seconds > 0
            ? track.minFrameDuration : CMTime(seconds: 1 / Double(max(1, track.nominalFrameRate)), preferredTimescale: 60000)
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: asset.duration)
        let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
        layer.setTransform(transform.concatenating(CGAffineTransform(translationX: -bounds.minX, y: -bounds.minY)), at: .zero)
        instruction.layerInstructions = [layer]
        composition.instructions = [instruction]
        let oriented = AVAssetReaderVideoCompositionOutput(videoTracks: [track], videoSettings: settings)
        oriented.videoComposition = composition
        output = oriented
    }
    output.alwaysCopiesSampleData = false
    reader.add(output)
    guard reader.startReading() else { throw reader.error! }
    var metadata: [String: Any] = ["width":width,"height":height,"sourceWidth":Int(source.width),"sourceHeight":Int(source.height),"duration":asset.duration.seconds,"fps":Double(track.nominalFrameRate)]
    metadata["resizeMode"] = resizeMode
    metadata["addedCompression"] = "none (raw RGBA)"
    metadata["sourceBitrate"] = Double(track.estimatedDataRate)
    if let format = track.formatDescriptions.first {
        let code = CMFormatDescriptionGetMediaSubType(format as! CMFormatDescription)
        metadata["sourceCodec"] = String(bytes: [24,16,8,0].map { UInt8((code >> $0) & 255) }, encoding: .ascii) ?? String(code)
    }
    if !transform.isIdentity {
        metadata["orientationApplied"] = true
        metadata["encodedWidth"] = Int(track.naturalSize.width)
        metadata["encodedHeight"] = Int(track.naturalSize.height)
    }
    let stdout = FileHandle.standardOutput
    stdout.write(try JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys])); stdout.write(Data([10]))
    var rgba = [UInt8](repeating: 0, count: width * height * 4)
    while let sample = output.copyNextSampleBuffer() {
        try autoreleasepool {
            guard let pixels = CMSampleBufferGetImageBuffer(sample) else { return }
            CVPixelBufferLockBaseAddress(pixels, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
            var input = vImage_Buffer(data: CVPixelBufferGetBaseAddress(pixels)!, height: vImagePixelCount(CVPixelBufferGetHeight(pixels)), width: vImagePixelCount(CVPixelBufferGetWidth(pixels)), rowBytes: CVPixelBufferGetBytesPerRow(pixels))
            let status = rgba.withUnsafeMutableBytes { bytes -> vImage_Error in
                var dest = vImage_Buffer(data: bytes.baseAddress!, height: vImagePixelCount(height), width: vImagePixelCount(width), rowBytes: width * 4)
                let scaled = vImageScale_ARGB8888(&input, &dest, nil, vImage_Flags(kvImageHighQualityResampling))
                if scaled != kvImageNoError { return scaled }
                return vImagePermuteChannels_ARGB8888(&dest, &dest, [2,1,0,3], vImage_Flags(kvImageNoFlags))
            }
            guard status == kvImageNoError else { throw NSError(domain:"vImage",code:Int(status)) }
            var bits = CMSampleBufferGetPresentationTimeStamp(sample).seconds.bitPattern.littleEndian
            stdout.write(withUnsafeBytes(of: &bits) { Data($0) }); stdout.write(Data(rgba))
        }
    }
    if reader.status == .failed { throw reader.error! }
}
do { try run() }
catch { FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8)); exit(1) }
