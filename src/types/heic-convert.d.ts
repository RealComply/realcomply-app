// heic-convert ships no types of its own. Only the Node entry point and only
// the one call shape this product uses — a wider guess would be a fiction with
// a type annotation on it.
declare module "heic-convert" {
  function convert(options: {
    buffer: Buffer | Uint8Array;
    format: "JPEG" | "PNG";
    /** JPEG only, 0–1. */
    quality?: number;
  }): Promise<ArrayBuffer>;

  export = convert;
}
