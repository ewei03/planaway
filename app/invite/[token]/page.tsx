import Link from "next/link";
import { auth } from "@/auth";
import { AcceptInvite } from "@/components/AcceptInvite";
import { NotFoundError, getInvitePreview, tripAccess, type InvitePreview } from "@/lib/store";

/**
 * Anyone with the link sees the trip's details here. Joining needs an account,
 * so signed-out visitors are sent to sign in and brought back.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth();

  let preview: InvitePreview | null = null;
  try {
    preview = await getInvitePreview(token);
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
  }

  let hasAccess = false;
  if (preview && session?.user?.id) {
    hasAccess = await tripAccess(session.user.id, preview.tripId).then(
      () => true,
      () => false,
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-card card">
        {preview ? (
          <AcceptInvite token={token} preview={preview} signedIn={Boolean(session?.user)} hasAccess={hasAccess} />
        ) : (
          <>
            <h1>Invite not valid</h1>
            <p className="muted">This invite link is invalid, expired, or was revoked. Ask whoever shared the trip for a new one.</p>
            <Link className="btn primary block" href="/">
              Go to PlanAway
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
