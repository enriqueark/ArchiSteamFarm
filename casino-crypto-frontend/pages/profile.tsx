import fs from "node:fs";
import path from "node:path";

import type { GetStaticProps } from "next";

type ProfilePageProps = {
  profileMarkup: string;
};

export default function ProfilePage({ profileMarkup }: ProfilePageProps) {
  return (
    <>
      <style jsx global>{`
        @import url("/profile-content/content-qr.css");
      `}</style>
      <div className="-mx-5 -my-4 overflow-x-auto overflow-y-hidden">
        <div
          style={{ minWidth: 1286, width: "100%", display: "flex", justifyContent: "center" }}
          dangerouslySetInnerHTML={{ __html: profileMarkup }}
        />
      </div>
    </>
  );
}

export const getStaticProps: GetStaticProps<ProfilePageProps> = async () => {
  const htmlPath = path.join(process.cwd(), "public", "profile-content", "content-qr.html");
  let profileMarkup = fs.readFileSync(htmlPath, "utf8");

  profileMarkup = profileMarkup.replace(/<link[^>]*content-qr\.css[^>]*>\s*/i, "");
  profileMarkup = profileMarkup.replace(/src="assets\//g, 'src="/profile-content/assets/');
  // Figma export wraps the main content in a table with div children.
  // Browsers/React re-parent these nodes unpredictably, causing a broken layout.
  profileMarkup = profileMarkup.replace(/<table\b[^>]*>/i, '<div class="content-qr-table-root">');
  profileMarkup = profileMarkup.replace(/<\/table>/i, "</div>");

  return {
    props: {
      profileMarkup,
    },
  };
};
