import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AcceptInvite } from "@/components/AcceptInvite";
import { NotFoundError, getInvite } from "@/lib/store";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`);

  let invite: Awaited<ReturnType<typeof getInvite>> | null = null;
  try {
    invite = await getInvite(token);
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
  }

  return (
    <main className="auth-page">
      <div className="auth-card card">
        {invite ? (
          <AcceptInvite token={token} groupName={invite.groupName} role={invite.role} />
        ) : (
          <>
            <h1>Invite not valid</h1>
            <p className="muted">This invite link is invalid or has expired. Ask the group owner for a new one.</p>
            <Link className="btn primary block" href="/">
              Go to PlanAway
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
