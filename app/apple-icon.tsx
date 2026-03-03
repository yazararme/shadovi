import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  let fontData: ArrayBuffer | null = null;
  try {
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Exo+2:wght@900&display=block",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    ).then((r) => r.text());

    const fontUrl = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (fontUrl) {
      fontData = await fetch(fontUrl).then((r) => r.arrayBuffer());
    }
  } catch {
    // Fall through to system font
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0D0437",
          borderRadius: "36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            color: "white",
            fontSize: 128,
            fontWeight: 900,
            fontFamily: fontData ? "'Exo 2'" : "system-ui",
            lineHeight: 1,
            letterSpacing: "-2px",
          }}
        >
          S
        </span>
      </div>
    ),
    {
      ...size,
      ...(fontData
        ? { fonts: [{ name: "Exo 2", data: fontData, weight: 900 }] }
        : {}),
    }
  );
}
