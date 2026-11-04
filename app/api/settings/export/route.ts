import { handler, requireUser } from "@/lib/http";
import { exportUserData } from "@/lib/store";

/** Everything PlanAway holds about the signed-in user, as a JSON download. */
export const GET = handler(async () => {
  const user = await requireUser();
  const data = await exportUserData(user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="planaway-data-${data.exportedAt.slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
});
