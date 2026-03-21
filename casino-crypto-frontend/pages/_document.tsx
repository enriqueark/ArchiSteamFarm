import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  const runtimeConfig = {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "",
  };

  return (
    <Html lang="en">
      <Head />
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig)};`,
          }}
        />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
