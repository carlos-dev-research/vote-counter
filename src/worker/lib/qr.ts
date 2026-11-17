import { renderSVG } from "uqr";

/** SVG QR code for the given URL. Medium error correction survives a slightly blurry projector. */
export function qrSvg(url: string): string {
  return renderSVG(url, { ecc: "M", border: 2 });
}
