import { useCallback, useRef } from "react";

export default function ProfilePage() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const handleFrameLoad = useCallback(() => {
    const frame = iframeRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return;

    const html = doc.documentElement;
    const body = doc.body;

    // Keep the imported document visually integrated with app chrome.
    html.style.background = "#070707";
    body.style.background = "#070707";
    body.style.margin = "0";
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    // Figma export places footer block first; move it to bottom.
    const root = doc.getElementById("n20731272");
    const footer = doc.getElementById("n20731273");
    if (root && footer && root.lastElementChild !== footer) {
      root.appendChild(footer);
    }

    const contentHeight = Math.max(
      html.scrollHeight,
      body.scrollHeight,
      root?.scrollHeight ?? 0
    );
    frame.style.height = `${contentHeight}px`;
  }, []);

  return (
    <div className="-mx-5 -my-4 overflow-x-auto bg-[#070707]">
      <div className="flex justify-center" style={{ minWidth: 1286 }}>
        <iframe
          ref={iframeRef}
          title="Profile content"
          src="/profile-content/content-qr.html"
          onLoad={handleFrameLoad}
          style={{ width: 1286, minWidth: 1286, border: 0, display: "block" }}
        />
      </div>
    </div>
  );
}
