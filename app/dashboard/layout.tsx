import { DashboardSidebar } from "@/components/layout/DashboardSidebar";
import { ClientContextProvider } from "@/context/ClientContext";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClientContextProvider>
      <div className="flex h-screen overflow-hidden print:h-auto print:overflow-visible print:block">
        <DashboardSidebar />
        <main className="flex-1 overflow-y-auto bg-[#F9FAFB] print:overflow-visible print:p-0">
          {children}
        </main>
      </div>
    </ClientContextProvider>
  );
}
