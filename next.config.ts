import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Cross-origin isolation enables SharedArrayBuffer, which ONNX Runtime
        // needs for multi-threaded WASM (the CPU fallback and the VAD).
        // `credentialless` still lets us fetch models from the Hugging Face CDN.
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
