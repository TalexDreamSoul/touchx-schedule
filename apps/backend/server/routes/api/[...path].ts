import { handleV1ApiWithErrorBoundary } from "../../services/v1-api";
import { withNexusStateScope } from "../../services/nexus-state-manager";

export default defineEventHandler(async (event) => {
  return await withNexusStateScope(event, async () => {
    return await handleV1ApiWithErrorBoundary(event);
  });
});
