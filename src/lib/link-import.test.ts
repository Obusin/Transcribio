import { describe, expect, test } from "bun:test";
import { classifyLink, looksLikeMedia } from "./link-import";

describe("classifyLink", () => {
  test("plain media URLs are direct, named after the file", () => {
    expect(classifyLink("https://example.com/talks/lecture-01.mp4")).toEqual({
      kind: "direct",
      url: "https://example.com/talks/lecture-01.mp4",
      label: "lecture-01.mp4",
    });
  });

  test("a scheme-less paste is treated as https", () => {
    const p = classifyLink("example.com/a.mp3");
    expect(p.kind).toBe("direct");
    if (p.kind === "direct") expect(p.url).toBe("https://example.com/a.mp3");
  });

  test("Google Drive viewer links are rewritten to the download endpoint", () => {
    const p = classifyLink("https://drive.google.com/file/d/1AbC-xyz_9/view?usp=sharing");
    expect(p.kind).toBe("direct");
    if (p.kind === "direct") {
      expect(p.url).toBe("https://drive.usercontent.google.com/download?id=1AbC-xyz_9&export=download&confirm=t");
    }
  });

  test("Google Drive open?id= links work too", () => {
    const p = classifyLink("https://drive.google.com/open?id=XYZ123");
    expect(p.kind === "direct" && p.url.includes("id=XYZ123")).toBe(true);
  });

  test("Drive folder links are refused", () => {
    expect(classifyLink("https://drive.google.com/drive/folders/abc").kind).toBe("invalid");
  });

  test("Dropbox share links ask for the raw file", () => {
    const p = classifyLink("https://www.dropbox.com/scl/fi/abc/meeting.m4a?rlkey=k&dl=0");
    expect(p.kind).toBe("direct");
    if (p.kind === "direct") {
      expect(p.url).toContain("raw=1");
      expect(p.url).not.toContain("dl=0");
      expect(p.label).toBe("meeting.m4a");
    }
  });

  test("video platforms are recognised, including short and mobile hosts", () => {
    for (const [link, name] of [
      ["https://www.youtube.com/watch?v=abc", "YouTube"],
      ["https://youtu.be/abc", "YouTube"],
      ["https://m.facebook.com/watch/?v=1", "Facebook"],
      ["https://fb.watch/xyz", "Facebook"],
      ["https://www.tiktok.com/@a/video/1", "TikTok"],
    ]) {
      expect(classifyLink(link)).toEqual({ kind: "platform", platform: name });
    }
  });

  test("a lookalike domain is not mistaken for a platform", () => {
    expect(classifyLink("https://notyoutube.com/a.mp4").kind).toBe("direct");
  });

  test("junk and non-web schemes are invalid", () => {
    expect(classifyLink("").kind).toBe("invalid");
    expect(classifyLink("file:///etc/passwd").kind).toBe("invalid");
    expect(classifyLink("ftp://example.com/a.mp3").kind).toBe("invalid");
  });
});

describe("looksLikeMedia", () => {
  test("accepts media and opaque types, rejects web pages", () => {
    expect(looksLikeMedia("video/mp4")).toBe(true);
    expect(looksLikeMedia("audio/mpeg; charset=binary")).toBe(true);
    expect(looksLikeMedia("application/octet-stream")).toBe(true);
    expect(looksLikeMedia(null)).toBe(true);
    expect(looksLikeMedia("text/html; charset=utf-8")).toBe(false);
    expect(looksLikeMedia("application/json")).toBe(false);
  });
});
