import { ImageResponse } from "next/og";

export function createPwaIcon(size: 192 | 512) {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#163631",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <svg aria-hidden="true" height={size * 0.7} viewBox="0 0 64 64" width={size * 0.7}>
        <path
          d="M32 10c8.6 8.2 14.4 15.1 14.4 23.7C46.4 43 40.1 50 32 54c-8.1-4-14.4-11-14.4-20.3C17.6 25.1 23.4 18.2 32 10Z"
          fill="#f4f1e8"
        />
        <path d="m32 20 5.7 12.3L32 44l-5.7-11.7L32 20Z" fill="#d55836" />
      </svg>
    </div>,
    {
      height: size,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
      width: size,
    },
  );
}
