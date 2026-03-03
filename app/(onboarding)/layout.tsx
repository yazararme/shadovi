export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#F4F6F9]">
      <header className="bg-white border-b border-[#E2E8F0]">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center py-5 sm:py-6">
            <span className="font-exo2 font-black text-[24px] sm:text-[28px] md:text-[32px] leading-none tracking-tight text-[#0D0437]">
              Shadovi
            </span>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-10">
        {children}
      </main>
    </div>
  );
}
