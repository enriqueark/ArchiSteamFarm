import Head from "next/head";

export default function HomePage() {
  return (
    <>
      <Head>
        <title>REDWATER</title>
      </Head>
      <div className="h-[calc(100vh-98px)] w-full overflow-hidden rounded-none bg-[#090909]">
        <iframe
          title="Figma main export"
          src="/figma-main/main-gl.html"
          className="h-full w-full border-0"
        />
      </div>
    </>
  );
}
