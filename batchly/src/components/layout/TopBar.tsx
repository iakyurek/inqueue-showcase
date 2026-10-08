import { LogoutButton } from "./LogoutButton";

interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  /** kept for API compatibility — always renders dark */
  dark?: boolean;
}

export function TopBar({ title, subtitle, actions }: TopBarProps) {
  return (
    <div
      className="flex items-center justify-between px-6 py-4 shrink-0"
      style={{
        background: "rgba(10,11,13,.88)",
        backdropFilter: "blur(20px) saturate(1.4)",
        WebkitBackdropFilter: "blur(20px) saturate(1.4)",
        borderBottom: "1px solid var(--iq-line)",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}
    >
      <div>
        <h1
          className="text-[18px] font-bold leading-tight"
          style={{ color: "var(--iq-text)", letterSpacing: "-0.01em" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-[13px] mt-0.5 leading-snug" style={{ color: "var(--iq-text-3)" }}>
            {subtitle}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2.5">
        {actions}
        <LogoutButton />
      </div>
    </div>
  );
}
