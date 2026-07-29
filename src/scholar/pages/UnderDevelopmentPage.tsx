import { Wrench } from "lucide-react";

export function UnderDevelopmentPage({ title }: { title: string }) {
  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center bg-white px-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-full bg-[#F3BC00]/15 flex items-center justify-center mx-auto mb-6">
          <Wrench size={26} className="text-[#F3BC00]" />
        </div>
        <h1 className="text-2xl font-extrabold text-[#1F334F] mb-2">{title}</h1>
        <p className="text-sm text-slate-500">This page is under development. Please check back soon.</p>
      </div>
    </div>
  );
}
