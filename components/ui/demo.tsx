import { GlowCard } from "@/components/ui/spotlight-card";

export function Default() {
  return (
    <div className="w-screen h-screen flex flex-row items-center justify-center gap-10 custom-cursor">
      <GlowCard>Card 1</GlowCard>
      <GlowCard>Card 2</GlowCard>
      <GlowCard>Card 3</GlowCard>
    </div>
  );
}
