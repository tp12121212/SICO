export function decodeXmlBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  if (bytes.length >= 2) {
    const bom = `${bytes[0].toString(16)}${bytes[1].toString(16)}`.toLowerCase();
    if (bom === "fffe") {
      return new TextDecoder("utf-16le").decode(bytes).replace(/^\uFEFF/, "");
    }
    if (bom === "feff") {
      return new TextDecoder("utf-16be").decode(bytes).replace(/^\uFEFF/, "");
    }
  }

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  }

  const looksUtf16Le = bytes.length > 3 && bytes[1] === 0x00 && bytes[3] === 0x00;
  return looksUtf16Le ? new TextDecoder("utf-16le").decode(bytes) : new TextDecoder("utf-8").decode(bytes);
}

export async function readXmlFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return decodeXmlBytes(new Uint8Array(buffer)).replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
}
