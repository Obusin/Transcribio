import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Pricing is off while the app is free for testing. Temporary, not permanent,
    // so search engines don't treat the page as gone for good.
    return [{ source: "/pricing", destination: "/#free", permanent: false }];
  },
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
