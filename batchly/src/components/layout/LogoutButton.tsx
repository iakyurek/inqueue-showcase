"use client";

// Small logout control shown in the TopBar. Clears the inQueue session cookie
// via this app's /api/auth/logout, then routes to the hub login page.
export function LogoutButton() {
  const hubUrl = process.env.NEXT_PUBLIC_INQUEUE_HUB_URL || "http://localhost:4000";
  async function handleClick() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      window.location.href = `${hubUrl}/login`;
    }
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-[12px] px-3 py-1.5 rounded-md"
      style={{
        background: "transparent",
        border: "1px solid var(--iq-line)",
        color: "var(--iq-text-3)",
        cursor: "pointer",
      }}
      title="Sign out of inQueue"
    >
      Log out
    </button>
  );
}
