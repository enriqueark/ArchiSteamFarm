export default function ProfilePage() {
  return (
    <div className="-mx-5 -my-4 h-full min-h-[calc(100vh-130px)] overflow-hidden rounded-[12px] bg-[#070707]">
      <iframe
        title="Profile content"
        src="/profile-content/content-qr.html"
        className="h-full min-h-[calc(100vh-130px)] w-full border-0"
      />
    </div>
  );
}
