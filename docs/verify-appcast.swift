// Checks an appcast enclosure: Ed25519 over the exact file, against that app's public key.
// usage: swift docs/verify-appcast.swift <downloaded.dmg> <public-key-base64> <edSignature-base64>
//   key:    the app's SUPublicEDKey (once the shim ships) or ~/.kh-sparkle/<bundle-id>/public.key
//   sig:    grep -o 'edSignature="[^"]*"' appcast.xml | cut -d'"' -f2
// Prints "SIGNATURE OK" or "SIGNATURE INVALID"; exit 0 verified, 1 invalid, 2 usage/malformed.
// (Changed 2026-11-23: an invalid signature used to print the line and still exit 0.)
import CryptoKit
import Foundation

let args = CommandLine.arguments
guard args.count == 4,
      let pub = Data(base64Encoded: args[2]), let sig = Data(base64Encoded: args[3]),
      let data = try? Data(contentsOf: URL(fileURLWithPath: args[1])) else {
    print("usage: verify-appcast <file> <public-key-base64> <signature-base64>"); exit(2)
}
guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: pub) else { print("bad public key"); exit(2) }
if key.isValidSignature(sig, for: data) {
    print("SIGNATURE OK")
} else {
    print("SIGNATURE INVALID")
    exit(1)
}
