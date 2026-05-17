import { TouchXApiClient } from "@touchx/api-client";
import { getSessionToken } from "./auth";

export const adminApi = new TouchXApiClient({
  baseUrl: "/api/v1",
  token: () => getSessionToken(),
});
