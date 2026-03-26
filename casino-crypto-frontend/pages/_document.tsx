import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  const runtimeConfig = {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "",
  };
  const runtimeScript = `window.__RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig)};try{var k='NEXT_PUBLIC_API_URL';var v=(window.__RUNTIME_CONFIG__&&window.__RUNTIME_CONFIG__[k])||'';if(!v&&window.location&&window.location.origin){window.__RUNTIME_CONFIG__[k]=window.location.origin;}}catch(_e){}`;

  return (
    <Html lang="en">
      <Head />
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: runtimeScript,
          }}
        />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
