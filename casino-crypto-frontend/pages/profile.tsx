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
      <div className="-mx-5 -my-4 overflow-x-auto">
        <div
          style={{ minWidth: 1286 }}
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

  return {
    props: {
      profileMarkup,
    },
  };
};
