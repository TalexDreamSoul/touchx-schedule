import { handleV1ApiWithErrorBoundary } from "../../services/v1-api";

export default defineEventHandler(async (event) => {
  return await handleV1ApiWithErrorBoundary(event);
});
