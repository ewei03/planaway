import { EXPORTS, ExportUnavailable, exportFilename, type ExportFormat } from "@/lib/export";
import { handler, jsonError, requireUser, type IdParams } from "@/lib/http";
import { getItineraryForExport } from "@/lib/store";

export const GET = handler(async (req: Request, { params }: IdParams) => {
  const user = await requireUser();
  const query = new URL(req.url).searchParams;
  const format = (query.get("format") ?? "csv") as ExportFormat;
  // hasOwn, not `in`: "toString" and friends are inherited keys.
  if (!Object.hasOwn(EXPORTS, format)) {
    return jsonError(`Unknown format. Use one of: ${Object.keys(EXPORTS).join(", ")}.`, 400);
  }
  const versionId = query.get("version");
  const itinerary = await getItineraryForExport(user.id, (await params).id, versionId);
  if (!itinerary) {
    return jsonError(versionId ? "Saved version not found." : "There is no itinerary to export yet.", 404);
  }
  const { mime, render } = EXPORTS[format];
  let content: string;
  try {
    content = render(itinerary);
  } catch (err) {
    if (err instanceof ExportUnavailable) return jsonError(err.message, 422);
    throw err;
  }
  return new Response(content, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${exportFilename(itinerary, format)}"`,
    },
  });
});
