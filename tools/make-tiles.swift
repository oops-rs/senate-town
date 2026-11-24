// Writes assets/ground.png: the Works' ground tiles (32 px, one row), drawn
// with Core Graphics so the Tiled map has a real tileset to edit with.
//   swift tools/make-tiles.swift
import AppKit

let T = 32, N = 8
let ctx = CGContext(data: nil, width: T * N, height: T, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
func c(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: a)
}
var seed: UInt64 = 7
func rnd() -> CGFloat { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return CGFloat(seed >> 40) / CGFloat(1 << 24) }
func tile(_ i: Int, _ base: UInt32, _ draw: (CGFloat) -> Void) {
    let x = CGFloat(i * T)
    ctx.setFillColor(c(base)); ctx.fill(CGRect(x: x, y: 0, width: CGFloat(T), height: CGFloat(T)))
    draw(x)
}
func blades(_ x: CGFloat, _ hex: UInt32, _ n: Int) {
    ctx.setStrokeColor(c(hex)); ctx.setLineWidth(1.2); ctx.setLineCap(.round)
    for _ in 0..<n {
        let px = x + 3 + rnd() * 26, py = 4 + rnd() * 24
        ctx.move(to: CGPoint(x: px, y: py)); ctx.addLine(to: CGPoint(x: px + 1, y: py + 3)); ctx.strokePath()
    }
}
// 0, 1, 2: grass (plain, blades, flowers); 3: darker grass
tile(0, 0xBFE0A6) { x in blades(x, 0xAED596, 3) }
tile(1, 0xBFE0A6) { x in blades(x, 0xA6CF8C, 7) }
tile(2, 0xBFE0A6) { x in
    blades(x, 0xAED596, 3)
    for (fx, fy, col) in [(9.0, 9.0, UInt32(0xFFF2A8)), (22, 20, 0xFFB7C5), (15, 25, 0xFFFFFF)] {
        ctx.setFillColor(c(col)); ctx.fillEllipse(in: CGRect(x: x + fx - 2, y: fy - 2, width: 4, height: 4))
    }
}
tile(3, 0xBFE0A6) { x in blades(x, 0x9CC882, 5) }
// 4, 5: paving (plaza), with seams
for (i, base) in [(4, UInt32(0xF3E6CD)), (5, 0xEFE0C3)] {
    tile(i, base) { x in
        ctx.setStrokeColor(c(0xE0CCA6)); ctx.setLineWidth(1)
        ctx.stroke(CGRect(x: x + 0.5, y: 0.5, width: 31, height: 15)); ctx.stroke(CGRect(x: x + 0.5 - 16, y: 16.5, width: 31, height: 15))
        ctx.stroke(CGRect(x: x + 16.5, y: 16.5, width: 31, height: 15))
    }
}
// 6: water; 7: packed earth
tile(6, 0x8FD3F0) { x in
    ctx.setStrokeColor(c(0xFFFFFF, 0.5)); ctx.setLineWidth(1.5); ctx.setLineCap(.round)
    ctx.move(to: CGPoint(x: x + 5, y: 10)); ctx.addQuadCurve(to: CGPoint(x: x + 15, y: 10), control: CGPoint(x: x + 10, y: 6)); ctx.strokePath()
    ctx.move(to: CGPoint(x: x + 17, y: 22)); ctx.addQuadCurve(to: CGPoint(x: x + 27, y: 22), control: CGPoint(x: x + 22, y: 18)); ctx.strokePath()
}
tile(7, 0xE9D7B5) { x in
    for _ in 0..<6 { ctx.setFillColor(c(0xD9C49C)); ctx.fillEllipse(in: CGRect(x: x + rnd() * 28, y: rnd() * 28, width: 3, height: 2)) }
}
let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "assets/ground.png")
try! rep.representation(using: .png, properties: [:])!.write(to: out)
print("wrote \(out.path)")
